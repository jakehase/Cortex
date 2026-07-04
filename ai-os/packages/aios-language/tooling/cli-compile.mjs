import { createCompileResult } from "../api/compile-result.mjs";
import { compileAiosSource } from "../source/ast.mjs";

const TOOLCHAIN_PROTOCOL = "aios.language.cli-toolchain.v1";
const COMPILE_CONTRACT_PROTOCOL = "aios.language.cli-compile-contract.v1";
const DEFAULT_PROVIDER = "mailchimp";
const DEFAULT_ROLE = "cli-operator";

function cleanText(value) {
  return String(value ?? "").trim();
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

function optionList(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function keyedOptionMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [cleanText(key), entry])
    .filter(([key]) => key)));
}

function diagnostic(severity, code, message, path = "$", hint = "") {
  return Object.freeze({
    severity,
    code,
    message,
    path,
    ...(hint ? { hint } : {}),
  });
}

function normalizeSourceInput(source, options = {}) {
  const text = typeof source === "string" ? source : String(source?.source ?? "");
  const fileName = cleanText(options.fileName ?? source?.fileName ?? source?.sourceName) || "inline.aios";
  return Object.freeze({
    text,
    fileName,
    sourceHash: stableHash(`${fileName}\n${text}`),
  });
}

function createBoundaryProfile(jobs, statusHandoff, input, options = {}) {
  const tenantId = cleanText(options.tenantId) || "local";
  const workspaceId = cleanText(options.workspaceId) || "default";
  const actorId = cleanText(options.actorId) || cleanText(options.userId) || "cli";
  const provider = cleanText(options.provider) || statusHandoff.provider || DEFAULT_PROVIDER;
  const roles = stableList([...optionList(options.roles), DEFAULT_ROLE]);
  const requestedPermissions = stableList(jobs.flatMap((job) => job.capabilities.map((capability) => capability.name)));
  const explicitAllowedPermissions = stableList(optionList(options.allowedPermissions));
  const explicitDeniedPermissions = stableList(optionList(options.deniedPermissions));
  const allowedPermissions = explicitAllowedPermissions.length > 0
    ? requestedPermissions.filter((permission) => explicitAllowedPermissions.includes(permission))
    : requestedPermissions.filter((permission) => !explicitDeniedPermissions.includes(permission));
  const deniedPermissions = stableList([
    ...requestedPermissions.filter((permission) => explicitDeniedPermissions.includes(permission)),
    ...(explicitAllowedPermissions.length > 0
      ? requestedPermissions.filter((permission) => !explicitAllowedPermissions.includes(permission))
      : []),
  ]);
  const authorizedTenants = stableList([tenantId, ...optionList(options.authorizedTenantIds)]);
  const sourceTenants = stableList(optionList(options.sourceTenantIds));
  const crossTenantRequests = sourceTenants.filter((sourceTenantId) => !authorizedTenants.includes(sourceTenantId));
  const allowedWorkspaces = stableList([workspaceId, ...optionList(options.allowedWorkspaceIds)]);
  const workspaceRequests = stableList([workspaceId, ...optionList(options.workspaceIds)]);
  const outOfScopeWorkspaces = workspaceRequests.filter((requestedWorkspaceId) => !allowedWorkspaces.includes(requestedWorkspaceId));
  const external = statusHandoff.externalProviders.length > 0;
  const auditChannel = cleanText(options.auditChannel) || `${provider}:audit`;
  const auditRequired = external || deniedPermissions.length > 0 || crossTenantRequests.length > 0 || outOfScopeWorkspaces.length > 0;
  const isolated = crossTenantRequests.length === 0 && outOfScopeWorkspaces.length === 0;
  const permissionState = deniedPermissions.length > 0 ? "denied" : requestedPermissions.length > 0 ? "granted" : "not-requested";
  const state = isolated && permissionState !== "denied" ? external ? "review-required" : "isolated" : "blocked";

  return Object.freeze({
    protocol: "aios.language.cli-boundary-profile.v1",
    state,
    tenantId,
    workspaceId,
    actorId,
    isolationKey: stableHash(`${tenantId}:${workspaceId}:${input.sourceHash}`),
    roles,
    requestedPermissions,
    allowedPermissions: Object.freeze(allowedPermissions),
    deniedPermissions,
    permissionState,
    tenantIsolation: Object.freeze({
      isolated,
      authorizedTenants,
      sourceTenants,
      crossTenantRequests: Object.freeze(crossTenantRequests),
    }),
    workspaceScope: Object.freeze({
      allowedWorkspaces,
      requestedWorkspaces: workspaceRequests,
      outOfScopeWorkspaces: Object.freeze(outOfScopeWorkspaces),
    }),
    audit: Object.freeze({
      required: auditRequired,
      channel: auditChannel,
      subject: `${tenantId}/${workspaceId}/${actorId}`,
      handoffId: stableHash(`${auditChannel}:${tenantId}:${workspaceId}:${input.sourceHash}`),
    }),
    nextAction: state === "blocked"
      ? deniedPermissions.length > 0
        ? "resolve-cli-permission-denial"
        : "resolve-cli-tenant-workspace-boundary"
      : external
        ? "record-audit-and-request-adapter-acceptance"
        : "handoff-to-runtime-adapter",
  });
}

