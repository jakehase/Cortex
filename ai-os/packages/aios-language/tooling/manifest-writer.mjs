import {
  assertAiosCliCompileContractReady,
  buildAiosCliCompileContract,
  summarizeAiosCliCompileContract,
} from "./cli-compile.mjs";

export const MANIFEST_WRITER_PROTOCOL = "aios.language.mailchimp-manifest-writer.v1";

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

function diagnostic(severity, code, message, path = "$", nextAction = "") {
  return Object.freeze({
    severity,
    code,
    message,
    path,
    ...(nextAction ? { nextAction } : {}),
  });
}

function asList(value) {
  return Object.freeze((Array.isArray(value) ? value : value ? [value] : [])
    .map(cleanText)
    .filter(Boolean)
    .sort());
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function normalizeSlug(value, fallback) {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function dedupe(values) {
  return Object.freeze([...new Set(values.map(cleanText).filter(Boolean))].sort());
}

function createTenantBoundary(compileContract, packageName, options = {}) {
  const mailchimp = compileContract.mailchimpProvider;
  const tenantId = normalizeSlug(options.tenantId || mailchimp.identity.accountId, "mailchimp-tenant-unbound");
  const workspaceId = normalizeSlug(options.workspaceId || options.workspace || packageName, packageName);
  const role = cleanText(options.role) || (compileContract.statusHandoff.acceptedForRuntime ? "runtime-publisher" : "preview-operator");
  const requestedPermissions = dedupe([
    ...asList(options.permissions),
    ...compileContract.compileResult.capabilityManifest.map((entry) => entry.name),
  ]);
  const deniedPermissions = dedupe([
    ...mailchimp.capabilityNegotiation.missingScopes,
    ...(tenantId === "mailchimp-tenant-unbound" ? ["mailchimp:tenant:identity"] : []),
  ]);
  const allowedPermissions = Object.freeze(requestedPermissions.filter((permission) => !deniedPermissions.includes(permission)));
  const isolationKey = stableHash(`${tenantId}:${workspaceId}:${packageName}:${compileContract.source.sourceHash}`);
  const boundaryState = deniedPermissions.length > 0 ? "blocked" : mailchimp.required ? "enforced" : "advisory";
  const auditEvents = Object.freeze([
    Object.freeze({
      id: "tenant-boundary-shaped",
      level: boundaryState === "blocked" ? "error" : "info",
      subject: tenantId,
      workspaceId,
      message: "Mailchimp tenant boundary was shaped before manifest export.",
    }),
    Object.freeze({
      id: "permission-envelope-shaped",
      level: deniedPermissions.length > 0 ? "warn" : "info",
      requested: requestedPermissions.length,
      allowed: allowedPermissions.length,
      denied: deniedPermissions.length,
    }),
  ]);

  return Object.freeze({
    protocol: "aios.language.mailchimp-tenant-boundary.v1",
    state: boundaryState,
    tenantId,
    workspaceId,
    role,
    isolationKey,
    packagePathPrefix: `packages/${packageName}`,
    requestedPermissions,
    allowedPermissions,
    deniedPermissions,
    audit: Object.freeze({
      protocol: "aios.language.mailchimp-audit-handoff.v1",
      correlationId: mailchimp.sync.correlationId,
      eventCount: auditEvents.length,
      events: auditEvents,
      nextAction: boundaryState === "blocked" ? "repair-mailchimp-tenant-boundary" : "record-mailchimp-tenant-boundary-audit",
    }),
    safeBoundary: Object.freeze({
      canWritePackage: boundaryState !== "blocked" && role !== "reader",
      canPublishRuntime: boundaryState === "enforced" && compileContract.statusHandoff.acceptedForRuntime,
      canPreviewRuntime: compileContract.statusHandoff.acceptedForClientPreview,
    }),
  });
}

function createManifestFiles(compileContract, packageName) {
  const exportManifest = compileContract.exportManifest;
  const mailchimp = compileContract.mailchimpProvider;
  const sourceHash = compileContract.source.sourceHash;
  const packageRoot = `packages/${packageName}`;
  const routes = [
    {
      path: "manifest.json",
      kind: "manifest",
      contract: exportManifest.protocol,
      status: compileContract.statusHandoff.state,
    },
    {
      path: "runtime/mailchimp-adapter.contract.json",
      kind: "adapter-contract",
      contract: mailchimp.protocol,
      status: mailchimp.state,
    },
    {
      path: "runtime/recovery-handoff.json",
      kind: "recovery-handoff",
      contract: compileContract.recoveryHandoff.protocol,
      status: compileContract.recoveryHandoff.strategy,
    },
    {
      path: "runtime/tenant-boundary.json",
      kind: "tenant-boundary",
      contract: "aios.language.mailchimp-tenant-boundary.v1",
      status: mailchimp.identity.accountId ? "tenant-bound" : "tenant-unbound",
    },
    {
      path: "runtime/lifecycle-controls.json",
      kind: "lifecycle-controls",
      contract: "aios.language.mailchimp-manifest-lifecycle-controls.v1",
      status: compileContract.statusHandoff.acceptedForRuntime ? "runtime-ready" : "preview-only",
    },
  ];

  return Object.freeze(routes.map((route) => Object.freeze({
    ...route,
    packagePath: `${packageRoot}/${route.path}`,
    artifactHash: stableHash(`${sourceHash}:${route.path}:${route.status}:${route.contract}`),
    exportable: route.kind !== "adapter-contract" || mailchimp.capabilityNegotiation.accepted,
  })));
}

function createManifestStatus(compileContract, files, tenantBoundary, options = {}) {
  const compileReadiness = assertAiosCliCompileContractReady(compileContract);
  const missingExports = files.filter((file) => !file.exportable);
  const publishMode = cleanText(options.publishMode) || "dry-run";
  const tenantBlocked = tenantBoundary.state === "blocked";
  const state = compileReadiness.ok && missingExports.length === 0 && !tenantBlocked
    ? compileContract.statusHandoff.acceptedForRuntime ? "publishable" : "previewable"
    : missingExports.length > 0 ? "provider-blocked" : tenantBlocked ? "tenant-blocked" : "repair-required";
  const nextAction = state === "publishable"
    ? publishMode === "write" ? "write-mailchimp-package-manifest" : "preview-mailchimp-package-manifest"
    : state === "provider-blocked"
      ? "negotiate-mailchimp-provider-capabilities"
      : state === "tenant-blocked"
        ? "repair-mailchimp-tenant-boundary"
      : compileReadiness.nextAction;

  return Object.freeze({
    protocol: "aios.language.mailchimp-manifest-status.v1",
    state,
    publishMode,
    sourceHash: compileContract.source.sourceHash,
    runtimeReady: compileContract.statusHandoff.acceptedForRuntime,
    previewReady: compileContract.statusHandoff.acceptedForClientPreview,
    providerState: compileContract.mailchimpProvider.state,
    providerSyncState: compileContract.mailchimpProvider.sync.state,
    tenantState: tenantBoundary.state,
    workspaceId: tenantBoundary.workspaceId,
    isolationKey: tenantBoundary.isolationKey,
    missingExports: Object.freeze(missingExports.map((file) => file.packagePath)),
    nextAction,
  });
}

function createManifestOperationalHealth(compileContract, status, tenantBoundary, files, options = {}) {
  const requestedAttempt = Number(options.retryAttempt ?? options.attempt ?? 0);
  const attempt = Number.isFinite(requestedAttempt) && requestedAttempt > 0
    ? Math.floor(requestedAttempt)
    : 0;
  const requestedLimit = Number(options.retryLimit ?? compileContract.recoveryHandoff.retryLimit ?? 3);
  const maxAttempts = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 10)
    : 3;
  const requestedBackoff = Number(options.retryBackoffMs ?? options.backoffMs ?? 1000);
  const baseBackoffMs = Number.isFinite(requestedBackoff) && requestedBackoff > 0
    ? Math.min(Math.floor(requestedBackoff), 60000)
    : 1000;
  const missingScopes = compileContract.mailchimpProvider.capabilityNegotiation.missingScopes;
  const blockedExports = files.filter((file) => !file.exportable);
  const failureSignals = Object.freeze([
    ...(missingScopes.length > 0 ? ["mailchimp-scope-gap"] : []),
    ...(tenantBoundary.state === "blocked" ? ["tenant-boundary-blocked"] : []),
    ...(blockedExports.length > 0 ? ["manifest-export-blocked"] : []),
    ...(!compileContract.statusHandoff.acceptedForClientPreview ? ["client-preview-unavailable"] : []),
  ]);
  const degradedSignals = Object.freeze([
    ...(status.state === "previewable" ? ["runtime-publish-not-accepted"] : []),
    ...(tenantBoundary.state === "advisory" ? ["tenant-boundary-advisory"] : []),
    ...(compileContract.mailchimpProvider.sync.channel ? [] : ["mailchimp-sync-channel-missing"]),
  ]);
  const state = failureSignals.length > 0
    ? "unhealthy"
    : degradedSignals.length > 0
      ? "degraded"
      : "healthy";
  const retryable = state === "unhealthy"
    && attempt < maxAttempts
    && tenantBoundary.state !== "blocked";
  const nextBackoffMs = retryable
    ? Math.min(baseBackoffMs * (2 ** attempt), 60000)
    : 0;
  const actionableErrors = Object.freeze([
    ...(missingScopes.length > 0
      ? [Object.freeze({
        code: "AIOS_MANIFEST_MAILCHIMP_SCOPE_GAP",
        path: "$.manifest.mailchimp.missingScopes",
        nextAction: "negotiate-mailchimp-provider-capabilities",
        retryable: false,
      })]
      : []),
    ...(tenantBoundary.state === "blocked"
      ? [Object.freeze({
        code: "AIOS_MANIFEST_TENANT_BOUNDARY_BLOCKED",
        path: "$.manifest.tenantBoundary",
        nextAction: "repair-mailchimp-tenant-boundary",
        retryable: false,
      })]
      : []),
    ...(blockedExports.length > 0
      ? [Object.freeze({
        code: "AIOS_MANIFEST_EXPORT_BLOCKED",
        path: "$.manifest.files",
        nextAction: "repair-mailchimp-manifest-exports",
        retryable,
      })]
      : []),
  ]);

  return Object.freeze({
    protocol: "aios.language.mailchimp-manifest-operational-health.v1",
    state,
    degradedMode: state === "degraded" ? "preview-only" : state === "unhealthy" ? "repair-only" : "none",
    failureSignals,
    degradedSignals,
    blockedExportCount: blockedExports.length,
    actionableErrors,
    retry: Object.freeze({
      retryable,
      attempt,
      maxAttempts,
      baseBackoffMs,
      nextBackoffMs,
      exhausted: state === "unhealthy" && attempt >= maxAttempts,
      nextAction: retryable
        ? "retry-mailchimp-manifest-write"
        : actionableErrors[0]?.nextAction || status.nextAction,
    }),
    handoff: Object.freeze({
      auditCorrelationId: compileContract.mailchimpProvider.sync.correlationId,
      tenantState: tenantBoundary.state,
      workspaceId: tenantBoundary.workspaceId,
      safeToWrite: state !== "unhealthy" && tenantBoundary.safeBoundary.canWritePackage,
      nextAction: actionableErrors[0]?.nextAction || status.nextAction,
    }),
  });
}

function createManifestLifecycleControls(compileContract, status, tenantBoundary, operationalHealth, files, packageName, options = {}) {
  const requestedMode = cleanText(options.lifecycleMode || options.mode || status.publishMode);
  const mode = ["write", "dry-run", "preview", "disabled"].includes(requestedMode)
    ? requestedMode
    : "dry-run";
  const enabled = options.enabled === undefined
    ? mode !== "disabled"
    : options.enabled === true;
  const approvalTicket = cleanText(options.approvalTicket || options.changeTicket);
  const requireApproval = options.requireApproval === undefined
    ? mode === "write"
    : options.requireApproval === true;
  const scheduleMode = cleanText(options.scheduleMode || options.schedule?.mode || "manual");
  const scheduleEnabled = enabled && scheduleMode !== "manual" && scheduleMode !== "disabled";
  const scheduleExpression = cleanText(options.scheduleExpression || options.schedule?.expression);
  const scheduleTimezone = cleanText(options.scheduleTimezone || options.schedule?.timezone || "UTC");
  const maxRuns = Number(options.maxRuns ?? options.schedule?.maxRuns ?? 1);
  const maxRuntimeMs = Number(options.maxRuntimeMs ?? 300000);
  const manifestFileCount = files.filter((file) => file.exportable).length;
  const blockedExports = files.filter((file) => !file.exportable);
  const commandBase = stableHash([
    compileContract.source.sourceHash,
    status.state,
    tenantBoundary.isolationKey,
    mode,
    enabled ? "enabled" : "disabled",
    scheduleMode,
    scheduleExpression || "manual",
  ].join(":"));
  const settingsBlockers = Object.freeze([
    ...(enabled && mode === "disabled" ? ["lifecycle cannot be enabled while mode is disabled"] : []),
    ...(mode === "write" && !tenantBoundary.safeBoundary.canWritePackage ? ["write mode requires tenant package-write permission"] : []),
    ...(mode === "write" && !compileContract.statusHandoff.acceptedForRuntime ? ["write mode requires runtime acceptance"] : []),
    ...(mode === "write" && requireApproval && !approvalTicket ? ["write mode requires approval ticket"] : []),
    ...(scheduleEnabled && !scheduleExpression ? ["enabled schedule requires an expression"] : []),
    ...(scheduleEnabled && operationalHealth.state === "unhealthy" ? ["schedule cannot run while manifest health is unhealthy"] : []),
    ...(Number.isFinite(maxRuns) && maxRuns > 0 ? [] : ["schedule maxRuns must be a positive number"]),
    ...(Number.isFinite(maxRuntimeMs) && maxRuntimeMs >= 1000 ? [] : ["maxRuntimeMs must be at least 1000"]),
  ]);
  const lifecycleState = !enabled
    ? "disabled"
    : settingsBlockers.length > 0
      ? "blocked"
      : mode === "write" && status.state === "publishable"
        ? "armed"
        : "preview";
  const nextAction = lifecycleState === "armed"
    ? "run-mailchimp-manifest-write"
    : lifecycleState === "preview"
      ? "preview-mailchimp-manifest-lifecycle"
      : lifecycleState === "disabled"
        ? "enable-mailchimp-manifest-lifecycle"
        : settingsBlockers[0]?.includes("approval")
          ? "attach-mailchimp-manifest-approval"
          : settingsBlockers[0]?.includes("schedule")
            ? "repair-mailchimp-manifest-schedule"
            : "repair-mailchimp-manifest-lifecycle";
  const timeline = Object.freeze([
    Object.freeze({
      index: 0,
      event: "manifest-lifecycle-shaped",
      state: lifecycleState,
      mode,
      enabled,
      at: cleanText(options.generatedAt) || "logical:manifest-lifecycle",
    }),
    Object.freeze({
      index: 1,
      event: scheduleEnabled ? "manifest-schedule-armed" : "manifest-schedule-manual",
      state: scheduleEnabled ? "scheduled" : "manual",
      expression: scheduleExpression || null,
      timezone: scheduleTimezone,
      at: cleanText(options.scheduleEvaluatedAt) || "logical:schedule",
    }),
    Object.freeze({
      index: 2,
      event: lifecycleState === "blocked" ? "manifest-lifecycle-blocked" : "manifest-lifecycle-next-action",
      state: lifecycleState,
      nextAction,
      blockedCount: settingsBlockers.length,
      at: cleanText(options.nextActionAt) || "logical:next-action",
    }),
  ]);

  return Object.freeze({
    protocol: "aios.language.mailchimp-manifest-lifecycle-controls.v1",
    state: lifecycleState,
    settings: Object.freeze({
      enabled,
      mode,
      requireApproval,
      approvalTicket: approvalTicket || null,
      maxRuntimeMs: Math.floor(Number.isFinite(maxRuntimeMs) ? maxRuntimeMs : 300000),
      externalWritesAllowed: mode === "write" && tenantBoundary.safeBoundary.canWritePackage,
      dryRun: mode !== "write",
    }),
    scheduler: Object.freeze({
      enabled: scheduleEnabled,
      mode: scheduleEnabled ? scheduleMode : "manual",
      expression: scheduleExpression || null,
      timezone: scheduleTimezone,
      maxRuns: Math.floor(Number.isFinite(maxRuns) && maxRuns > 0 ? maxRuns : 1),
      nextCursor: scheduleEnabled
        ? stableHash(`${commandBase}:${scheduleExpression}:${scheduleTimezone}`)
        : null,
    }),
    commands: Object.freeze({
      preview: Object.freeze({
        idempotent: true,
        idempotencyKey: `${commandBase}:preview`,
        command: "aios.mailchimp.manifest.preview",
        enabled: lifecycleState !== "blocked",
      }),
      enable: Object.freeze({
        idempotent: true,
        idempotencyKey: `${commandBase}:enable`,
        command: "aios.mailchimp.manifest.enable",
        enabled: lifecycleState === "disabled",
      }),
      disable: Object.freeze({
        idempotent: true,
        idempotencyKey: `${commandBase}:disable`,
        command: "aios.mailchimp.manifest.disable",
        enabled: enabled,
      }),
      write: Object.freeze({
        idempotent: true,
        idempotencyKey: `${commandBase}:write:${approvalTicket || "no-approval"}`,
        command: lifecycleState === "armed"
          ? "aios.mailchimp.manifest.write"
          : "aios.mailchimp.manifest.preview",
        enabled: lifecycleState === "armed",
      }),
    }),
    exportSummary: Object.freeze({
      ready: lifecycleState === "armed" || lifecycleState === "preview",
      manifestFileCount,
      blockedExportCount: blockedExports.length,
      packageName,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      healthState: operationalHealth.state,
      nextAction,
    }),
    timeline,
    validation: Object.freeze({
      ready: settingsBlockers.length === 0,
      canRunNextAction: lifecycleState === "armed" || lifecycleState === "preview",
      blockers: settingsBlockers,
    }),
    nextAction,
  });
}

function createMailchimpProviderContract(compileContract, status, tenantBoundary, operationalHealth, lifecycleControls, options = {}) {
  const mailchimp = compileContract.mailchimpProvider;
  const generatedAt = cleanText(options.providerGeneratedAt || options.generatedAt) || "logical:provider-contract";
  const providerResource = cleanText(options.providerResource || options.resource) || "mailchimp-runtime-package";
  const requestedCapabilities = dedupe([
    ...compileContract.compileResult.capabilityManifest.map((entry) => entry.name),
    ...asList(options.providerCapabilities),
  ]);
  const requiredScopes = dedupe([
    ...asList(mailchimp.capabilityNegotiation?.requiredScopes),
    ...asList(mailchimp.capabilityNegotiation?.missingScopes),
    ...requestedCapabilities.filter((capability) => capability.startsWith("mailchimp:")),
  ]);
  const acceptedScopes = dedupe([
    ...asList(mailchimp.capabilityNegotiation?.acceptedScopes),
    ...requiredScopes.filter((scope) => !mailchimp.capabilityNegotiation.missingScopes.includes(scope)),
  ]);
  const missingScopes = dedupe(mailchimp.capabilityNegotiation.missingScopes);
  const deniedCapabilities = dedupe([
    ...missingScopes,
    ...tenantBoundary.deniedPermissions.filter((permission) => permission.startsWith("mailchimp:")),
  ]);
  const acceptedCapabilities = Object.freeze(requestedCapabilities
    .filter((capability) => !deniedCapabilities.includes(capability))
    .sort());
  const negotiationState = deniedCapabilities.length > 0
    ? "blocked"
    : mailchimp.capabilityNegotiation.accepted === true
      ? "accepted"
      : "pending";
  const syncState = mailchimp.sync.channel
    ? mailchimp.sync.state || (negotiationState === "accepted" ? "ready" : "pending")
    : "missing-channel";
  const externalHandoffState = lifecycleControls.state === "armed" && negotiationState === "accepted"
    ? "ready"
    : negotiationState === "blocked" || tenantBoundary.state === "blocked"
      ? "blocked"
      : "preview";
  const contractId = stableHash([
    compileContract.source.sourceHash,
    providerResource,
    tenantBoundary.isolationKey,
    requestedCapabilities.join(","),
    deniedCapabilities.join(","),
    lifecycleControls.state,
  ].join(":"));
  const commandBase = `aios.mailchimp.provider.${contractId}`;
  const validationBlockers = Object.freeze([
    ...(providerResource ? [] : ["provider contract requires a Mailchimp resource"]),
    ...(mailchimp.required && requiredScopes.length === 0 ? ["mailchimp provider requires at least one required scope"] : []),
    ...missingScopes.map((scope) => `mailchimp provider scope not accepted: ${scope}`),
    ...(tenantBoundary.state === "blocked" ? ["mailchimp provider contract requires tenant boundary repair"] : []),
    ...(lifecycleControls.state === "blocked" ? ["mailchimp provider contract requires valid lifecycle controls"] : []),
    ...(syncState === "missing-channel" ? ["mailchimp provider sync channel is missing"] : []),
  ]);
  const syncMetadata = Object.freeze({
    protocol: "aios.language.mailchimp-provider-sync-metadata.v1",
    state: syncState,
    channel: mailchimp.sync.channel || "local-status",
    correlationId: mailchimp.sync.correlationId,
    generatedAt,
    checkpoint: stableHash(`${contractId}:${syncState}:${mailchimp.sync.correlationId}`),
    replayGuard: Object.freeze({
      sourceHash: compileContract.source.sourceHash,
      manifestState: status.state,
      lifecycleState: lifecycleControls.state,
      tenantIsolationKey: tenantBoundary.isolationKey,
    }),
  });
  const capabilityNegotiation = Object.freeze({
    protocol: "aios.language.mailchimp-provider-capability-negotiation.v1",
    state: negotiationState,
    requestedCapabilities,
    acceptedCapabilities,
    deniedCapabilities,
    requiredScopes,
    acceptedScopes,
    missingScopes,
    externalWritesAllowed: lifecycleControls.settings.externalWritesAllowed === true,
    nextAction: negotiationState === "blocked"
      ? "negotiate-mailchimp-provider-capabilities"
      : negotiationState === "pending"
        ? "confirm-mailchimp-provider-capabilities"
        : lifecycleControls.nextAction,
  });
  const commands = Object.freeze({
    negotiate: Object.freeze({
      idempotent: true,
      idempotencyKey: `${commandBase}:negotiate:${deniedCapabilities.join(",") || "none"}`,
      command: "aios.mailchimp.provider.negotiateCapabilities",
      enabled: negotiationState !== "accepted",
      expectedState: negotiationState,
    }),
    sync: Object.freeze({
      idempotent: true,
      idempotencyKey: `${commandBase}:sync:${syncMetadata.checkpoint}`,
      command: "aios.mailchimp.provider.syncManifest",
      enabled: validationBlockers.length === 0 || externalHandoffState === "preview",
      expectedState: syncState,
    }),
    acknowledge: Object.freeze({
      idempotent: true,
      idempotencyKey: `${commandBase}:ack:${lifecycleControls.commands.write.idempotencyKey}`,
      command: externalHandoffState === "ready"
        ? "aios.mailchimp.provider.acknowledgeRuntimeHandoff"
        : "aios.mailchimp.provider.previewRuntimeHandoff",
      enabled: externalHandoffState !== "blocked",
      expectedState: externalHandoffState,
    }),
  });

  return Object.freeze({
    protocol: "aios.language.mailchimp-provider-service-contract.v1",
    contractId,
    provider: "mailchimp",
    resource: providerResource,
    state: externalHandoffState,
    generatedAt,
    tenant: Object.freeze({
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      isolationKey: tenantBoundary.isolationKey,
      role: tenantBoundary.role,
    }),
    capabilityNegotiation,
    syncMetadata,
    externalHandoff: Object.freeze({
      state: externalHandoffState,
      ready: externalHandoffState === "ready",
      handoffToken: externalHandoffState === "ready"
        ? stableHash(`${contractId}:handoff:${lifecycleControls.commands.write.idempotencyKey}`)
        : null,
      lifecycleCommand: lifecycleControls.commands.write.command,
      lifecycleIdempotencyKey: lifecycleControls.commands.write.idempotencyKey,
      recoveryToken: compileContract.recoveryHandoff.resumeToken,
      healthState: operationalHealth.state,
      nextAction: externalHandoffState === "blocked"
        ? capabilityNegotiation.nextAction
        : lifecycleControls.nextAction,
    }),
    commands,
    validation: Object.freeze({
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      canSync: commands.sync.enabled,
      canAcknowledge: commands.acknowledge.enabled,
    }),
  });
}

export function buildAiosMailchimpManifest(source = "", options = {}) {
  const compileContract = options.compileContract?.protocol
    ? options.compileContract
    : buildAiosCliCompileContract(source, options);
  const summary = summarizeAiosCliCompileContract(compileContract);
  const packageName = cleanText(options.packageName) || "aios-mailchimp-runtime";
  const files = createManifestFiles(compileContract, packageName);
  const tenantBoundary = createTenantBoundary(compileContract, packageName, options);
  const status = createManifestStatus(compileContract, files, tenantBoundary, options);
  const operationalHealth = createManifestOperationalHealth(compileContract, status, tenantBoundary, files, options);
  const lifecycleControls = createManifestLifecycleControls(
    compileContract,
    status,
    tenantBoundary,
    operationalHealth,
    files,
    packageName,
    options,
  );
  const providerContract = createMailchimpProviderContract(
    compileContract,
    status,
    tenantBoundary,
    operationalHealth,
    lifecycleControls,
    options,
  );
  const capabilities = asList(compileContract.compileResult.capabilityManifest.map((entry) => entry.name));
  const verifierContracts = Array.isArray(compileContract.compileResult.verifierContracts)
    ? compileContract.compileResult.verifierContracts
    : [];
  const truthClaims = Array.isArray(compileContract.compileResult.truthClaims)
    ? compileContract.compileResult.truthClaims
    : [];
  const memoryScopes = asList([
    ...compileContract.compileResult.memoryContract.reads,
    ...compileContract.compileResult.memoryContract.writes,
    ...compileContract.compileResult.memoryContract.scopes,
  ]);
  const manifestBody = Object.freeze({
    name: packageName,
    version: cleanText(options.version) || "0.0.0-aios",
    target: "mailchimp",
    sourceHash: compileContract.source.sourceHash,
    contracts: Object.freeze({
      compile: compileContract.protocol,
      manifest: MANIFEST_WRITER_PROTOCOL,
      status: status.protocol,
      mailchimp: compileContract.mailchimpProvider.protocol,
      recovery: compileContract.recoveryHandoff.protocol,
      operationalHealth: operationalHealth.protocol,
      lifecycleControls: lifecycleControls.protocol,
      providerContract: providerContract.protocol,
    }),
    kernel: Object.freeze({
      jobCount: compileContract.compileResult.jobs.length,
      capabilities,
      memoryScopes,
      verifierCount: verifierContracts.length,
      claimCount: truthClaims.length,
    }),
    mailchimp: Object.freeze({
      state: compileContract.mailchimpProvider.state,
      required: compileContract.mailchimpProvider.required,
      accountId: compileContract.mailchimpProvider.identity.accountId,
      audienceId: compileContract.mailchimpProvider.identity.audienceId,
      campaignId: compileContract.mailchimpProvider.identity.campaignId,
      syncChannel: compileContract.mailchimpProvider.sync.channel,
      correlationId: compileContract.mailchimpProvider.sync.correlationId,
      missingScopes: compileContract.mailchimpProvider.capabilityNegotiation.missingScopes,
    }),
    tenantBoundary,
    operationalHealth,
    lifecycleControls,
    providerContract,
    recovery: Object.freeze({
      strategy: compileContract.recoveryHandoff.strategy,
      resumeToken: compileContract.recoveryHandoff.resumeToken,
      retryLimit: compileContract.recoveryHandoff.retryLimit,
      nextAction: compileContract.recoveryHandoff.nextAction,
    }),
    files,
  });
  const diagnostics = Object.freeze([
    ...compileContract.diagnostics,
    ...(status.state === "provider-blocked"
      ? [diagnostic("error", "AIOS_MANIFEST_MAILCHIMP_PROVIDER_BLOCKED", "Manifest cannot be published until Mailchimp provider scopes are accepted.", "$.mailchimp.missingScopes", status.nextAction)]
      : []),
    ...(status.state === "tenant-blocked"
      ? [diagnostic("error", "AIOS_MANIFEST_TENANT_BOUNDARY_BLOCKED", "Manifest cannot be published until tenant boundary identity and permissions are resolved.", "$.tenantBoundary", status.nextAction)]
      : []),
    ...(operationalHealth.retry.exhausted
      ? [diagnostic("error", "AIOS_MANIFEST_RETRY_EXHAUSTED", "Manifest writer exhausted deterministic retry attempts for the current failure state.", "$.manifest.operationalHealth.retry", operationalHealth.retry.nextAction)]
      : []),
    ...(lifecycleControls.validation.ready
      ? []
      : [diagnostic("error", "AIOS_MANIFEST_LIFECYCLE_BLOCKED", "Manifest lifecycle controls require valid settings before package handoff.", "$.manifest.lifecycleControls", lifecycleControls.nextAction)]),
    ...(providerContract.validation.ready
      ? []
      : [diagnostic("warning", "AIOS_MANIFEST_PROVIDER_CONTRACT_REVIEW", "Manifest provider contract requires Mailchimp capability negotiation or sync metadata before external handoff.", "$.manifest.providerContract", providerContract.externalHandoff.nextAction)]),
  ]);

  return Object.freeze({
    protocol: MANIFEST_WRITER_PROTOCOL,
    command: "manifest",
    packageName,
    summary,
    manifest: manifestBody,
    status,
    diagnostics,
    serialized: stableJson(manifestBody),
    manifestHash: stableHash(stableJson(manifestBody)),
    statusHandoff: Object.freeze({
      ...compileContract.statusHandoff,
      manifestState: status.state,
      manifestHash: stableHash(stableJson(manifestBody)),
      packageName,
      tenantState: tenantBoundary.state,
      workspaceId: tenantBoundary.workspaceId,
      isolationKey: tenantBoundary.isolationKey,
      healthState: operationalHealth.state,
      degradedMode: operationalHealth.degradedMode,
      lifecycleState: lifecycleControls.state,
      lifecycleCommand: lifecycleControls.commands.write.command,
      lifecycleIdempotencyKey: lifecycleControls.commands.write.idempotencyKey,
      scheduleEnabled: lifecycleControls.scheduler.enabled,
      providerContractId: providerContract.contractId,
      providerContractState: providerContract.state,
      providerNegotiationState: providerContract.capabilityNegotiation.state,
      providerSyncState: providerContract.syncMetadata.state,
      providerHandoffToken: providerContract.externalHandoff.handoffToken,
      retryable: operationalHealth.retry.retryable,
      nextBackoffMs: operationalHealth.retry.nextBackoffMs,
      nextAction: lifecycleControls.nextAction,
    }),
    recoveryHandoff: Object.freeze({
      ...compileContract.recoveryHandoff,
      manifestState: status.state,
      manifestFiles: files.map((file) => file.packagePath),
      tenantBoundary: Object.freeze({
        state: tenantBoundary.state,
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        deniedPermissions: tenantBoundary.deniedPermissions,
        nextAction: tenantBoundary.audit.nextAction,
      }),
      operationalHealth: Object.freeze({
        state: operationalHealth.state,
        degradedMode: operationalHealth.degradedMode,
        retry: operationalHealth.retry,
        actionableErrors: operationalHealth.actionableErrors,
      }),
      lifecycleControls: Object.freeze({
        state: lifecycleControls.state,
        settings: lifecycleControls.settings,
        scheduler: lifecycleControls.scheduler,
        commands: lifecycleControls.commands,
        nextAction: lifecycleControls.nextAction,
      }),
      providerContract: Object.freeze({
        contractId: providerContract.contractId,
        state: providerContract.state,
        capabilityNegotiation: providerContract.capabilityNegotiation,
        syncMetadata: providerContract.syncMetadata,
        externalHandoff: providerContract.externalHandoff,
        commands: providerContract.commands,
      }),
      nextAction: lifecycleControls.nextAction,
    }),
  });
}

export function assertAiosMailchimpManifestReady(contract) {
  const diagnostics = [];
  if (contract?.protocol !== MANIFEST_WRITER_PROTOCOL) {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_PROTOCOL_INVALID", "Manifest writer contract protocol is missing or unsupported."));
  }
  if (!contract?.manifestHash) {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_HASH_REQUIRED", "Manifest writer must expose a deterministic manifest hash.", "$.manifestHash"));
  }
  if (!contract?.status?.nextAction) {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_NEXT_ACTION_REQUIRED", "Manifest writer must expose a deterministic next action.", "$.status.nextAction"));
  }
  if ((contract?.manifest?.files?.length ?? 0) < 3) {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_FILES_REQUIRED", "Manifest writer must declare manifest, adapter, and recovery exports.", "$.manifest.files"));
  }
  if ((contract?.manifest?.mailchimp?.missingScopes?.length ?? 0) > 0) {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_MAILCHIMP_SCOPE_GAP", "Manifest writer has unresolved Mailchimp scope gaps.", "$.manifest.mailchimp.missingScopes"));
  }
  if (!contract?.manifest?.tenantBoundary?.isolationKey) {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_TENANT_ISOLATION_REQUIRED", "Manifest writer must expose a deterministic tenant isolation key.", "$.manifest.tenantBoundary.isolationKey"));
  }
  if (contract?.manifest?.tenantBoundary?.state === "blocked") {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_TENANT_BOUNDARY_BLOCKED", "Manifest writer has unresolved tenant boundary permissions.", "$.manifest.tenantBoundary.deniedPermissions", "repair-mailchimp-tenant-boundary"));
  }
  if (!contract?.manifest?.operationalHealth?.retry) {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_OPERATIONAL_HEALTH_REQUIRED", "Manifest writer must expose operational health, retry, and degraded-mode semantics.", "$.manifest.operationalHealth"));
  }
  if (!contract?.manifest?.lifecycleControls?.commands?.write?.idempotencyKey) {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_LIFECYCLE_CONTROLS_REQUIRED", "Manifest writer must expose lifecycle controls with idempotent write command state.", "$.manifest.lifecycleControls"));
  }
  if (!contract?.manifest?.providerContract?.contractId) {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_PROVIDER_CONTRACT_REQUIRED", "Manifest writer must expose a deterministic Mailchimp provider service contract.", "$.manifest.providerContract"));
  }
  if (!contract?.manifest?.providerContract?.syncMetadata?.checkpoint) {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_PROVIDER_SYNC_REQUIRED", "Manifest writer must expose provider sync metadata with a deterministic checkpoint.", "$.manifest.providerContract.syncMetadata"));
  }
  if (contract?.manifest?.providerContract?.validation?.ready === false) {
    diagnostics.push(diagnostic("warning", "AIOS_MANIFEST_PROVIDER_CONTRACT_REVIEW", "Manifest provider service contract requires capability negotiation or sync repair.", "$.manifest.providerContract.validation.blockers", contract.manifest.providerContract.externalHandoff.nextAction));
  }
  if (contract?.manifest?.lifecycleControls?.validation?.ready === false) {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_LIFECYCLE_BLOCKED", "Manifest lifecycle settings are not ready for handoff.", "$.manifest.lifecycleControls.validation.blockers", contract.manifest.lifecycleControls.nextAction));
  }
  if (contract?.manifest?.operationalHealth?.retry?.exhausted === true) {
    diagnostics.push(diagnostic("error", "AIOS_MANIFEST_RETRY_EXHAUSTED", "Manifest writer retry attempts are exhausted for the current failure state.", "$.manifest.operationalHealth.retry", contract.manifest.operationalHealth.retry.nextAction));
  }
  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    nextAction: diagnostics[0]?.nextAction || diagnostics[0]?.code || contract?.status?.nextAction || "repair-mailchimp-manifest",
  });
}

export function serializeAiosMailchimpManifest(contract) {
  return contract?.serialized ?? stableJson(contract?.manifest ?? {});
}
