import { compileMailchimpJobDescriptor } from "./job-descriptor-compiler.mjs";

const SEVERITY_RANK = {
  error: 0,
  warning: 1,
  info: 2
};

const RECOVERY_BY_CODE = {
  "job.provider.unsupported": "select-mailchimp-provider",
  "job.task.missing": "declare-mailchimp-task",
  "capability.action.missing": "declare-capability-action",
  "capability.action.unsupported": "remove-unsupported-capability",
  "capability.lifecycle.scheduleWindow.unsupported": "select-supported-schedule-window",
  "capability.lifecycle.disabledRequired": "enable-required-mailchimp-capability",
  "lifecycle.runtimeStart.disabled": "accept-preview-before-runtime-start",
  "lifecycle.preview.disabled": "enable-mailchimp-client-preview",
  "lifecycle.schedule.paused": "resume-mailchimp-schedule",
  "memory.mount.unsupported": "select-supported-memory-mount",
  "memory.mount.mode.unsupported": "select-supported-memory-mode",
  "memory.sync.direction.unsupported": "select-supported-sync-direction",
  "memory.sync.readonlyWriteSuppressed": "review-readonly-writeback-suppression",
  "verifier.rule.invalid": "repair-verifier-rule",
  "verifier.predicate.unsupported": "select-supported-verifier-predicate",
  "capability.approval.required": "collect-human-approval",
  "workspace.tenant.missing": "declare-workspace-tenant-boundary",
  "workspace.id.missing": "declare-workspace-tenant-boundary",
  "workspace.boundary.wildcard": "replace-wildcard-workspace-boundary",
  "workspace.tenant.crossAccess": "isolate-mailchimp-tenant-workspace",
  "workspace.role.missing": "grant-required-workspace-role",
  "workspace.scope.denied": "remove-denied-mailchimp-scope",
  "provider.service.missing": "select-mailchimp-provider-service",
  "provider.service.unsupported": "select-supported-mailchimp-provider-service",
  "provider.scope.missing": "declare-mailchimp-service-scope",
  "provider.capability.unnegotiated": "negotiate-mailchimp-provider-capability",
  "provider.sync.missing": "declare-provider-sync-handoff",
  "client.runtime.state.missing": "hydrate-mailchimp-client-runtime-state",
  "client.runtime.resume.missing": "restore-mailchimp-runtime-resume-token",
  "client.runtime.ack.pending": "acknowledge-mailchimp-client-command",
  "client.runtime.preview.unavailable": "enable-mailchimp-client-preview"
};

const RETRY_POLICY_BY_ACTION = {
  "handoff-to-runtime-adapter": { retryable: true, backoffMs: 5000, maxAttempts: 1, failureClass: "runtime-handoff" },
  "review-runtime-handoff-action": { retryable: true, backoffMs: 30000, maxAttempts: 3, failureClass: "operator-review" },
  "collect-human-approval": { retryable: true, backoffMs: 60000, maxAttempts: 6, failureClass: "approval-gate" },
  "select-mailchimp-provider": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "provider-contract" },
  "declare-mailchimp-task": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "job-contract" },
  "declare-capability-action": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "capability-contract" },
  "remove-unsupported-capability": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "capability-contract" },
  "select-supported-schedule-window": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "capability-lifecycle" },
  "enable-required-mailchimp-capability": { retryable: true, backoffMs: 45000, maxAttempts: 3, failureClass: "capability-lifecycle" },
  "accept-preview-before-runtime-start": { retryable: true, backoffMs: 30000, maxAttempts: 3, failureClass: "lifecycle-control" },
  "enable-mailchimp-client-preview": { retryable: true, backoffMs: 30000, maxAttempts: 2, failureClass: "lifecycle-control" },
  "resume-mailchimp-schedule": { retryable: true, backoffMs: 60000, maxAttempts: 4, failureClass: "schedule-control" },
  "select-supported-memory-mount": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "memory-contract" },
  "select-supported-memory-mode": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "memory-contract" },
  "select-supported-sync-direction": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "provider-sync-contract" },
  "review-readonly-writeback-suppression": { retryable: true, backoffMs: 30000, maxAttempts: 2, failureClass: "provider-sync-review" },
  "repair-verifier-rule": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "verifier-contract" },
  "select-supported-verifier-predicate": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "verifier-contract" },
  "declare-workspace-tenant-boundary": { retryable: true, backoffMs: 45000, maxAttempts: 4, failureClass: "workspace-boundary" },
  "replace-wildcard-workspace-boundary": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "workspace-boundary" },
  "isolate-mailchimp-tenant-workspace": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "tenant-isolation" },
  "grant-required-workspace-role": { retryable: true, backoffMs: 45000, maxAttempts: 4, failureClass: "workspace-permission" },
  "remove-denied-mailchimp-scope": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "scope-boundary" },
  "select-mailchimp-provider-service": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "provider-service-contract" },
  "select-supported-mailchimp-provider-service": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "provider-service-contract" },
  "declare-mailchimp-service-scope": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "provider-service-scope" },
  "negotiate-mailchimp-provider-capability": { retryable: true, backoffMs: 45000, maxAttempts: 3, failureClass: "provider-capability-negotiation" },
  "declare-provider-sync-handoff": { retryable: true, backoffMs: 30000, maxAttempts: 3, failureClass: "provider-sync-handoff" },
  "hydrate-mailchimp-client-runtime-state": { retryable: true, backoffMs: 15000, maxAttempts: 3, failureClass: "client-runtime-state" },
  "restore-mailchimp-runtime-resume-token": { retryable: true, backoffMs: 10000, maxAttempts: 2, failureClass: "client-runtime-resume" },
  "acknowledge-mailchimp-client-command": { retryable: true, backoffMs: 20000, maxAttempts: 4, failureClass: "client-command-ack" },
  "repair-before-runtime-handoff": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "compile-contract" }
};

const SUPPORTED_PROVIDER_SERVICES = [
  "mailchimp-marketing-api",
  "mailchimp-transactional-api"
];

const SERVICE_DEFAULT_SCOPES = {
  "mailchimp-marketing-api": ["campaigns:read", "campaigns:write", "lists:read"],
  "mailchimp-transactional-api": ["messages:send", "templates:read"]
};

function compileIfNeeded(source, options) {
  if (source?.kind === "aios.kernelJobDescriptor") return source;
  return compileMailchimpJobDescriptor(source, options);
}

function normalizeSeverity(diagnostic = {}) {
  const severity = diagnostic.severity || diagnostic.level || "info";
  return Object.hasOwn(SEVERITY_RANK, severity) ? severity : "info";
}

function diagnosticScope(diagnostic = {}) {
  if (diagnostic.action) return { type: "capability", id: diagnostic.action };
  if (diagnostic.mount) return { type: "memory", id: diagnostic.mount };
  if (diagnostic.rule) return { type: "verifier", id: diagnostic.rule };
  if (diagnostic.field) return { type: "field", id: diagnostic.field };
  return { type: "job", id: "mailchimp" };
}

function stableDiagnosticId(jobId, diagnostic, index) {
  const code = diagnostic.code || "diagnostic.unknown";
  const scope = diagnosticScope(diagnostic);
  return `${jobId}.${String(index + 1).padStart(2, "0")}.${code}.${scope.type}.${scope.id}`
    .replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function recoveryActionFor(diagnostic, runtimeHandoff) {
  if (RECOVERY_BY_CODE[diagnostic.code]) return RECOVERY_BY_CODE[diagnostic.code];
  if (diagnostic.level === "error" || diagnostic.severity === "error") return "repair-before-runtime-handoff";
  if (runtimeHandoff?.readinessStatus === "needs-operator-action") return "review-runtime-handoff-action";
  return "observe";
}

function sortDiagnostics(left, right) {
  const severityDelta = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severityDelta !== 0) return severityDelta;
  if (left.scope.type !== right.scope.type) return left.scope.type.localeCompare(right.scope.type);
  if (left.scope.id !== right.scope.id) return left.scope.id.localeCompare(right.scope.id);
  return left.code.localeCompare(right.code);
}

function countBy(values, key) {
  return values.reduce((counts, value) => {
    const bucket = value[key] || "unknown";
    counts[bucket] = (counts[bucket] || 0) + 1;
    return counts;
  }, {});
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(Boolean).map(String))).sort();
}