function descriptorJobForCompileResult(descriptor, index, options = {}) {
  const provider = cleanText(options.provider) || DEFAULT_PROVIDER;
  const capabilities = (descriptor.capabilities ?? []).map((capability) => ({
    name: capability.name,
    mode: capability.scope || "use",
    target: capability.boundary === "external" ? provider : null,
  }));
  const persistentMemory = (descriptor.memory ?? [])
    .filter((memory) => memory.mode === "persistent")
    .map((memory) => memory.name);
  const transientMemory = (descriptor.memory ?? [])
    .filter((memory) => memory.mode !== "persistent")
    .map((memory) => memory.name);
  const external = (descriptor.handoff?.providers ?? []).length > 0
    || capabilities.some((capability) => capability.target);
  const id = descriptor.id || `cli.job.${index + 1}`;
  const workflow = cleanText(options.workflow) || descriptor.sourceName || `job-${index + 1}`;

  return {
    id,
    name: descriptor.sourceName || id,
    adapter: external ? provider : "local",
    action: "dispatch",
    capabilities,
    memory: {
      reads: transientMemory,
      writes: persistentMemory,
      scopes: stableList([workflow, cleanText(options.workspaceId) || "default"]),
      localOnly: true,
    },
    verifiers: descriptor.verifier?.contracts ?? [],
    truthBoundary: {
      claims: descriptor.verifier?.truthBoundaries ?? [],
    },
    requestContract: {
      channel: "cli",
      workflow,
      tenantId: cleanText(options.tenantId) || "local",
      workspaceId: cleanText(options.workspaceId) || "default",
      clientRequestId: `${id}:cli`,
      idempotencyKey: `${id}:${stableHash(workflow)}`,
      userVisibleStatus: "compiled",
    },
    accessPolicy: {
      roles: ["cli-operator"],
      permissions: capabilities.map((capability) => capability.name),
      boundaryMode: external ? "external-reviewed" : "local-only",
      audit: {
        required: true,
        handoff: `${provider}:audit`,
      },
    },
    clientState: {
      visibleFields: ["status", "nextAction", "diagnostics"],
      hiddenFields: ["idempotencyKey"],
      persistedKeys: ["sourceHash", "descriptorId"],
    },
    persistedState: {
      commands: (descriptor.steps ?? []).map((step) => ({
        id: `${id}:${step.id}`,
        name: step.adapter,
        idempotencyKey: `${id}:${step.id}:${stableHash(JSON.stringify(step.input ?? {}))}`,
        checkpoint: `${id}:${step.id}:checkpoint`,
        replayable: true,
      })),
      checkpoints: [],
      restartSafe: true,
    },
    workflowHandoff: {
      title: `Compile ${workflow}`,
      nextAction: external ? "await-adapter-acceptance" : "handoff-to-runtime-adapter",
      userMessage: external
        ? "Compiled with external provider handoff requirements."
        : "Compiled for local runtime handoff.",
    },
    recovery: {
      retryLimit: external ? 2 : 0,
      statusOnFailure: external ? "adapter-recovery-required" : "needs-operator",
    },
    rollback: {
      required: Boolean(descriptor.rollback),
      action: descriptor.rollback?.strategy || "halt",
    },
  };
}

function providerStatusFor(provider, options = {}) {
  const acceptedProviders = stableList(optionList(options.acceptedProviders));
  const degradedProviders = stableList(optionList(options.degradedProviders));
  const failedProviders = stableList(optionList(options.failedProviders));
  const adapterStatuses = keyedOptionMap(options.adapterStatuses);
  const explicit = cleanText(adapterStatuses[provider]?.state ?? adapterStatuses[provider]?.status);
  if (failedProviders.includes(provider) || explicit === "failed" || explicit === "blocked") return "failed";
  if (degradedProviders.includes(provider) || explicit === "degraded") return "degraded";
  if (acceptedProviders.includes(provider) || explicit === "accepted" || explicit === "ready") return "accepted";
  if (explicit === "pending" || explicit === "waiting") return "pending";
  return "pending";
}

