import {
  RECOVERY_STATUS,
  createClientRuntimeAdoptionPlan,
  createProviderServiceContract,
  createRecoveryControls,
  createRecoveryHandoff,
  createRecoveryLifecycleState,
  createRecoveryStatus,
  validateClientRuntimeAdoptionPlan,
  validateProviderServiceContract
} from "./recovery-api.mjs";
import { compileRuntimeContract, validateRuntimeContract } from "./runtime-api.mjs";
import { createMailchimpStdlibContract, createStdlibWorkflowReport, validateStdlibContract } from "./stdlib-api.mjs";

export const PACKAGE_CONTRACT_VERSION = "aios.language.package.v1";

const DEFAULT_MAILCHIMP_PROVIDER_CAPABILITIES = Object.freeze([
  "mailchimp.audience:read",
  "mailchimp.campaign:write",
  "mailchimp.report:read"
]);

export function createPackageContract(input = {}) {
  const name = normalizePackageName(input.name || "mailchimp-runtime-package");
  const boundaryOptions = createPackageBoundaryOptions(input);
  const stdlib = input.stdlib || createMailchimpStdlibContract({
    adapterStatus: input.adapterStatus,
    ...boundaryOptions
  });
  const modules = normalizeModules(input.modules, stdlib);
  const runtimeContracts = modules.map((module) => compileRuntimeContract(module.source, {
    name: module.name,
    adapter: input.adapter || "mailchimp",
    adapterStatus: input.adapterStatus,
    priority: module.priority,
    ...boundaryOptions
  }));
  const manifest = createManifest({ name, modules, stdlib, runtimeContracts });
  const analytics = createPackageAnalytics({ name, manifest, stdlib, runtimeContracts });
  const provider = createMailchimpPackageProviderState({ input, manifest, analytics, runtimeContracts });
  const validation = validatePackageShape({ manifest, stdlib, runtimeContracts, analytics, provider });
  const lifecycle = createPackageLifecycleState({ input, analytics, validation, provider });
  const recovery = createPackageRecovery(name, validation, analytics, input.adapterStatus, lifecycle, provider);
  const clientAdoption = createMailchimpClientAdoptionState({ input, name, runtimeContracts, provider, lifecycle, recovery, validation });
  return Object.freeze({
    version: PACKAGE_CONTRACT_VERSION,
    kind: "aios.language.package-contract",
    manifest,
    stdlib,
    runtimeContracts: Object.freeze(runtimeContracts),
    analytics,
    provider,
    lifecycle,
    recovery,
    clientAdoption,
    status: recovery.recovery.status
  });
}

export function createMailchimpPackageContract(options = {}) {
  return createPackageContract({ ...options, name: options.name || "mailchimp-runtime-package" });
}