function normalizeBoundaryId(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function capabilityRequiredScopes(job) {
  const service = job.contracts?.capabilities?.providerServiceContract || {};
  return normalizeList(service.syncMetadata?.serviceScopes || []);
}

function providerServiceSource(job) {
  const capabilityService = job.contracts?.capabilities?.providerServiceContract || {};
  const memoryService = job.contracts?.memory?.providerServiceContract || {};
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const serviceHandoff = runtimeHandoff.serviceHandoff || {};
  return {
    capabilityService,
    memoryService,
    runtimeHandoff,
    serviceHandoff,
    capabilities: job.contracts?.capabilities?.capabilities || [],
    mounts: job.contracts?.memory?.mounts || []
  };
}

function deriveProviderServiceContract(job, options = {}) {
  const {
    capabilityService,
    memoryService,
    runtimeHandoff,
    serviceHandoff,
    capabilities,
    mounts
  } = providerServiceSource(job);
  const optionService = options.providerServiceContract || {};
  const providerService = optionService.providerService
    || capabilityService.providerService
    || memoryService.providerService
    || serviceHandoff.providerService
    || runtimeHandoff.providerService
    || "mailchimp-marketing-api";
  const supportedServices = normalizeList(optionService.supportedServices || SUPPORTED_PROVIDER_SERVICES);
  const serviceSupported = supportedServices.includes(providerService);
  const declaredScopes = normalizeList(
    optionService.serviceScopes
      || capabilityService.syncMetadata?.serviceScopes
      || capabilityService.serviceScopes
      || []
  );
  const defaultScopes = SERVICE_DEFAULT_SCOPES[providerService] || [];
  const requiredScopes = normalizeList(declaredScopes.length ? declaredScopes : defaultScopes);
  const writeActions = normalizeList(
    capabilities
      .filter((capability) => capability.providerOperation?.externalWrite === true)
      .map((capability) => capability.action)
  );
  const negotiatedCapabilities = normalizeList(
    optionService.negotiatedCapabilities
      || capabilityService.capabilityNegotiation
      || memoryService.capabilityNegotiation
      || []
  );
  const requiredNegotiations = normalizeList([
    ...writeActions,
    ...(memoryService.capabilityNegotiation || [])
  ]);
  const unnegotiatedCapabilities = requiredNegotiations
    .filter((capability) => !negotiatedCapabilities.includes(capability));
  const providerSyncMounts = mounts
    .filter((mount) => mount.providerContract?.syncDirection && mount.providerContract.syncDirection !== "local-only")
    .map((mount) => ({
      name: mount.name,
      syncDirection: mount.providerContract.syncDirection,
      externalHandoff: mount.providerContract.externalHandoff || "not-required",
      capability: mount.providerContract.capability || null
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const syncRequired = memoryService.syncRequired === true || providerSyncMounts.length > 0;
  const syncHandoffReady = syncRequired === false
    || providerSyncMounts.every((mount) => mount.externalHandoff !== "not-required");
  const missingScopes = requiredScopes.length === 0 ? ["mailchimp-provider-scope"] : [];
  const status = serviceSupported === false || missingScopes.length > 0
    ? "blocked"
    : unnegotiatedCapabilities.length > 0 || syncHandoffReady === false
      ? "needs-operator-action"
      : "ready";

  return {
    schemaVersion: "aios.mailchimp.provider-service-contract.v1",
    provider: "mailchimp",
    jobId: job.id,
    providerService,
    supportedServices,
    serviceSupported,
    status,
    syncMetadata: {
      syncRequired,
      serviceScopes: requiredScopes,
      declaredScopes,
      defaultScopesApplied: declaredScopes.length === 0,
      providerSyncMounts,
      syncHandoffReady
    },
    capabilityNegotiation: {
      writeActions,
      required: requiredNegotiations,
      negotiated: negotiatedCapabilities,
      unnegotiated: unnegotiatedCapabilities,
      approvalActions: normalizeList(capabilityService.runtimeControls?.approvalActions || [])
    },
    externalHandoff: {
      target: serviceHandoff.providerService || providerService,
      required: syncRequired || writeActions.length > 0,
      ready: serviceSupported && missingScopes.length === 0 && syncHandoffReady && unnegotiatedCapabilities.length === 0,
      idempotencyKey: `${job.id}:${providerService}:${requiredScopes.join("|")}:${negotiatedCapabilities.join("|")}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    },
    nextAction: serviceSupported === false
      ? "select-supported-mailchimp-provider-service"
      : missingScopes.length
        ? "declare-mailchimp-service-scope"
        : unnegotiatedCapabilities.length
          ? "negotiate-mailchimp-provider-capability"
          : syncHandoffReady === false
            ? "declare-provider-sync-handoff"
            : "handoff-to-runtime-adapter"
  };
}

function providerServiceDiagnostic(field, code, message, severity = "warning", extras = {}) {
  return {
    severity,
    code,
    field,
    message,
    source: "provider-service-contract",
    ...extras
  };
}

function providerServiceDiagnostics(providerServiceContract) {
  const diagnostics = [];
  if (!providerServiceContract.providerService) {
    diagnostics.push(providerServiceDiagnostic(
      "providerService",
      "provider.service.missing",
      "Mailchimp provider service is required before adapter handoff.",
      "error"
    ));
  }
  if (providerServiceContract.serviceSupported === false) {
    diagnostics.push(providerServiceDiagnostic(
      "providerService",
      "provider.service.unsupported",
      `Mailchimp provider service '${providerServiceContract.providerService}' is not in the supported service set.`,
      "error",
      { providerService: providerServiceContract.providerService }
    ));
  }
  if (providerServiceContract.syncMetadata.serviceScopes.length === 0) {
    diagnostics.push(providerServiceDiagnostic(
      "serviceScopes",
      "provider.scope.missing",
      "Mailchimp provider service scopes must be declared for runtime handoff.",
      "error"
    ));
  }
  for (const action of providerServiceContract.capabilityNegotiation.unnegotiated) {
    diagnostics.push(providerServiceDiagnostic(
      "capabilityNegotiation",
      "provider.capability.unnegotiated",
      `Mailchimp capability '${action}' requires provider-service negotiation before runtime handoff.`,
      "warning",
      { action }
    ));
  }
  if (providerServiceContract.syncMetadata.syncHandoffReady === false) {
    diagnostics.push(providerServiceDiagnostic(
      "providerSyncMounts",
      "provider.sync.missing",
      "Mailchimp provider sync mounts require an external handoff target before adapter recovery can resume.",
      "warning"
    ));
  }
  return diagnostics;
}

function derivePermissionBoundary(job, options = {}) {
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const sourceBoundary = job.contracts?.tenantBoundary || job.contracts?.workspaceBoundary || {};
  const optionBoundary = options.workspaceBoundary || {};
  const requiredScopes = capabilityRequiredScopes(job);
  const sourceWorkspaceId = optionBoundary.workspaceId
    || sourceBoundary.workspaceId
    || runtimeHandoff.clientContract?.workspaceId;
  const sourceTenantId = optionBoundary.tenantId
    || sourceBoundary.tenantId
    || runtimeHandoff.clientContract?.tenantId;
  const workspaceId = normalizeBoundaryId(
    sourceWorkspaceId,
    "workspace.local"
  );
  const tenantId = normalizeBoundaryId(
    sourceTenantId,
    "tenant.local"
  );
  const allowedRoles = normalizeList(optionBoundary.allowedRoles || sourceBoundary.allowedRoles || ["owner", "operator"]);
  const requiredRoles = normalizeList(optionBoundary.requiredRoles || sourceBoundary.requiredRoles || ["operator"]);
  const requestedScopes = normalizeList(optionBoundary.requestedScopes || sourceBoundary.requestedScopes || requiredScopes);
  const explicitTenantIds = normalizeList(optionBoundary.allowedTenantIds || sourceBoundary.allowedTenantIds || [tenantId]);
  const missingRoles = requiredRoles.filter((role) => !allowedRoles.includes(role));
  const deniedScopes = requestedScopes.filter((scope) => requiredScopes.length > 0 && !requiredScopes.includes(scope));
  const wildcardBoundary = workspaceId === "*" || tenantId === "*";
  const crossTenantAccess = explicitTenantIds.length > 0 && !explicitTenantIds.includes(tenantId);
  const isolationKey = `${tenantId}:${workspaceId}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const safeBoundary = wildcardBoundary === false
    && crossTenantAccess === false
    && missingRoles.length === 0
    && deniedScopes.length === 0;

  return {
    schemaVersion: "aios.mailchimp.permission-boundary.v1",
    provider: "mailchimp",
    jobId: job.id,
    tenantId,
    workspaceId,
    isolationKey,
    explicitTenant: Boolean(sourceTenantId),
    explicitWorkspace: Boolean(sourceWorkspaceId),
    allowedTenantIds: explicitTenantIds,
    allowedRoles,
    requiredRoles,
    missingRoles,
    requiredScopes,
    requestedScopes,
    deniedScopes,
    wildcardBoundary,
    crossTenantAccess,
    safeBoundary,
    enforcement: {
      rolePolicy: "compile-diagnostic",
      scopePolicy: "adapter-handoff",
      tenantPolicy: "single-tenant-isolation",
      externalWritesAllowed: runtimeHandoff.controls?.requiresApprovalBeforeExternalWrite !== true
        && safeBoundary === true
    },
    nextAction: wildcardBoundary
      ? "replace-wildcard-workspace-boundary"
      : crossTenantAccess
        ? "isolate-mailchimp-tenant-workspace"
        : missingRoles.length
          ? "grant-required-workspace-role"
          : deniedScopes.length
            ? "remove-denied-mailchimp-scope"
            : "handoff-to-runtime-adapter"
  };
}

function boundaryDiagnostic(field, code, message, severity = "error", extras = {}) {
  return {
    severity,
    code,
    field,
    message,
    source: "permission-boundary",
    ...extras
  };
}

function permissionBoundaryDiagnostics(boundary) {
  const diagnostics = [];
  if (!boundary.explicitTenant) {
    diagnostics.push(boundaryDiagnostic(
      "tenantId",
      "workspace.tenant.missing",
      "Mailchimp runtime handoff is using the local fallback tenant boundary.",
      "warning"
    ));
  }
  if (!boundary.explicitWorkspace) {
    diagnostics.push(boundaryDiagnostic(
      "workspaceId",
      "workspace.id.missing",
      "Mailchimp runtime handoff is using the local fallback workspace boundary.",
      "warning"
    ));
  }
  if (boundary.wildcardBoundary) {
    diagnostics.push(boundaryDiagnostic(
      "workspaceBoundary",
      "workspace.boundary.wildcard",
      "Mailchimp runtime handoff cannot use wildcard tenant or workspace boundaries."
    ));
  }
  if (boundary.crossTenantAccess) {
    diagnostics.push(boundaryDiagnostic(
      "tenantId",
      "workspace.tenant.crossAccess",
      "Mailchimp runtime handoff requested a tenant outside the allowed tenant boundary."
    ));
  }
  for (const role of boundary.missingRoles) {
    diagnostics.push(boundaryDiagnostic(
      "workspaceRole",
      "workspace.role.missing",
      `Mailchimp runtime handoff requires workspace role '${role}'.`,
      "error",
      { role }
    ));
  }
  for (const scope of boundary.deniedScopes) {
    diagnostics.push(boundaryDiagnostic(
      "mailchimpScope",
      "workspace.scope.denied",
      `Mailchimp runtime handoff requested undeclared scope '${scope}'.`,
      "error",
      { scope }
    ));
  }
  return diagnostics;
}

function lifecycleSource(job) {
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const service = job.contracts?.capabilities?.providerServiceContract || {};
  return {
    runtimeHandoff,
    controls: runtimeHandoff.controls || {},
    runtimeControls: service.runtimeControls || {},
    capabilities: job.contracts?.capabilities?.capabilities || []
  };
}

function deriveLifecycleControls(job, permissionBoundary) {
  const { runtimeHandoff, controls, runtimeControls, capabilities } = lifecycleSource(job);
  const disabledActions = normalizeList(runtimeControls.disabledActions || controls.disabledActions || []);
  const approvalActions = normalizeList(runtimeControls.approvalActions || controls.approvalActions || []);
  const requiredActions = normalizeList(capabilities.map((capability) => capability.action));
  const writeActions = normalizeList(
    capabilities
      .filter((capability) => capability.providerOperation?.externalWrite === true)
      .map((capability) => capability.action)
  );
  const disabledRequiredActions = disabledActions.filter((action) => requiredActions.includes(action));
  const disabledWriteActions = disabledActions.filter((action) => writeActions.includes(action));
  const schedule = controls.schedule || runtimeControls.schedule || {};
  const requestedWindow = schedule.window || runtimeHandoff.scheduleWindow || "runtime";
  const allowedWindows = normalizeList(schedule.allowedWindows || ["compile", "preflight", "runtime"]);
  const schedulePaused = schedule.paused === true || controls.schedulePaused === true;
  const previewEnabled = controls.canPreview !== false;
  const acceptedForPreview = runtimeHandoff.acceptedForClientPreview !== false;
  const acceptedForRuntime = runtimeHandoff.acceptedForRuntime === true;
  const operatorApprovalRequired = controls.requiresApprovalBeforeExternalWrite === true
    || writeActions.some((action) => approvalActions.includes(action));
  const operatorApprovalReady = operatorApprovalRequired === false
    || approvalActions.some((action) => writeActions.includes(action));
  const scheduleWindowSupported = allowedWindows.includes(requestedWindow);
  const runtimeStartEnabled = controls.canStartRuntime === true
    && acceptedForRuntime
    && previewEnabled
    && acceptedForPreview
    && disabledRequiredActions.length === 0
    && permissionBoundary.safeBoundary === true
    && schedulePaused === false
    && scheduleWindowSupported
    && operatorApprovalReady;
  const nextAction = previewEnabled === false || acceptedForPreview === false
    ? "enable-mailchimp-client-preview"
    : disabledRequiredActions.length > 0
      ? "enable-required-mailchimp-capability"
      : scheduleWindowSupported === false
        ? "select-supported-schedule-window"
        : schedulePaused
          ? "resume-mailchimp-schedule"
          : runtimeStartEnabled
            ? "handoff-to-runtime-adapter"
            : "accept-preview-before-runtime-start";

  return {
    schemaVersion: "aios.mailchimp.lifecycle-controls.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: runtimeStartEnabled
      ? "ready"
      : disabledRequiredActions.length || scheduleWindowSupported === false
        ? "blocked"
        : "needs-operator-action",
    preview: {
      enabled: previewEnabled && acceptedForPreview,
      canPreview: previewEnabled,
      acceptedForClientPreview: acceptedForPreview,
      disableReason: previewEnabled === false
        ? "preview-control-disabled"
        : acceptedForPreview === false
          ? "runtime-handoff-preview-rejected"
          : null
    },
    runtimeStart: {
      enabled: runtimeStartEnabled,
      controlEnabled: controls.canStartRuntime === true,
      acceptedForRuntime,
      requiresApprovalBeforeExternalWrite: controls.requiresApprovalBeforeExternalWrite === true,
      operatorApprovalRequired,
      operatorApprovalReady,
      disableReason: runtimeStartEnabled
        ? null
        : disabledRequiredActions.length
          ? "disabled-required-capability"
          : permissionBoundary.safeBoundary !== true
            ? "permission-boundary"
            : scheduleWindowSupported === false
              ? "unsupported-schedule-window"
              : schedulePaused
                ? "schedule-paused"
                : acceptedForRuntime === false
                  ? "runtime-not-accepted"
                  : controls.canStartRuntime !== true
                    ? "runtime-start-control-disabled"
                    : "operator-action-required"
    },
    capabilityControls: {
      requiredActions,
      writeActions,
      disabledActions,
      disabledRequiredActions,
      disabledWriteActions,
      approvalActions,
      canEnableDisabledCapabilities: controls.canEnableDisabledCapabilities === true,
      enableRequiredBeforeRuntime: disabledRequiredActions.length > 0
    },
    schedule: {
      requestedWindow,
      allowedWindows,
      supported: scheduleWindowSupported,
      paused: schedulePaused,
      resumeAt: schedule.resumeAt || null,
      nextEligibleWindow: schedulePaused
        ? schedule.resumeAt || requestedWindow
        : scheduleWindowSupported
          ? requestedWindow
          : allowedWindows[0] || "preflight"
    },
    nextAction
  };
}

function lifecycleDiagnostic(field, code, message, severity = "warning", extras = {}) {
  return {
    severity,
    code,
    field,
    message,
    source: "lifecycle-controls",
    ...extras
  };
}

function lifecycleControlDiagnostics(lifecycleControls) {
  const diagnostics = [];
  if (lifecycleControls.preview.enabled === false) {
    diagnostics.push(lifecycleDiagnostic(
      "canPreview",
      "lifecycle.preview.disabled",
      "Mailchimp client preview is disabled before runtime handoff.",
      "warning"
    ));
  }
  for (const action of lifecycleControls.capabilityControls.disabledRequiredActions) {
    diagnostics.push(lifecycleDiagnostic(
      "disabledActions",
      "capability.lifecycle.disabledRequired",
      `Required Mailchimp capability '${action}' is disabled for runtime start.`,
      "error",
      { action }
    ));
  }
  if (lifecycleControls.schedule.supported === false) {
    diagnostics.push(lifecycleDiagnostic(
      "scheduleWindow",
      "capability.lifecycle.scheduleWindow.unsupported",
      `Mailchimp lifecycle schedule window '${lifecycleControls.schedule.requestedWindow}' is not supported.`,
      "error",
      { requestedWindow: lifecycleControls.schedule.requestedWindow }
    ));
  }
  if (lifecycleControls.schedule.paused) {
    diagnostics.push(lifecycleDiagnostic(
      "schedulePaused",
      "lifecycle.schedule.paused",
      "Mailchimp lifecycle schedule is paused before runtime start.",
      "warning"
    ));
  }
  if (lifecycleControls.runtimeStart.enabled === false && lifecycleControls.status !== "blocked") {
    diagnostics.push(lifecycleDiagnostic(
      "canStartRuntime",
      "lifecycle.runtimeStart.disabled",
      "Mailchimp runtime start is gated until preview acceptance and lifecycle controls are ready.",
      "warning"
    ));
  }
  return diagnostics;
}

function normalizeClientState(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function deriveClientRuntimeAdoption(job, runtimeHandoff, options = {}, statusHandoff = {}, clientCommandLeases = {}) {
  const clientContract = runtimeHandoff.clientContract || {};
  const requiredClientState = normalizeList(clientContract.requiredClientState || []);
  const clientRuntimeState = normalizeClientState(
    options.clientRuntimeState
      || options.currentClientState
      || clientContract.currentState
      || runtimeHandoff.clientState
  );
  const providedStateKeys = normalizeList(Object.keys(clientRuntimeState));
  const missingStateKeys = requiredClientState.filter((key) => !providedStateKeys.includes(key));
  const ack = statusHandoff.clientCommandAck || clientCommandLeases.clientAck || {};
  const ackKeys = normalizeList(ack.ackKeys || clientCommandLeases.clientAck?.ackKeys || []);
  const acknowledgedKeys = normalizeList(
    options.acknowledgedCommandKeys
      || options.clientAcknowledgements
      || clientRuntimeState.acknowledgedCommandKeys
      || []
  );
  const pendingAckKeys = ackKeys.filter((key) => !acknowledgedKeys.includes(key));
  const resumeToken = statusHandoff.statusLedger?.resumeToken
    || clientCommandLeases.clientAck?.resumeToken
    || runtimeHandoff.clientContract?.resumeToken
    || clientRuntimeState.resumeToken
    || null;
  const statusRevision = statusHandoff.statusLedger?.statusRevision
    || runtimeHandoff.clientContract?.statusRevision
    || clientRuntimeState.statusRevision
    || null;
  const previewAvailable = runtimeHandoff.acceptedForClientPreview !== false;
  const runtimeStartRequested = runtimeHandoff.acceptedForRuntime === true
    || runtimeHandoff.controls?.canStartRuntime === true;
  const resumeReady = runtimeStartRequested === false || Boolean(resumeToken && statusRevision);
  const ackReady = pendingAckKeys.length === 0;
  const stateReady = missingStateKeys.length === 0;
  const readyForClientRuntime = previewAvailable && stateReady && resumeReady && ackReady;
  const blocked = previewAvailable === false || stateReady === false || resumeReady === false;
  const status = readyForClientRuntime
    ? "ready"
    : blocked
      ? "blocked"
      : "waiting-for-client";
  const adoptionId = `${job.id}:client-runtime-adoption:${status}:${missingStateKeys.join("|")}:${pendingAckKeys.join("|")}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = previewAvailable === false
    ? "enable-mailchimp-client-preview"
    : missingStateKeys.length > 0
      ? "hydrate-mailchimp-client-runtime-state"
      : resumeReady === false
        ? "restore-mailchimp-runtime-resume-token"
        : pendingAckKeys.length > 0
          ? "acknowledge-mailchimp-client-command"
          : "handoff-to-runtime-adapter";

  return {
    schemaVersion: "aios.mailchimp.client-runtime-adoption.v1",
    provider: "mailchimp",
    jobId: job.id,
    adoptionId,
    status,
    readyForClientRuntime,
    previewAvailable,
    runtimeStartRequested,
    requiredClientState,
    providedStateKeys,
    missingStateKeys,
    resume: {
      resumeToken,
      statusRevision,
      ready: resumeReady
    },
    commandAck: {
      required: ack.required === true || ackKeys.length > 0,
      requiredKeys: ackKeys,
      acknowledgedKeys,
      pendingKeys: pendingAckKeys,
      ready: ackReady
    },
    clientPatch: {
      clientRuntimeAdoptionId: adoptionId,
      clientRuntimeAdoptionStatus: status,
      clientRuntimeReady: readyForClientRuntime,
      clientRuntimeMissingStateKeys: missingStateKeys,
      clientRuntimePendingAckKeys: pendingAckKeys,
      clientRuntimeResumeToken: resumeToken,
      clientRuntimeStatusRevision: statusRevision,
      nextAction
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-runtime-adoption-id",
      resumeFromAdoptionId: adoptionId,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function clientRuntimeAdoptionDiagnostic(field, code, message, severity = "warning", extras = {}) {
  return {
    severity,
    code,
    field,
    message,
    source: "client-runtime-adoption",
    ...extras
  };
}

function clientRuntimeAdoptionDiagnostics(adoption) {
  const diagnostics = [];
  if (adoption.previewAvailable === false) {
    diagnostics.push(clientRuntimeAdoptionDiagnostic(
      "clientPreview",
      "client.runtime.preview.unavailable",
      "Mailchimp client runtime adoption requires the client preview handoff to be available.",
      "warning"
    ));
  }
  for (const key of adoption.missingStateKeys) {
    diagnostics.push(clientRuntimeAdoptionDiagnostic(
      "clientRuntimeState",
      "client.runtime.state.missing",
      `Mailchimp client runtime state is missing required key '${key}'.`,
      "warning",
      { requiredClientStateKey: key }
    ));
  }
  if (adoption.resume.ready === false) {
    diagnostics.push(clientRuntimeAdoptionDiagnostic(
      "runtimeResume",
      "client.runtime.resume.missing",
      "Mailchimp client runtime adoption requires a resume token and status revision before runtime start.",
      "warning"
    ));
  }
  for (const ackKey of adoption.commandAck.pendingKeys) {
    diagnostics.push(clientRuntimeAdoptionDiagnostic(
      "clientCommandAck",
      "client.runtime.ack.pending",
      `Mailchimp client command acknowledgement '${ackKey}' is still pending.`,
      "warning",
      { ackKey }
    ));
  }
  return diagnostics;
}

function actionId(jobId, action, index) {
  return `${jobId}.action.${String(index + 1).padStart(2, "0")}.${action.nextAction || "observe"}`
    .replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function stableCommandId(jobId, command, index) {
  const scope = command.scope || {};
  return `${jobId}.cmd.${String(index + 1).padStart(2, "0")}.${command.command}.${scope.type || "runtime"}.${scope.id || command.status}`
    .replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function retryPolicyForAction(action, status) {
  const explicit = RETRY_POLICY_BY_ACTION[action.nextAction] || {};
  const required = action.required === true || status === "blocked";
  const retryable = explicit.retryable ?? (required === false);
  const backoffMs = explicit.backoffMs ?? (retryable ? 30000 : 0);
  const maxAttempts = explicit.maxAttempts ?? (retryable ? 3 : 0);
  const failureClass = explicit.failureClass || action.scope?.type || "runtime-handoff";
  return {
    retryable,
    backoffMs,
    maxAttempts,
    failureClass,
    nextAction: action.nextAction,
    statusOnRetry: status,
    degradedMode: status !== "ready" || required,
    operatorActionRequired: action.nextAction === "collect-human-approval"
      || action.scheduleWindow === "preflight"
  };
}

function collectRuntimeActions(job, normalizedDiagnostics) {
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const handoffActions = Array.isArray(runtimeHandoff.nextActions) ? runtimeHandoff.nextActions : [];
  const diagnosticActions = normalizedDiagnostics
    .filter((diagnostic) => diagnostic.severity !== "info")
    .map((diagnostic) => ({
      source: "diagnostic",
      code: diagnostic.code,
      scope: diagnostic.scope,
      required: diagnostic.severity === "error",
      nextAction: diagnostic.recoveryAction,
      scheduleWindow: diagnostic.severity === "error" ? "compile" : "preflight"
    }));

  return [...diagnosticActions, ...handoffActions]
    .filter((action) => action.nextAction && action.nextAction !== "no-action")
    .map((action, index) => {
      const normalized = {
        id: actionId(job.id, action, index),
        order: index + 1,
        source: action.source || "runtime-handoff",
        code: action.code || action.action || action.ruleId || "runtime.nextAction",
        required: action.required === true,
        nextAction: action.nextAction,
        scheduleWindow: action.scheduleWindow || "preflight",
        scope: action.scope || {
          type: action.source || "runtime",
          id: action.action || action.ruleId || action.nextAction
        }
      };
      return {
        ...normalized,
        retryPolicy: retryPolicyForAction(normalized, "pending")
      };
    });
}

function commandForAction(action, status) {
  if (action.nextAction === "collect-human-approval") {
    return {
      command: "await-operator-approval",
      status,
      idempotencyScope: "operator-approval",
      replayPolicy: "resume-pending-command"
    };
  }
  if (action.required) {
    return {
      command: "block-runtime-start",
      status,
      idempotencyScope: "compile-repair",
      replayPolicy: "replace-with-newer-diagnostic-set"
    };
  }
  if (action.scheduleWindow === "preflight") {
    return {
      command: "queue-preflight-review",
      status,
      idempotencyScope: "runtime-preflight",
      replayPolicy: "dedupe-by-command-id"
    };
  }
  return {
    command: "observe-runtime-handoff",
    status,
    idempotencyScope: "runtime-observation",
    replayPolicy: "dedupe-by-command-id"
  };
}

function buildRecoveryCommands(job, status, runtimeHandoff, nextActions, counts) {
  const sourceActions = nextActions.length > 0
    ? nextActions
    : [{
      nextAction: status === "ready" ? "handoff-to-runtime-adapter" : "review-runtime-handoff-action",
      required: status === "blocked",
      scheduleWindow: status === "ready" ? "runtime" : "preflight",
      scope: { type: "runtime", id: runtimeHandoff.runtimeAdapter || job.runtimeAdapter?.id || "mailchimp.campaignRuntimeAdapter" }
    }];

  const commands = sourceActions.map((action, index) => {
    const command = commandForAction(action, status);
    const commandRecord = {
      ...command,
      order: index + 1,
      sourceActionId: action.id || null,
      nextAction: action.nextAction,
      required: action.required === true,
      scheduleWindow: action.scheduleWindow || "preflight",
      scope: action.scope || { type: "runtime", id: command.idempotencyScope },
      diagnosticCode: action.code || null,
      blocksRuntimeStart: status === "blocked" || action.required === true,
      completedByAdapter: false,
      retryPolicy: retryPolicyForAction(action, status)
    };
    return {
      ...commandRecord,
      id: stableCommandId(job.id, commandRecord, index),
      idempotencyKey: `${job.id}:${command.idempotencyScope}:${action.id || action.nextAction}:${status}`
    };
  });

  const requiredCommands = commands.filter((command) => command.required || command.blocksRuntimeStart);
  return {
    status,
    commandCount: commands.length,
    requiredCommandCount: requiredCommands.length,
    commands,
    replaySafe: true,
    duplicateCommandPolicy: "dedupe-by-idempotency-key",
    restartCursor: {
      commandId: requiredCommands[0]?.id || commands[0]?.id || null,
      nextAction: requiredCommands[0]?.nextAction || commands[0]?.nextAction || "handoff-to-runtime-adapter",
      statusOnResume: status,
      diagnosticErrorCount: counts.bySeverity?.error || 0,
      diagnosticWarningCount: counts.bySeverity?.warning || 0
    }
  };
}

function leaseStateForCommand(command, status, runtimeHandoff) {
  if (command.blocksRuntimeStart) {
    return {
      status: "blocked",
      ackRequired: true,
      clientVisible: true,
      reason: "runtime-start-blocked"
    };
  }
  if (command.command === "await-operator-approval") {
    return {
      status: "awaiting-ack",
      ackRequired: true,
      clientVisible: true,
      reason: "operator-approval-required"
    };
  }
  if (command.scheduleWindow === "preflight" || status === "needs-operator-action") {
    return {
      status: "pending",
      ackRequired: true,
      clientVisible: true,
      reason: "preflight-review-required"
    };
  }
  if (runtimeHandoff.acceptedForRuntime !== true) {
    return {
      status: "pending",
      ackRequired: false,
      clientVisible: true,
      reason: "runtime-not-accepted"
    };
  }
  return {
    status: "ready",
    ackRequired: false,
    clientVisible: command.nextAction !== "handoff-to-runtime-adapter",
    reason: "runtime-command-ready"
  };
}

function buildClientCommandLease(job, command, status, runtimeHandoff, index) {
  const leaseState = leaseStateForCommand(command, status, runtimeHandoff);
  const scope = command.scope || { type: "runtime", id: command.idempotencyScope || "runtime" };
  const leaseKey = [
    job.id,
    "client-lease",
    command.idempotencyKey || command.id,
    leaseState.status,
    command.nextAction
  ].join(":").replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    id: `${job.id}.lease.${String(index + 1).padStart(2, "0")}.${command.command}.${scope.type}.${scope.id}`
      .replace(/[^a-zA-Z0-9_.-]/g, "_"),
    order: index + 1,
    commandId: command.id,
    command: command.command,
    status: leaseState.status,
    reason: leaseState.reason,
    nextAction: command.nextAction,
    required: command.required === true,
    blocksRuntimeStart: command.blocksRuntimeStart === true,
    clientVisible: leaseState.clientVisible,
    ackRequired: leaseState.ackRequired,
    scheduleWindow: command.scheduleWindow || "preflight",
    scope,
    leaseKey,
    ackKey: leaseState.ackRequired
      ? `${leaseKey}:ack`.replace(/[^a-zA-Z0-9_.:-]/g, "_")
      : null,
    idempotencyKey: command.idempotencyKey || leaseKey,
    retryPolicy: command.retryPolicy || retryPolicyForAction(command, status),
    replayPolicy: command.replayPolicy || "dedupe-by-command-id",
    clientPatch: {
      commandId: command.id,
      commandStatus: leaseState.status,
      commandAction: command.nextAction,
      commandAckRequired: leaseState.ackRequired,
      commandLeaseKey: leaseKey,
      commandAckKey: leaseState.ackRequired ? `${leaseKey}:ack`.replace(/[^a-zA-Z0-9_.:-]/g, "_") : null
    }
  };
}

function buildClientCommandLeases(job, status, runtimeHandoff, recoveryCommands) {
  const commands = Array.isArray(recoveryCommands.commands) ? recoveryCommands.commands : [];
  const leases = commands.map((command, index) => (
    buildClientCommandLease(job, command, status, runtimeHandoff, index)
  ));
  const visibleLeases = leases.filter((lease) => lease.clientVisible);
  const ackRequiredLeases = leases.filter((lease) => lease.ackRequired);
  const blockingLeases = leases.filter((lease) => lease.blocksRuntimeStart);
  const primaryLease = blockingLeases[0] || ackRequiredLeases[0] || visibleLeases[0] || leases[0] || null;

  return {
    schemaVersion: "aios.mailchimp.client-command-leases.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    leaseStatus: blockingLeases.length > 0
      ? "blocked"
      : ackRequiredLeases.length > 0
        ? "awaiting-client-ack"
        : "ready",
    primaryLeaseId: primaryLease?.id || null,
    primaryAction: primaryLease?.nextAction
      || recoveryCommands.restartCursor?.nextAction
      || "handoff-to-runtime-adapter",
    ackRequiredCount: ackRequiredLeases.length,
    visibleCount: visibleLeases.length,
    blockingCount: blockingLeases.length,
    leases,
    clientAck: {
      required: ackRequiredLeases.length > 0,
      ackKeys: ackRequiredLeases.map((lease) => lease.ackKey).filter(Boolean),
      resumeFromLeaseId: primaryLease?.id || null,
      resumeToken: `${job.id}:client-command-leases:${primaryLease?.id || status}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-command-lease-key",
      externalWritesPerformed: false,
      resumeFromLeaseId: primaryLease?.id || null
    }
  };
}

function failureStateId(jobId, action, index) {
  const scope = action.scope || {};
  return `${jobId}.failure.${String(index + 1).padStart(2, "0")}.${action.retryPolicy.failureClass}.${scope.type || "runtime"}.${scope.id || action.nextAction}`
    .replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function buildFailureState(job, status, nextActions, recoveryCommands, counts) {
  const commandsByAction = new Map(
    recoveryCommands.commands.map((command) => [command.sourceActionId, command])
  );
  const queue = nextActions
    .filter((action) => action.required || action.retryPolicy?.operatorActionRequired || status !== "ready")
    .map((action, index) => {
      const command = commandsByAction.get(action.id) || {};
      const retryPolicy = command.retryPolicy || action.retryPolicy || retryPolicyForAction(action, status);
      return {
        id: failureStateId(job.id, { ...action, retryPolicy }, index),
        order: index + 1,
        actionId: action.id,
        commandId: command.id || null,
        status: action.required || status === "blocked" ? "blocked" : "degraded",
        failureClass: retryPolicy.failureClass,
        severity: action.required ? "error" : "warning",
        source: action.source,
        code: action.code,
        scope: action.scope,
        nextAction: action.nextAction,
        retry: {
          retryable: retryPolicy.retryable,
          backoffMs: retryPolicy.backoffMs,
          maxAttempts: retryPolicy.maxAttempts,
          nextAction: retryPolicy.nextAction,
          statusOnRetry: retryPolicy.statusOnRetry
        },
        handoff: {
          adapterVisible: true,
          blocksRuntimeStart: command.blocksRuntimeStart === true || action.required === true,
          replayPolicy: command.replayPolicy || "dedupe-by-idempotency-key",
          idempotencyKey: command.idempotencyKey || `${job.id}:${action.id}:${status}`
        }
      };
    });
  const retryableQueue = queue.filter((item) => item.retry.retryable);
  const blockingQueue = queue.filter((item) => item.handoff.blocksRuntimeStart);

  return {
    schemaVersion: "aios.mailchimp.failure-state.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    mode: blockingQueue.length > 0
      ? "blocked"
      : queue.length > 0
        ? "degraded"
        : "ready",
    queue,
    summary: {
      total: queue.length,
      blocking: blockingQueue.length,
      retryable: retryableQueue.length,
      nonRetryable: queue.length - retryableQueue.length,
      errorDiagnostics: counts.bySeverity?.error || 0,
      warningDiagnostics: counts.bySeverity?.warning || 0
    },
    nextRetry: retryableQueue.length
      ? {
        failureId: retryableQueue[0].id,
        actionId: retryableQueue[0].actionId,
        backoffMs: retryableQueue[0].retry.backoffMs,
        maxAttempts: retryableQueue[0].retry.maxAttempts,
        nextAction: retryableQueue[0].nextAction,
        idempotencyKey: retryableQueue[0].handoff.idempotencyKey
      }
      : null,
    adapterHandoff: {
      acceptedForRuntime: status === "ready" && blockingQueue.length === 0,
      degradedMode: queue.length > 0,
      queueRequired: queue.length > 0,
      resumeFromFailureId: blockingQueue[0]?.id || retryableQueue[0]?.id || null,
      nextAction: blockingQueue[0]?.nextAction
        || retryableQueue[0]?.nextAction
        || "handoff-to-runtime-adapter"
    }
  };
}

function buildStatusLedger(job, status, runtimeHandoff, counts, recoveryCommands) {
  const runtimeAdapter = runtimeHandoff.runtimeAdapter || job.runtimeAdapter?.id || "mailchimp.campaignRuntimeAdapter";
  const acceptedForRuntime = status === "ready" && runtimeHandoff.acceptedForRuntime === true;
  const acceptedForClientPreview = status !== "blocked" && runtimeHandoff.acceptedForClientPreview !== false;
  const canStartRuntime = acceptedForRuntime && runtimeHandoff.controls?.canStartRuntime === true;
  const commandIds = recoveryCommands.commands.map((command) => command.id);

  return {
    schemaVersion: "aios.mailchimp.status-ledger.v1",
    provider: "mailchimp",
    jobId: job.id,
    runtimeAdapter,
    status,
    readinessStatus: runtimeHandoff.readinessStatus || status,
    acceptedForRuntime,
    acceptedForClientPreview,
    canStartRuntime,
    statusRevision: `${job.id}:${status}:${counts.total}:${commandIds.join("|")}`,
    persistedAtPhase: status === "ready" ? "runtime-handoff" : "compile-recovery",
    commandIds,
    blockingDiagnosticCount: counts.bySeverity?.error || 0,
    warningDiagnosticCount: counts.bySeverity?.warning || 0,
    resumeToken: `${job.id}:${runtimeAdapter}:${status}:${recoveryCommands.restartCursor.commandId || "runtime"}`,
    restartSafe: {
      replaySafe: true,
      duplicateCommandPolicy: recoveryCommands.duplicateCommandPolicy,
      resumeFromCommandId: recoveryCommands.restartCursor.commandId,
      resumeAction: recoveryCommands.restartCursor.nextAction,
      externalWritesPerformed: false
    }
  };
}

function visibleStatusForHandoff(status, runtimeHandoff, failureState, clientCommandLeases) {
  if (status === "blocked" || failureState.mode === "blocked") return "blocked-before-runtime";
  if (clientCommandLeases.clientAck?.required === true) return "waiting-for-client-ack";
  if (status === "needs-operator-action" || failureState.mode === "degraded") return "waiting-for-operator-action";
  if (runtimeHandoff.acceptedForRuntime !== true) return "preview-ready-runtime-not-accepted";
  if (runtimeHandoff.controls?.canStartRuntime !== true) return "runtime-start-disabled";
  return "ready-for-runtime";
}

function buildStatusHandoffPacket(job, status, runtimeHandoff, counts, recoveryCommands, failureState, clientCommandLeases) {
  const statusLedger = buildStatusLedger(job, status, runtimeHandoff, counts, recoveryCommands);
  const blockingCommands = recoveryCommands.commands.filter((command) => command.blocksRuntimeStart);
  const ackKeys = clientCommandLeases.clientAck?.ackKeys || [];
  const primaryLease = Array.isArray(clientCommandLeases.leases)
    ? clientCommandLeases.leases.find((lease) => lease.id === clientCommandLeases.primaryLeaseId)
      || clientCommandLeases.leases[0]
    : null;
  const adapterHandoff = failureState.adapterHandoff || {};
  const nextAction = blockingCommands[0]?.nextAction
    || primaryLease?.nextAction
    || adapterHandoff.nextAction
    || recoveryCommands.restartCursor.nextAction
    || "handoff-to-runtime-adapter";
  const handoffState = status === "blocked" || failureState.mode === "blocked"
    ? "blocked"
    : clientCommandLeases.clientAck?.required === true
      ? "waiting-for-client"
      : status === "needs-operator-action" || failureState.mode === "degraded"
        ? "degraded"
        : runtimeHandoff.acceptedForRuntime === true
          ? "ready"
          : "preview";
  const staleStatusPolicy = {
    onRevisionMismatch: "reload-status-ledger",
    onMissingCommandJournal: "rebuild-recovery-commands",
    onMissingClientAck: clientCommandLeases.clientAck?.required === true
      ? "request-client-command-ack"
      : "continue-runtime-handoff",
    onAdapterCursorExpired: adapterHandoff.queueRequired
      ? "resume-from-failure-state"
      : "refresh-adapter-status-before-release"
  };

  return {
    schemaVersion: "aios.mailchimp.status-handoff.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    handoffState,
    visibleStatus: visibleStatusForHandoff(status, runtimeHandoff, failureState, clientCommandLeases),
    runtimeAdapter: statusLedger.runtimeAdapter,
    statusLedger: {
      statusRevision: statusLedger.statusRevision,
      readinessStatus: statusLedger.readinessStatus,
      resumeToken: statusLedger.resumeToken,
      commandIds: statusLedger.commandIds,
      persistedAtPhase: statusLedger.persistedAtPhase,
      blockingDiagnosticCount: statusLedger.blockingDiagnosticCount,
      warningDiagnosticCount: statusLedger.warningDiagnosticCount
    },
    clientCommandAck: {
      required: clientCommandLeases.clientAck?.required === true,
      ackKeys,
      nextAckKey: primaryLease?.ackKey || ackKeys[0] || null,
      resumeFromLeaseId: clientCommandLeases.clientAck?.resumeFromLeaseId || primaryLease?.id || null,
      resumeToken: clientCommandLeases.clientAck?.resumeToken || statusLedger.resumeToken,
      blocksRuntimeStart: blockingCommands.length > 0 || clientCommandLeases.blockingCount > 0
    },
    adapterRecovery: {
      mode: failureState.mode,
      queueLength: failureState.summary?.total || 0,
      blocking: failureState.summary?.blocking || 0,
      retryable: failureState.summary?.retryable || 0,
      nextRetry: failureState.nextRetry || null,
      acceptedForRuntime: adapterHandoff.acceptedForRuntime === true,
      degradedMode: adapterHandoff.degradedMode === true,
      resumeFromFailureId: adapterHandoff.resumeFromFailureId || null,
      nextAction: adapterHandoff.nextAction || nextAction
    },
    restartContract: {
      replaySafe: statusLedger.restartSafe?.replaySafe === true,
      duplicateCommandPolicy: statusLedger.restartSafe?.duplicateCommandPolicy || "dedupe-by-idempotency-key",
      resumeFromCommandId: statusLedger.restartSafe?.resumeFromCommandId || null,
      resumeAction: statusLedger.restartSafe?.resumeAction || nextAction,
      externalWritesPerformed: false,
      statusOnResume: recoveryCommands.restartCursor.statusOnResume || status,
      staleStatusPolicy
    },
    clientPatch: {
      provider: "mailchimp",
      jobId: job.id,
      runtimeAdapter: statusLedger.runtimeAdapter,
      status,
      visibleStatus: visibleStatusForHandoff(status, runtimeHandoff, failureState, clientCommandLeases),
      handoffState,
      nextAction,
      statusRevision: statusLedger.statusRevision,
      resumeToken: statusLedger.resumeToken,
      commandLeaseStatus: clientCommandLeases.leaseStatus,
      commandAckRequired: clientCommandLeases.clientAck?.required === true,
      commandAckKey: primaryLease?.ackKey || ackKeys[0] || null,
      failureMode: failureState.mode
    },
    commands: {
      total: recoveryCommands.commandCount,
      required: recoveryCommands.requiredCommandCount,
      blockingCommandIds: blockingCommands.map((command) => command.id),
      primaryCommandId: blockingCommands[0]?.id || recoveryCommands.restartCursor.commandId || null
    },
    nextAction
  };
}

function clientWorkflowStatus(status, runtimeHandoff, counts) {
  if (status === "blocked") {
    return {
      phase: "repair",
      banner: "Mailchimp setup needs repair before runtime handoff.",
      severity: "error",
      primaryAction: "review-blocking-diagnostics"
    };
  }
  if (status === "needs-operator-action") {
    return {
      phase: "approval",
      banner: "Mailchimp setup is ready for preview and needs operator action before runtime start.",
      severity: "warning",
      primaryAction: runtimeHandoff.controls?.requiresApprovalBeforeExternalWrite
        ? "collect-human-approval"
        : "review-runtime-handoff-action"
    };
  }
  if ((counts.bySeverity?.info || 0) > 0) {
    return {
      phase: "preflight",
      banner: "Mailchimp setup is ready with informational preflight notes.",
      severity: "info",
      primaryAction: "handoff-to-runtime-adapter"
    };
  }
  return {
    phase: "ready",
    banner: "Mailchimp setup is ready for runtime handoff.",
    severity: "info",
    primaryAction: "handoff-to-runtime-adapter"
  };
}

function buildClientStatePatch(job, status, runtimeHandoff, counts, nextActions) {
  const requiredActions = nextActions.filter((action) => action.required);
  const workflow = clientWorkflowStatus(status, runtimeHandoff, counts);
  return {
    provider: "mailchimp",
    jobId: job.id,
    workflowPhase: workflow.phase,
    readinessStatus: runtimeHandoff.readinessStatus || job.status || status,
    acceptedForRuntime: status === "ready" && runtimeHandoff.acceptedForRuntime === true,
    acceptedForClientPreview: status !== "blocked" && runtimeHandoff.acceptedForClientPreview !== false,
    canStartRuntime: status === "ready" && runtimeHandoff.controls?.canStartRuntime === true,
    requiresOperatorAction: requiredActions.length > 0 || status === "needs-operator-action",
    requiresApprovalBeforeExternalWrite: runtimeHandoff.controls?.requiresApprovalBeforeExternalWrite === true,
    blockingDiagnosticCount: counts.bySeverity?.error || 0,
    warningDiagnosticCount: counts.bySeverity?.warning || 0,
    nextActionId: nextActions[0]?.id || null,
    nextAction: nextActions[0]?.nextAction || workflow.primaryAction,
    idempotencyKey: `${job.id}:${status}:${nextActions.map((action) => action.id).join("|")}`
  };
}

function buildStatusRecoveryBundle(job, statusHandoff, recoveryCommands, failureState, clientCommandLeases) {
  const ledger = statusHandoff.statusLedger || {};
  const restart = statusHandoff.restartContract || {};
  const ack = statusHandoff.clientCommandAck || {};
  const adapterRecovery = statusHandoff.adapterRecovery || {};
  const commandIds = Array.isArray(ledger.commandIds) ? ledger.commandIds : [];
  const commands = Array.isArray(recoveryCommands.commands) ? recoveryCommands.commands : [];
  const leases = Array.isArray(clientCommandLeases.leases) ? clientCommandLeases.leases : [];
  const queue = Array.isArray(failureState.queue) ? failureState.queue : [];
  const ackRequired = ack.required === true || clientCommandLeases.clientAck?.required === true;
  const blockingCommandIds = commands
    .filter((command) => command.blocksRuntimeStart === true)
    .map((command) => command.id)
    .filter(Boolean);
  const blockingLeaseIds = leases
    .filter((lease) => lease.blocksRuntimeStart === true)
    .map((lease) => lease.id)
    .filter(Boolean);
  const retryableFailureIds = queue
    .filter((item) => item.retry?.retryable === true)
    .map((item) => item.id)
    .filter(Boolean);
  const resumeToken = ledger.resumeToken || clientCommandLeases.clientAck?.resumeToken || `${job.id}:${statusHandoff.status}`;
  const statusRevision = ledger.statusRevision || `${job.id}:${statusHandoff.status}:${commandIds.length}`;
  const checkpoints = [
    {
      id: `${job.id}.recovery.status-ledger`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      phase: "status-ledger",
      required: true,
      ready: Boolean(resumeToken) && Boolean(statusRevision),
      cursor: resumeToken,
      nextAction: restart.resumeAction || statusHandoff.nextAction
    },
    {
      id: `${job.id}.recovery.command-journal`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      phase: "command-journal",
      required: true,
      ready: commandIds.length > 0 || commands.length > 0,
      cursor: restart.resumeFromCommandId || commandIds[0] || commands[0]?.id || null,
      nextAction: recoveryCommands.restartCursor?.nextAction || statusHandoff.nextAction
    },
    {
      id: `${job.id}.recovery.client-ack`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      phase: "client-ack",
      required: ackRequired,
      ready: ackRequired === false || Boolean(ack.nextAckKey || ack.ackKeys?.[0]),
      cursor: ack.resumeFromLeaseId || clientCommandLeases.primaryLeaseId || null,
      nextAction: ackRequired ? "request-client-command-ack" : "continue-runtime-handoff"
    },
    {
      id: `${job.id}.recovery.adapter-failure`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      phase: "adapter-failure",
      required: adapterRecovery.mode === "blocked" || adapterRecovery.mode === "degraded",
      ready: adapterRecovery.mode !== "blocked",
      cursor: adapterRecovery.resumeFromFailureId || failureState.adapterHandoff?.resumeFromFailureId || null,
      nextAction: adapterRecovery.nextAction || failureState.adapterHandoff?.nextAction || statusHandoff.nextAction
    }
  ];
  const missingRequired = checkpoints
    .filter((checkpoint) => checkpoint.required && checkpoint.ready !== true)
    .map((checkpoint) => checkpoint.phase);
  const state = missingRequired.length > 0 || adapterRecovery.mode === "blocked" || blockingCommandIds.length > 0
    ? "blocked"
    : ackRequired || blockingLeaseIds.length > 0
      ? "waiting-for-client"
      : retryableFailureIds.length > 0 || adapterRecovery.mode === "degraded"
        ? "retryable"
        : "ready";
  const nextAction = missingRequired.includes("status-ledger")
    ? "rebuild-status-ledger"
    : missingRequired.includes("command-journal")
      ? "rebuild-recovery-commands"
      : missingRequired.includes("client-ack")
        ? "request-client-command-ack"
        : missingRequired.includes("adapter-failure")
          ? "resume-from-failure-state"
          : state === "waiting-for-client"
            ? "request-client-command-ack"
            : state === "retryable"
              ? adapterRecovery.nextAction || failureState.nextRetry?.nextAction || "retry-runtime-handoff"
              : statusHandoff.nextAction || "handoff-to-runtime-adapter";

  return {
    schemaVersion: "aios.mailchimp.status-recovery-bundle.v1",
    provider: "mailchimp",
    jobId: job.id,
    state,
    readyForRuntimeResume: state === "ready"
      && restart.replaySafe === true
      && Boolean(resumeToken)
      && ackRequired === false,
    nextAction,
    resume: {
      resumeToken,
      statusRevision,
      statusOnResume: restart.statusOnResume || statusHandoff.status,
      resumeFromCommandId: restart.resumeFromCommandId || recoveryCommands.restartCursor?.commandId || null,
      resumeFromLeaseId: ack.resumeFromLeaseId || clientCommandLeases.clientAck?.resumeFromLeaseId || null,
      resumeFromFailureId: adapterRecovery.resumeFromFailureId || failureState.adapterHandoff?.resumeFromFailureId || null
    },
    counters: {
      commands: commands.length,
      leases: leases.length,
      failureQueue: queue.length,
      blockingCommands: blockingCommandIds.length,
      blockingLeases: blockingLeaseIds.length,
      retryableFailures: retryableFailureIds.length,
      ackKeys: ack.ackKeys?.length || clientCommandLeases.clientAck?.ackKeys?.length || 0,
      missingRequiredCheckpoints: missingRequired.length
    },
    checkpoints,
    blocking: {
      commandIds: blockingCommandIds,
      leaseIds: blockingLeaseIds,
      missingRequiredCheckpoints: missingRequired,
      adapterMode: adapterRecovery.mode || failureState.mode || "unknown"
    },
    clientPatch: {
      statusRecoveryState: state,
      statusRecoveryReady: state === "ready",
      statusRecoveryNextAction: nextAction,
      statusRecoveryResumeToken: resumeToken,
      statusRecoveryRevision: statusRevision,
      statusRecoveryAckRequired: ackRequired
    },
    restartSemantics: {
      replaySafe: restart.replaySafe === true,
      duplicateCommandPolicy: restart.duplicateCommandPolicy || recoveryCommands.duplicateCommandPolicy || "dedupe-by-idempotency-key",
      staleStatusPolicy: restart.staleStatusPolicy || {},
      externalWritesPerformed: false
    }
  };
}

function buildVisibleWorkflow(job, status, runtimeHandoff, counts, nextActions, clientCommandLeases) {
  const workflow = clientWorkflowStatus(status, runtimeHandoff, counts);
  const requiredActions = nextActions.filter((action) => action.required);
  const operatorActions = nextActions.filter((action) => action.retryPolicy?.operatorActionRequired);
  const commandLeases = clientCommandLeases || {};
  const primaryLease = Array.isArray(commandLeases.leases)
    ? commandLeases.leases.find((lease) => lease.id === commandLeases.primaryLeaseId) || commandLeases.leases[0]
    : null;
  const validationItems = [
    {
      id: "mailchimp.workflow.preview-visible",
      label: "Client preview is visible",
      status: status === "blocked" || runtimeHandoff.acceptedForClientPreview === false ? "blocked" : "accepted",
      required: true,
      nextAction: runtimeHandoff.acceptedForClientPreview === false
        ? "enable-mailchimp-client-preview"
        : workflow.primaryAction,
      evidence: {
        acceptedForClientPreview: runtimeHandoff.acceptedForClientPreview !== false,
        blockingDiagnosticCount: counts.bySeverity?.error || 0
      }
    },
    {
      id: "mailchimp.workflow.operator-next-step",
      label: "Next operator step is explainable",
      status: nextActions[0]?.nextAction || workflow.primaryAction ? "accepted" : "blocked",
      required: true,
      nextAction: nextActions[0]?.nextAction || workflow.primaryAction,
      evidence: {
        queuedActions: nextActions.length,
        requiredActions: requiredActions.length,
        operatorActions: operatorActions.length
      }
    },
    {
      id: "mailchimp.workflow.runtime-gate",
      label: "Runtime start gate is explicit",
      status: status === "ready" && runtimeHandoff.controls?.canStartRuntime === true
        ? "accepted"
        : status === "blocked"
          ? "blocked"
          : "needs-operator-action",
      required: true,
      nextAction: status === "ready" && runtimeHandoff.controls?.canStartRuntime === true
        ? "handoff-to-runtime-adapter"
        : nextActions[0]?.nextAction || workflow.primaryAction,
      evidence: {
        acceptedForRuntime: runtimeHandoff.acceptedForRuntime === true,
        canStartRuntime: runtimeHandoff.controls?.canStartRuntime === true,
        readinessStatus: runtimeHandoff.readinessStatus || status
      }
    }
  ];
  const blockedItems = validationItems.filter((item) => item.status === "blocked");
  const pendingItems = validationItems.filter((item) => item.status === "needs-operator-action");
  const explainReason = blockedItems.length
    ? "workflow-blocked"
    : pendingItems.length
      ? "workflow-operator-action"
      : status === "ready"
        ? "workflow-ready"
        : "workflow-preflight";
  return {
    schemaVersion: "aios.mailchimp.client-workflow.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    phase: workflow.phase,
    banner: workflow.banner,
    severity: workflow.severity,
    primaryAction: nextActions[0]?.nextAction || workflow.primaryAction,
    previewEnabled: status !== "blocked" && runtimeHandoff.acceptedForClientPreview !== false,
    runtimeStartEnabled: status === "ready" && runtimeHandoff.controls?.canStartRuntime === true,
    actionQueue: nextActions.map((action) => ({
      id: action.id,
      label: action.nextAction,
      required: action.required,
      scheduleWindow: action.scheduleWindow,
      scope: action.scope
    })),
    commandLeases: {
      status: commandLeases.leaseStatus || "unknown",
      primaryLeaseId: commandLeases.primaryLeaseId || null,
      ackRequired: commandLeases.clientAck?.required === true,
      ackRequiredCount: commandLeases.ackRequiredCount || 0,
      visibleCount: commandLeases.visibleCount || 0,
      blockingCount: commandLeases.blockingCount || 0,
      resumeToken: commandLeases.clientAck?.resumeToken || null,
      leases: (commandLeases.leases || []).map((lease) => ({
        id: lease.id,
        commandId: lease.commandId,
        status: lease.status,
        nextAction: lease.nextAction,
        ackRequired: lease.ackRequired,
        ackKey: lease.ackKey,
        clientVisible: lease.clientVisible,
        scope: lease.scope
      }))
    },
    validationSummary: {
      total: validationItems.length,
      accepted: validationItems.filter((item) => item.status === "accepted").length,
      blocked: blockedItems.length,
      pending: pendingItems.length,
      required: validationItems.filter((item) => item.required).length,
      blockingDiagnostics: counts.bySeverity?.error || 0,
      warningDiagnostics: counts.bySeverity?.warning || 0
    },
    validationItems,
    explainNextStep: {
      action: blockedItems[0]?.nextAction
        || pendingItems[0]?.nextAction
        || primaryLease?.nextAction
        || nextActions[0]?.nextAction
        || workflow.primaryAction,
      reason: explainReason,
      actionId: nextActions[0]?.id || null,
      leaseId: primaryLease?.id || null,
      ackRequired: primaryLease?.ackRequired === true,
      ackKey: primaryLease?.ackKey || null,
      scope: nextActions[0]?.scope || { type: "runtime", id: "mailchimp.campaignRuntimeAdapter" }
    },
    statePatch: {
      ...buildClientStatePatch(job, status, runtimeHandoff, counts, nextActions),
      workflowContractVersion: "aios.mailchimp.client-workflow.v1",
      validationBlocked: blockedItems.length,
      validationPending: pendingItems.length,
      commandLeaseStatus: commandLeases.leaseStatus || "unknown",
      commandLeaseId: primaryLease?.id || null,
      commandAckRequired: primaryLease?.ackRequired === true,
      commandAckKey: primaryLease?.ackKey || null,
      explainReason
    }
  };
}

export function emitMailchimpDiagnostics(source = {}, options = {}) {
  const job = compileIfNeeded(source, options);
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const providerServiceContract = deriveProviderServiceContract(job, options);
  const serviceDiagnostics = providerServiceDiagnostics(providerServiceContract);
  const permissionBoundary = derivePermissionBoundary(job, options);
  const boundaryDiagnostics = permissionBoundaryDiagnostics(permissionBoundary);
  const lifecycleControls = deriveLifecycleControls(job, permissionBoundary);
  const lifecycleDiagnostics = lifecycleControlDiagnostics(lifecycleControls);
  const initialClientRuntimeAdoption = deriveClientRuntimeAdoption(job, runtimeHandoff, options);
  const adoptionDiagnostics = clientRuntimeAdoptionDiagnostics(initialClientRuntimeAdoption);
  const diagnostics = [
    ...(job.diagnostics || []),
    ...serviceDiagnostics,
    ...boundaryDiagnostics,
    ...lifecycleDiagnostics,
    ...adoptionDiagnostics
  ]
    .map((diagnostic, index) => {
      const severity = normalizeSeverity(diagnostic);
      return {
        id: stableDiagnosticId(job.id, diagnostic, index),
        provider: "mailchimp",
        severity,
        code: diagnostic.code || "diagnostic.unknown",
        message: diagnostic.message || "Mailchimp compiler diagnostic.",
        scope: diagnosticScope(diagnostic),
        recoveryAction: recoveryActionFor({ ...diagnostic, severity }, runtimeHandoff),
        blocksRuntimeHandoff: severity === "error",
        userVisible: severity !== "info",
        source: diagnostic.source || "compiler"
      };
    })
    .sort(sortDiagnostics);
  const counts = {
    total: diagnostics.length,
    bySeverity: {
      error: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
      warning: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
      info: diagnostics.filter((diagnostic) => diagnostic.severity === "info").length
    },
    byScope: countBy(diagnostics.map((diagnostic) => diagnostic.scope), "type")
  };
  const blocked = counts.bySeverity.error > 0 || runtimeHandoff.readinessStatus === "blocked";
  const nextActions = collectRuntimeActions(job, diagnostics);
  const status = blocked
    ? "blocked"
    : counts.bySeverity.warning > 0 || runtimeHandoff.readinessStatus === "needs-operator-action"
      ? "needs-operator-action"
      : "ready";
  const recoveryCommands = buildRecoveryCommands(job, status, runtimeHandoff, nextActions, counts);
  const clientCommandLeases = buildClientCommandLeases(job, status, runtimeHandoff, recoveryCommands);
  const failureState = buildFailureState(job, status, nextActions, recoveryCommands, counts);
  const statusHandoff = buildStatusHandoffPacket(
    job,
    status,
    runtimeHandoff,
    counts,
    recoveryCommands,
    failureState,
    clientCommandLeases
  );
  const statusRecoveryBundle = buildStatusRecoveryBundle(
    job,
    statusHandoff,
    recoveryCommands,
    failureState,
    clientCommandLeases
  );
  const clientRuntimeAdoption = deriveClientRuntimeAdoption(
    job,
    runtimeHandoff,
    options,
    statusHandoff,
    clientCommandLeases
  );
  const statusLedger = {
    ...statusHandoff.statusLedger,
    schemaVersion: "aios.mailchimp.status-ledger.v1",
    provider: "mailchimp",
    jobId: job.id,
    runtimeAdapter: statusHandoff.runtimeAdapter,
    status,
    acceptedForRuntime: status === "ready" && runtimeHandoff.acceptedForRuntime === true,
    acceptedForClientPreview: status !== "blocked" && runtimeHandoff.acceptedForClientPreview !== false,
    canStartRuntime: status === "ready" && runtimeHandoff.controls?.canStartRuntime === true,
    restartSafe: statusHandoff.restartContract
  };
  const clientWorkflow = buildVisibleWorkflow(job, status, runtimeHandoff, counts, nextActions, clientCommandLeases);

  return {
    kind: "aios.mailchimp.diagnosticEmission",
    provider: "mailchimp",
    jobId: job.id,
    task: job.task,
    status,
    runtimeHandoff: {
      readinessStatus: runtimeHandoff.readinessStatus || job.status,
      acceptedForRuntime: runtimeHandoff.acceptedForRuntime === true,
      acceptedForClientPreview: runtimeHandoff.acceptedForClientPreview !== false,
      canStartRuntime: runtimeHandoff.controls?.canStartRuntime === true,
      requiresApprovalBeforeExternalWrite: runtimeHandoff.controls?.requiresApprovalBeforeExternalWrite === true
    },
    permissionBoundary: {
      ...permissionBoundary,
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "permission-boundary")
        .map((diagnostic) => diagnostic.id),
      status: permissionBoundary.safeBoundary
        ? boundaryDiagnostics.length > 0 ? "needs-operator-action" : "ready"
        : "blocked"
    },
    providerServiceContract: {
      ...providerServiceContract,
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "provider-service-contract")
        .map((diagnostic) => diagnostic.id)
    },
    lifecycleControls,
    clientRuntimeAdoption: {
      ...clientRuntimeAdoption,
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "client-runtime-adoption")
        .map((diagnostic) => diagnostic.id)
    },
    diagnostics,
    counts,
    nextActions,
    recoveryCommands,
    clientCommandLeases,
    failureState,
    statusLedger,
    statusHandoff,
    statusRecoveryBundle,
    clientWorkflow,
    recovery: {
      recoverable: blocked === false || nextActions.some((action) => action.required),
      strategy: blocked ? "repair-compile-contract" : "handoff-status-guided",
      nextAction: statusHandoff.nextAction
        || failureState.adapterHandoff.nextAction
        || recoveryCommands.restartCursor.nextAction
        || nextActions[0]?.nextAction
        || "handoff-to-runtime-adapter",
      requiredActionCount: nextActions.filter((action) => action.required).length,
      resumeToken: statusHandoff.statusLedger.resumeToken,
      restartCursor: recoveryCommands.restartCursor,
      statusHandoff: {
        handoffState: statusHandoff.handoffState,
        visibleStatus: statusHandoff.visibleStatus,
        statusRevision: statusHandoff.statusLedger.statusRevision,
        resumeToken: statusHandoff.statusLedger.resumeToken,
        nextAction: statusHandoff.nextAction,
        ackRequired: statusHandoff.clientCommandAck.required
      },
      statusRecoveryBundle: {
        state: statusRecoveryBundle.state,
        readyForRuntimeResume: statusRecoveryBundle.readyForRuntimeResume,
        nextAction: statusRecoveryBundle.nextAction,
        resumeToken: statusRecoveryBundle.resume.resumeToken,
        missingRequiredCheckpoints: statusRecoveryBundle.blocking.missingRequiredCheckpoints
      },
      clientRuntimeAdoption: {
        status: clientRuntimeAdoption.status,
        readyForClientRuntime: clientRuntimeAdoption.readyForClientRuntime,
        adoptionId: clientRuntimeAdoption.adoptionId,
        nextAction: clientRuntimeAdoption.nextAction,
        missingStateKeys: clientRuntimeAdoption.missingStateKeys,
        pendingAckKeys: clientRuntimeAdoption.commandAck.pendingKeys,
        resumeToken: clientRuntimeAdoption.resume.resumeToken
      },
      failureState: {
        mode: failureState.mode,
        queueLength: failureState.summary.total,
        retryableCount: failureState.summary.retryable,
        nextRetry: failureState.nextRetry,
        adapterHandoff: failureState.adapterHandoff
      }
    },
    truthBoundary: {
      source: "diagnostic-emitter",
      deterministic: true,
      externalMailchimpStateVerified: false,
      compiledLocally: true,
      includesLifecycleControls: true,
      includesProviderServiceContract: true,
      includesClientWorkflowValidation: true,
      includesClientCommandLeases: true,
      includesStatusHandoff: true,
      includesStatusRecoveryBundle: true,
      includesClientRuntimeAdoption: true
    }
  };
}

export function assertMailchimpDiagnosticsReady(emission) {
  const diagnostics = emission?.diagnostics || [];
  const statusLedger = emission?.statusLedger || {};
  const failureState = emission?.failureState || {};
  const lifecycleControls = emission?.lifecycleControls || {};
  const providerServiceContract = emission?.providerServiceContract || {};
  const clientWorkflow = emission?.clientWorkflow || {};
  const clientCommandLeases = emission?.clientCommandLeases || {};
  const statusHandoff = emission?.statusHandoff || {};
  const statusRecoveryBundle = emission?.statusRecoveryBundle || {};
  const clientRuntimeAdoption = emission?.clientRuntimeAdoption || {};
  return {
    ok: emission?.provider === "mailchimp"
      && diagnostics.every((diagnostic) => diagnostic.id && diagnostic.code)
      && statusLedger.schemaVersion === "aios.mailchimp.status-ledger.v1"
      && Boolean(statusLedger.resumeToken)
      && statusHandoff.schemaVersion === "aios.mailchimp.status-handoff.v1"
      && Boolean(statusHandoff.statusLedger?.statusRevision)
      && Boolean(statusHandoff.clientPatch?.nextAction)
      && statusHandoff.restartContract?.replaySafe === true
      && statusRecoveryBundle.schemaVersion === "aios.mailchimp.status-recovery-bundle.v1"
      && Boolean(statusRecoveryBundle.resume?.resumeToken)
      && statusRecoveryBundle.restartSemantics?.externalWritesPerformed === false
      && clientRuntimeAdoption.schemaVersion === "aios.mailchimp.client-runtime-adoption.v1"
      && Boolean(clientRuntimeAdoption.adoptionId)
      && clientRuntimeAdoption.restartSemantics?.externalWritesPerformed === false
      && failureState.schemaVersion === "aios.mailchimp.failure-state.v1"
      && Array.isArray(failureState.queue)
      && lifecycleControls.schemaVersion === "aios.mailchimp.lifecycle-controls.v1"
      && Boolean(lifecycleControls.nextAction)
      && providerServiceContract.schemaVersion === "aios.mailchimp.provider-service-contract.v1"
      && Boolean(providerServiceContract.externalHandoff?.idempotencyKey)
      && clientWorkflow.schemaVersion === "aios.mailchimp.client-workflow.v1"
      && Boolean(clientWorkflow.explainNextStep?.action)
      && clientCommandLeases.schemaVersion === "aios.mailchimp.client-command-leases.v1"
      && Array.isArray(clientCommandLeases.leases)
      && Boolean(clientCommandLeases.clientAck?.resumeToken),
    blockingDiagnosticIds: diagnostics
      .filter((diagnostic) => diagnostic.blocksRuntimeHandoff)
      .map((diagnostic) => diagnostic.id),
    resumeToken: statusLedger.resumeToken || null,
    statusHandoffState: statusHandoff.handoffState || "unknown",
    statusHandoffVisibleStatus: statusHandoff.visibleStatus || "unknown",
    statusHandoffNextAction: statusHandoff.nextAction || null,
    statusHandoffAckRequired: statusHandoff.clientCommandAck?.required === true,
    statusRecoveryState: statusRecoveryBundle.state || "unknown",
    statusRecoveryReady: statusRecoveryBundle.readyForRuntimeResume === true,
    statusRecoveryNextAction: statusRecoveryBundle.nextAction || null,
    clientRuntimeAdoptionStatus: clientRuntimeAdoption.status || "unknown",
    clientRuntimeReady: clientRuntimeAdoption.readyForClientRuntime === true,
    clientRuntimeAdoptionNextAction: clientRuntimeAdoption.nextAction || null,
    clientRuntimeMissingStateKeys: clientRuntimeAdoption.missingStateKeys || [],
    clientRuntimePendingAckKeys: clientRuntimeAdoption.commandAck?.pendingKeys || [],
    restartSafe: statusLedger.restartSafe?.replaySafe === true,
    failureMode: failureState.mode || "unknown",
    lifecycleStatus: lifecycleControls.status || "unknown",
    runtimeStartEnabled: lifecycleControls.runtimeStart?.enabled === true,
    providerServiceStatus: providerServiceContract.status || "unknown",
    providerService: providerServiceContract.providerService || null,
    providerServiceHandoffReady: providerServiceContract.externalHandoff?.ready === true,
    clientWorkflowPhase: clientWorkflow.phase || "unknown",
    clientWorkflowValidationBlocked: clientWorkflow.validationSummary?.blocked || 0,
    clientCommandLeaseStatus: clientCommandLeases.leaseStatus || "unknown",
    clientCommandAckRequired: clientCommandLeases.clientAck?.required === true,
    clientCommandLeaseCount: clientCommandLeases.leases?.length || 0,
    retryableFailureCount: failureState.summary?.retryable || 0,
    nextAction: providerServiceContract.externalHandoff?.ready === false
      ? providerServiceContract.nextAction || "repair-provider-service-contract"
      : emission?.recovery?.nextAction || "emit-diagnostics"
  };
}