function createProviderReadiness(externalProviders, boundaryProfile = null, options = {}) {
  if (externalProviders.length === 0) {
    return Object.freeze({
      protocol: "aios.language.cli-provider-readiness.v1",
      required: false,
      state: "not-required",
      failureState: "none",
      providers: Object.freeze([]),
      acceptedProviders: Object.freeze([]),
      pendingProviders: Object.freeze([]),
      degradedProviders: Object.freeze([]),
      failedProviders: Object.freeze([]),
      retry: Object.freeze({
        retryable: false,
        attempt: 0,
        retryAfterMs: null,
        backoff: "none",
        retryLimit: 0,
      }),
      handoff: null,
      actionableErrors: Object.freeze([]),
      nextAction: "handoff-to-runtime-adapter",
    });
  }

  const retryAttempt = Math.max(0, Number.parseInt(options.adapterRetryAttempt ?? options.retryAttempt ?? 0, 10) || 0);
  const retryLimit = Math.max(0, Number.parseInt(options.adapterRetryLimit ?? 2, 10) || 0);
  const baseDelayMs = Math.max(250, Number.parseInt(options.adapterRetryBaseDelayMs ?? 1000, 10) || 1000);
  const adapterStatuses = keyedOptionMap(options.adapterStatuses);
  const providerEntries = externalProviders.map((provider) => {
    const status = providerStatusFor(provider, options);
    const adapterStatus = adapterStatuses[provider] ?? {};
    const message = cleanText(adapterStatus.message ?? adapterStatus.reason);
    return Object.freeze({
      provider,
      status,
      accepted: status === "accepted" || status === "degraded",
      degraded: status === "degraded",
      blocking: status === "failed",
      message,
      capabilityHandshake: cleanText(adapterStatus.capabilityHandshake) || `${provider}:capability-negotiation`,
      statusChannel: cleanText(adapterStatus.statusChannel) || `${provider}:status`,
    });
  });
  const acceptedProviders = Object.freeze(providerEntries
    .filter((entry) => entry.accepted)
    .map((entry) => entry.provider));
  const pendingProviders = Object.freeze(providerEntries
    .filter((entry) => entry.status === "pending")
    .map((entry) => entry.provider));
  const degradedProviders = Object.freeze(providerEntries
    .filter((entry) => entry.degraded)
    .map((entry) => entry.provider));
  const failedProviders = Object.freeze(providerEntries
    .filter((entry) => entry.blocking)
    .map((entry) => entry.provider));
  const boundaryBlocked = boundaryProfile?.state === "blocked";
  const state = boundaryBlocked || failedProviders.length > 0
    ? "blocked"
    : pendingProviders.length > 0
      ? degradedProviders.length > 0 ? "degraded" : "waiting"
      : degradedProviders.length > 0
        ? "degraded"
        : "ready";
  const retryable = state === "waiting" || state === "degraded";
  const retryAfterMs = retryable && retryAttempt < retryLimit
    ? baseDelayMs * (2 ** retryAttempt)
    : null;
  const failureState = boundaryBlocked
    ? "boundary-blocked"
    : failedProviders.length > 0
      ? "provider-failed"
      : pendingProviders.length > 0
        ? "provider-pending"
        : degradedProviders.length > 0
          ? "provider-degraded"
          : "none";
  const actionableErrors = Object.freeze([
    ...(failedProviders.length > 0
      ? [Object.freeze({
        code: "AIOS_CLI_PROVIDER_FAILED",
        path: "$.providerReadiness.failedProviders",
        nextAction: "repair-provider-handoff",
        providers: failedProviders,
      })]
      : []),
    ...(boundaryBlocked
      ? [Object.freeze({
        code: "AIOS_CLI_PROVIDER_BOUNDARY_BLOCKED",
        path: "$.boundaryProfile",
        nextAction: boundaryProfile.nextAction,
        providers: externalProviders,
      })]
      : []),
  ]);

  return Object.freeze({
    protocol: "aios.language.cli-provider-readiness.v1",
    required: true,
    state,
    failureState,
    providers: Object.freeze(providerEntries),
    acceptedProviders,
    pendingProviders,
    degradedProviders,
    failedProviders,
    retry: Object.freeze({
      retryable,
      attempt: retryAttempt,
      retryAfterMs,
      backoff: retryable ? "exponential-adapter-poll" : "none",
      retryLimit,
    }),
    handoff: Object.freeze({
      channel: cleanText(options.adapterStatusChannel) || `${externalProviders[0]}:status`,
      correlationId: stableHash(`${externalProviders.join(",")}:${boundaryProfile?.isolationKey ?? "no-boundary"}`),
      syncRequired: state !== "ready",
      syncState: state === "ready" ? "synced" : state === "blocked" ? "blocked" : "pending",
    }),
    actionableErrors,
    nextAction: actionableErrors[0]?.nextAction
      || (state === "ready" ? "handoff-to-runtime-adapter" : "request-adapter-acceptance"),
  });
}