export function validatePackageContract(contract) {
  const errors = [];
  if (!contract || contract.version !== PACKAGE_CONTRACT_VERSION) errors.push("package contract version mismatch");
  if (!contract?.manifest?.name) errors.push("package manifest name is required");
  if (!contract?.analytics?.summary?.exportedModules) errors.push("package analytics summary is required");
  if (!contract?.lifecycle?.nextActionState) errors.push("package lifecycle next-action state is required");
  if (!contract?.clientAdoption?.nextActionState) errors.push("package client adoption next-action state is required");
  if (!contract?.analytics?.runtimeExports) errors.push("package runtime export analytics are required");
  if (!contract?.analytics?.stdlibExport) errors.push("package stdlib export analytics are required");
  if (!contract?.analytics?.stdlibWorkflow?.summary?.nextAction) errors.push("package stdlib workflow analytics are required");
  if (!contract?.clientAdoption?.workflowHandoff?.nextStep?.action) errors.push("package client workflow handoff is required");
  const adoptionValidation = validateClientRuntimeAdoptionPlan(contract?.clientAdoption);
  if (!adoptionValidation.ok) errors.push(...adoptionValidation.errors.map((error) => `clientAdoption:${error}`));
  const providerValidation = validateProviderServiceContract(contract?.provider);
  if (!providerValidation.ok) errors.push(...providerValidation.errors.map((error) => `provider:${error}`));
  const stdlibValidation = validateStdlibContract(contract?.stdlib);
  if (!stdlibValidation.ok) errors.push(...stdlibValidation.errors.map((error) => `stdlib:${error}`));
  for (const runtime of contract?.runtimeContracts || []) {
    const runtimeValidation = validateRuntimeContract(runtime);
    if (!runtimeValidation.ok) errors.push(...runtimeValidation.errors.map((error) => `runtime:${error}`));
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function selfCheckPackageApi() {
  const contract = createMailchimpPackageContract();
  const validation = validatePackageContract(contract);
  return Object.freeze({
    ok: validation.ok
      && contract.manifest.modules.length >= 3
      && contract.analytics.timeline.length >= 3
      && contract.analytics.runtimeExports.length === contract.runtimeContracts.length
      && contract.provider.negotiation.complete === true
      && contract.lifecycle.nextActionState.enabled === true
      && contract.clientAdoption.summary.runtimeBindingCount === contract.runtimeContracts.length
      && contract.clientAdoption.workflowHandoff.providerReportCount === contract.stdlib.workflow.summary.providerReportCount,
    validation,
    sample: contract
  });
}

function createPackageBoundaryOptions(input) {
  return Object.freeze({
    tenantId: input.tenantId || input.tenant,
    workspaceId: input.workspaceId || input.workspace,
    expectedTenantId: input.expectedTenantId,
    expectedWorkspaceId: input.expectedWorkspaceId,
    roles: input.roles,
    permissions: input.permissions,
    enforcePermissions: input.enforcePermissions,
    auditSink: input.auditSink || "mailchimp.package.audit"
  });
}

function normalizeModules(modules, stdlib) {
  if (Array.isArray(modules) && modules.length > 0) {
    return Object.freeze(modules.map((module, index) => normalizeModule(module, index)));
  }
  return Object.freeze(stdlib.tools.map((tool, index) => normalizeModule({
    name: `${tool.name}.module`,
    priority: index === 0 ? "high" : "normal",
    source: [
      `@job ${tool.name}`,
      ...tool.permissions.map((permission) => `@permission ${permission}`),
      `@capability ${tool.capability}`,
      `@memory ${tool.memory}`,
      `@claim ${tool.claim}`,
      "@verify claims>=1",
      "@verify capabilities>=1"
    ].join("\n")
  }, index)));
}

function normalizeModule(module, index) {
  const name = normalizeModuleName(module.name || `module-${index + 1}`);
  return Object.freeze({
    id: `pkg_module_${index + 1}`,
    name,
    source: String(module.source || `@job ${name}\n@claim ${name} requires verification`),
    priority: normalizePriority(module.priority)
  });
}

function createManifest({ name, modules, stdlib, runtimeContracts }) {
  return Object.freeze({
    name,
    exports: Object.freeze(runtimeContracts.map((runtime) => runtime.job.name)),
    modules: Object.freeze(modules.map((module, index) => Object.freeze({
      id: module.id,
      name: module.name,
      runtimeJobId: runtimeContracts[index].job.id,
      sourceDigest: runtimeContracts[index].job.sourceDigest,
      priority: module.priority
    }))),
    dependencies: Object.freeze([
      Object.freeze({
      name: stdlib.namespace,
      version: stdlib.version,
      toolCount: stdlib.tools.length,
      healthStatus: stdlib.health?.summary?.status || "unknown"
    })
    ]),
    boundaries: Object.freeze(createManifestBoundaries(runtimeContracts))
  });
}

function createPackageAnalytics({ name, manifest, stdlib, runtimeContracts }) {
  const counters = createPackageCounters({ manifest, stdlib, runtimeContracts });
  const history = createPackageHistorySnapshots({ name, counters, runtimeContracts });
  const timeline = createPackageTimeline({ manifest, stdlib, runtimeContracts, history });
  const runtimeExports = createPackageRuntimeExportSummaries(runtimeContracts);
  const stdlibExport = createPackageStdlibExportSummary(stdlib);
  const stdlibWorkflow = createPackageStdlibWorkflowSummary(stdlib);
  const exportSummary = createPackageExportSummary({ name, manifest, counters, timeline, runtimeExports, stdlibExport, stdlibWorkflow });
  const report = createPackageReportingState({ name, counters, timeline, runtimeExports, stdlibExport, stdlibWorkflow });
  return Object.freeze({
    counters,
    history,
    timeline,
    runtimeExports,
    stdlibExport,
    stdlibWorkflow,
    exportSummary,
    report,
    summary: Object.freeze({
      packageName: name,
      exportedModules: manifest.exports.length,
      status: counters.blockedRuntimes > 0 ? "blocked" : counters.degradedRuntimes > 0 ? "degraded" : "ready",
      auditEvents: counters.auditEvents,
      uniqueTenants: counters.uniqueTenants,
      uniqueWorkspaces: counters.uniqueWorkspaces,
      runtimeTimelineEvents: counters.runtimeTimelineEvents,
      stdlibStatus: stdlibExport.status,
      stdlibWorkflowAction: stdlibWorkflow.summary.nextAction
    })
  });
}

function createPackageCounters({ manifest, stdlib, runtimeContracts }) {
  const tenants = new Set(runtimeContracts.map((runtime) => runtime.boundary?.tenantId).filter(Boolean));
  const workspaces = new Set(runtimeContracts.map((runtime) => runtime.boundary?.workspaceId).filter(Boolean));
  const deniedCapabilities = runtimeContracts.reduce((count, runtime) => {
    return count + runtime.capabilities.filter((capability) => capability.allowed !== true).length;
  }, 0);
  const auditEvents = runtimeContracts.reduce((count, runtime) => count + (runtime.audit?.eventTypes?.length || 0), 0);
  return Object.freeze({
    modules: manifest.modules.length,
    exports: manifest.exports.length,
    stdlibTools: stdlib.tools.length,
    runtimeContracts: runtimeContracts.length,
    readyRuntimes: runtimeContracts.filter((runtime) => runtime.status === "ready").length,
    degradedRuntimes: runtimeContracts.filter((runtime) => runtime.status === "degraded").length,
    blockedRuntimes: runtimeContracts.filter((runtime) => runtime.status === "blocked").length,
    deniedCapabilities,
    durableMemorySlots: runtimeContracts.reduce((count, runtime) => count + runtime.memory.filter((slot) => slot.durability === "durable").length, 0),
    claims: runtimeContracts.reduce((count, runtime) => count + runtime.claims.length, 0),
    auditEvents,
    runtimeTimelineEvents: runtimeContracts.reduce((count, runtime) => count + (runtime.analytics?.timeline?.length || 0), 0),
    runtimeHistorySnapshots: runtimeContracts.reduce((count, runtime) => count + (runtime.analytics?.history?.length || 0), 0),
    stdlibTimelineEvents: stdlib.analytics?.timeline?.length || 0,
    stdlibHistorySnapshots: stdlib.analytics?.history?.length || 0,
    uniqueTenants: tenants.size,
    uniqueWorkspaces: workspaces.size
  });
}

function createPackageHistorySnapshots({ name, counters, runtimeContracts }) {
  const boundaryDigest = stablePackageDigest(runtimeContracts.map((runtime) => runtime.boundary?.isolationKey || "none").join("|"));
  return Object.freeze([
    Object.freeze({
      sequence: 1,
      label: "stdlib-linked",
      packageName: name,
      counters: Object.freeze({ stdlibTools: counters.stdlibTools, modules: counters.modules })
    }),
    Object.freeze({
      sequence: 2,
      label: "runtime-compiled",
      packageName: name,
      counters: Object.freeze({ runtimeContracts: counters.runtimeContracts, claims: counters.claims })
    }),
    Object.freeze({
      sequence: 3,
      label: "boundary-audited",
      packageName: name,
      boundaryDigest,
      counters: Object.freeze({
        uniqueTenants: counters.uniqueTenants,
        uniqueWorkspaces: counters.uniqueWorkspaces,
        deniedCapabilities: counters.deniedCapabilities
      })
    }),
    Object.freeze({
      sequence: 4,
      label: "export-report-linked",
      packageName: name,
      counters: Object.freeze({
        runtimeTimelineEvents: counters.runtimeTimelineEvents,
        runtimeHistorySnapshots: counters.runtimeHistorySnapshots,
        stdlibTimelineEvents: counters.stdlibTimelineEvents
      })
    })
  ]);
}

function createPackageTimeline({ manifest, stdlib, runtimeContracts, history }) {
  const compileEvents = runtimeContracts.map((runtime, index) => Object.freeze({
    order: index + 10,
    type: "runtime.compile",
    module: manifest.modules[index]?.name || runtime.job.name,
    jobId: runtime.job.id,
    status: runtime.status,
    tenantId: runtime.boundary?.tenantId || "unknown",
    workspaceId: runtime.boundary?.workspaceId || "unknown",
    auditId: runtime.audit?.auditId || null
  }));
  return Object.freeze([
    Object.freeze({
      order: 1,
      type: "package.create",
      packageName: manifest.name,
      status: "ready"
    }),
    Object.freeze({
      order: 2,
      type: "stdlib.health",
      namespace: stdlib.namespace,
      status: stdlib.health?.summary?.status || "unknown",
      blockedTools: stdlib.health?.summary?.blockedTools || 0,
      exportCount: stdlib.analytics?.exportSummary?.exportCount || 0
    }),
    ...compileEvents,
    ...history.map((snapshot) => Object.freeze({
      order: snapshot.sequence + 100,
      type: `history.${snapshot.label}`,
      status: "recorded",
      counters: snapshot.counters
    }))
  ]);
}

function createPackageRuntimeExportSummaries(runtimeContracts) {
  return Object.freeze(runtimeContracts.map((runtime) => Object.freeze({
    name: runtime.analytics?.exportSummary?.name || runtime.job.name,
    jobId: runtime.job.id,
    status: runtime.analytics?.exportSummary?.status || runtime.status,
    auditId: runtime.analytics?.exportSummary?.auditId || runtime.audit?.auditId || null,
    verifierDigest: runtime.analytics?.exportSummary?.verifierDigest || runtime.verifier?.digest || null,
    timelineEvents: runtime.analytics?.timeline?.length || 0,
    historySnapshots: runtime.analytics?.history?.length || 0,
    counters: runtime.analytics?.counters || Object.freeze({})
  })));
}

function createPackageStdlibExportSummary(stdlib) {
  const exportSummary = stdlib.analytics?.exportSummary || Object.freeze({
    namespace: stdlib.namespace,
    exports: Object.freeze(stdlib.tools.map((tool) => tool.name)),
    exportCount: stdlib.tools.length,
    status: stdlib.health?.summary?.status || "unknown",
    counters: Object.freeze({ tools: stdlib.tools.length })
  });
  return Object.freeze({
    namespace: exportSummary.namespace,
    exports: exportSummary.exports,
    exportCount: exportSummary.exportCount,
    status: exportSummary.status,
    lifecycle: stdlib.analytics?.lifecycleExport || stdlib.health?.lifecycle || null,
    timelineEvents: stdlib.analytics?.timeline?.length || 0,
    historySnapshots: stdlib.analytics?.history?.length || 0,
    counters: exportSummary.counters
  });
}

function createPackageStdlibWorkflowSummary(stdlib) {
  const report = createStdlibWorkflowReport(stdlib);
  return Object.freeze({
    namespace: report.namespace,
    ok: report.ok,
    summary: report.summary,
    preview: report.preview,
    acceptance: report.acceptance,
    readiness: report.readiness,
    providerReportCount: report.providerReports.length,
    handoffRequired: report.summary.handoffRequired,
    nextStep: report.preview.nextStep,
    validation: report.validation
  });
}

function createPackageExportSummary({ name, manifest, counters, timeline, runtimeExports, stdlibExport, stdlibWorkflow }) {
  return Object.freeze({
    name,
    exports: manifest.exports,
    exportCount: manifest.exports.length,
    health: counters.blockedRuntimes > 0 ? "blocked" : counters.degradedRuntimes > 0 ? "degraded" : "ready",
    counters,
    runtimeExports,
    stdlibExport,
    stdlibWorkflow: Object.freeze({
      namespace: stdlibWorkflow.namespace,
      status: stdlibWorkflow.summary.status,
      nextAction: stdlibWorkflow.summary.nextAction,
      providerReportCount: stdlibWorkflow.providerReportCount,
      handoffRequired: stdlibWorkflow.handoffRequired
    }),
    timelineEvents: timeline.length,
    generatedAt: "deterministic-compile"
  });
}

function createPackageReportingState({ name, counters, timeline, runtimeExports, stdlibExport, stdlibWorkflow }) {
  const blockedExports = runtimeExports.filter((entry) => entry.status === RECOVERY_STATUS.BLOCKED).map((entry) => entry.name);
  const degradedExports = runtimeExports.filter((entry) => entry.status === RECOVERY_STATUS.DEGRADED).map((entry) => entry.name);
  const reportStatus = blockedExports.length > 0
    ? RECOVERY_STATUS.BLOCKED
    : degradedExports.length > 0 || stdlibExport.status === RECOVERY_STATUS.DEGRADED || stdlibWorkflow.summary.status === RECOVERY_STATUS.DEGRADED
      ? RECOVERY_STATUS.DEGRADED
      : RECOVERY_STATUS.READY;
  return Object.freeze({
    name,
    status: reportStatus,
    generatedAt: "deterministic-compile",
    totals: Object.freeze({
      exports: counters.exports,
      runtimeTimelineEvents: counters.runtimeTimelineEvents,
      runtimeHistorySnapshots: counters.runtimeHistorySnapshots,
      packageTimelineEvents: timeline.length
    }),
    blockedExports: Object.freeze(blockedExports),
    degradedExports: Object.freeze(degradedExports),
    workflowHandoff: Object.freeze({
      namespace: stdlibWorkflow.namespace,
      required: stdlibWorkflow.handoffRequired,
      providerReportCount: stdlibWorkflow.providerReportCount,
      nextStep: stdlibWorkflow.nextStep,
      readinessScore: stdlibWorkflow.readiness.score,
      acceptanceState: stdlibWorkflow.acceptance.state
    }),
    nextReportAction: reportStatus === RECOVERY_STATUS.BLOCKED
      ? "request-boundary-approval"
      : reportStatus === RECOVERY_STATUS.DEGRADED
        ? "handoff"
        : "continue"
  });
}

function createManifestBoundaries(runtimeContracts) {
  const byScope = new Map();
  for (const runtime of runtimeContracts) {
    const key = runtime.boundary?.deterministicScope || "unknown/unknown";
    const current = byScope.get(key) || {
      scope: key,
      tenantId: runtime.boundary?.tenantId || "unknown",
      workspaceId: runtime.boundary?.workspaceId || "unknown",
      jobs: []
    };
    current.jobs.push(runtime.job.id);
    byScope.set(key, current);
  }
  return [...byScope.values()].map((entry) => Object.freeze({
    scope: entry.scope,
    tenantId: entry.tenantId,
    workspaceId: entry.workspaceId,
    jobCount: entry.jobs.length,
    jobs: Object.freeze(entry.jobs)
  }));
}

function validatePackageShape({ manifest, stdlib, runtimeContracts, analytics, provider }) {
  const errors = [];
  const exports = new Set(manifest.exports);
  if (exports.size !== manifest.exports.length) errors.push("package exports must be unique");
  if (analytics.counters.exports !== manifest.exports.length) errors.push("package analytics export counter mismatch");
  if (analytics.counters.runtimeContracts !== runtimeContracts.length) errors.push("package analytics runtime counter mismatch");
  if (analytics.summary.exportedModules !== manifest.exports.length) errors.push("package analytics summary mismatch");
  if (analytics.runtimeExports.length !== runtimeContracts.length) errors.push("package runtime export summary mismatch");
  if (analytics.stdlibExport.exportCount !== stdlib.tools.length) errors.push("package stdlib export summary mismatch");
  if (analytics.stdlibWorkflow.providerReportCount !== (stdlib.workflow?.summary?.providerReportCount ?? analytics.stdlibWorkflow.providerReportCount)) errors.push("package stdlib workflow provider counter mismatch");
  if (!analytics.stdlibWorkflow.nextStep?.action) errors.push("package stdlib workflow next step mismatch");
  if (analytics.report.totals.exports !== manifest.exports.length) errors.push("package report export total mismatch");
  const providerValidation = validateProviderServiceContract(provider);
  if (!providerValidation.ok) errors.push(...providerValidation.errors);
  if (provider?.negotiation?.missing?.length > 0) {
    errors.push(`package provider missing capabilities: ${provider.negotiation.missing.join(", ")}`);
  }
  const stdlibValidation = validateStdlibContract(stdlib);
  if (!stdlibValidation.ok) errors.push(...stdlibValidation.errors);
  for (const runtime of runtimeContracts) {
    const runtimeValidation = validateRuntimeContract(runtime);
    if (!runtimeValidation.ok) errors.push(...runtimeValidation.errors);
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

function createMailchimpPackageProviderState({ input, manifest, analytics, runtimeContracts }) {
  const requiredCapabilities = collectRuntimeCapabilities(runtimeContracts);
  const offeredCapabilities = input.providerCapabilities || input.offeredCapabilities || DEFAULT_MAILCHIMP_PROVIDER_CAPABILITIES;
  const providerStatus = input.providerStatus || input.serviceStatus;
  return createProviderServiceContract({
    provider: "mailchimp",
    service: input.providerService || "marketing-runtime",
    requiredCapabilities,
    offeredCapabilities,
    optionalCapabilities: input.optionalProviderCapabilities || [],
    capabilityAliases: input.providerCapabilityAliases,
    endpoints: input.providerEndpoints || {
      statusEndpoint: input.statusEndpoint,
      syncEndpoint: input.syncEndpoint,
      recoveryEndpoint: input.recoveryEndpoint
    },
    sync: {
      cursor: input.syncCursor || `pkg:${stablePackageDigest(manifest.exports.join("|"))}`,
      watermark: input.syncWatermark || "deterministic-compile",
      schedule: analytics.summary.status === "ready" ? "immediate" : analytics.summary.status === "degraded" ? "manual-review" : "backoff",
      retryAfterMs: analytics.summary.status === "ready" ? 0 : 2000,
      maxAttempts: analytics.summary.status === "blocked" ? 0 : 3,
      mode: "incremental"
    },
    signal: providerStatus,
    enabled: input.enabled
  });
}

function createPackageLifecycleState({ input, analytics, validation, provider }) {
  const controls = normalizePackageLifecycleControls(input.lifecycle || input.controls || {}, analytics, validation, provider);
  const status = createRecoveryStatus({
    status: validation.ok ? analytics.summary.status : RECOVERY_STATUS.BLOCKED,
    reason: validation.ok ? "package-ready" : "package-validation",
    recoverable: validation.ok && provider.negotiation.missing.length === 0,
    issues: validation.errors,
    controls,
    nextAction: selectPackageNextAction({ analytics, validation, provider, controls })
  });
  const state = createRecoveryLifecycleState({
    status,
    controls,
    command: input.command || status.nextAction
  });
  const settings = validatePackageLifecycleSettings({ controls, analytics, validation, provider, state });
  return Object.freeze({
    ...state,
    controls,
    settingsValidation: settings,
    enablement: Object.freeze({
      requested: controls.requestedEnabled,
      effective: state.nextActionState.enabled && settings.ok,
      reason: settings.ok ? status.reason : settings.errors[0]
    }),
    schedule: Object.freeze({
      mode: controls.schedule.mode,
      retryAfterMs: controls.schedule.retryAfterMs,
      maxAttempts: controls.maxAttempts,
      source: controls.scheduleSource
    }),
    nextActionState: Object.freeze({
      ...state.nextActionState,
      enabled: state.nextActionState.enabled && settings.ok,
      action: settings.ok ? state.nextActionState.action : "fix-settings"
    })
  });
}

function createPackageRecovery(name, validation, analytics, adapterStatus, lifecycle, provider) {
  const packageRecovery = createRecoveryStatus({
    status: validation.ok ? analytics.summary.status : "blocked",
    reason: "package-validation",
    recoverable: validation.ok && provider.negotiation.complete,
    issues: validation.errors,
    controls: lifecycle.controls,
    nextAction: lifecycle.nextActionState.action
  });
  const adapterRecovery = adapterStatus ? createRecoveryStatus(adapterStatus) : createRecoveryStatus();
  const selected = adapterRecovery.status === "ready" ? packageRecovery : adapterRecovery;
  return createRecoveryHandoff({
    stage: "package",
    source: name,
    adapter: {
      name: provider.provider,
      statusEndpoint: provider.endpoints.statusEndpoint
    },
    status: selected,
    controls: lifecycle.controls,
    command: lifecycle.nextActionState.action
  });
}

function createMailchimpClientAdoptionState({ input, name, runtimeContracts, provider, lifecycle, recovery, validation }) {
  const plan = createClientRuntimeAdoptionPlan({
    packageName: name,
    providerContract: provider,
    runtimeContracts,
    lifecycle,
    recovery: recovery.recovery,
    validation,
    clients: input.clients || input.clientAdoptionClients || createDefaultMailchimpClients(input),
    auditId: `${name}.client-adoption`,
    stage: "package-client-adoption"
  });
  const workflowHandoff = createPackageClientWorkflowHandoff({
    packageName: name,
    provider,
    lifecycle,
    recovery,
    validation,
    adoption: plan,
    stdlibWorkflow: input.stdlib?.workflow
  });
  return Object.freeze({
    ...plan,
    workflowHandoff
  });
}

function createPackageClientWorkflowHandoff({ packageName, provider, lifecycle, recovery, validation, adoption, stdlibWorkflow }) {
  const stdlibSummary = stdlibWorkflow?.summary || Object.freeze({
    status: adoption.summary.status,
    providerReportCount: provider.negotiation.requested.length,
    nextAction: adoption.summary.nextAction,
    handoffRequired: adoption.handoff.handoffRequired
  });
  const blocked = adoption.summary.blockedClientCount > 0 || provider.negotiation.missing.length > 0 || validation.ok === false;
  const status = blocked
    ? RECOVERY_STATUS.BLOCKED
    : adoption.summary.status === RECOVERY_STATUS.DEGRADED || stdlibSummary.status === RECOVERY_STATUS.DEGRADED
      ? RECOVERY_STATUS.DEGRADED
      : RECOVERY_STATUS.READY;
  const action = blocked
    ? provider.negotiation.missing.length > 0 ? "request-capability" : "request-boundary-approval"
    : stdlibSummary.nextAction || lifecycle.nextActionState.action;
  return Object.freeze({
    packageName,
    status,
    provider: provider.provider,
    service: provider.service,
    providerReportCount: stdlibSummary.providerReportCount,
    handoffRequired: stdlibSummary.handoffRequired || recovery.handoffRequired || status !== RECOVERY_STATUS.READY,
    endpoint: provider.externalHandoff.endpoint,
    missingCapabilities: provider.negotiation.missing,
    nextStep: Object.freeze({
      action,
      enabled: !blocked && lifecycle.nextActionState.enabled && adoption.summary.enabled,
      schedule: blocked ? "manual-approval" : lifecycle.nextActionState.schedule,
      retryAfterMs: blocked ? 0 : lifecycle.nextActionState.retryAfterMs,
      reason: blocked ? "package-client-workflow-blocked" : adoption.summary.reason
    }),
    validation: Object.freeze({
      ok: validation.ok && !blocked,
      errors: Object.freeze([
        ...validation.errors,
        ...provider.negotiation.missing.map((capability) => `provider missing capability ${capability}`)
      ]),
      clientBlockers: adoption.clients.filter((client) => client.status === RECOVERY_STATUS.BLOCKED).map((client) => client.id)
    })
  });
}

function createDefaultMailchimpClients(input) {
  const channels = input.clientChannels || input.channels || ["web", "api", "worker"];
  const list = Array.isArray(channels) ? channels : [channels];
  return Object.freeze(list.map((channel, index) => {
    const normalized = normalizePackageName(channel || `client-${index + 1}`);
    return Object.freeze({
      id: `mailchimp-${normalized}-client`,
      name: `Mailchimp ${normalized} client`,
      channel: normalized,
      enabled: true
    });
  }));
}

function collectRuntimeCapabilities(runtimeContracts) {
  const capabilities = runtimeContracts.flatMap((runtime) => {
    return runtime.capabilities.map((capability) => `${capability.name}:${capability.mode}`);
  });
  return Object.freeze([...new Set(capabilities)].sort());
}

function normalizePackageLifecycleControls(input, analytics, validation, provider) {
  const requestedEnabled = input.enabled ?? input.packageEnabled ?? validation.ok;
  const blocked = analytics.summary.status === "blocked" || provider.negotiation.missing.length > 0 || !validation.ok;
  const scheduleSource = input.schedule ? "input" : blocked ? "blocked" : analytics.summary.status === "degraded" ? "analytics" : "default";
  const schedule = input.schedule || (blocked ? "manual-approval" : analytics.summary.status === "degraded" ? "manual-review" : "immediate");
  const retryAfterMs = input.retryAfterMs ?? (analytics.summary.status === "degraded" ? 2000 : 0);
  const maxAttempts = blocked ? 0 : normalizePositiveInteger(input.maxAttempts, analytics.summary.status === "degraded" ? 2 : 1);
  const controls = createRecoveryControls({
    enabled: Boolean(requestedEnabled) && !blocked,
    schedule,
    retryAfterMs,
    maxAttempts,
    nextAction: input.nextAction || selectPackageNextAction({ analytics, validation, provider })
  });
  return Object.freeze({
    ...controls,
    requestedEnabled: Boolean(requestedEnabled),
    scheduleSource
  });
}

function selectPackageNextAction({ analytics, validation, provider }) {
  if (provider.negotiation.missing.length > 0) return "request-capability";
  if (!validation.ok) return "fix-settings";
  if (analytics.summary.status === "blocked") return "request-boundary-approval";
  if (analytics.summary.status === "degraded" || provider.status === RECOVERY_STATUS.DEGRADED) return "handoff";
  return "continue";
}

function validatePackageLifecycleSettings({ controls, analytics, validation, provider, state }) {
  const errors = [];
  if (!controls.requestedEnabled) errors.push("package lifecycle is disabled by request");
  if (analytics.summary.exportedModules <= 0) errors.push("package lifecycle requires exported modules");
  if (!validation.ok && controls.enabled) errors.push("invalid package lifecycle cannot be enabled");
  if (provider.negotiation.missing.length > 0 && state.nextActionState.action !== "request-capability") {
    errors.push("missing provider capabilities require request-capability action");
  }
  if (controls.schedule.mode === "immediate" && analytics.summary.status === "degraded") {
    errors.push("degraded package lifecycle cannot run immediately");
  }
  if (controls.schedule.mode === "manual-approval" && controls.enabled) {
    errors.push("manual approval schedule must remain disabled until approved");
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

function normalizePackageName(value) {
  return String(value || "package").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "package";
}

function normalizeModuleName(value) {
  return String(value || "module").trim().toLowerCase().replace(/[^a-z0-9.]+/g, ".").replace(/^\.+|\.+$/g, "") || "module";
}

function normalizePriority(value = "normal") {
  const priority = String(value || "normal").trim().toLowerCase();
  return ["low", "normal", "high"].includes(priority) ? priority : "normal";
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function stablePackageDigest(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}