function createMailchimpProviderContract(compileResult, statusHandoff, boundaryProfile, input, options = {}) {
  const settings = options.mailchimp ?? options.providerSettings ?? {};
  const provider = cleanText(options.provider) || statusHandoff.provider || DEFAULT_PROVIDER;
  const audienceId = cleanText(settings.audienceId ?? options.audienceId);
  const campaignId = cleanText(settings.campaignId ?? options.campaignId);
  const templateId = cleanText(settings.templateId ?? options.templateId);
  const segmentId = cleanText(settings.segmentId ?? options.segmentId);
  const syncCursor = cleanText(settings.syncCursor ?? options.syncCursor);
  const externalAccountId = cleanText(settings.accountId ?? options.providerAccountId) || `${boundaryProfile.tenantId}:${provider}`;
  const providerCapabilities = stableList([
    ...optionList(settings.capabilities),
    ...optionList(options.providerCapabilities),
    "campaigns:read",
    "campaigns:write",
    "lists:read",
    "templates:read",
    "reports:read",
  ]);
  const requestedScopes = stableList([
    ...compileResult.capabilityManifest.map((capability) => capability.name),
    ...optionList(settings.requiredScopes),
  ]);
  const mailchimpRequiredScopes = stableList(requestedScopes.filter((scope) => (
    scope.startsWith("campaign")
    || scope.startsWith("audience")
    || scope.startsWith("list")
    || scope.startsWith("template")
    || scope.startsWith("report")
    || scope.startsWith("mailchimp")
  )));
  const normalizedProviderScopes = providerCapabilities.map((scope) => scope.replaceAll(".", ":"));
  const missingScopes = Object.freeze(mailchimpRequiredScopes.filter((scope) => {
    const normalized = scope.replaceAll(".", ":");
    return !normalizedProviderScopes.includes(normalized)
      && !normalizedProviderScopes.includes(`${normalized}:read`)
      && !normalizedProviderScopes.includes(`${normalized}:write`);
  }));
  const required = statusHandoff.externalProviders.includes(provider)
    || statusHandoff.externalProviders.includes(DEFAULT_PROVIDER)
    || mailchimpRequiredScopes.length > 0;
  const identityComplete = Boolean(audienceId || campaignId);
  const providerReady = statusHandoff.providerReadiness?.state === "ready"
    || statusHandoff.providerReadiness?.state === "not-required";
  const state = !required
    ? "not-required"
    : missingScopes.length > 0
      ? "capability-gap"
      : !identityComplete
        ? "identity-required"
        : providerReady
          ? "ready"
          : statusHandoff.providerReadiness?.state ?? "waiting";
  const correlationSeed = [
    provider,
    externalAccountId,
    audienceId || "no-audience",
    campaignId || "no-campaign",
    input.sourceHash,
  ].join(":");
  const handoffId = stableHash(correlationSeed);
  const syncRequired = required && (state !== "ready" || Boolean(syncCursor));
  const diagnostics = Object.freeze([
    ...(required && !identityComplete
      ? [diagnostic(
        "warning",
        "AIOS_CLI_MAILCHIMP_IDENTITY_REQUIRED",
        "Mailchimp handoff should include an audienceId or campaignId for deterministic provider sync.",
        "$.mailchimpProvider.identity",
        "configure-mailchimp-provider-identity",
      )]
      : []),
    ...(missingScopes.length > 0
      ? [diagnostic(
        "error",
        "AIOS_CLI_MAILCHIMP_CAPABILITY_GAP",
        "Mailchimp provider capabilities do not cover the compiled provider scopes.",
        "$.mailchimpProvider.capabilityNegotiation.missingScopes",
        "negotiate-mailchimp-provider-capabilities",
      )]
      : []),
  ]);

  return Object.freeze({
    protocol: "aios.language.cli-mailchimp-provider-contract.v1",
    provider,
    required,
    state,
    identity: Object.freeze({
      accountId: externalAccountId,
      audienceId: audienceId || null,
      campaignId: campaignId || null,
      templateId: templateId || null,
      segmentId: segmentId || null,
      tenantId: boundaryProfile.tenantId,
      workspaceId: boundaryProfile.workspaceId,
    }),
    capabilityNegotiation: Object.freeze({
      requestedScopes,
      mailchimpRequiredScopes,
      providerCapabilities,
      missingScopes,
      accepted: missingScopes.length === 0,
      handshake: cleanText(settings.capabilityHandshake) || `${provider}:mailchimp-capability-negotiation`,
    }),
    sync: Object.freeze({
      required: syncRequired,
      state: state === "ready"
        ? "synced"
        : state === "capability-gap"
          ? "blocked"
          : syncRequired
            ? "pending"
            : "not-required",
      cursor: syncCursor || null,
      channel: cleanText(settings.statusChannel) || statusHandoff.providerReadiness?.handoff?.channel || `${provider}:campaign-status`,
      correlationId: statusHandoff.providerReadiness?.handoff?.correlationId ?? handoffId,
      externalStateKey: stableHash(`${externalAccountId}:${audienceId}:${campaignId}:${input.sourceHash}`),
    }),
    handoff: Object.freeze({
      id: handoffId,
      target: "mailchimp-campaign-runtime",
      sourceHash: input.sourceHash,
      auditHandoffId: boundaryProfile.audit.handoffId,
      retryAfterMs: statusHandoff.providerReadiness?.retry?.retryAfterMs ?? null,
      nextAction: diagnostics.find((entry) => entry.severity === "error")?.hint
        || diagnostics[0]?.hint
        || (state === "ready" ? "handoff-to-mailchimp-runtime" : "request-mailchimp-provider-sync"),
    }),
    diagnostics,
  });
}

function createAdapterStatusHandoff(compiled, compileResult, input, boundaryProfile = null, options = {}) {
  const errors = compileResult.diagnostics.filter((entry) => entry.severity === "error");
  const warnings = compileResult.diagnostics.filter((entry) => entry.severity === "warning");
  const externalProviders = stableList(compiled.descriptors?.flatMap((descriptor) => descriptor.handoff?.providers ?? []) ?? []);
  const providerReadiness = createProviderReadiness(externalProviders, boundaryProfile, options);
  const boundaryBlocked = boundaryProfile?.state === "blocked";
  const providerBlocked = providerReadiness.state === "blocked";
  const providerReady = providerReadiness.state === "ready" || providerReadiness.state === "not-required";
  const acceptedForRuntime = errors.length === 0 && !boundaryBlocked && !providerBlocked && providerReady && compileResult.persistedState.restartSafe;
  const status = errors.length > 0 || boundaryBlocked || providerBlocked
    ? "blocked"
    : externalProviders.length > 0 && !providerReady
      ? "waiting-for-adapter"
      : "ready";

  return Object.freeze({
    protocol: "aios.language.cli-status-handoff.v1",
    state: status,
    visibleStatus: status === "blocked" ? "Compile blocked" : status === "ready" ? "Ready for runtime" : "Waiting for adapter acceptance",
    acceptedForRuntime,
    acceptedForClientPreview: errors.length === 0,
    sourceHash: input.sourceHash,
    provider: externalProviders[0] || DEFAULT_PROVIDER,
    externalProviders,
    diagnostics: Object.freeze({
      errors: errors.length,
      warnings: warnings.length,
      blockingCodes: Object.freeze(errors.map((entry) => entry.code).sort()),
    }),
    providerReadiness,
    boundary: boundaryProfile ? Object.freeze({
      state: boundaryProfile.state,
      permissionState: boundaryProfile.permissionState,
      deniedPermissions: boundaryProfile.deniedPermissions,
      isolated: boundaryProfile.tenantIsolation.isolated,
      auditHandoffId: boundaryProfile.audit.handoffId,
    }) : null,
    nextAction: boundaryBlocked
      ? boundaryProfile.nextAction
      : providerReadiness.actionableErrors[0]?.nextAction
      || (providerReadiness.state === "waiting" || providerReadiness.state === "degraded" ? providerReadiness.nextAction : null)
      || errors[0]?.hint
      || errors[0]?.code
      || (status === "ready" ? "handoff-to-runtime-adapter" : "request-adapter-acceptance"),
  });
}

function createRecoveryHandoff(statusHandoff, compileResult, boundaryProfile = null) {
  const restartSafe = compileResult.persistedState.restartSafe === true;
  const commandCount = compileResult.persistedState.commandCount ?? 0;
  const boundaryBlocked = boundaryProfile?.state === "blocked";
  const recoverable = statusHandoff.state !== "blocked" && !boundaryBlocked && restartSafe;
  const providerReadiness = statusHandoff.providerReadiness;
  const providerRetry = providerReadiness?.retry ?? {};

  return Object.freeze({
    protocol: "aios.language.cli-recovery-handoff.v1",
    recoverable,
    restartSafe,
    strategy: recoverable ? "idempotent-replay" : "operator-repair",
    commandCount,
    retryLimit: providerRetry.retryLimit ?? (statusHandoff.externalProviders.length > 0 ? 2 : 0),
    retryAfterMs: providerRetry.retryAfterMs ?? null,
    backoff: providerRetry.backoff ?? "none",
    resumeToken: `${statusHandoff.sourceHash}:${statusHandoff.state}`,
    providerResumeScope: providerReadiness?.handoff ? Object.freeze({
      state: providerReadiness.state,
      failureState: providerReadiness.failureState,
      channel: providerReadiness.handoff.channel,
      correlationId: providerReadiness.handoff.correlationId,
      pendingProviders: providerReadiness.pendingProviders,
      failedProviders: providerReadiness.failedProviders,
    }) : null,
    boundaryResumeScope: boundaryProfile ? Object.freeze({
      tenantId: boundaryProfile.tenantId,
      workspaceId: boundaryProfile.workspaceId,
      isolationKey: boundaryProfile.isolationKey,
    }) : null,
    nextAction: boundaryBlocked
      ? boundaryProfile.nextAction
      : recoverable ? statusHandoff.nextAction : "repair-source-before-runtime-handoff",
  });
}

function createCliExportManifest(compiled, compileResult, statusHandoff, recoveryHandoff, mailchimpProvider) {
  const providerReadiness = statusHandoff.providerReadiness;
  return Object.freeze({
    protocol: "aios.language.cli-export-manifest.v1",
    target: compileResult.target,
    descriptorCount: compiled.descriptors?.length ?? 0,
    capabilityCount: compileResult.capabilityManifest.length,
    memoryLocalOnly: compileResult.memoryContract.localOnly,
    verifierCount: compileResult.verifierContracts.length,
    statusState: statusHandoff.state,
    recoveryStrategy: recoveryHandoff.strategy,
    providerState: providerReadiness?.state ?? "unknown",
    providerCount: providerReadiness?.providers.length ?? 0,
    providerSyncState: providerReadiness?.handoff?.syncState ?? "not-required",
    mailchimpState: mailchimpProvider.state,
    mailchimpSyncState: mailchimpProvider.sync.state,
    artifactNames: Object.freeze([
      "kernel-jobs.json",
      "capability-manifest.json",
      "memory-contract.json",
      "verifier-contracts.json",
      "status-handoff.json",
      "recovery-handoff.json",
      "provider-readiness.json",
      "mailchimp-provider-contract.json",
    ]),
  });
}

function createCompileExportAnalytics(compiled, compileResult, boundaryProfile, statusHandoff, recoveryHandoff, exportManifest, mailchimpProvider) {
  const providerReadiness = statusHandoff.providerReadiness;
  const descriptors = compiled.descriptors ?? [];
  const diagnostics = compileResult.diagnostics ?? [];
  const jobs = compileResult.jobs ?? [];
  const persistentCommands = jobs.flatMap((job) => job.persistedState?.commands ?? []);
  const externalJobs = jobs.filter((job) => job.adapter !== "local");
  const capabilityNames = stableList(compileResult.capabilityManifest.map((capability) => capability.name));
  const providerNames = stableList(statusHandoff.externalProviders);
  const counters = Object.freeze({
    descriptorCount: descriptors.length,
    jobCount: jobs.length,
    externalJobCount: externalJobs.length,
    capabilityCount: compileResult.capabilityManifest.length,
    uniqueCapabilityCount: capabilityNames.length,
    verifierCount: compileResult.verifierContracts.length,
    persistentCommandCount: persistentCommands.length,
    diagnosticErrorCount: statusHandoff.diagnostics.errors,
    diagnosticWarningCount: statusHandoff.diagnostics.warnings,
    deniedPermissionCount: boundaryProfile.deniedPermissions.length,
    providerCount: providerReadiness?.providers.length ?? 0,
    providerAcceptedCount: providerReadiness?.acceptedProviders.length ?? 0,
    providerPendingCount: providerReadiness?.pendingProviders.length ?? 0,
    providerDegradedCount: providerReadiness?.degradedProviders.length ?? 0,
    providerFailedCount: providerReadiness?.failedProviders.length ?? 0,
    mailchimpMissingScopeCount: mailchimpProvider.capabilityNegotiation.missingScopes.length,
    mailchimpSyncRequired: mailchimpProvider.sync.required ? 1 : 0,
  });
  const history = Object.freeze([
    Object.freeze({
      id: "source-normalized",
      sourceHash: statusHandoff.sourceHash,
      status: "accepted",
      descriptorCount: descriptors.length,
      nextAction: "compile-source-descriptors",
    }),
    Object.freeze({
      id: "kernel-contract-created",
      sourceHash: statusHandoff.sourceHash,
      status: jobs.length > 0 ? "emitted" : "empty",
      jobCount: jobs.length,
      capabilityCount: compileResult.capabilityManifest.length,
      memoryLocalOnly: compileResult.memoryContract.localOnly,
      nextAction: jobs.length > 0 ? "validate-runtime-boundary" : "add-job-contract",
    }),
    Object.freeze({
      id: "boundary-profile-evaluated",
      sourceHash: statusHandoff.sourceHash,
      status: boundaryProfile.state,
      permissionState: boundaryProfile.permissionState,
      deniedPermissionCount: boundaryProfile.deniedPermissions.length,
      auditRequired: boundaryProfile.audit.required,
      nextAction: boundaryProfile.nextAction,
    }),
    Object.freeze({
      id: "provider-readiness-evaluated",
      sourceHash: statusHandoff.sourceHash,
      status: providerReadiness?.state ?? "not-required",
      providerCount: providerReadiness?.providers.length ?? 0,
      providerSyncState: providerReadiness?.handoff?.syncState ?? "not-required",
      retryAfterMs: providerReadiness?.retry?.retryAfterMs ?? null,
      nextAction: providerReadiness?.nextAction ?? statusHandoff.nextAction,
    }),
    Object.freeze({
      id: "mailchimp-provider-contract-created",
      sourceHash: statusHandoff.sourceHash,
      status: mailchimpProvider.state,
      providerState: providerReadiness?.state ?? "not-required",
      providerSyncState: mailchimpProvider.sync.state,
      missingScopes: mailchimpProvider.capabilityNegotiation.missingScopes.length,
      nextAction: mailchimpProvider.handoff.nextAction,
    }),
    Object.freeze({
      id: "export-manifest-ready",
      sourceHash: statusHandoff.sourceHash,
      status: statusHandoff.state,
      runtimeReady: statusHandoff.acceptedForRuntime,
      recoveryStrategy: recoveryHandoff.strategy,
      artifactCount: exportManifest.artifactNames.length,
      nextAction: statusHandoff.nextAction,
    }),
  ]);
  const timeline = Object.freeze(history.map((snapshot, index) => Object.freeze({
    order: index + 1,
    event: snapshot.id,
    status: snapshot.status,
    providerState: snapshot.providerState ?? providerReadiness?.state ?? "not-required",
    providerSyncState: snapshot.providerSyncState ?? providerReadiness?.handoff?.syncState ?? "not-required",
    boundaryState: snapshot.boundaryState ?? boundaryProfile.state,
    nextAction: snapshot.nextAction ?? null,
  })));
  const exportSummary = Object.freeze({
    reportName: "compile-report.json",
    sourceHash: statusHandoff.sourceHash,
    target: compileResult.target,
    runtimeReady: statusHandoff.acceptedForRuntime,
    previewReady: statusHandoff.acceptedForClientPreview,
    statusState: statusHandoff.state,
    boundaryState: boundaryProfile.state,
    providerState: providerReadiness?.state ?? "not-required",
    providerSyncState: providerReadiness?.handoff?.syncState ?? "not-required",
    mailchimpState: mailchimpProvider.state,
    mailchimpSyncState: mailchimpProvider.sync.state,
    recoveryStrategy: recoveryHandoff.strategy,
    artifactNames: exportManifest.artifactNames,
    capabilityNames,
    providerNames,
    blockingCodes: statusHandoff.diagnostics.blockingCodes,
    nextAction: statusHandoff.nextAction,
  });

  return Object.freeze({
    protocol: "aios.language.cli-compile-analytics.v1",
    counters,
    history,
    timeline,
    exportSummary,
    diagnostics: Object.freeze(diagnostics.map((entry) => Object.freeze({
      severity: entry.severity,
      code: entry.code,
      path: entry.path ?? "$",
    }))),
  });
}

function createCompileReviewGate(statusHandoff, recoveryHandoff, boundaryProfile, analytics, options = {}) {
  const settings = options.lifecycleSettings ?? options.compileSettings ?? options.settings ?? {};
  const enabled = settings.enabled !== false;
  const acceptance = cleanText(settings.acceptance) || cleanText(options.acceptanceMode) || "operator";
  const schedule = cleanText(settings.schedule) || cleanText(options.schedule) || "manual";
  const allowedAcceptances = new Set(["operator", "provider", "auto"]);
  const allowedSchedules = new Set(["manual", "on-provider-ready", "on-boundary-clear", "immediate"]);
  const providerState = statusHandoff.providerReadiness?.state ?? "not-required";
  const boundaryBlocked = boundaryProfile.state === "blocked";
  const providerWaiting = providerState === "waiting" || providerState === "degraded";
  const providerBlocked = providerState === "blocked";
  const runtimeReady = statusHandoff.acceptedForRuntime === true;
  const diagnostics = [];

  if (!allowedAcceptances.has(acceptance)) {
    diagnostics.push(diagnostic(
      "error",
      "AIOS_CLI_COMPILE_ACCEPTANCE_INVALID",
      "Compile lifecycle acceptance must be operator, provider, or auto.",
      "$.reviewGate.settings.acceptance",
      "repair-compile-lifecycle-settings",
    ));
  }
  if (!allowedSchedules.has(schedule)) {
    diagnostics.push(diagnostic(
      "error",
      "AIOS_CLI_COMPILE_SCHEDULE_INVALID",
      "Compile lifecycle schedule must be manual, on-provider-ready, on-boundary-clear, or immediate.",
      "$.reviewGate.settings.schedule",
      "repair-compile-lifecycle-settings",
    ));
  }
  if (acceptance === "auto" && statusHandoff.externalProviders.length > 0 && providerState !== "ready") {
    diagnostics.push(diagnostic(
      "warning",
      "AIOS_CLI_COMPILE_AUTO_ACCEPTANCE_WAITING",
      "Auto acceptance is paused until external provider readiness is synced.",
      "$.reviewGate.acceptance",
      "wait-for-provider-acceptance",
    ));
  }
  if (schedule === "immediate" && !runtimeReady) {
    diagnostics.push(diagnostic(
      "warning",
      "AIOS_CLI_COMPILE_IMMEDIATE_PAUSED",
      "Immediate runtime handoff is paused until compile readiness is complete.",
      "$.reviewGate.schedule",
      statusHandoff.nextAction,
    ));
  }

  const settingsValid = diagnostics.filter((entry) => entry.severity === "error").length === 0;
  const disabledReasons = Object.freeze([
    ...(!enabled ? ["operator-disabled"] : []),
    ...(!settingsValid ? ["settings-invalid"] : []),
    ...(boundaryBlocked ? ["boundary-blocked"] : []),
    ...(providerBlocked ? ["provider-blocked"] : []),
    ...(acceptance === "provider" && providerWaiting ? ["provider-acceptance-pending"] : []),
    ...(acceptance === "auto" && statusHandoff.externalProviders.length > 0 && providerState !== "ready" ? ["provider-sync-required"] : []),
    ...(!statusHandoff.acceptedForClientPreview ? ["preview-blocked"] : []),
  ]);
  const canPreview = enabled && settingsValid && statusHandoff.acceptedForClientPreview;
  const canAccept = canPreview && runtimeReady && disabledReasons.length === 0;
  const canSchedule = enabled
    && settingsValid
    && schedule !== "manual"
    && !providerBlocked
    && (schedule !== "on-provider-ready" || providerWaiting)
    && (schedule !== "on-boundary-clear" || boundaryBlocked);
  const queued = canSchedule && !canAccept;
  const nextAction = settingsValid
    ? canAccept
      ? "accept-compile-runtime-handoff"
      : queued
        ? schedule === "on-boundary-clear"
          ? "schedule-compile-after-boundary-clear"
          : schedule === "on-provider-ready"
            ? "schedule-compile-after-provider-ready"
            : "schedule-compile-immediate-retry"
        : disabledReasons.includes("operator-disabled")
          ? "enable-compile-lifecycle"
          : statusHandoff.nextAction
    : "repair-compile-lifecycle-settings";

  return Object.freeze({
    protocol: "aios.language.cli-compile-review-gate.v1",
    settings: Object.freeze({
      enabled,
      acceptance,
      schedule,
    }),
    controls: Object.freeze({
      enabled: enabled && settingsValid && !providerBlocked && !boundaryBlocked,
      canPreview,
      canAccept,
      canDisable: true,
      canSchedule,
    }),
    acceptance: Object.freeze({
      requiredBy: acceptance,
      accepted: canAccept,
      runtimeReady,
      previewReady: statusHandoff.acceptedForClientPreview,
      providerState,
      providerSyncState: statusHandoff.providerReadiness?.handoff?.syncState ?? "not-required",
      boundaryState: boundaryProfile.state,
    }),
    schedule: Object.freeze({
      mode: schedule,
      queued,
      blockedBy: disabledReasons,
      retryAfterMs: statusHandoff.providerReadiness?.retry?.retryAfterMs ?? recoveryHandoff.retryAfterMs,
      resumeWhen: boundaryBlocked
        ? "boundary-cleared"
        : providerWaiting
          ? "provider-accepted"
          : runtimeReady
            ? "operator-acceptance"
            : "compile-contract-ready",
    }),
    clientState: Object.freeze({
      visibleStatus: statusHandoff.visibleStatus,
      sourceHash: statusHandoff.sourceHash,
      reportName: analytics.exportSummary.reportName,
      timelineEvents: analytics.timeline.length,
      nextAction,
    }),
    diagnostics: Object.freeze(diagnostics),
    nextAction,
  });
}

export function buildAiosCliCompileContract(source = "", options = {}) {
  const input = normalizeSourceInput(source, options);
  const compiled = compileAiosSource(input.text, {
    ...options,
    fileName: input.fileName,
    namespace: cleanText(options.namespace) || DEFAULT_PROVIDER,
    service: cleanText(options.service) || DEFAULT_PROVIDER,
  });
  const jobs = (compiled.descriptors ?? []).map((descriptor, index) => descriptorJobForCompileResult(descriptor, index, options));
  const compileResult = createCompileResult({
    jobs,
    diagnostics: compiled.diagnostics,
    ast: compiled.ast,
    sourceHash: input.sourceHash,
    target: "aios-kernel/mailchimp-cli-contract.v1",
  });
  const provisionalStatus = createAdapterStatusHandoff(compiled, compileResult, input, null, options);
  const boundaryProfile = createBoundaryProfile(jobs, provisionalStatus, input, options);
  const statusHandoff = createAdapterStatusHandoff(compiled, compileResult, input, boundaryProfile, options);
  const recoveryHandoff = createRecoveryHandoff(statusHandoff, compileResult, boundaryProfile);
  const mailchimpProvider = createMailchimpProviderContract(compileResult, statusHandoff, boundaryProfile, input, options);
  const exportManifest = createCliExportManifest(compiled, compileResult, statusHandoff, recoveryHandoff, mailchimpProvider);
  const analytics = createCompileExportAnalytics(compiled, compileResult, boundaryProfile, statusHandoff, recoveryHandoff, exportManifest, mailchimpProvider);
  const reviewGate = createCompileReviewGate(statusHandoff, recoveryHandoff, boundaryProfile, analytics, options);

  return Object.freeze({
    protocol: COMPILE_CONTRACT_PROTOCOL,
    toolchain: TOOLCHAIN_PROTOCOL,
    command: "compile",
    source: input,
    compiled,
    compileResult,
    boundaryProfile,
    mailchimpProvider,
    statusHandoff,
    recoveryHandoff,
    exportManifest,
    analytics,
    reviewGate,
    diagnostics: Object.freeze([
      ...compileResult.diagnostics,
      ...mailchimpProvider.diagnostics,
      ...reviewGate.diagnostics,
      ...(statusHandoff.acceptedForRuntime
        ? []
        : [diagnostic("warning", "AIOS_CLI_RUNTIME_HANDOFF_NOT_READY", "Compiled contract is not accepted for runtime handoff yet.", "$.statusHandoff")]),
      ...(boundaryProfile.state === "blocked"
        ? [diagnostic("error", "AIOS_CLI_BOUNDARY_BLOCKED", "Compile contract crossed a tenant, workspace, or permission boundary.", "$.boundaryProfile", boundaryProfile.nextAction)]
        : []),
      ...(statusHandoff.providerReadiness.actionableErrors.map((entry) => diagnostic(
        "error",
        entry.code,
        "Provider handoff readiness blocked the compiled runtime contract.",
        entry.path,
        entry.nextAction,
      ))),
    ]),
  });
}

export function summarizeAiosCliCompileContract(contract) {
  return Object.freeze({
    protocol: "aios.language.cli-compile-summary.v1",
    ok: contract.statusHandoff.acceptedForClientPreview,
    runtimeReady: contract.statusHandoff.acceptedForRuntime,
    status: contract.statusHandoff.state,
    nextAction: contract.statusHandoff.nextAction,
    sourceHash: contract.source.sourceHash,
    descriptors: contract.exportManifest.descriptorCount,
    capabilities: contract.exportManifest.capabilityCount,
    recovery: contract.recoveryHandoff.strategy,
    providerState: contract.statusHandoff.providerReadiness?.state,
    providerSyncState: contract.statusHandoff.providerReadiness?.handoff?.syncState,
    mailchimpState: contract.mailchimpProvider?.state,
    mailchimpSyncState: contract.mailchimpProvider?.sync?.state,
    reviewGate: contract.reviewGate?.acceptance?.accepted === true ? "accepted" : contract.reviewGate?.nextAction,
    lifecycleEnabled: contract.reviewGate?.controls?.enabled,
    boundaryState: contract.boundaryProfile?.state,
    tenantId: contract.boundaryProfile?.tenantId,
    workspaceId: contract.boundaryProfile?.workspaceId,
    reportName: contract.analytics?.exportSummary?.reportName,
    artifactCount: contract.analytics?.exportSummary?.artifactNames?.length ?? contract.exportManifest.artifactNames.length,
    timelineEvents: contract.analytics?.timeline?.length ?? 0,
    blockingCodes: contract.analytics?.exportSummary?.blockingCodes ?? Object.freeze([]),
  });
}

export function assertAiosCliCompileContractReady(contract) {
  const diagnostics = [];
  if (contract?.protocol !== COMPILE_CONTRACT_PROTOCOL) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_COMPILE_PROTOCOL_INVALID", "Compile contract protocol is missing or unsupported."));
  }
  if (!contract?.statusHandoff?.acceptedForClientPreview) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_COMPILE_PREVIEW_BLOCKED", "Compile contract is not ready for client preview.", "$.statusHandoff"));
  }
  if (!contract?.recoveryHandoff?.resumeToken) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_RECOVERY_TOKEN_REQUIRED", "Compile contract must expose a deterministic recovery resume token.", "$.recoveryHandoff.resumeToken"));
  }
  if (!contract?.statusHandoff?.providerReadiness?.state) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_PROVIDER_READINESS_REQUIRED", "Compile contract must expose provider readiness state.", "$.statusHandoff.providerReadiness"));
  }
  if (!contract?.analytics?.exportSummary?.reportName) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_COMPILE_ANALYTICS_REQUIRED", "Compile contract must expose export-ready analytics.", "$.analytics.exportSummary"));
  }
  if (!Array.isArray(contract?.analytics?.timeline) || contract.analytics.timeline.length === 0) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_COMPILE_TIMELINE_REQUIRED", "Compile contract must expose deterministic export timeline events.", "$.analytics.timeline"));
  }
  if (!contract?.reviewGate?.controls) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_COMPILE_REVIEW_GATE_REQUIRED", "Compile contract must expose lifecycle review gate controls.", "$.reviewGate.controls"));
  }
  if (!contract?.mailchimpProvider?.capabilityNegotiation) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_MAILCHIMP_PROVIDER_REQUIRED", "Compile contract must expose Mailchimp provider capability negotiation.", "$.mailchimpProvider.capabilityNegotiation"));
  }
  if ((contract?.mailchimpProvider?.capabilityNegotiation?.missingScopes?.length ?? 0) > 0) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_MAILCHIMP_CAPABILITY_GAP", "Mailchimp provider capabilities must cover required compiled scopes.", "$.mailchimpProvider.capabilityNegotiation.missingScopes"));
  }
  if (contract?.boundaryProfile?.state === "blocked") {
    diagnostics.push(diagnostic("error", "AIOS_CLI_BOUNDARY_BLOCKED", "Compile contract must resolve tenant, workspace, or permission boundaries before runtime handoff.", "$.boundaryProfile"));
  }
  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    nextAction: diagnostics[0]?.code || contract?.statusHandoff?.nextAction || "handoff-to-runtime-adapter",
  });
}

export { COMPILE_CONTRACT_PROTOCOL, TOOLCHAIN_PROTOCOL };
