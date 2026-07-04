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
  "lifecycle.runControl.frozen": "wait-for-mailchimp-run-control-window",
  "lifecycle.runControl.concurrencyExceeded": "reduce-mailchimp-runtime-concurrency",
  "lifecycle.runControl.modeUnsupported": "select-supported-mailchimp-run-control-mode",
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
  "provider.sync.ack.missing": "acknowledge-mailchimp-provider-sync",
  "provider.sync.watermark.missing": "restore-mailchimp-sync-watermark",
  "client.runtime.state.missing": "hydrate-mailchimp-client-runtime-state",
  "client.runtime.resume.missing": "restore-mailchimp-runtime-resume-token",
  "client.runtime.ack.pending": "acknowledge-mailchimp-client-command",
  "client.runtime.preview.unavailable": "enable-mailchimp-client-preview",
  "client.settings.required.missing": "hydrate-mailchimp-client-runtime-settings",
  "client.settings.revision.stale": "accept-mailchimp-client-settings",
  "client.settings.schedule.unsupported": "select-supported-schedule-window",
  "client.settings.runtimeStart.blocked": "accept-preview-before-runtime-start",
  "client.settings.rollout.held": "release-mailchimp-settings-rollout",
  "client.settings.rollout.window.closed": "select-supported-schedule-window",
  "client.settings.rollout.revision.pending": "accept-mailchimp-client-settings",
  "client.status.revision.stale": "refresh-mailchimp-client-status",
  "client.status.resume.missing": "restore-mailchimp-runtime-resume-token",
  "client.status.ack.pending": "acknowledge-mailchimp-client-command",
  "client.status.runtime.blocked": "repair-client-runtime-status-handoff",
  "release.controls.provider.blocked": "repair-provider-release-controls",
  "release.controls.lifecycle.blocked": "enable-mailchimp-runtime-start-control",
  "release.controls.settings.blocked": "accept-mailchimp-client-settings",
  "release.controls.clientAck.pending": "acknowledge-mailchimp-client-command",
  "release.controls.status.blocked": "repair-client-runtime-status-handoff",
  "preview.release.ticket.acceptance.blocked": "accept-mailchimp-preview",
  "preview.release.ticket.runtime.blocked": "enable-mailchimp-runtime-start-control",
  "preview.release.ticket.status.blocked": "refresh-mailchimp-client-status",
  "preview.release.ticket.verifier.blocked": "evaluate-candidate-before-runtime-handoff",
  "provider.export.service.blocked": "repair-provider-service-handoff",
  "provider.export.sync.blocked": "repair-provider-sync-checkpoint",
  "provider.export.release.blocked": "repair-provider-release-controls",
  "provider.export.status.pending": "refresh-provider-export-status",
  "provider.callback.endpoint.missing": "declare-mailchimp-callback-endpoint",
  "provider.callback.secret.missing": "declare-mailchimp-callback-signing-secret",
  "provider.callback.events.unacknowledged": "acknowledge-mailchimp-callback-events",
  "provider.callback.runtime.blocked": "repair-mailchimp-callback-handoff"
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
  "wait-for-mailchimp-run-control-window": { retryable: true, backoffMs: 60000, maxAttempts: 6, failureClass: "run-control-window" },
  "reduce-mailchimp-runtime-concurrency": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "run-control-capacity" },
  "select-supported-mailchimp-run-control-mode": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "run-control-mode" },
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
  "request-workspace-role-grant": { retryable: true, backoffMs: 45000, maxAttempts: 4, failureClass: "workspace-permission-grant" },
  "prune-undeclared-mailchimp-scope": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "scope-boundary" },
  "append-tenant-permission-audit": { retryable: true, backoffMs: 15000, maxAttempts: 2, failureClass: "tenant-audit-handoff" },
  "select-mailchimp-provider-service": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "provider-service-contract" },
  "select-supported-mailchimp-provider-service": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "provider-service-contract" },
  "declare-mailchimp-service-scope": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "provider-service-scope" },
  "negotiate-mailchimp-provider-capability": { retryable: true, backoffMs: 45000, maxAttempts: 3, failureClass: "provider-capability-negotiation" },
  "declare-provider-sync-handoff": { retryable: true, backoffMs: 30000, maxAttempts: 3, failureClass: "provider-sync-handoff" },
  "acknowledge-mailchimp-provider-sync": { retryable: true, backoffMs: 20000, maxAttempts: 4, failureClass: "provider-sync-ack" },
  "restore-mailchimp-sync-watermark": { retryable: true, backoffMs: 15000, maxAttempts: 3, failureClass: "provider-sync-watermark" },
  "hydrate-mailchimp-client-runtime-state": { retryable: true, backoffMs: 15000, maxAttempts: 3, failureClass: "client-runtime-state" },
  "restore-mailchimp-runtime-resume-token": { retryable: true, backoffMs: 10000, maxAttempts: 2, failureClass: "client-runtime-resume" },
  "acknowledge-mailchimp-client-command": { retryable: true, backoffMs: 20000, maxAttempts: 4, failureClass: "client-command-ack" },
  "hydrate-mailchimp-client-runtime-settings": { retryable: true, backoffMs: 15000, maxAttempts: 3, failureClass: "client-runtime-settings" },
  "accept-mailchimp-client-settings": { retryable: true, backoffMs: 20000, maxAttempts: 3, failureClass: "client-settings-acceptance" },
  "release-mailchimp-settings-rollout": { retryable: true, backoffMs: 30000, maxAttempts: 4, failureClass: "client-settings-rollout" },
  "refresh-mailchimp-client-status": { retryable: true, backoffMs: 10000, maxAttempts: 3, failureClass: "client-status-handoff" },
  "repair-client-runtime-status-handoff": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "client-status-handoff" },
  "repair-provider-release-controls": { retryable: true, backoffMs: 30000, maxAttempts: 3, failureClass: "runtime-release-controls" },
  "enable-mailchimp-runtime-start-control": { retryable: true, backoffMs: 30000, maxAttempts: 3, failureClass: "runtime-release-controls" },
  "refresh-preview-release-ticket": { retryable: true, backoffMs: 15000, maxAttempts: 3, failureClass: "preview-release-ticket" },
  "repair-preview-release-ticket": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "preview-release-ticket" },
  "refresh-provider-export-status": { retryable: true, backoffMs: 15000, maxAttempts: 3, failureClass: "provider-export-readiness" },
  "declare-mailchimp-callback-endpoint": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "provider-callback-handoff" },
  "declare-mailchimp-callback-signing-secret": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "provider-callback-handoff" },
  "acknowledge-mailchimp-callback-events": { retryable: true, backoffMs: 20000, maxAttempts: 4, failureClass: "provider-callback-handoff" },
  "repair-mailchimp-callback-handoff": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "provider-callback-handoff" },
  "review-mailchimp-service-level-objective": { retryable: true, backoffMs: 30000, maxAttempts: 3, failureClass: "service-level-objective" },
  "pause-mailchimp-runtime-release": { retryable: false, backoffMs: 0, maxAttempts: 0, failureClass: "service-level-objective" },
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

function deriveProviderSyncCheckpoint(job, providerServiceContract, options = {}) {
  const optionCheckpoint = options.providerSyncCheckpoint || {};
  const syncMetadata = providerServiceContract.syncMetadata || {};
  const syncMounts = Array.isArray(syncMetadata.providerSyncMounts)
    ? syncMetadata.providerSyncMounts
    : [];
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const handoffState = runtimeHandoff.providerSyncCheckpoint || {};
  const acknowledgedMounts = normalizeList(
    optionCheckpoint.acknowledgedMounts
      || handoffState.acknowledgedMounts
      || []
  );
  const watermarks = {
    ...(handoffState.watermarks || {}),
    ...(optionCheckpoint.watermarks || {})
  };
  const checkpointRows = syncMounts.map((mount) => {
    const watermark = watermarks[mount.name] || mount.watermark || null;
    const ackKey = `${job.id}:${providerServiceContract.providerService}:${mount.name}:${mount.syncDirection}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
    const acked = acknowledgedMounts.includes(mount.name) || optionCheckpoint.acknowledgeAll === true;
    const ready = mount.externalHandoff !== "not-required"
      && acked
      && Boolean(watermark);
    return {
      name: mount.name,
      syncDirection: mount.syncDirection,
      capability: mount.capability,
      externalHandoff: mount.externalHandoff,
      ackKey,
      acknowledged: acked,
      watermark,
      ready,
      nextAction: mount.externalHandoff === "not-required"
        ? "declare-provider-sync-handoff"
        : acked === false
          ? "acknowledge-mailchimp-provider-sync"
          : watermark
            ? "handoff-to-runtime-adapter"
            : "restore-mailchimp-sync-watermark"
    };
  });
  const missingAckMounts = checkpointRows
    .filter((row) => row.acknowledged === false && row.externalHandoff !== "not-required")
    .map((row) => row.name);
  const missingWatermarkMounts = checkpointRows
    .filter((row) => row.acknowledged === true && !row.watermark)
    .map((row) => row.name);
  const missingHandoffMounts = checkpointRows
    .filter((row) => row.externalHandoff === "not-required")
    .map((row) => row.name);
  const syncRequired = syncMetadata.syncRequired === true || checkpointRows.length > 0;
  const ready = syncRequired === false
    || checkpointRows.every((row) => row.ready);
  const status = ready
    ? "ready"
    : missingHandoffMounts.length > 0
      ? "blocked"
      : "needs-operator-action";
  const nextAction = missingHandoffMounts.length > 0
    ? "declare-provider-sync-handoff"
    : missingAckMounts.length > 0
      ? "acknowledge-mailchimp-provider-sync"
      : missingWatermarkMounts.length > 0
        ? "restore-mailchimp-sync-watermark"
        : "handoff-to-runtime-adapter";

  return {
    schemaVersion: "aios.mailchimp.provider-sync-checkpoint.v1",
    provider: "mailchimp",
    jobId: job.id,
    providerService: providerServiceContract.providerService,
    status,
    ready,
    syncRequired,
    nextAction,
    checkpointRows,
    missingAckMounts,
    missingWatermarkMounts,
    missingHandoffMounts,
    resumeToken: optionCheckpoint.resumeToken
      || handoffState.resumeToken
      || `${job.id}:provider-sync:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    idempotencyKey: `${providerServiceContract.externalHandoff?.idempotencyKey || job.id}:sync-checkpoint`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    clientPatch: {
      providerSyncCheckpointStatus: status,
      providerSyncCheckpointReady: ready,
      providerSyncCheckpointNextAction: nextAction,
      providerSyncMissingAckMounts: missingAckMounts,
      providerSyncMissingWatermarkMounts: missingWatermarkMounts
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-sync-ack-key",
      resumeFromAckKey: checkpointRows.find((row) => row.ready === false)?.ackKey || null,
      externalWritesPerformed: false
    }
  };
}

function providerSyncCheckpointDiagnostics(providerSyncCheckpoint) {
  const diagnostics = [];
  for (const mount of providerSyncCheckpoint.missingHandoffMounts) {
    diagnostics.push(providerServiceDiagnostic(
      "providerSyncCheckpoint",
      "provider.sync.missing",
      `Mailchimp provider sync mount '${mount}' requires an external handoff target before runtime release.`,
      "warning",
      { mount, source: "provider-sync-checkpoint" }
    ));
  }
  for (const mount of providerSyncCheckpoint.missingAckMounts) {
    diagnostics.push(providerServiceDiagnostic(
      "providerSyncCheckpoint",
      "provider.sync.ack.missing",
      `Mailchimp provider sync mount '${mount}' must be acknowledged before adapter handoff.`,
      "warning",
      { mount, source: "provider-sync-checkpoint" }
    ));
  }
  for (const mount of providerSyncCheckpoint.missingWatermarkMounts) {
    diagnostics.push(providerServiceDiagnostic(
      "providerSyncCheckpoint",
      "provider.sync.watermark.missing",
      `Mailchimp provider sync mount '${mount}' needs a restart-safe watermark before adapter recovery can resume.`,
      "warning",
      { mount, source: "provider-sync-checkpoint" }
    ));
  }
  return diagnostics;
}

function deriveProviderExportReadiness(
  job,
  status,
  providerServiceContract,
  providerSyncCheckpoint,
  runtimeReleaseControls,
  statusLedger,
  options = {}
) {
  const optionExport = options.providerExportReadiness || {};
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const exportHandoff = runtimeHandoff.providerExportReadiness || {};
  const providerServiceReady = providerServiceContract.externalHandoff?.ready === true
    && providerServiceContract.status === "ready";
  const providerSyncReady = providerSyncCheckpoint.ready === true;
  const releaseReady = runtimeReleaseControls.readyForRuntimeStart === true
    && runtimeReleaseControls.status !== "blocked";
  const statusReady = Boolean(statusLedger.resumeToken)
    && Boolean(statusLedger.statusRevision)
    && status !== "blocked";
  const rows = [
    {
      id: "provider-service",
      label: "Mailchimp provider service",
      status: providerServiceReady ? "ready" : providerServiceContract.status || "blocked",
      ready: providerServiceReady,
      nextAction: providerServiceReady
        ? "handoff-to-runtime-adapter"
        : providerServiceContract.nextAction || "repair-provider-service-handoff",
      evidence: {
        providerService: providerServiceContract.providerService,
        externalHandoffReady: providerServiceContract.externalHandoff?.ready === true,
        unnegotiatedCapabilities: providerServiceContract.capabilityNegotiation?.unnegotiated || []
      }
    },
    {
      id: "provider-sync",
      label: "Mailchimp provider sync checkpoint",
      status: providerSyncReady ? "ready" : providerSyncCheckpoint.status || "needs-operator-action",
      ready: providerSyncReady,
      nextAction: providerSyncReady
        ? "handoff-to-runtime-adapter"
        : providerSyncCheckpoint.nextAction || "repair-provider-sync-checkpoint",
      evidence: {
        syncRequired: providerSyncCheckpoint.syncRequired === true,
        resumeToken: providerSyncCheckpoint.resumeToken || null,
        missingAckMounts: providerSyncCheckpoint.missingAckMounts || [],
        missingWatermarkMounts: providerSyncCheckpoint.missingWatermarkMounts || [],
        missingHandoffMounts: providerSyncCheckpoint.missingHandoffMounts || []
      }
    },
    {
      id: "runtime-release",
      label: "Mailchimp runtime release controls",
      status: releaseReady ? "ready" : runtimeReleaseControls.status || "needs-operator-action",
      ready: releaseReady,
      nextAction: releaseReady
        ? "handoff-to-runtime-adapter"
        : runtimeReleaseControls.nextAction || "repair-provider-release-controls",
      evidence: {
        releaseKey: runtimeReleaseControls.releaseKey || null,
        readyForRuntimeStart: runtimeReleaseControls.readyForRuntimeStart === true,
        blockedGateIds: runtimeReleaseControls.clientPatch?.runtimeReleaseBlockedGateIds || []
      }
    },
    {
      id: "status-ledger",
      label: "Mailchimp status ledger",
      status: statusReady ? "ready" : status === "blocked" ? "blocked" : "waiting",
      ready: statusReady,
      nextAction: statusReady ? "handoff-to-runtime-adapter" : "refresh-provider-export-status",
      evidence: {
        resumeToken: statusLedger.resumeToken || null,
        statusRevision: statusLedger.statusRevision || null,
        acceptedForRuntime: statusLedger.acceptedForRuntime === true
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.ready === false && row.id !== "status-ledger");
  const waitingRows = rows.filter((row) => row.ready === false && !blockedRows.includes(row));
  const ready = rows.every((row) => row.ready);
  const exportReady = ready
    && providerServiceContract.externalHandoff?.required !== false
    && runtimeHandoff.acceptedForClientPreview !== false;
  const nextRow = blockedRows[0] || waitingRows[0] || null;
  const statusValue = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0 || exportReady === false
      ? "needs-operator-action"
      : "ready";
  const exportKey = optionExport.exportKey
    || exportHandoff.exportKey
    || `${job.id}:${providerServiceContract.providerService}:provider-export`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const resumeToken = optionExport.resumeToken
    || exportHandoff.resumeToken
    || statusLedger.resumeToken
    || `${exportKey}:resume`;

  return {
    schemaVersion: "aios.mailchimp.provider-export-readiness.v1",
    provider: "mailchimp",
    jobId: job.id,
    providerService: providerServiceContract.providerService,
    status: statusValue,
    ready,
    exportReady,
    exportKey,
    resumeToken,
    statusRevision: statusLedger.statusRevision || null,
    nextAction: nextRow?.nextAction || (exportReady ? "publish-provider-export-readiness" : "refresh-provider-export-status"),
    rows,
    validationSummary: {
      total: rows.length,
      ready: rows.filter((row) => row.ready).length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      blockedRowIds: blockedRows.map((row) => row.id),
      waitingRowIds: waitingRows.map((row) => row.id)
    },
    externalHandoff: {
      target: optionExport.target || exportHandoff.target || providerServiceContract.externalHandoff?.target || "mailchimp-provider-export",
      required: providerServiceContract.externalHandoff?.required !== false,
      ready: exportReady,
      idempotencyKey: `${exportKey}:${statusLedger.statusRevision || "unrevisioned"}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      externalWritesPerformed: false
    },
    clientPatch: {
      providerExportReadinessStatus: statusValue,
      providerExportReady: exportReady,
      providerExportNextAction: nextRow?.nextAction || (exportReady ? "publish-provider-export-readiness" : "refresh-provider-export-status"),
      providerExportBlockedRows: blockedRows.map((row) => row.id),
      providerExportWaitingRows: waitingRows.map((row) => row.id),
      providerExportResumeToken: resumeToken
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-export-key",
      resumeToken,
      externalWritesPerformed: false
    }
  };
}

function providerExportReadinessDiagnostics(providerExportReadiness) {
  const diagnostics = [];
  for (const row of providerExportReadiness.rows || []) {
    if (row.ready) continue;
    diagnostics.push(providerServiceDiagnostic(
      "providerExportReadiness",
      row.id === "provider-service"
        ? "provider.export.service.blocked"
        : row.id === "provider-sync"
          ? "provider.export.sync.blocked"
          : row.id === "runtime-release"
            ? "provider.export.release.blocked"
            : "provider.export.status.pending",
      `Mailchimp provider export row '${row.id}' is not ready for runtime handoff.`,
      row.status === "blocked" ? "error" : "warning",
      { source: "provider-export-readiness", rowId: row.id }
    ));
  }
  return diagnostics;
}

function deriveProviderCallbackHandoff(job, providerServiceContract, statusLedger, options = {}) {
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const source = {
    ...(runtimeHandoff.providerCallbackHandoff || {}),
    ...(options.providerCallbackHandoff || {})
  };
  const requiredEvents = normalizeList(source.requiredEvents || [
    "campaign.sent",
    "campaign.send_failed",
    "audience.sync_completed"
  ]);
  const acknowledgedEvents = normalizeList(source.acknowledgedEvents || []);
  const missingEvents = requiredEvents.filter((event) => !acknowledgedEvents.includes(event));
  const endpointId = normalizeBoundaryId(source.endpointId, "");
  const signingSecretRef = normalizeBoundaryId(source.signingSecretRef, "");
  const endpointReady = endpointId.length > 0;
  const secretReady = signingSecretRef.length > 0;
  const serviceReady = providerServiceContract.externalHandoff?.ready === true
    && providerServiceContract.status !== "blocked";
  const ready = endpointReady && secretReady && serviceReady && missingEvents.length === 0;
  const status = endpointReady === false || secretReady === false || providerServiceContract.status === "blocked"
    ? "blocked"
    : ready
      ? "ready"
      : "needs-operator-action";
  const callbackKey = source.callbackKey
    || `${job.id}:${providerServiceContract.providerService}:provider-callback:${requiredEvents.join("|")}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const resumeToken = source.resumeToken
    || statusLedger?.resumeToken
    || `${callbackKey}:resume`;
  const nextAction = endpointReady === false
    ? "declare-mailchimp-callback-endpoint"
    : secretReady === false
      ? "declare-mailchimp-callback-signing-secret"
      : serviceReady === false
        ? providerServiceContract.nextAction || "repair-provider-service-handoff"
        : missingEvents.length
          ? "acknowledge-mailchimp-callback-events"
          : "handoff-to-runtime-adapter";
  const rows = [
    {
      id: "callback-endpoint",
      label: "Mailchimp callback endpoint",
      status: endpointReady ? "ready" : "blocked",
      ready: endpointReady,
      nextAction: endpointReady ? "handoff-to-runtime-adapter" : "declare-mailchimp-callback-endpoint",
      evidence: { endpointId: endpointId || null }
    },
    {
      id: "callback-signing-secret",
      label: "Mailchimp callback signing secret",
      status: secretReady ? "ready" : "blocked",
      ready: secretReady,
      nextAction: secretReady ? "handoff-to-runtime-adapter" : "declare-mailchimp-callback-signing-secret",
      evidence: { signingSecretRef: signingSecretRef || null }
    },
    {
      id: "callback-event-ack",
      label: "Mailchimp callback event acknowledgements",
      status: missingEvents.length ? "needs-operator-action" : "ready",
      ready: missingEvents.length === 0,
      nextAction: missingEvents.length ? "acknowledge-mailchimp-callback-events" : "handoff-to-runtime-adapter",
      evidence: { requiredEvents, acknowledgedEvents, missingEvents }
    },
    {
      id: "provider-service",
      label: "Mailchimp provider service callback support",
      status: serviceReady ? "ready" : providerServiceContract.status || "blocked",
      ready: serviceReady,
      nextAction: serviceReady
        ? "handoff-to-runtime-adapter"
        : providerServiceContract.nextAction || "repair-provider-service-handoff",
      evidence: {
        providerService: providerServiceContract.providerService,
        externalHandoffReady: providerServiceContract.externalHandoff?.ready === true
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const waitingRows = rows.filter((row) => row.ready === false && row.status !== "blocked");

  return {
    schemaVersion: "aios.mailchimp.provider-callback-handoff.v1",
    provider: "mailchimp",
    jobId: job.id,
    providerService: providerServiceContract.providerService,
    status,
    ready,
    callbackKey,
    resumeToken,
    endpoint: {
      endpointId: endpointId || null,
      signingSecretRef: signingSecretRef || null,
      ready: endpointReady && secretReady
    },
    events: {
      required: requiredEvents,
      acknowledged: acknowledgedEvents,
      missing: missingEvents
    },
    rows,
    nextAction,
    routePayload: {
      routeId: "mailchimp.provider-callback-handoff",
      providerService: providerServiceContract.providerService,
      callbackKey,
      resumeToken,
      statusRevision: statusLedger?.statusRevision || null,
      idempotencyKey: `${callbackKey}:${statusLedger?.statusRevision || "unrevisioned"}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      dryRunOnly: true
    },
    validationSummary: {
      total: rows.length,
      ready: rows.filter((row) => row.ready).length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      blockedRowIds: blockedRows.map((row) => row.id),
      waitingRowIds: waitingRows.map((row) => row.id)
    },
    clientPatch: {
      providerCallbackStatus: status,
      providerCallbackReady: ready,
      providerCallbackNextAction: nextAction,
      providerCallbackMissingEvents: missingEvents,
      providerCallbackResumeToken: resumeToken
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-callback-key",
      resumeToken,
      externalWritesPerformed: false
    }
  };
}

function providerCallbackHandoffDiagnostics(providerCallbackHandoff) {
  const diagnostics = [];
  if (providerCallbackHandoff.endpoint?.endpointId == null) {
    diagnostics.push(providerServiceDiagnostic(
      "providerCallbackHandoff",
      "provider.callback.endpoint.missing",
      "Mailchimp callback handoff requires a callback endpoint before runtime status callbacks can resume.",
      "error",
      { source: "provider-callback-handoff" }
    ));
  }
  if (providerCallbackHandoff.endpoint?.signingSecretRef == null) {
    diagnostics.push(providerServiceDiagnostic(
      "providerCallbackHandoff",
      "provider.callback.secret.missing",
      "Mailchimp callback handoff requires a signing secret reference before runtime status callbacks can resume.",
      "error",
      { source: "provider-callback-handoff" }
    ));
  }
  for (const event of providerCallbackHandoff.events?.missing || []) {
    diagnostics.push(providerServiceDiagnostic(
      "providerCallbackHandoff",
      "provider.callback.events.unacknowledged",
      `Mailchimp callback event '${event}' needs an acknowledgement before restart-safe callback handoff.`,
      "warning",
      { event, source: "provider-callback-handoff" }
    ));
  }
  return diagnostics;
}

function derivePreviewReleaseTicket(job, status, previewAcceptancePacket, runtimeReleaseControls, statusLedger, options = {}) {
  const source = options.previewReleaseTicket || {};
  const releaseKey = runtimeReleaseControls.releaseKey || source.releaseKey || `${job.id}:runtime-release`;
  const ticketKey = source.ticketKey
    || `${job.id}:preview-release:${previewAcceptancePacket.acceptanceToken || "unaccepted"}:${releaseKey}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const rows = [
    {
      id: "preview-acceptance",
      status: previewAcceptancePacket.readyForRuntimeStart === true ? "ready" : previewAcceptancePacket.status || "waiting",
      ready: previewAcceptancePacket.readyForRuntimeStart === true,
      required: true,
      nextAction: previewAcceptancePacket.readyForRuntimeStart === true
        ? "handoff-to-runtime-adapter"
        : previewAcceptancePacket.nextAction || "accept-mailchimp-preview",
      code: previewAcceptancePacket.readyForRuntimeStart === true
        ? "preview.release.ticket.acceptance.ready"
        : "preview.release.ticket.acceptance.blocked"
    },
    {
      id: "runtime-release-controls",
      status: runtimeReleaseControls.readyForRuntimeStart === true ? "ready" : runtimeReleaseControls.status || "waiting",
      ready: runtimeReleaseControls.readyForRuntimeStart === true,
      required: true,
      nextAction: runtimeReleaseControls.readyForRuntimeStart === true
        ? "handoff-to-runtime-adapter"
        : runtimeReleaseControls.nextAction || "enable-mailchimp-runtime-start-control",
      code: runtimeReleaseControls.readyForRuntimeStart === true
        ? "preview.release.ticket.runtime.ready"
        : "preview.release.ticket.runtime.blocked"
    },
    {
      id: "status-ledger",
      status: statusLedger.resumeToken && statusLedger.statusRevision && status !== "blocked" ? "ready" : "waiting",
      ready: Boolean(statusLedger.resumeToken && statusLedger.statusRevision && status !== "blocked"),
      required: true,
      nextAction: statusLedger.resumeToken && statusLedger.statusRevision && status !== "blocked"
        ? "handoff-to-runtime-adapter"
        : "refresh-mailchimp-client-status",
      code: statusLedger.resumeToken && statusLedger.statusRevision && status !== "blocked"
        ? "preview.release.ticket.status.ready"
        : "preview.release.ticket.status.blocked"
    }
  ];
  const blockedRows = rows.filter((row) => row.required && row.status === "blocked");
  const waitingRows = rows.filter((row) => row.required && row.ready === false && row.status !== "blocked");
  const readyForRuntimeRelease = blockedRows.length === 0
    && waitingRows.length === 0
    && previewAcceptancePacket.readyForRuntimeStart === true
    && runtimeReleaseControls.readyForRuntimeStart === true
    && status !== "blocked";
  const nextRow = blockedRows[0] || waitingRows[0] || null;

  return {
    schemaVersion: "aios.mailchimp.preview-release-ticket.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: blockedRows.length
      ? "blocked"
      : waitingRows.length
        ? "needs-operator-action"
        : readyForRuntimeRelease
          ? "ready"
          : "waiting",
    ticketKey,
    releaseKey,
    acceptanceToken: previewAcceptancePacket.acceptanceToken || null,
    readyForRuntimeRelease,
    nextAction: nextRow?.nextAction
      || source.nextAction
      || (readyForRuntimeRelease ? "release-mailchimp-preview-to-runtime" : "refresh-preview-release-ticket"),
    resumeToken: source.resumeToken || previewAcceptancePacket.statusLedger?.resumeToken || statusLedger.resumeToken || `${ticketKey}:resume`,
    statusRevision: source.statusRevision || previewAcceptancePacket.statusLedger?.statusRevision || statusLedger.statusRevision || null,
    rows,
    validationSummary: {
      total: rows.length,
      ready: rows.filter((row) => row.ready).length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      blockedRowIds: blockedRows.map((row) => row.id),
      waitingRowIds: waitingRows.map((row) => row.id)
    },
    clientPatch: {
      previewReleaseTicketStatus: blockedRows.length
        ? "blocked"
        : waitingRows.length
          ? "needs-operator-action"
          : "ready",
      previewReleaseTicketReady: readyForRuntimeRelease,
      previewReleaseTicketNextAction: nextRow?.nextAction || "release-mailchimp-preview-to-runtime",
      previewReleaseTicketBlockedRows: blockedRows.map((row) => row.id),
      previewReleaseTicketWaitingRows: waitingRows.map((row) => row.id)
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-preview-release-ticket-key",
      resumeToken: source.resumeToken || previewAcceptancePacket.statusLedger?.resumeToken || statusLedger.resumeToken || `${ticketKey}:resume`,
      externalWritesPerformed: false
    }
  };
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

function permissionGrantCommandId(jobId, command, index) {
  return `${jobId}.permission.${String(index + 1).padStart(2, "0")}.${command.kind}.${command.target}`
    .replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function buildPermissionGrantPlan(job, boundary) {
  const missingRoleCommands = boundary.missingRoles.map((role) => ({
    kind: "role-grant",
    target: role,
    owner: "workspace-admin",
    action: "request-workspace-role-grant",
    required: true,
    blocksRuntimeStart: true,
    reason: "required-workspace-role-missing",
    scope: {
      type: "workspace-role",
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      role
    }
  }));
  const deniedScopeCommands = boundary.deniedScopes.map((scope) => ({
    kind: "scope-prune",
    target: scope,
    owner: "runtime-adapter",
    action: "prune-undeclared-mailchimp-scope",
    required: true,
    blocksRuntimeStart: true,
    reason: "requested-scope-not-declared",
    scope: {
      type: "mailchimp-scope",
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      scope
    }
  }));
  const auditCommand = {
    kind: "audit-append",
    target: boundary.isolationKey,
    owner: "operator",
    action: "append-tenant-permission-audit",
    required: boundary.safeBoundary === true,
    blocksRuntimeStart: false,
    reason: boundary.safeBoundary ? "permission-boundary-ready-for-audit" : "permission-boundary-audit-after-repair",
    scope: {
      type: "tenant-audit",
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      isolationKey: boundary.isolationKey
    }
  };
  const commands = [...missingRoleCommands, ...deniedScopeCommands, auditCommand]
    .map((command, index) => ({
      ...command,
      id: permissionGrantCommandId(job.id, command, index),
      order: index + 1,
      status: command.blocksRuntimeStart
        ? "blocked"
        : boundary.safeBoundary
          ? "ready"
          : "waiting",
      idempotencyKey: `${job.id}:${boundary.isolationKey}:${command.kind}:${command.target}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      retryPolicy: RETRY_POLICY_BY_ACTION[command.action] || RETRY_POLICY_BY_ACTION[boundary.nextAction] || {
        retryable: false,
        backoffMs: 0,
        maxAttempts: 0,
        failureClass: "permission-boundary"
      }
    }));
  const blockingCommands = commands.filter((command) => command.blocksRuntimeStart);
  const status = boundary.safeBoundary === false || blockingCommands.length > 0
    ? "blocked"
    : commands.some((command) => command.status === "waiting")
      ? "needs-operator-action"
      : "ready";

  return {
    schemaVersion: "aios.mailchimp.permission-grant-plan.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    safeBoundary: boundary.safeBoundary === true,
    isolationKey: boundary.isolationKey,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    commands,
    summary: {
      total: commands.length,
      blocking: blockingCommands.length,
      roleGrants: missingRoleCommands.length,
      scopePrunes: deniedScopeCommands.length,
      auditAppends: 1,
      retryable: commands.filter((command) => command.retryPolicy.retryable).length
    },
    nextAction: blockingCommands[0]?.action
      || (boundary.safeBoundary ? "append-tenant-permission-audit" : boundary.nextAction),
    clientPatch: {
      permissionGrantPlanStatus: status,
      permissionGrantPlanNextAction: blockingCommands[0]?.action
        || (boundary.safeBoundary ? "append-tenant-permission-audit" : boundary.nextAction),
      permissionGrantCommandIds: commands.map((command) => command.id),
      permissionGrantBlockingCount: blockingCommands.length,
      tenantIsolationKey: boundary.isolationKey
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-permission-grant-command-id",
      resumeFromCommandId: blockingCommands[0]?.id || auditCommand.id || null,
      externalWritesPerformed: false
    }
  };
}

function buildTenantPermissionEnforcement(job, boundary, grantPlan, diagnostics) {
  const boundaryDiagnosticIds = diagnostics
    .filter((diagnostic) => diagnostic.source === "permission-boundary")
    .map((diagnostic) => diagnostic.id);
  const commands = Array.isArray(grantPlan.commands) ? grantPlan.commands : [];
  const commandRows = commands.map((command) => {
    const retryPolicy = command.retryPolicy || RETRY_POLICY_BY_ACTION[command.action] || {};
    const blocked = command.blocksRuntimeStart === true || command.status === "blocked";
    return {
      commandId: command.id,
      kind: command.kind,
      target: command.target,
      owner: command.owner,
      action: command.action,
      status: blocked ? "blocked" : command.status || "waiting",
      required: command.required === true,
      blocksRuntimeStart: blocked,
      retryable: retryPolicy.retryable === true,
      backoffMs: retryPolicy.backoffMs || 0,
      failureClass: retryPolicy.failureClass || "tenant-permission-boundary",
      auditRequired: command.kind === "audit-append" || boundary.safeBoundary === true,
      scope: command.scope || {
        type: "tenant-permission",
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId
      },
      idempotencyKey: command.idempotencyKey || `${job.id}:${boundary.isolationKey}:${command.kind}:${command.target}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    };
  });
  const blockedRows = commandRows.filter((row) => row.blocksRuntimeStart);
  const retryableRows = commandRows.filter((row) => row.retryable);
  const auditRows = commandRows.filter((row) => row.auditRequired);
  const deniedScopeRows = commandRows.filter((row) => row.kind === "scope-prune");
  const missingRoleRows = commandRows.filter((row) => row.kind === "role-grant");
  const waiverRows = normalizeList(
    job.contracts?.tenantBoundary?.approvedWaivers
      || job.contracts?.workspaceBoundary?.approvedWaivers
      || []
  ).map((waiverId, index) => ({
    id: `${job.id}.tenant-waiver.${String(index + 1).padStart(2, "0")}.${waiverId}`
      .replace(/[^a-zA-Z0-9_.-]/g, "_"),
    waiverId,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    accepted: boundary.safeBoundary === true,
    replayPolicy: "dedupe-by-tenant-waiver-id"
  }));
  const status = boundary.safeBoundary === false || blockedRows.length > 0
    ? "blocked"
    : boundaryDiagnosticIds.length > 0 || retryableRows.length > 0
      ? "needs-operator-action"
      : "ready";
  const nextAction = blockedRows[0]?.action
    || retryableRows[0]?.action
    || grantPlan.nextAction
    || (status === "ready" ? "append-tenant-permission-audit" : boundary.nextAction);
  const enforcementKey = `${job.id}:${boundary.isolationKey}:${status}:${commandRows.map((row) => row.commandId).join("|")}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.tenant-permission-enforcement.v1",
    provider: "mailchimp",
    jobId: job.id,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    isolationKey: boundary.isolationKey,
    status,
    safeBoundary: boundary.safeBoundary === true,
    enforcementKey,
    nextAction,
    boundary: {
      explicitTenant: boundary.explicitTenant === true,
      explicitWorkspace: boundary.explicitWorkspace === true,
      wildcardBoundary: boundary.wildcardBoundary === true,
      crossTenantAccess: boundary.crossTenantAccess === true,
      allowedTenantIds: boundary.allowedTenantIds || [],
      allowedRoles: boundary.allowedRoles || [],
      requiredRoles: boundary.requiredRoles || [],
      missingRoles: boundary.missingRoles || [],
      requiredScopes: boundary.requiredScopes || [],
      requestedScopes: boundary.requestedScopes || [],
      deniedScopes: boundary.deniedScopes || []
    },
    decisions: commandRows,
    waivers: waiverRows,
    audit: {
      required: boundary.safeBoundary === true || auditRows.length > 0,
      ready: boundary.safeBoundary === true && blockedRows.length === 0,
      commandIds: auditRows.map((row) => row.commandId),
      diagnosticIds: boundaryDiagnosticIds,
      appendAction: "append-tenant-permission-audit",
      externalWritesPerformed: false
    },
    counters: {
      commands: commandRows.length,
      blocked: blockedRows.length,
      retryable: retryableRows.length,
      missingRoles: missingRoleRows.length,
      deniedScopes: deniedScopeRows.length,
      waivers: waiverRows.length,
      diagnostics: boundaryDiagnosticIds.length
    },
    clientPatch: {
      tenantPermissionEnforcementKey: enforcementKey,
      tenantPermissionEnforcementStatus: status,
      tenantPermissionNextAction: nextAction,
      tenantPermissionBlocked: blockedRows.length,
      tenantPermissionRetryable: retryableRows.length,
      tenantPermissionAuditReady: boundary.safeBoundary === true && blockedRows.length === 0,
      tenantIsolationKey: boundary.isolationKey
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-tenant-permission-enforcement-key",
      resumeFromEnforcementKey: enforcementKey,
      externalWritesPerformed: false
    }
  };
}

function buildTenantBoundaryPosture(job, boundary, grantPlan, enforcement, diagnostics) {
  const boundaryDiagnosticIds = diagnostics
    .filter((diagnostic) => diagnostic.source === "permission-boundary")
    .map((diagnostic) => diagnostic.id);
  const decisions = Array.isArray(enforcement.decisions) ? enforcement.decisions : [];
  const commands = Array.isArray(grantPlan.commands) ? grantPlan.commands : [];
  const blockedDecisions = decisions.filter((decision) => (
    decision.blocksRuntimeStart === true
    || decision.status === "blocked"
  ));
  const waitingDecisions = decisions.filter((decision) => (
    decision.status === "waiting"
    || decision.status === "needs-operator-action"
  ));
  const retryableDecisions = decisions.filter((decision) => decision.retryable === true);
  const auditCommand = commands.find((command) => command.kind === "audit-append") || null;
  const explicitBoundary = boundary.explicitTenant === true && boundary.explicitWorkspace === true;
  const scopeDrift = boundary.deniedScopes.length > 0
    || boundary.requestedScopes.some((scope) => boundary.requiredScopes.length > 0 && !boundary.requiredScopes.includes(scope));
  const roleDrift = boundary.missingRoles.length > 0;
  const isolationDrift = boundary.wildcardBoundary === true || boundary.crossTenantAccess === true || explicitBoundary === false;
  const status = boundary.safeBoundary !== true || blockedDecisions.length > 0
    ? "blocked"
    : waitingDecisions.length > 0 || retryableDecisions.length > 0 || boundaryDiagnosticIds.length > 0
      ? "needs-operator-action"
      : enforcement.audit?.ready === true
        ? "ready"
        : "audit-pending";
  const nextAction = status === "ready"
    ? "handoff-to-runtime-adapter"
    : blockedDecisions[0]?.action
      || waitingDecisions[0]?.action
      || enforcement.nextAction
      || grantPlan.nextAction
      || boundary.nextAction;
  const postureKey = `${job.id}:${boundary.isolationKey}:${status}:${boundary.requiredRoles.join("|")}:${boundary.requiredScopes.join("|")}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.tenant-boundary-posture.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    postureKey,
    isolationKey: boundary.isolationKey,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    safeForRuntime: status === "ready" && boundary.safeBoundary === true,
    safeForAuditAppend: boundary.safeBoundary === true
      && blockedDecisions.length === 0
      && Boolean(auditCommand?.id),
    nextAction,
    drift: {
      explicitBoundary,
      isolationDrift,
      roleDrift,
      scopeDrift,
      auditDrift: enforcement.audit?.ready !== true,
      missingRoles: boundary.missingRoles,
      deniedScopes: boundary.deniedScopes,
      diagnosticIds: boundaryDiagnosticIds
    },
    runtimeGate: {
      blocksRuntimeStart: status === "blocked",
      blockedDecisionIds: blockedDecisions.map((decision) => decision.commandId).filter(Boolean),
      waitingDecisionIds: waitingDecisions.map((decision) => decision.commandId).filter(Boolean),
      retryableDecisionIds: retryableDecisions.map((decision) => decision.commandId).filter(Boolean),
      requiredRoleCount: boundary.requiredRoles.length,
      requiredScopeCount: boundary.requiredScopes.length
    },
    auditHandoff: {
      commandId: auditCommand?.id || null,
      ready: enforcement.audit?.ready === true,
      appendAction: enforcement.audit?.appendAction || "append-tenant-permission-audit",
      idempotencyKey: auditCommand?.idempotencyKey || `${job.id}:${boundary.isolationKey}:tenant-boundary-posture`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      externalWritesPerformed: false
    },
    clientPatch: {
      tenantBoundaryPostureStatus: status,
      tenantBoundaryPostureKey: postureKey,
      tenantBoundaryPostureNextAction: nextAction,
      tenantBoundarySafeForRuntime: status === "ready" && boundary.safeBoundary === true,
      tenantBoundarySafeForAudit: boundary.safeBoundary === true && blockedDecisions.length === 0,
      tenantBoundaryDriftCount: [
        isolationDrift,
        roleDrift,
        scopeDrift,
        enforcement.audit?.ready !== true
      ].filter(Boolean).length
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-tenant-boundary-posture-key",
      resumeFromPostureKey: postureKey,
      externalWritesPerformed: false
    }
  };
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
  const runControl = deriveLifecycleRunControl(
    job,
    runtimeHandoff,
    controls.runControl || runtimeControls.runControl || {},
    capabilities
  );
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
    && runControl.ready
    && operatorApprovalReady;
  const nextAction = previewEnabled === false || acceptedForPreview === false
    ? "enable-mailchimp-client-preview"
    : disabledRequiredActions.length > 0
      ? "enable-required-mailchimp-capability"
      : scheduleWindowSupported === false
        ? "select-supported-schedule-window"
        : schedulePaused
          ? "resume-mailchimp-schedule"
          : runControl.ready === false
            ? runControl.nextAction
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
        : runControl.status === "blocked"
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
              : runControl.ready === false
                ? runControl.disableReason
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
    runControl,
    nextAction
  };
}

function parseRunControlInstant(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRunControlWindows(windows) {
  if (!Array.isArray(windows)) return [];
  return windows
    .map((window, index) => {
      const startMs = parseRunControlInstant(window.start || window.windowStart);
      const endMs = parseRunControlInstant(window.end || window.windowEnd);
      return {
        id: window.id || `freeze-${String(index + 1).padStart(2, "0")}`,
        reason: String(window.reason || "operator-freeze"),
        start: window.start || window.windowStart || null,
        end: window.end || window.windowEnd || null,
        startMs,
        endMs,
        valid: Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < endMs
      };
    })
    .filter((window) => window.valid)
    .sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
}

function deriveLifecycleRunControl(job, runtimeHandoff, source = {}, capabilities = []) {
  const now = parseRunControlInstant(source.now || runtimeHandoff.now || runtimeHandoff.requestedAt) ?? 0;
  const supportedModes = normalizeList(source.supportedModes || ["manual", "immediate", "windowed"]);
  const requestedMode = source.mode || runtimeHandoff.startMode || runtimeHandoff.scheduleMode || "manual";
  const modeSupported = supportedModes.includes(requestedMode);
  const freezeWindows = normalizeRunControlWindows(source.freezeWindows || runtimeHandoff.freezeWindows || []);
  const activeFreezeWindow = freezeWindows.find((window) => (
    now > 0 && window.startMs <= now && now < window.endMs
  )) || null;
  const maxConcurrentJobs = Number.isInteger(source.maxConcurrentJobs) && source.maxConcurrentJobs > 0
    ? source.maxConcurrentJobs
    : Number.isInteger(runtimeHandoff.maxConcurrentJobs) && runtimeHandoff.maxConcurrentJobs > 0
      ? runtimeHandoff.maxConcurrentJobs
      : capabilities.length || 1;
  const requestedConcurrency = Number.isInteger(source.requestedConcurrency) && source.requestedConcurrency > 0
    ? source.requestedConcurrency
    : Number.isInteger(runtimeHandoff.requestedConcurrency) && runtimeHandoff.requestedConcurrency > 0
      ? runtimeHandoff.requestedConcurrency
      : Math.max(1, capabilities.filter((capability) => capability.providerOperation?.externalWrite === true).length);
  const concurrencyExceeded = requestedConcurrency > maxConcurrentJobs;
  const ready = modeSupported && !activeFreezeWindow && !concurrencyExceeded;
  const status = ready
    ? "ready"
    : modeSupported === false || concurrencyExceeded
      ? "blocked"
      : "needs-operator-action";
  const nextAction = modeSupported === false
    ? "select-supported-mailchimp-run-control-mode"
    : concurrencyExceeded
      ? "reduce-mailchimp-runtime-concurrency"
      : activeFreezeWindow
        ? "wait-for-mailchimp-run-control-window"
        : "handoff-to-runtime-adapter";
  return {
    schemaVersion: "aios.mailchimp.lifecycle-run-control.v1",
    status,
    ready,
    requestedMode,
    supportedModes,
    now: source.now || runtimeHandoff.now || runtimeHandoff.requestedAt || null,
    activeFreezeWindow: activeFreezeWindow ? {
      id: activeFreezeWindow.id,
      reason: activeFreezeWindow.reason,
      start: activeFreezeWindow.start,
      end: activeFreezeWindow.end
    } : null,
    freezeWindows: freezeWindows.map((window) => ({
      id: window.id,
      reason: window.reason,
      start: window.start,
      end: window.end
    })),
    concurrency: {
      requested: requestedConcurrency,
      max: maxConcurrentJobs,
      exceeded: concurrencyExceeded
    },
    disableReason: modeSupported === false
      ? "unsupported-run-control-mode"
      : concurrencyExceeded
        ? "run-control-concurrency-exceeded"
        : activeFreezeWindow
          ? "run-control-freeze-window"
          : null,
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
  if (lifecycleControls.runControl?.activeFreezeWindow) {
    diagnostics.push(lifecycleDiagnostic(
      "runControl.freezeWindows",
      "lifecycle.runControl.frozen",
      "Mailchimp runtime start is inside an operator freeze window.",
      "warning",
      { freezeWindowId: lifecycleControls.runControl.activeFreezeWindow.id }
    ));
  }
  if (lifecycleControls.runControl?.concurrency?.exceeded) {
    diagnostics.push(lifecycleDiagnostic(
      "runControl.concurrency",
      "lifecycle.runControl.concurrencyExceeded",
      "Mailchimp runtime concurrency exceeds the lifecycle run-control limit.",
      "error",
      {
        requestedConcurrency: lifecycleControls.runControl.concurrency.requested,
        maxConcurrentJobs: lifecycleControls.runControl.concurrency.max
      }
    ));
  }
  if (lifecycleControls.runControl && lifecycleControls.runControl.supportedModes.includes(lifecycleControls.runControl.requestedMode) === false) {
    diagnostics.push(lifecycleDiagnostic(
      "runControl.mode",
      "lifecycle.runControl.modeUnsupported",
      `Mailchimp run-control mode '${lifecycleControls.runControl.requestedMode}' is not supported.`,
      "error",
      { requestedMode: lifecycleControls.runControl.requestedMode }
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

function deriveClientCommandLeaseReplayHandoff(job, status, clientCommandLeases, statusHandoff) {
  const leases = Array.isArray(clientCommandLeases.leases) ? clientCommandLeases.leases : [];
  const blockedLeases = leases.filter((lease) => lease.blocksRuntimeStart === true || lease.status === "blocked");
  const ackLeases = leases.filter((lease) => lease.ackRequired === true || lease.ack?.required === true);
  const replayRows = leases.map((lease) => ({
    leaseId: lease.id,
    jobId: lease.jobId || job.id,
    commandId: lease.commandId || null,
    status: lease.status || clientCommandLeases.leaseStatus || status,
    visibleStatus: lease.visibleStatus || lease.statusProjection?.visible || statusHandoff.visibleStatus || status,
    nextAction: lease.nextAction || clientCommandLeases.primaryAction || "review-client-command-lease",
    ackRequired: lease.ackRequired === true || lease.ack?.required === true,
    ackKey: lease.ackKey || lease.ack?.nextAckKey || null,
    blocksRuntimeStart: lease.blocksRuntimeStart === true || lease.status === "blocked",
    replayCursor: lease.replay?.replayCursor
      || lease.replayCursor
      || statusHandoff.statusLedger?.resumeToken
      || null,
    replayDecision: lease.replay?.replayDecision || lease.replayDecision || "return-existing-status",
    idempotencyKey: lease.replay?.idempotencyKey
      || lease.idempotencyKey
      || statusHandoff.route?.idempotencyKey
      || statusHandoff.statusLedger?.statusRevision
      || null,
    restartSafe: lease.statusProjection?.restartSafe !== false
      && (statusHandoff.restartContract?.replaySafe !== false)
  }));
  const unsafeRows = replayRows.filter((row) => !row.replayCursor || (!row.idempotencyKey && row.ackRequired !== true));
  const readyForRuntime = blockedLeases.length === 0 && unsafeRows.length === 0;
  const handoffStatus = blockedLeases.length > 0
    ? "blocked"
    : ackLeases.length > 0
      ? "waiting-for-client-ack"
      : readyForRuntime
        ? "ready"
        : "review";
  const routeId = `${job.id}:client-command-lease-replay:${handoffStatus}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const resumeToken = clientCommandLeases.resumeToken
    || statusHandoff.statusLedger?.resumeToken
    || `${job.id}:client-command-lease-replay`;
  const ackKeys = clientCommandLeases.ack?.keys
    || clientCommandLeases.clientAck?.ackKeys
    || ackLeases.map((lease) => lease.ackKey || lease.ack?.nextAckKey).filter(Boolean);
  const nextAction = blockedLeases[0]?.nextAction
    || ackLeases[0]?.nextAction
    || clientCommandLeases.primaryAction
    || (readyForRuntime ? "resume-command-lease-replay" : "refresh-client-command-lease-replay");

  return {
    schemaVersion: "aios.mailchimp.client-command-lease-replay-handoff.v1",
    provider: "mailchimp",
    jobId: job.id,
    routeId,
    status: handoffStatus,
    readyForClient: handoffStatus !== "blocked",
    readyForRuntime,
    resumeToken,
    primaryLeaseId: clientCommandLeases.primaryLeaseId || replayRows[0]?.leaseId || null,
    nextAction,
    ack: {
      required: ackLeases.length > 0 || clientCommandLeases.clientAck?.required === true,
      keys: ackKeys,
      nextAckKey: clientCommandLeases.ack?.nextAckKey
        || clientCommandLeases.clientAck?.nextAckKey
        || ackKeys[0]
        || null,
      requiredCount: clientCommandLeases.ack?.requiredCount
        || clientCommandLeases.clientAck?.requiredCount
        || ackLeases.length
    },
    routePayload: {
      routeId,
      resumeToken,
      idempotencyKey: `${job.id}:${routeId}:${resumeToken}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      externalWritesPerformed: false
    },
    validationSummary: {
      total: replayRows.length,
      blocked: blockedLeases.length,
      waitingForAck: ackLeases.length,
      restartUnsafe: unsafeRows.length,
      ready: replayRows.length - unsafeRows.length,
      blockedLeaseIds: blockedLeases.map((lease) => lease.id).filter(Boolean),
      ackLeaseIds: ackLeases.map((lease) => lease.id).filter(Boolean),
      unsafeLeaseIds: unsafeRows.map((row) => row.leaseId).filter(Boolean)
    },
    rows: replayRows,
    clientPatch: {
      commandLeaseReplayHandoffStatus: handoffStatus,
      commandLeaseReplayHandoffRouteId: routeId,
      commandLeaseReplayHandoffReady: readyForRuntime,
      commandLeaseReplayHandoffNextAction: nextAction,
      commandLeaseReplayResumeToken: resumeToken,
      commandLeaseReplayAckRequired: ackLeases.length > 0,
      commandLeaseReplayBlockedLeaseIds: blockedLeases.map((lease) => lease.id).filter(Boolean)
    },
    restartSemantics: {
      replaySafe: readyForRuntime,
      duplicateCommandPolicy: "dedupe-by-command-lease-replay-handoff-route",
      resumeToken,
      resumeFromLeaseId: clientCommandLeases.primaryLeaseId || replayRows[0]?.leaseId || null,
      externalWritesPerformed: false
    }
  };
}

function deriveClientRuntimeSettings(job, runtimeHandoff, lifecycleControls, adoption, options = {}) {
  const clientContract = runtimeHandoff.clientContract || {};
  const configuredSettings = normalizeClientState(
    options.clientRuntimeSettings
      || options.currentClientSettings
      || clientContract.currentSettings
      || runtimeHandoff.clientSettings
  );
  const requiredSettingKeys = normalizeList(
    clientContract.requiredSettings
      || runtimeHandoff.requiredClientSettings
      || []
  );
  const derivedSettings = {
    previewEnabled: lifecycleControls.preview?.enabled === true,
    runtimeStartEnabled: lifecycleControls.runtimeStart?.enabled === true,
    schedulePaused: lifecycleControls.schedule?.paused === true,
    scheduleWindow: lifecycleControls.schedule?.requestedWindow || runtimeHandoff.scheduleWindow || "runtime"
  };
  const effectiveSettings = {
    ...derivedSettings,
    ...configuredSettings
  };
  const providedSettingKeys = normalizeList(Object.keys(configuredSettings));
  const effectiveSettingKeys = normalizeList(Object.keys(effectiveSettings));
  const missingRequiredSettings = requiredSettingKeys
    .filter((key) => effectiveSettingKeys.includes(key) === false);
  const requestedRevision = String(
    options.clientSettingsRevision
      || configuredSettings.settingsRevision
      || clientContract.settingsRevision
      || `${job.id}:${effectiveSettings.scheduleWindow}:${effectiveSettings.previewEnabled}:${effectiveSettings.runtimeStartEnabled}`
  ).replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const acceptedRevision = options.acceptedClientSettingsRevision
    || configuredSettings.acceptedSettingsRevision
    || clientContract.acceptedSettingsRevision
    || null;
  const revisionAccepted = acceptedRevision == null || acceptedRevision === requestedRevision;
  const scheduleSupported = lifecycleControls.schedule?.supported !== false;
  const runtimeStartBlocked = effectiveSettings.runtimeStartEnabled === true
    && lifecycleControls.runtimeStart?.enabled === false;
  const readyForClientRuntime = missingRequiredSettings.length === 0
    && revisionAccepted
    && scheduleSupported
    && runtimeStartBlocked === false
    && adoption.readyForClientRuntime === true;
  const status = scheduleSupported === false || runtimeStartBlocked
    ? "blocked"
    : readyForClientRuntime
      ? "ready"
      : missingRequiredSettings.length > 0 || revisionAccepted === false
        ? "needs-operator-action"
        : adoption.status || "waiting-for-client";
  const nextAction = scheduleSupported === false
    ? "select-supported-schedule-window"
    : runtimeStartBlocked
      ? "accept-preview-before-runtime-start"
      : missingRequiredSettings.length > 0
        ? "hydrate-mailchimp-client-runtime-settings"
        : revisionAccepted === false
          ? "accept-mailchimp-client-settings"
          : adoption.nextAction || "handoff-to-runtime-adapter";

  return {
    schemaVersion: "aios.mailchimp.client-runtime-settings.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    settingsRevision: requestedRevision,
    acceptedSettingsRevision: acceptedRevision,
    revisionAccepted,
    readyForClientRuntime,
    requiredSettingKeys,
    providedSettingKeys,
    missingRequiredSettings,
    effectiveSettings,
    controls: {
      previewEnabled: effectiveSettings.previewEnabled === true,
      runtimeStartEnabled: effectiveSettings.runtimeStartEnabled === true,
      schedulePaused: effectiveSettings.schedulePaused === true,
      scheduleWindow: effectiveSettings.scheduleWindow,
      scheduleSupported,
      runtimeStartBlocked
    },
    adoption: {
      adoptionId: adoption.adoptionId || null,
      status: adoption.status || "unknown",
      readyForClientRuntime: adoption.readyForClientRuntime === true,
      missingStateKeys: adoption.missingStateKeys || [],
      pendingAckKeys: adoption.commandAck?.pendingKeys || []
    },
    validationSummary: {
      total: requiredSettingKeys.length + 4,
      missingRequiredSettings: missingRequiredSettings.length,
      revisionAccepted,
      scheduleSupported,
      runtimeStartBlocked,
      adoptionReady: adoption.readyForClientRuntime === true
    },
    clientPatch: {
      mailchimpClientSettingsRevision: requestedRevision,
      mailchimpClientSettingsAccepted: revisionAccepted,
      mailchimpClientSettingsStatus: status,
      mailchimpClientSettingsNextAction: nextAction,
      mailchimpRuntimeStartEnabled: effectiveSettings.runtimeStartEnabled === true,
      mailchimpScheduleWindow: effectiveSettings.scheduleWindow,
      mailchimpSchedulePaused: effectiveSettings.schedulePaused === true
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-settings-revision",
      resumeFromSettingsRevision: requestedRevision,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function clientRuntimeSettingsDiagnostic(field, code, message, severity = "warning", extras = {}) {
  return {
    severity,
    code,
    field,
    message,
    source: "client-runtime-settings",
    ...extras
  };
}

function clientRuntimeSettingsDiagnostics(settings) {
  const diagnostics = [];
  for (const key of settings.missingRequiredSettings) {
    diagnostics.push(clientRuntimeSettingsDiagnostic(
      "clientRuntimeSettings",
      "client.settings.required.missing",
      `Mailchimp client runtime settings are missing required key '${key}'.`,
      "warning",
      { requiredSettingKey: key }
    ));
  }
  if (settings.revisionAccepted === false) {
    diagnostics.push(clientRuntimeSettingsDiagnostic(
      "clientSettingsRevision",
      "client.settings.revision.stale",
      "Mailchimp client runtime settings revision has not been accepted by the client.",
      "warning",
      { settingsRevision: settings.settingsRevision }
    ));
  }
  if (settings.controls.scheduleSupported === false) {
    diagnostics.push(clientRuntimeSettingsDiagnostic(
      "scheduleWindow",
      "client.settings.schedule.unsupported",
      `Mailchimp client settings requested unsupported schedule window '${settings.controls.scheduleWindow}'.`,
      "error",
      { requestedWindow: settings.controls.scheduleWindow }
    ));
  }
  if (settings.controls.runtimeStartBlocked === true) {
    diagnostics.push(clientRuntimeSettingsDiagnostic(
      "runtimeStartEnabled",
      "client.settings.runtimeStart.blocked",
      "Mailchimp client settings request runtime start while lifecycle controls still block it.",
      "error"
    ));
  }
  return diagnostics;
}

function deriveSettingsRolloutGate(job, runtimeHandoff, lifecycleControls, clientRuntimeSettings, options = {}) {
  const rolloutSource = runtimeHandoff.settingsRollout
    || runtimeHandoff.clientSettingsRollout
    || {};
  const optionRollout = options.clientSettingsRollout
    || options.settingsRollout
    || {};
  const rolloutEnabled = optionRollout.enabled ?? rolloutSource.enabled ?? true;
  const rolloutHeld = optionRollout.held === true || rolloutSource.held === true;
  const acknowledgedRevision = optionRollout.acknowledgedRevision
    || optionRollout.acceptedRevision
    || rolloutSource.acknowledgedRevision
    || rolloutSource.acceptedRevision
    || clientRuntimeSettings.acceptedSettingsRevision
    || null;
  const requestedRevision = clientRuntimeSettings.settingsRevision || "unversioned";
  const revisionAcknowledged = acknowledgedRevision == null || acknowledgedRevision === requestedRevision;
  const rolloutWindow = optionRollout.window
    || rolloutSource.window
    || lifecycleControls.schedule?.requestedWindow
    || "runtime";
  const allowedWindows = normalizeList(
    optionRollout.allowedWindows
      || rolloutSource.allowedWindows
      || lifecycleControls.schedule?.allowedWindows
      || ["preflight", "runtime"]
  );
  const windowOpen = lifecycleControls.schedule?.paused !== true
    && lifecycleControls.schedule?.supported !== false
    && (allowedWindows.length === 0 || allowedWindows.includes(rolloutWindow));
  const runtimeStartAllowed = lifecycleControls.runtimeStart?.enabled === true
    && clientRuntimeSettings.controls?.runtimeStartBlocked !== true;
  const settingsReady = clientRuntimeSettings.status !== "blocked"
    && clientRuntimeSettings.missingRequiredSettings.length === 0
    && clientRuntimeSettings.revisionAccepted !== false;
  const checkpoints = [
    {
      id: "settings-required-values",
      label: "Required settings are present",
      ready: clientRuntimeSettings.missingRequiredSettings.length === 0,
      required: true,
      nextAction: "hydrate-mailchimp-client-runtime-settings",
      diagnosticCode: "client.settings.required.missing",
      evidence: {
        missingRequiredSettings: clientRuntimeSettings.missingRequiredSettings || []
      }
    },
    {
      id: "settings-revision-accepted",
      label: "Settings revision is accepted",
      ready: clientRuntimeSettings.revisionAccepted !== false && revisionAcknowledged,
      required: true,
      nextAction: "accept-mailchimp-client-settings",
      diagnosticCode: "client.settings.rollout.revision.pending",
      evidence: {
        requestedRevision,
        acceptedSettingsRevision: clientRuntimeSettings.acceptedSettingsRevision || null,
        acknowledgedRevision
      }
    },
    {
      id: "settings-rollout-window",
      label: "Rollout window is open",
      ready: windowOpen,
      required: true,
      nextAction: lifecycleControls.schedule?.supported === false
        ? "select-supported-schedule-window"
        : "resume-mailchimp-schedule",
      diagnosticCode: "client.settings.rollout.window.closed",
      evidence: {
        rolloutWindow,
        allowedWindows,
        schedulePaused: lifecycleControls.schedule?.paused === true,
        scheduleSupported: lifecycleControls.schedule?.supported !== false
      }
    },
    {
      id: "settings-rollout-hold",
      label: "Settings rollout is not held",
      ready: rolloutEnabled === true && rolloutHeld === false,
      required: true,
      nextAction: rolloutEnabled === true
        ? "release-mailchimp-settings-rollout"
        : "hydrate-mailchimp-client-runtime-settings",
      diagnosticCode: "client.settings.rollout.held",
      evidence: {
        rolloutEnabled,
        rolloutHeld,
        holdReason: optionRollout.holdReason || rolloutSource.holdReason || null
      }
    },
    {
      id: "settings-runtime-start",
      label: "Runtime start controls accept settings",
      ready: runtimeStartAllowed,
      required: true,
      nextAction: "accept-preview-before-runtime-start",
      diagnosticCode: "client.settings.runtimeStart.blocked",
      evidence: {
        runtimeStartEnabled: lifecycleControls.runtimeStart?.enabled === true,
        runtimeStartBlocked: clientRuntimeSettings.controls?.runtimeStartBlocked === true
      }
    }
  ].map((checkpoint, index) => ({
    ...checkpoint,
    id: `${job.id}.settingsRollout.${String(index + 1).padStart(2, "0")}.${checkpoint.id}`
      .replace(/[^a-zA-Z0-9_.-]/g, "_"),
    gateId: checkpoint.id,
    order: index + 1,
    state: checkpoint.ready ? "ready" : "blocked"
  }));
  const blocked = checkpoints.filter((checkpoint) => checkpoint.required && checkpoint.ready !== true);
  const ready = blocked.length === 0 && settingsReady;
  const nextCheckpoint = blocked[0] || checkpoints.find((checkpoint) => checkpoint.ready !== true) || null;
  const rolloutKey = `${job.id}:settings-rollout:${requestedRevision}:${rolloutWindow}:${ready ? "ready" : "blocked"}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.settings-rollout-gate.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: ready ? "ready" : "blocked",
    readyForRuntimeStart: ready,
    rolloutKey,
    settingsRevision: requestedRevision,
    acknowledgedRevision,
    revisionAcknowledged,
    rolloutWindow,
    enabled: rolloutEnabled === true,
    held: rolloutHeld,
    nextAction: ready
      ? "handoff-to-runtime-adapter"
      : nextCheckpoint?.nextAction || clientRuntimeSettings.nextAction || "accept-mailchimp-client-settings",
    nextGateId: nextCheckpoint?.gateId || null,
    checkpoints,
    counters: {
      total: checkpoints.length,
      ready: checkpoints.filter((checkpoint) => checkpoint.ready).length,
      blocked: blocked.length
    },
    clientPatch: {
      mailchimpSettingsRolloutStatus: ready ? "ready" : "blocked",
      mailchimpSettingsRolloutReady: ready,
      mailchimpSettingsRolloutKey: rolloutKey,
      mailchimpSettingsRolloutNextAction: ready
        ? "handoff-to-runtime-adapter"
        : nextCheckpoint?.nextAction || clientRuntimeSettings.nextAction || "accept-mailchimp-client-settings",
      mailchimpSettingsRolloutNextGateId: nextCheckpoint?.gateId || null,
      mailchimpSettingsRolloutBlockedGateIds: blocked.map((checkpoint) => checkpoint.gateId)
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-settings-rollout-key",
      resumeFromRolloutKey: rolloutKey,
      externalWritesPerformed: false
    }
  };
}

function settingsRolloutGateDiagnostics(gate) {
  return (gate.checkpoints || [])
    .filter((checkpoint) => checkpoint.required && checkpoint.ready !== true)
    .map((checkpoint) => ({
      severity: checkpoint.diagnosticCode === "client.settings.runtimeStart.blocked" ? "error" : "warning",
      code: checkpoint.diagnosticCode,
      field: "settingsRolloutGate",
      message: `Mailchimp settings rollout gate '${checkpoint.gateId}' is ${checkpoint.state}.`,
      source: "settings-rollout-gate",
      gateId: checkpoint.gateId
    }));
}

function deriveClientStatusHandoff(job, runtimeHandoff, status, statusHandoff, clientRuntimeAdoption, clientRuntimeSettings, options = {}) {
  const clientContract = runtimeHandoff.clientContract || {};
  const optionStatus = options.clientStatusHandoff || {};
  const clientState = normalizeClientState(
    options.clientRuntimeState
      || options.currentClientState
      || clientContract.currentState
      || runtimeHandoff.clientState
  );
  const statusLedger = statusHandoff.statusLedger || {};
  const commandAck = clientRuntimeAdoption.commandAck || {};
  const requiredAckKeys = normalizeList(commandAck.requiredKeys || statusHandoff.clientCommandAck?.ackKeys || []);
  const pendingAckKeys = normalizeList(commandAck.pendingKeys || []);
  const resumeToken = statusLedger.resumeToken
    || clientRuntimeAdoption.resume?.resumeToken
    || clientState.resumeToken
    || clientContract.resumeToken
    || null;
  const statusRevision = statusLedger.statusRevision
    || clientRuntimeAdoption.resume?.statusRevision
    || clientState.statusRevision
    || clientContract.statusRevision
    || null;
  const acceptedRevision = optionStatus.acceptedStatusRevision
    || clientState.acceptedStatusRevision
    || clientContract.acceptedStatusRevision
    || null;
  const revisionAccepted = acceptedRevision == null || acceptedRevision === statusRevision;
  const resumeReady = Boolean(resumeToken && statusRevision);
  const runtimeBlocked = status === "blocked"
    || statusHandoff.adapterRecovery?.mode === "blocked"
    || clientRuntimeSettings.status === "blocked";
  const statusId = `${job.id}:client-status:${status}:${statusRevision || "missing"}:${pendingAckKeys.join("|")}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const routeId = optionStatus.routeId
    || `${job.id}:client-status-route:${clientRuntimeAdoption.adoptionId || "adoption"}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = runtimeBlocked
    ? "repair-client-runtime-status-handoff"
    : resumeReady === false
      ? "restore-mailchimp-runtime-resume-token"
      : revisionAccepted === false
        ? "refresh-mailchimp-client-status"
        : pendingAckKeys.length > 0
          ? "acknowledge-mailchimp-client-command"
          : clientRuntimeSettings.nextAction || clientRuntimeAdoption.nextAction || "handoff-to-runtime-adapter";
  const readyForClient = runtimeBlocked === false
    && resumeReady
    && clientRuntimeAdoption.readyForClientRuntime === true
    && clientRuntimeSettings.readyForClientRuntime === true;
  const readyForRuntime = readyForClient
    && revisionAccepted
    && pendingAckKeys.length === 0
    && statusHandoff.restartContract?.replaySafe === true;
  const visibleStatus = runtimeBlocked
    ? "client-runtime-blocked"
    : resumeReady === false
      ? "client-status-resume-missing"
      : revisionAccepted === false
        ? "client-status-stale"
        : pendingAckKeys.length > 0
          ? "client-command-ack-pending"
          : readyForRuntime
            ? "client-runtime-ready"
            : "client-runtime-waiting";

  return {
    schemaVersion: "aios.mailchimp.client-status-handoff.v1",
    provider: "mailchimp",
    jobId: job.id,
    statusId,
    status: runtimeBlocked
      ? "blocked"
      : readyForRuntime
        ? "ready"
        : revisionAccepted === false || pendingAckKeys.length > 0
          ? "waiting-for-client"
          : clientRuntimeSettings.status || clientRuntimeAdoption.status || "waiting-for-client",
    visibleStatus,
    readyForClient,
    readyForRuntime,
    nextAction,
    route: {
      routeId,
      method: "PATCH",
      path: `/mailchimp/jobs/${job.id}/client-status`,
      idempotencyKey: `${routeId}:${statusRevision || "missing"}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      bodyShape: {
        statusRevision: "string",
        acceptedStatusRevision: "string",
        acknowledgedCommandKeys: "array",
        resumeToken: "string"
      }
    },
    statusLedger: {
      resumeToken,
      statusRevision,
      acceptedStatusRevision: acceptedRevision,
      revisionAccepted,
      readinessStatus: statusLedger.readinessStatus || status,
      visibleStatus
    },
    adoption: {
      adoptionId: clientRuntimeAdoption.adoptionId,
      status: clientRuntimeAdoption.status,
      readyForClientRuntime: clientRuntimeAdoption.readyForClientRuntime === true,
      missingStateKeys: clientRuntimeAdoption.missingStateKeys || []
    },
    settings: {
      settingsRevision: clientRuntimeSettings.settingsRevision,
      status: clientRuntimeSettings.status,
      readyForClientRuntime: clientRuntimeSettings.readyForClientRuntime === true,
      revisionAccepted: clientRuntimeSettings.revisionAccepted !== false,
      missingRequiredSettings: clientRuntimeSettings.missingRequiredSettings || []
    },
    commandAck: {
      required: commandAck.required === true || pendingAckKeys.length > 0,
      requiredKeys: requiredAckKeys,
      pendingKeys: pendingAckKeys,
      acknowledgedKeys: commandAck.acknowledgedKeys || [],
      ready: pendingAckKeys.length === 0
    },
    blocking: {
      runtimeBlocked,
      resumeMissing: resumeReady === false,
      staleRevision: revisionAccepted === false,
      pendingAckKeys,
      missingStateKeys: clientRuntimeAdoption.missingStateKeys || [],
      missingRequiredSettings: clientRuntimeSettings.missingRequiredSettings || []
    },
    clientPatch: {
      mailchimpClientStatusId: statusId,
      mailchimpClientVisibleStatus: visibleStatus,
      mailchimpClientStatusRouteId: routeId,
      mailchimpClientStatusRevision: statusRevision,
      mailchimpClientStatusAccepted: revisionAccepted,
      mailchimpClientStatusReady: readyForClient,
      mailchimpClientRuntimeReady: readyForRuntime,
      mailchimpClientStatusNextAction: nextAction,
      mailchimpClientPendingAckKeys: pendingAckKeys
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-status-route-id",
      resumeFromStatusId: statusId,
      externalWritesPerformed: false
    }
  };
}

function clientStatusHandoffDiagnostics(handoff) {
  const diagnostics = [];
  if (handoff.blocking.runtimeBlocked) {
    diagnostics.push(clientRuntimeSettingsDiagnostic(
      "clientStatusHandoff",
      "client.status.runtime.blocked",
      "Mailchimp client status handoff is blocked by runtime readiness.",
      "error",
      { source: "client-status-handoff" }
    ));
  }
  if (handoff.blocking.resumeMissing) {
    diagnostics.push(clientRuntimeSettingsDiagnostic(
      "clientStatusHandoff",
      "client.status.resume.missing",
      "Mailchimp client status handoff requires a resume token and status revision.",
      "warning",
      { source: "client-status-handoff" }
    ));
  }
  if (handoff.blocking.staleRevision) {
    diagnostics.push(clientRuntimeSettingsDiagnostic(
      "clientStatusHandoff",
      "client.status.revision.stale",
      "Mailchimp client status revision has not been accepted by the client runtime.",
      "warning",
      { source: "client-status-handoff", statusRevision: handoff.statusLedger.statusRevision }
    ));
  }
  for (const ackKey of handoff.commandAck.pendingKeys) {
    diagnostics.push(clientRuntimeSettingsDiagnostic(
      "clientStatusHandoff",
      "client.status.ack.pending",
      `Mailchimp client status handoff is waiting on command acknowledgement '${ackKey}'.`,
      "warning",
      { source: "client-status-handoff", ackKey }
    ));
  }
  return diagnostics;
}

function releaseControlId(jobId, gate, index) {
  return `${jobId}.releaseControl.${String(index + 1).padStart(2, "0")}.${gate.id}`
    .replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function deriveRuntimeReleaseControls(
  job,
  runtimeHandoff,
  providerServiceContract,
  providerSyncCheckpoint,
  lifecycleControls,
  clientRuntimeSettings,
  settingsRolloutGate,
  clientStatusHandoff,
  clientCommandLeases
) {
  const releaseSource = runtimeHandoff.releaseControls || {};
  const acknowledgedGateIds = normalizeList(releaseSource.acknowledgedGateIds || []);
  const forcedHoldGateIds = normalizeList(releaseSource.holdGateIds || []);
  const providerReady = providerServiceContract.externalHandoff?.ready === true
    && providerServiceContract.status === "ready"
    && providerSyncCheckpoint.ready === true;
  const lifecycleReady = lifecycleControls.runtimeStart?.enabled === true
    && lifecycleControls.schedule?.paused !== true
    && lifecycleControls.status !== "blocked";
  const settingsReady = clientRuntimeSettings.readyForClientRuntime === true
    && clientRuntimeSettings.revisionAccepted !== false
    && (clientRuntimeSettings.missingRequiredSettings || []).length === 0;
  const settingsRolloutReady = settingsRolloutGate.readyForRuntimeStart === true
    && settingsRolloutGate.status !== "blocked";
  const pendingAckKeys = normalizeList([
    ...(clientStatusHandoff.commandAck?.pendingKeys || []),
    ...(clientCommandLeases.clientAck?.ackKeys || [])
  ]);
  const clientAckReady = pendingAckKeys.length === 0
    && clientStatusHandoff.commandAck?.required !== true
    && clientCommandLeases.clientAck?.required !== true;
  const statusReady = clientStatusHandoff.readyForRuntime === true
    && clientStatusHandoff.status !== "blocked"
    && Boolean(clientStatusHandoff.route?.idempotencyKey);
  const gates = [
    {
      id: "provider-service-and-sync",
      label: "Provider service and sync checkpoint",
      owner: "adapter",
      ready: providerReady,
      required: true,
      nextAction: providerServiceContract.externalHandoff?.ready === false
        ? providerServiceContract.nextAction || "repair-provider-release-controls"
        : providerSyncCheckpoint.nextAction || "handoff-to-runtime-adapter",
      diagnosticCode: "release.controls.provider.blocked",
      evidence: {
        providerServiceStatus: providerServiceContract.status || "unknown",
        providerHandoffReady: providerServiceContract.externalHandoff?.ready === true,
        providerSyncReady: providerSyncCheckpoint.ready === true,
        missingAckMounts: providerSyncCheckpoint.missingAckMounts || [],
        missingWatermarkMounts: providerSyncCheckpoint.missingWatermarkMounts || []
      }
    },
    {
      id: "lifecycle-runtime-start",
      label: "Lifecycle runtime start controls",
      owner: "operator",
      ready: lifecycleReady,
      required: true,
      nextAction: lifecycleControls.nextAction || "enable-mailchimp-runtime-start-control",
      diagnosticCode: "release.controls.lifecycle.blocked",
      evidence: {
        lifecycleStatus: lifecycleControls.status || "unknown",
        runtimeStartEnabled: lifecycleControls.runtimeStart?.enabled === true,
        schedulePaused: lifecycleControls.schedule?.paused === true,
        scheduleWindow: lifecycleControls.schedule?.requestedWindow || runtimeHandoff.scheduleWindow || "runtime"
      }
    },
    {
      id: "client-runtime-settings",
      label: "Client runtime settings revision",
      owner: "client-runtime",
      ready: settingsReady && settingsRolloutReady,
      required: true,
      nextAction: settingsRolloutGate.nextAction || clientRuntimeSettings.nextAction || "accept-mailchimp-client-settings",
      diagnosticCode: "release.controls.settings.blocked",
      evidence: {
        settingsRevision: clientRuntimeSettings.settingsRevision || null,
        revisionAccepted: clientRuntimeSettings.revisionAccepted !== false,
        missingRequiredSettings: clientRuntimeSettings.missingRequiredSettings || [],
        settingsRolloutStatus: settingsRolloutGate.status || "unknown",
        settingsRolloutReady,
        settingsRolloutBlockedGateIds: settingsRolloutGate.clientPatch?.mailchimpSettingsRolloutBlockedGateIds || []
      }
    },
    {
      id: "client-command-ack",
      label: "Client command acknowledgement",
      owner: "client-runtime",
      ready: clientAckReady,
      required: true,
      nextAction: "acknowledge-mailchimp-client-command",
      diagnosticCode: "release.controls.clientAck.pending",
      severity: "warning",
      evidence: {
        pendingAckKeys,
        clientStatusAckRequired: clientStatusHandoff.commandAck?.required === true,
        commandLeaseAckRequired: clientCommandLeases.clientAck?.required === true
      }
    },
    {
      id: "client-status-route",
      label: "Client status route handoff",
      owner: "client-runtime",
      ready: statusReady,
      required: true,
      nextAction: clientStatusHandoff.nextAction || "repair-client-runtime-status-handoff",
      diagnosticCode: "release.controls.status.blocked",
      evidence: {
        clientStatus: clientStatusHandoff.status || "unknown",
        readyForRuntime: clientStatusHandoff.readyForRuntime === true,
        routeId: clientStatusHandoff.route?.routeId || null,
        idempotencyKey: clientStatusHandoff.route?.idempotencyKey || null
      }
    }
  ].map((gate, index) => {
    const forcedHold = forcedHoldGateIds.includes(gate.id);
    const acknowledged = acknowledgedGateIds.includes(gate.id);
    const state = forcedHold
      ? "held"
      : gate.ready
        ? "ready"
        : gate.severity === "warning" && acknowledged
          ? "acknowledged"
          : gate.severity === "warning"
            ? "waiting"
            : "blocked";
    return {
      ...gate,
      id: releaseControlId(job.id, gate, index),
      gateId: gate.id,
      state,
      ready: state === "ready" || state === "acknowledged",
      held: forcedHold,
      acknowledged,
      order: index + 1
    };
  });
  const blockingGates = gates.filter((gate) => gate.required && gate.state === "blocked");
  const waitingGates = gates.filter((gate) => gate.state === "waiting" || gate.state === "held");
  const ready = blockingGates.length === 0
    && waitingGates.length === 0
    && runtimeHandoff.acceptedForRuntime === true;
  const status = blockingGates.length > 0
    ? "blocked"
    : waitingGates.length > 0 || runtimeHandoff.acceptedForRuntime !== true
      ? "needs-operator-action"
      : "ready";
  const nextGate = blockingGates[0] || waitingGates[0] || gates.find((gate) => gate.ready !== true) || null;
  const releaseKey = `${job.id}:release-controls:${status}:${gates.map((gate) => gate.gateId).join("|")}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.runtime-release-controls.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    readyForRuntimeStart: ready,
    acceptedForRuntime: runtimeHandoff.acceptedForRuntime === true,
    releaseKey,
    nextAction: ready
      ? "handoff-to-runtime-adapter"
      : nextGate?.nextAction || "review-runtime-release-controls",
    nextGateId: nextGate?.gateId || null,
    gates,
    counters: {
      total: gates.length,
      ready: gates.filter((gate) => gate.ready).length,
      blocked: blockingGates.length,
      waiting: waitingGates.length,
      held: gates.filter((gate) => gate.held).length
    },
    clientPatch: {
      runtimeReleaseControlsStatus: status,
      runtimeReleaseControlsReady: ready,
      runtimeReleaseControlsNextAction: ready
        ? "handoff-to-runtime-adapter"
        : nextGate?.nextAction || "review-runtime-release-controls",
      runtimeReleaseControlsNextGateId: nextGate?.gateId || null,
      runtimeReleaseBlockedGateIds: blockingGates.map((gate) => gate.gateId),
      runtimeReleaseWaitingGateIds: waitingGates.map((gate) => gate.gateId),
      runtimeReleaseKey: releaseKey
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-runtime-release-control-key",
      resumeFromReleaseKey: releaseKey,
      externalWritesPerformed: false
    }
  };
}

function runtimeReleaseControlDiagnostics(releaseControls) {
  return releaseControls.gates
    .filter((gate) => gate.required && gate.ready !== true)
    .map((gate) => ({
      severity: gate.severity || (gate.state === "blocked" ? "error" : "warning"),
      code: gate.diagnosticCode,
      field: "runtimeReleaseControls",
      message: `Mailchimp runtime release gate '${gate.gateId}' is ${gate.state}.`,
      source: "runtime-release-controls",
      gateId: gate.gateId
    }));
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

function buildPersistedStatusEnvelope(job, status, statusLedger, statusHandoff, recoveryCommands, failureState, clientCommandLeases) {
  const commands = Array.isArray(recoveryCommands.commands) ? recoveryCommands.commands : [];
  const leases = Array.isArray(clientCommandLeases.leases) ? clientCommandLeases.leases : [];
  const leaseByCommandId = new Map(
    leases
      .filter((lease) => lease.commandId)
      .map((lease) => [lease.commandId, lease])
  );
  const commandRows = commands.map((command, index) => {
    const lease = leaseByCommandId.get(command.id) || leases[index] || {};
    const blocked = command.blocksRuntimeStart === true || command.status === "blocked";
    const waiting = blocked === false && (
      command.required === true
      || lease.ackRequired === true
      || lease.status === "waiting"
    );
    const rowStatus = blocked ? "blocked" : waiting ? "waiting" : "ready";
    return {
      order: command.order || index + 1,
      commandId: command.id,
      command: command.command,
      status: rowStatus,
      commandStatus: command.status || "unknown",
      required: command.required === true,
      blocksRuntimeStart: blocked,
      nextAction: command.nextAction || statusHandoff.nextAction,
      idempotencyKey: command.idempotencyKey || null,
      resumeCursor: command.replayPolicy?.resumeCursor
        || command.replayCursor
        || recoveryCommands.restartCursor?.commandId
        || null,
      leaseId: lease.id || null,
      ackRequired: lease.ackRequired === true,
      ackKey: lease.ackKey || null,
      restartSafe: blocked === false
        && Boolean(command.idempotencyKey)
        && statusLedger.restartSafe?.replaySafe === true,
      owner: command.owner || lease.owner || "runtime-adapter",
      failureClass: command.retryPolicy?.failureClass || null
    };
  });
  const blockedRows = commandRows.filter((row) => row.status === "blocked");
  const waitingRows = commandRows.filter((row) => row.status === "waiting");
  const unsafeRows = commandRows.filter((row) => row.restartSafe === false);
  const envelopeStatus = blockedRows.length > 0 || failureState.mode === "blocked"
    ? "blocked"
    : waitingRows.length > 0 || failureState.mode === "degraded" || statusHandoff.handoffState === "waiting-for-client"
      ? "waiting"
      : "ready";
  const nextAction = blockedRows[0]?.nextAction
    || waitingRows[0]?.nextAction
    || failureState.adapterHandoff?.nextAction
    || statusHandoff.nextAction
    || "handoff-to-runtime-adapter";

  return {
    schemaVersion: "aios.mailchimp.persisted-status-envelope.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: envelopeStatus,
    compilerStatus: status,
    runtimeAdapter: statusLedger.runtimeAdapter,
    readyForRuntimeResume: envelopeStatus === "ready"
      && statusLedger.restartSafe?.replaySafe === true
      && unsafeRows.length === 0,
    readyForClientStatus: envelopeStatus !== "blocked",
    visibleStatus: statusHandoff.visibleStatus,
    resumeToken: statusLedger.resumeToken,
    statusRevision: statusLedger.statusRevision,
    persistedAtPhase: statusLedger.persistedAtPhase,
    nextAction,
    rows: commandRows,
    counters: {
      rows: commandRows.length,
      ready: commandRows.filter((row) => row.status === "ready").length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      restartUnsafe: unsafeRows.length,
      ackRequired: commandRows.filter((row) => row.ackRequired).length,
      retryableFailures: failureState.summary?.retryable || 0
    },
    blocking: {
      commandIds: blockedRows.map((row) => row.commandId).filter(Boolean),
      waitingCommandIds: waitingRows.map((row) => row.commandId).filter(Boolean),
      unsafeCommandIds: unsafeRows.map((row) => row.commandId).filter(Boolean),
      failureMode: failureState.mode,
      failureQueueLength: failureState.summary?.total || 0
    },
    routePayload: {
      method: "PUT",
      path: `/mailchimp/jobs/${job.id}/status-envelope`,
      idempotencyKey: `${job.id}:${statusLedger.statusRevision}:${statusLedger.resumeToken}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      bodyShape: {
        statusRevision: "string",
        resumeToken: "string",
        rows: "array",
        restartSemantics: "object"
      }
    },
    clientPatch: {
      mailchimpPersistedStatusEnvelopeStatus: envelopeStatus,
      mailchimpPersistedStatusEnvelopeReady: envelopeStatus === "ready" && unsafeRows.length === 0,
      mailchimpPersistedStatusEnvelopeRevision: statusLedger.statusRevision,
      mailchimpPersistedStatusEnvelopeResumeToken: statusLedger.resumeToken,
      mailchimpPersistedStatusEnvelopeNextAction: nextAction,
      mailchimpPersistedStatusEnvelopeBlockedCommandIds: blockedRows.map((row) => row.commandId).filter(Boolean)
    },
    restartSemantics: {
      replaySafe: envelopeStatus === "ready"
        && statusLedger.restartSafe?.replaySafe === true
        && unsafeRows.length === 0,
      duplicateCommandPolicy: statusLedger.restartSafe?.duplicateCommandPolicy || "dedupe-by-status-envelope-revision",
      resumeFromCommandId: statusLedger.restartSafe?.resumeFromCommandId || blockedRows[0]?.commandId || null,
      staleStatusPolicy: statusHandoff.restartContract?.staleStatusPolicy || {
        onRevisionMismatch: "reload-status-ledger",
        onMissingCommandJournal: "rebuild-recovery-commands",
        onMissingClientAck: "request-client-command-ack"
      },
      externalWritesPerformed: false
    },
    truthBoundary: {
      source: "diagnostic-emitter",
      deterministic: true,
      externalMailchimpStateVerified: false,
      externalWritesPerformed: false
    }
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

function buildRestartCheckpointManifest(job, statusHandoff, recoveryCommands, failureState, clientCommandLeases, statusRecoveryBundle) {
  const ledger = statusHandoff.statusLedger || {};
  const restart = statusHandoff.restartContract || {};
  const ack = statusHandoff.clientCommandAck || {};
  const adapterRecovery = statusHandoff.adapterRecovery || {};
  const commands = Array.isArray(recoveryCommands.commands) ? recoveryCommands.commands : [];
  const leases = Array.isArray(clientCommandLeases.leases) ? clientCommandLeases.leases : [];
  const failures = Array.isArray(failureState.queue) ? failureState.queue : [];
  const recoveryCheckpoints = Array.isArray(statusRecoveryBundle.checkpoints)
    ? statusRecoveryBundle.checkpoints
    : [];
  const primaryCommand = commands.find((command) => command.id === restart.resumeFromCommandId)
    || commands[0]
    || null;
  const primaryLease = leases.find((lease) => lease.id === ack.resumeFromLeaseId)
    || leases.find((lease) => lease.ackRequired)
    || leases[0]
    || null;
  const primaryFailure = failures.find((failure) => failure.id === adapterRecovery.resumeFromFailureId)
    || failures.find((failure) => failure.handoff?.blocksRuntimeStart)
    || failures[0]
    || null;
  const checkpointRows = [
    {
      id: `${job.id}.restart.status-ledger`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      phase: "status-ledger",
      source: "status-handoff",
      required: true,
      ready: Boolean(ledger.resumeToken && ledger.statusRevision),
      cursor: ledger.resumeToken || null,
      revision: ledger.statusRevision || null,
      replayPolicy: restart.duplicateCommandPolicy || "dedupe-by-idempotency-key",
      nextAction: ledger.resumeToken && ledger.statusRevision
        ? "load-status-ledger"
        : "rebuild-status-ledger"
    },
    {
      id: `${job.id}.restart.command-journal`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      phase: "command-journal",
      source: "recovery-commands",
      required: true,
      ready: commands.length > 0 && Boolean(primaryCommand?.idempotencyKey),
      cursor: primaryCommand?.id || restart.resumeFromCommandId || null,
      revision: primaryCommand?.idempotencyKey || null,
      replayPolicy: primaryCommand?.replayPolicy || restart.duplicateCommandPolicy || "dedupe-by-command-id",
      nextAction: commands.length > 0
        ? primaryCommand?.nextAction || recoveryCommands.restartCursor?.nextAction || "handoff-to-runtime-adapter"
        : "rebuild-recovery-commands"
    },
    {
      id: `${job.id}.restart.client-command-lease`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      phase: "client-command-lease",
      source: "client-command-leases",
      required: ack.required === true || clientCommandLeases.leaseStatus === "blocked",
      ready: ack.required !== true || Boolean(ack.nextAckKey || primaryLease?.ackKey),
      cursor: primaryLease?.id || ack.resumeFromLeaseId || null,
      revision: primaryLease?.leaseKey || primaryLease?.idempotencyKey || null,
      replayPolicy: primaryLease?.replayPolicy || clientCommandLeases.restartSemantics?.duplicateCommandPolicy || "dedupe-by-command-lease-key",
      nextAction: ack.required === true
        ? "request-client-command-ack"
        : primaryLease?.nextAction || "continue-runtime-handoff"
    },
    {
      id: `${job.id}.restart.adapter-failure`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      phase: "adapter-failure",
      source: "failure-state",
      required: adapterRecovery.mode === "blocked" || adapterRecovery.mode === "degraded",
      ready: adapterRecovery.mode !== "blocked",
      cursor: primaryFailure?.id || adapterRecovery.resumeFromFailureId || null,
      revision: primaryFailure?.handoff?.idempotencyKey || null,
      replayPolicy: primaryFailure?.handoff?.replayPolicy || "dedupe-by-idempotency-key",
      nextAction: adapterRecovery.nextAction || primaryFailure?.nextAction || "resume-from-failure-state"
    },
    {
      id: `${job.id}.restart.status-recovery-bundle`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      phase: "status-recovery-bundle",
      source: "status-recovery",
      required: true,
      ready: statusRecoveryBundle.restartSemantics?.replaySafe === true
        && Boolean(statusRecoveryBundle.resume?.resumeToken)
        && recoveryCheckpoints.every((checkpoint) => checkpoint.required !== true || checkpoint.ready === true),
      cursor: statusRecoveryBundle.resume?.resumeToken || ledger.resumeToken || null,
      revision: statusRecoveryBundle.resume?.statusRevision || ledger.statusRevision || null,
      replayPolicy: statusRecoveryBundle.restartSemantics?.duplicateCommandPolicy || "dedupe-by-idempotency-key",
      nextAction: statusRecoveryBundle.nextAction || "repair-status-recovery"
    }
  ];
  const missingRequired = checkpointRows
    .filter((checkpoint) => checkpoint.required && checkpoint.ready !== true)
    .map((checkpoint) => checkpoint.phase);
  const blockedRows = checkpointRows.filter((checkpoint) => checkpoint.required && checkpoint.ready !== true);
  const waitingRows = checkpointRows.filter((checkpoint) => checkpoint.required !== true && checkpoint.ready !== true);
  const readyForColdRestart = missingRequired.length === 0
    && restart.replaySafe === true
    && statusRecoveryBundle.restartSemantics?.externalWritesPerformed === false;
  const nextCheckpoint = blockedRows[0] || waitingRows[0] || checkpointRows.at(-1);

  return {
    schemaVersion: "aios.mailchimp.restart-checkpoint-manifest.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: readyForColdRestart
      ? "ready"
      : missingRequired.length > 0
        ? "blocked"
        : "waiting",
    readyForColdRestart,
    resumeToken: statusRecoveryBundle.resume?.resumeToken || ledger.resumeToken || `${job.id}:${statusHandoff.status}`,
    statusRevision: statusRecoveryBundle.resume?.statusRevision || ledger.statusRevision || `${job.id}:${statusHandoff.status}`,
    nextAction: readyForColdRestart
      ? restart.resumeAction || statusHandoff.nextAction || "handoff-to-runtime-adapter"
      : nextCheckpoint?.nextAction || "repair-restart-checkpoints",
    counters: {
      checkpoints: checkpointRows.length,
      required: checkpointRows.filter((checkpoint) => checkpoint.required).length,
      ready: checkpointRows.filter((checkpoint) => checkpoint.ready).length,
      missingRequired: missingRequired.length,
      commands: commands.length,
      leases: leases.length,
      failures: failures.length
    },
    checkpoints: checkpointRows.map((checkpoint, index) => ({
      order: index + 1,
      ...checkpoint,
      restartSafe: checkpoint.ready === true && Boolean(checkpoint.cursor || checkpoint.required === false)
    })),
    blocking: {
      missingRequiredCheckpoints: missingRequired,
      commandIds: commands.filter((command) => command.blocksRuntimeStart).map((command) => command.id),
      leaseIds: leases.filter((lease) => lease.blocksRuntimeStart || lease.ackRequired).map((lease) => lease.id),
      failureIds: failures.filter((failure) => failure.handoff?.blocksRuntimeStart).map((failure) => failure.id)
    },
    clientPatch: {
      restartCheckpointStatus: readyForColdRestart ? "ready" : missingRequired.length > 0 ? "blocked" : "waiting",
      restartCheckpointReady: readyForColdRestart,
      restartCheckpointNextAction: readyForColdRestart
        ? restart.resumeAction || statusHandoff.nextAction || "handoff-to-runtime-adapter"
        : nextCheckpoint?.nextAction || "repair-restart-checkpoints",
      restartCheckpointResumeToken: statusRecoveryBundle.resume?.resumeToken || ledger.resumeToken || null,
      restartCheckpointRevision: statusRecoveryBundle.resume?.statusRevision || ledger.statusRevision || null,
      restartCheckpointMissing: missingRequired
    },
    restartSemantics: {
      replaySafe: readyForColdRestart,
      duplicateCommandPolicy: restart.duplicateCommandPolicy || statusRecoveryBundle.restartSemantics?.duplicateCommandPolicy || "dedupe-by-idempotency-key",
      resumeFromCommandId: restart.resumeFromCommandId || recoveryCommands.restartCursor?.commandId || null,
      resumeFromLeaseId: ack.resumeFromLeaseId || clientCommandLeases.clientAck?.resumeFromLeaseId || null,
      resumeFromFailureId: adapterRecovery.resumeFromFailureId || failureState.adapterHandoff?.resumeFromFailureId || null,
      externalWritesPerformed: false,
      staleStatusPolicy: restart.staleStatusPolicy || statusRecoveryBundle.restartSemantics?.staleStatusPolicy || {}
    }
  };
}

function buildRestartReplayLedger(job, statusHandoff, recoveryCommands, failureState, clientCommandLeases, statusRecoveryBundle, restartCheckpointManifest) {
  const statusLedger = statusHandoff.statusLedger || {};
  const restartContract = statusHandoff.restartContract || {};
  const commands = Array.isArray(recoveryCommands.commands) ? recoveryCommands.commands : [];
  const leases = Array.isArray(clientCommandLeases.leases) ? clientCommandLeases.leases : [];
  const failures = Array.isArray(failureState.queue) ? failureState.queue : [];
  const checkpoints = Array.isArray(restartCheckpointManifest.checkpoints)
    ? restartCheckpointManifest.checkpoints
    : [];
  const replayRows = [
    ...commands.map((command, index) => ({
      id: `${job.id}.replay.command.${String(index + 1).padStart(2, "0")}.${command.command}`
        .replace(/[^a-zA-Z0-9_.-]/g, "_"),
      order: index + 1,
      kind: "recovery-command",
      sourceId: command.id,
      status: command.blocksRuntimeStart ? "blocked" : command.required ? "waiting" : "ready",
      replaySafe: Boolean(command.idempotencyKey),
      dedupeKey: command.idempotencyKey || command.id,
      replayPolicy: command.replayPolicy || recoveryCommands.duplicateCommandPolicy || "dedupe-by-idempotency-key",
      cursor: command.id,
      nextAction: command.nextAction,
      blocksRuntimeStart: command.blocksRuntimeStart === true,
      requiresAck: false,
      retryable: command.retryPolicy?.retryable === true
    })),
    ...leases.map((lease, index) => ({
      id: `${job.id}.replay.lease.${String(index + 1).padStart(2, "0")}.${lease.command}`
        .replace(/[^a-zA-Z0-9_.-]/g, "_"),
      order: commands.length + index + 1,
      kind: "client-command-lease",
      sourceId: lease.id,
      status: lease.status || "unknown",
      replaySafe: Boolean(lease.leaseKey || lease.idempotencyKey),
      dedupeKey: lease.leaseKey || lease.idempotencyKey || lease.id,
      replayPolicy: lease.replayPolicy || clientCommandLeases.restartSemantics?.duplicateCommandPolicy || "dedupe-by-command-lease-key",
      cursor: lease.id,
      nextAction: lease.nextAction,
      blocksRuntimeStart: lease.blocksRuntimeStart === true,
      requiresAck: lease.ackRequired === true,
      retryable: lease.retryPolicy?.retryable === true
    })),
    ...failures.map((failure, index) => ({
      id: `${job.id}.replay.failure.${String(index + 1).padStart(2, "0")}.${failure.failureClass}`
        .replace(/[^a-zA-Z0-9_.-]/g, "_"),
      order: commands.length + leases.length + index + 1,
      kind: "adapter-failure",
      sourceId: failure.id,
      status: failure.status || failureState.mode || "unknown",
      replaySafe: Boolean(failure.handoff?.idempotencyKey),
      dedupeKey: failure.handoff?.idempotencyKey || failure.id,
      replayPolicy: failure.handoff?.replayPolicy || "dedupe-by-idempotency-key",
      cursor: failure.id,
      nextAction: failure.nextAction,
      blocksRuntimeStart: failure.handoff?.blocksRuntimeStart === true,
      requiresAck: false,
      retryable: failure.retry?.retryable === true
    }))
  ];
  const unsafeRows = replayRows.filter((row) => row.replaySafe !== true);
  const ackRows = replayRows.filter((row) => row.requiresAck);
  const blockedRows = replayRows.filter((row) => row.blocksRuntimeStart || row.status === "blocked");
  const checkpointBlocked = checkpoints.filter((checkpoint) => checkpoint.required && checkpoint.ready !== true);
  const status = unsafeRows.length > 0 || checkpointBlocked.length > 0
    ? "blocked"
    : ackRows.length > 0
      ? "waiting-for-client"
      : blockedRows.length > 0 || failureState.mode === "degraded"
        ? "degraded"
        : "ready";
  const nextRow = unsafeRows[0]
    || checkpointBlocked[0]
    || ackRows[0]
    || blockedRows[0]
    || replayRows[0]
    || null;
  const resumeToken = restartCheckpointManifest.resumeToken
    || statusRecoveryBundle.resume?.resumeToken
    || statusLedger.resumeToken
    || `${job.id}:restart-replay:${status}`;
  const statusRevision = restartCheckpointManifest.statusRevision
    || statusRecoveryBundle.resume?.statusRevision
    || statusLedger.statusRevision
    || `${job.id}:${status}:${replayRows.length}`;

  return {
    schemaVersion: "aios.mailchimp.restart-replay-ledger.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    replayReady: status !== "blocked"
      && restartContract.replaySafe === true
      && restartCheckpointManifest.readyForColdRestart === true
      && unsafeRows.length === 0,
    resumeToken,
    statusRevision,
    nextAction: status === "blocked"
      ? nextRow?.nextAction || "repair-restart-replay-ledger"
      : ackRows.length > 0
        ? "request-client-command-ack"
        : restartContract.resumeAction || statusHandoff.nextAction || "handoff-to-runtime-adapter",
    rows: replayRows,
    counters: {
      rows: replayRows.length,
      commands: commands.length,
      leases: leases.length,
      failures: failures.length,
      unsafe: unsafeRows.length,
      ackRequired: ackRows.length,
      blocked: blockedRows.length,
      checkpointBlocked: checkpointBlocked.length,
      retryable: replayRows.filter((row) => row.retryable).length
    },
    duplicatePolicy: {
      defaultPolicy: restartContract.duplicateCommandPolicy
        || statusRecoveryBundle.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-idempotency-key",
      dedupeKeys: normalizeList(replayRows.map((row) => row.dedupeKey)),
      onDuplicate: "return-existing-result",
      onMissingDedupeKey: "block-replay-and-rebuild-command"
    },
    resume: {
      resumeFromCommandId: restartContract.resumeFromCommandId || recoveryCommands.restartCursor?.commandId || null,
      resumeFromLeaseId: statusRecoveryBundle.resume?.resumeFromLeaseId || clientCommandLeases.clientAck?.resumeFromLeaseId || null,
      resumeFromFailureId: statusRecoveryBundle.resume?.resumeFromFailureId || failureState.adapterHandoff?.resumeFromFailureId || null,
      resumeFromCheckpoint: checkpointBlocked[0]?.phase || restartCheckpointManifest.checkpoints?.find((checkpoint) => checkpoint.restartSafe)?.phase || null
    },
    clientPatch: {
      restartReplayStatus: status,
      restartReplayReady: status !== "blocked" && unsafeRows.length === 0,
      restartReplayNextAction: status === "blocked" ? nextRow?.nextAction || "repair-restart-replay-ledger" : statusHandoff.nextAction,
      restartReplayResumeToken: resumeToken,
      restartReplayRevision: statusRevision,
      restartReplayUnsafeRows: unsafeRows.map((row) => row.id),
      restartReplayAckRows: ackRows.map((row) => row.id)
    },
    restartSemantics: {
      replaySafe: unsafeRows.length === 0,
      duplicateCommandPolicy: restartContract.duplicateCommandPolicy || "dedupe-by-idempotency-key",
      staleStatusPolicy: restartContract.staleStatusPolicy || statusRecoveryBundle.restartSemantics?.staleStatusPolicy || {},
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

function buildPreviewHandoffSnapshot(job, status, runtimeHandoff, counts, nextActions, clientWorkflow, lifecycleControls, permissionBoundary, clientRuntimeSettings) {
  const validationItems = Array.isArray(clientWorkflow.validationItems) ? clientWorkflow.validationItems : [];
  const lifecycleControlRows = Array.isArray(lifecycleControls.controls) ? lifecycleControls.controls : [];
  const requiredSettings = normalizeList(clientRuntimeSettings.requiredSettingKeys || []);
  const missingSettings = normalizeList(clientRuntimeSettings.missingRequiredSettings || []);
  const blockingDiagnostics = counts.bySeverity?.error || 0;
  const warningDiagnostics = counts.bySeverity?.warning || 0;
  const safeBoundary = permissionBoundary.safeBoundary === true;
  const previewVisible = status !== "blocked"
    && runtimeHandoff.acceptedForClientPreview !== false
    && safeBoundary;
  const settingsAccepted = clientRuntimeSettings.revisionAccepted !== false
    && missingSettings.length === 0;
  const lifecycleAllowsRuntime = lifecycleControls.runtimeStart?.enabled === true
    || lifecycleControls.runtimeStartEnabled === true;
  const routeGates = [
    {
      id: "mailchimp.preview.route.diagnostics",
      label: "Diagnostics allow preview",
      status: blockingDiagnostics > 0 ? "blocked" : "accepted",
      required: true,
      nextAction: blockingDiagnostics > 0
        ? "review-blocking-diagnostics"
        : clientWorkflow.explainNextStep?.action || "handoff-to-runtime-adapter",
      evidence: {
        blockingDiagnostics,
        warningDiagnostics,
        status
      }
    },
    {
      id: "mailchimp.preview.route.boundary",
      label: "Tenant boundary is scoped",
      status: safeBoundary ? "accepted" : "blocked",
      required: true,
      nextAction: safeBoundary
        ? clientWorkflow.explainNextStep?.action || "handoff-to-runtime-adapter"
        : permissionBoundary.nextAction || "repair-permission-boundary",
      evidence: {
        tenantId: permissionBoundary.tenantId || null,
        workspaceId: permissionBoundary.workspaceId || null,
        isolationKey: permissionBoundary.isolationKey || null,
        missingRoles: permissionBoundary.missingRoles || [],
        deniedScopes: permissionBoundary.deniedScopes || []
      }
    },
    {
      id: "mailchimp.preview.route.lifecycle",
      label: "Lifecycle controls expose preview",
      status: previewVisible
        ? lifecycleAllowsRuntime || status !== "ready" ? "accepted" : "needs-operator-action"
        : "blocked",
      required: true,
      nextAction: previewVisible
        ? lifecycleControls.nextAction || clientWorkflow.explainNextStep?.action || "handoff-to-runtime-adapter"
        : "enable-mailchimp-client-preview",
      evidence: {
        previewVisible,
        runtimeStartEnabled: lifecycleAllowsRuntime,
        disabledControlIds: lifecycleControlRows
          .filter((control) => control.enabled !== true)
          .map((control) => control.id)
          .filter(Boolean)
      }
    },
    {
      id: "mailchimp.preview.route.settings",
      label: "Client settings are accepted",
      status: settingsAccepted ? "accepted" : "needs-operator-action",
      required: false,
      nextAction: missingSettings.length > 0
        ? "hydrate-mailchimp-client-runtime-settings"
        : clientRuntimeSettings.revisionAccepted === false
          ? "accept-mailchimp-client-settings"
          : clientWorkflow.explainNextStep?.action || "handoff-to-runtime-adapter",
      evidence: {
        settingsRevision: clientRuntimeSettings.settingsRevision || null,
        requiredSettingKeys: requiredSettings,
        missingRequiredSettings: missingSettings
      }
    }
  ];
  const blockedGates = routeGates.filter((gate) => gate.status === "blocked");
  const pendingGates = routeGates.filter((gate) => gate.status === "needs-operator-action");
  const primaryAction = blockedGates[0]?.nextAction
    || pendingGates[0]?.nextAction
    || clientWorkflow.explainNextStep?.action
    || nextActions[0]?.nextAction
    || "handoff-to-runtime-adapter";
  const routeId = `${job.id}:preview-route:${permissionBoundary.isolationKey || "tenant.local_workspace.local"}:${status}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const acceptanceToken = `${routeId}:${routeGates.map((gate) => `${gate.id}:${gate.status}`).join("|")}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.preview-handoff.v1",
    provider: "mailchimp",
    jobId: job.id,
    routeId,
    status: blockedGates.length > 0
      ? "blocked"
      : pendingGates.length > 0 || status === "needs-operator-action"
        ? "needs-operator-action"
        : "ready",
    visible: previewVisible,
    readyForAcceptance: previewVisible && blockedGates.length === 0,
    readyForRuntimeStart: previewVisible
      && blockedGates.length === 0
      && pendingGates.length === 0
      && lifecycleAllowsRuntime
      && runtimeHandoff.acceptedForRuntime === true,
    primaryAction,
    acceptance: {
      required: true,
      token: acceptanceToken,
      status: blockedGates.length > 0 ? "blocked" : pendingGates.length > 0 ? "pending" : "accepted",
      nextAction: primaryAction,
      requiredGateIds: routeGates.filter((gate) => gate.required).map((gate) => gate.id),
      blockedGateIds: blockedGates.map((gate) => gate.id),
      pendingGateIds: pendingGates.map((gate) => gate.id)
    },
    routePayload: {
      method: "POST",
      path: `/mailchimp/jobs/${job.id}/preview/acceptance`,
      idempotencyKey: acceptanceToken,
      bodyShape: {
        acceptanceToken: "string",
        statusRevision: "string",
        isolationKey: "string",
        accepted: "boolean"
      }
    },
    validationSummary: {
      total: routeGates.length,
      accepted: routeGates.filter((gate) => gate.status === "accepted").length,
      blocked: blockedGates.length,
      pending: pendingGates.length,
      required: routeGates.filter((gate) => gate.required).length,
      blockingDiagnostics,
      warningDiagnostics
    },
    gates: routeGates,
    clientPatch: {
      ...(clientWorkflow.statePatch || {}),
      previewHandoffRouteId: routeId,
      previewHandoffStatus: blockedGates.length > 0 ? "blocked" : pendingGates.length > 0 ? "needs-operator-action" : "ready",
      previewHandoffVisible: previewVisible,
      previewHandoffAcceptanceToken: acceptanceToken,
      previewHandoffNextAction: primaryAction,
      previewHandoffBlockedGateIds: blockedGates.map((gate) => gate.id),
      previewHandoffPendingGateIds: pendingGates.map((gate) => gate.id)
    },
    explainNextStep: {
      action: primaryAction,
      reason: blockedGates.length > 0
        ? "preview-route-blocked"
        : pendingGates.length > 0
          ? "preview-route-waiting"
          : "preview-route-ready",
      resumeToken: clientWorkflow.explainNextStep?.resumeToken || null,
      statusRevision: clientWorkflow.explainNextStep?.statusRevision || null,
      isolationKey: permissionBoundary.isolationKey || null
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-preview-handoff-token",
      resumeFromRouteId: routeId,
      externalWritesPerformed: false
    }
  };
}

function buildPreviewAcceptancePacket(job, status, counts, previewHandoff, previewExportReadiness, statusLedger, runtimeReleaseControls) {
  const gates = Array.isArray(previewHandoff.gates) ? previewHandoff.gates : [];
  const blockedGates = gates.filter((gate) => gate.status === "blocked");
  const pendingGates = gates.filter((gate) => gate.status === "needs-operator-action" || gate.status === "pending");
  const exportRows = Array.isArray(previewExportReadiness.rows) ? previewExportReadiness.rows : [];
  const blockedExportRows = exportRows.filter((row) => row.status === "blocked");
  const waitingExportRows = exportRows.filter((row) => row.status === "waiting" || row.status === "needs-operator-action");
  const releaseGates = Array.isArray(runtimeReleaseControls.gates) ? runtimeReleaseControls.gates : [];
  const blockedReleaseGates = releaseGates.filter((gate) => gate.state === "blocked");
  const waitingReleaseGates = releaseGates.filter((gate) => gate.state === "waiting" || gate.state === "held");
  const acceptanceToken = previewHandoff.acceptance?.token
    || previewExportReadiness.acceptanceToken
    || `${job.id}:preview-acceptance:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const statusRevision = statusLedger.statusRevision
    || previewExportReadiness.statusRevision
    || `${job.id}:${status}`;
  const resumeToken = statusLedger.resumeToken
    || previewExportReadiness.resumeToken
    || `${job.id}:${status}`;
  const readyForAcceptance = previewHandoff.readyForAcceptance === true
    && previewExportReadiness.readyForClientPreview === true
    && blockedGates.length === 0
    && blockedExportRows.length === 0;
  const readyForRuntimeStart = readyForAcceptance
    && previewHandoff.readyForRuntimeStart === true
    && previewExportReadiness.readyForRuntimeStart === true
    && runtimeReleaseControls.readyForRuntimeStart === true
    && blockedReleaseGates.length === 0
    && waitingReleaseGates.length === 0;
  const packetStatus = status === "blocked" || blockedGates.length > 0 || blockedExportRows.length > 0 || blockedReleaseGates.length > 0
    ? "blocked"
    : pendingGates.length > 0 || waitingExportRows.length > 0 || waitingReleaseGates.length > 0 || readyForRuntimeStart === false
      ? "needs-operator-action"
      : "ready";
  const nextAction = packetStatus === "ready"
    ? "accept-mailchimp-preview"
    : blockedGates[0]?.nextAction
      || blockedExportRows[0]?.nextAction
      || blockedReleaseGates[0]?.nextAction
      || pendingGates[0]?.nextAction
      || waitingExportRows[0]?.nextAction
      || waitingReleaseGates[0]?.nextAction
      || previewExportReadiness.nextAction
      || previewHandoff.primaryAction
      || "accept-preview";

  return {
    schemaVersion: "aios.mailchimp.preview-acceptance-packet.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: packetStatus,
    routeId: previewHandoff.routeId || null,
    acceptanceToken,
    readyForAcceptance,
    readyForRuntimeStart,
    nextAction,
    statusLedger: {
      resumeToken,
      statusRevision,
      acceptedStatusRevision: statusLedger.acceptedStatusRevision || null,
      visibleStatus: statusLedger.visibleStatus || packetStatus,
      restartSafe: statusLedger.restartSafe?.replaySafe === true
    },
    routePayload: {
      method: previewHandoff.routePayload?.method || "POST",
      path: previewHandoff.routePayload?.path || `/mailchimp/jobs/${job.id}/preview/acceptance`,
      idempotencyKey: acceptanceToken,
      bodyShape: {
        acceptanceToken: "string",
        statusRevision: "string",
        resumeToken: "string",
        accepted: "boolean",
        acceptedGateIds: "array",
        acknowledgedExportRowIds: "array"
      }
    },
    validationSummary: {
      total: gates.length + exportRows.length + releaseGates.length,
      accepted: gates.filter((gate) => gate.status === "accepted").length
        + exportRows.filter((row) => row.status === "ready").length
        + releaseGates.filter((gate) => gate.ready === true).length,
      blocked: blockedGates.length + blockedExportRows.length + blockedReleaseGates.length,
      pending: pendingGates.length + waitingExportRows.length + waitingReleaseGates.length,
      blockingDiagnostics: counts.bySeverity?.error || 0,
      warningDiagnostics: counts.bySeverity?.warning || 0
    },
    checkpoints: [
      {
        id: "preview-handoff",
        status: previewHandoff.status || "unknown",
        ready: previewHandoff.readyForAcceptance === true,
        blockedIds: blockedGates.map((gate) => gate.id),
        pendingIds: pendingGates.map((gate) => gate.id),
        nextAction: previewHandoff.primaryAction || previewHandoff.nextAction || nextAction
      },
      {
        id: "preview-export-readiness",
        status: previewExportReadiness.status || "unknown",
        ready: previewExportReadiness.readyForClientPreview === true,
        blockedIds: blockedExportRows.map((row) => row.id),
        pendingIds: waitingExportRows.map((row) => row.id),
        nextAction: previewExportReadiness.nextAction || nextAction
      },
      {
        id: "runtime-release-controls",
        status: runtimeReleaseControls.status || "unknown",
        ready: runtimeReleaseControls.readyForRuntimeStart === true,
        blockedIds: blockedReleaseGates.map((gate) => gate.gateId || gate.id),
        pendingIds: waitingReleaseGates.map((gate) => gate.gateId || gate.id),
        nextAction: runtimeReleaseControls.nextAction || nextAction
      }
    ],
    clientPatch: {
      ...(previewHandoff.clientPatch || {}),
      previewAcceptancePacketStatus: packetStatus,
      previewAcceptancePacketReady: readyForAcceptance,
      previewAcceptanceRuntimeReady: readyForRuntimeStart,
      previewAcceptancePacketNextAction: nextAction,
      previewAcceptanceToken: acceptanceToken,
      previewAcceptanceStatusRevision: statusRevision,
      previewAcceptanceResumeToken: resumeToken,
      previewAcceptanceBlockedCheckpointIds: [
        ...blockedGates.map((gate) => gate.id),
        ...blockedExportRows.map((row) => row.id),
        ...blockedReleaseGates.map((gate) => gate.gateId || gate.id)
      ],
      previewAcceptancePendingCheckpointIds: [
        ...pendingGates.map((gate) => gate.id),
        ...waitingExportRows.map((row) => row.id),
        ...waitingReleaseGates.map((gate) => gate.gateId || gate.id)
      ]
    },
    explainNextStep: {
      action: nextAction,
      reason: packetStatus === "blocked"
        ? "preview-acceptance-packet-blocked"
        : packetStatus === "needs-operator-action"
          ? "preview-acceptance-packet-waiting"
          : "preview-acceptance-packet-ready",
      resumeToken,
      statusRevision,
      routeId: previewHandoff.routeId || null
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-preview-acceptance-packet-token",
      resumeFromAcceptanceToken: acceptanceToken,
      externalWritesPerformed: false
    }
  };
}

function incidentOwnerFor(action, source) {
  if (source === "provider-service-contract") return "provider-operator";
  if (source === "permission-boundary") return "workspace-admin";
  if (source === "client-runtime-adoption") return "client-runtime";
  if (action === "collect-human-approval") return "operator";
  if (action?.includes("provider") || action?.includes("sync")) return "provider-operator";
  if (action?.includes("acknowledge") || action?.includes("hydrate")) return "client-runtime";
  if (action?.includes("workspace") || action?.includes("tenant")) return "workspace-admin";
  return "runtime-adapter";
}

function escalationBucketFor(diagnostic, retryPolicy) {
  if (diagnostic.severity === "error") return retryPolicy.retryable ? "retryable-blocker" : "hard-blocker";
  if (retryPolicy.operatorActionRequired) return "operator-action";
  if (retryPolicy.retryable) return "retryable-warning";
  return "monitor";
}

function incidentDeadlineMs(retryPolicy, order) {
  if (retryPolicy.retryable) return retryPolicy.backoffMs * Math.max(1, retryPolicy.maxAttempts || 1);
  if (retryPolicy.operatorActionRequired) return 60000 * order;
  return 0;
}

function buildIncidentBoundaryEvidence(job, permissionBoundary, diagnostic = {}, command = {}) {
  const boundary = permissionBoundary || {};
  const workspaceScoped = Boolean(boundary.tenantId && boundary.workspaceId);
  const diagnosticScopes = normalizeList([
    diagnostic.scope?.id,
    diagnostic.action,
    diagnostic.mount,
    diagnostic.field,
    ...(diagnostic.deniedScopes || []),
    ...(diagnostic.missingRoles || [])
  ]);
  const deniedScopes = normalizeList([
    ...(boundary.deniedScopes || []),
    ...(diagnostic.deniedScopes || [])
  ]);
  const missingRoles = normalizeList([
    ...(boundary.missingRoles || []),
    ...(diagnostic.missingRoles || [])
  ]);
  const boundaryBlocked = boundary.safeBoundary === false
    || boundary.wildcardBoundary === true
    || boundary.crossTenantAccess === true
    || deniedScopes.length > 0
    || missingRoles.length > 0;
  return {
    schemaVersion: "aios.mailchimp.incident-boundary-evidence.v1",
    provider: "mailchimp",
    jobId: job.id,
    tenantId: boundary.tenantId || "tenant.local",
    workspaceId: boundary.workspaceId || "workspace.local",
    isolationKey: boundary.isolationKey || `${boundary.tenantId || "tenant.local"}:${boundary.workspaceId || "workspace.local"}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    workspaceScoped,
    safeBoundary: boundary.safeBoundary === true,
    boundaryBlocked,
    explicitTenant: boundary.explicitTenant === true,
    explicitWorkspace: boundary.explicitWorkspace === true,
    requiredRoles: normalizeList(boundary.requiredRoles || []),
    allowedRoles: normalizeList(boundary.allowedRoles || []),
    missingRoles,
    requiredScopes: normalizeList(boundary.requiredScopes || []),
    requestedScopes: normalizeList(boundary.requestedScopes || []),
    deniedScopes,
    diagnosticScopes,
    audit: {
      appendRequired: diagnostic.source === "permission-boundary"
        || command.auditRequired === true
        || boundaryBlocked,
      safeToAppend: workspaceScoped && boundary.wildcardBoundary !== true && boundary.crossTenantAccess !== true,
      auditKey: `${job.id}:${boundary.isolationKey || "tenant.local_workspace.local"}:${diagnostic.code || "incident"}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    },
    runtimeHandoff: {
      blocksRuntimeStart: boundaryBlocked && diagnostic.severity === "error",
      nextAction: boundary.nextAction || diagnostic.recoveryAction || "handoff-to-runtime-adapter"
    }
  };
}

function summarizeIncidentBoundaries(incidents, permissionBoundary) {
  const boundaryRows = incidents.map((incident) => incident.boundaryEvidence).filter(Boolean);
  const blockedRows = boundaryRows.filter((row) => row.boundaryBlocked);
  const unsafeAuditRows = boundaryRows.filter((row) => row.audit?.safeToAppend === false);
  const tenantIds = normalizeList(boundaryRows.map((row) => row.tenantId));
  const workspaceIds = normalizeList(boundaryRows.map((row) => row.workspaceId));
  return {
    schemaVersion: "aios.mailchimp.operational-incident-boundary-summary.v1",
    status: blockedRows.length > 0 || permissionBoundary?.safeBoundary === false
      ? "blocked"
      : unsafeAuditRows.length > 0
        ? "degraded"
        : "ready",
    safeBoundary: permissionBoundary?.safeBoundary === true,
    isolationKey: permissionBoundary?.isolationKey || null,
    tenantIds,
    workspaceIds,
    blockedIncidentIds: incidents
      .filter((incident) => incident.boundaryEvidence?.boundaryBlocked)
      .map((incident) => incident.id),
    unsafeAuditIncidentIds: incidents
      .filter((incident) => incident.boundaryEvidence?.audit?.safeToAppend === false)
      .map((incident) => incident.id),
    deniedScopes: normalizeList(boundaryRows.flatMap((row) => row.deniedScopes || [])),
    missingRoles: normalizeList(boundaryRows.flatMap((row) => row.missingRoles || [])),
    auditAppendReady: unsafeAuditRows.length === 0
      && Boolean(permissionBoundary?.tenantId)
      && Boolean(permissionBoundary?.workspaceId),
    nextAction: blockedRows[0]?.runtimeHandoff?.nextAction
      || permissionBoundary?.nextAction
      || "handoff-to-runtime-adapter"
  };
}

function buildOperationalIncidentQueue(job, status, diagnostics, nextActions, recoveryCommands, failureState, providerServiceContract, statusRecoveryBundle, restartCheckpointManifest, permissionBoundary) {
  const actionByCode = new Map(nextActions.map((action) => [action.code, action]));
  const commandByActionId = new Map(
    (recoveryCommands.commands || []).map((command) => [command.sourceActionId, command])
  );
  const diagnosticIncidents = diagnostics
    .filter((diagnostic) => diagnostic.userVisible && diagnostic.severity !== "info")
    .map((diagnostic, index) => {
      const action = actionByCode.get(diagnostic.code) || {
        id: null,
        nextAction: diagnostic.recoveryAction,
        required: diagnostic.severity === "error",
        retryPolicy: retryPolicyForAction({
          nextAction: diagnostic.recoveryAction,
          required: diagnostic.severity === "error",
          scope: diagnostic.scope
        }, status)
      };
      const command = commandByActionId.get(action.id) || {};
      const retryPolicy = command.retryPolicy || action.retryPolicy;
      const owner = incidentOwnerFor(diagnostic.recoveryAction, diagnostic.source);
      const boundaryEvidence = buildIncidentBoundaryEvidence(job, permissionBoundary, diagnostic, command);
      return {
        id: `${job.id}.incident.${String(index + 1).padStart(2, "0")}.${diagnostic.code}.${diagnostic.scope.type}.${diagnostic.scope.id}`
          .replace(/[^a-zA-Z0-9_.-]/g, "_"),
        order: index + 1,
        source: diagnostic.source,
        diagnosticId: diagnostic.id,
        code: diagnostic.code,
        severity: diagnostic.severity,
        status: diagnostic.blocksRuntimeHandoff ? "blocking" : "open",
        owner,
        scope: diagnostic.scope,
        nextAction: diagnostic.recoveryAction,
        commandId: command.id || null,
        failureClass: retryPolicy.failureClass,
        escalationBucket: escalationBucketFor(diagnostic, retryPolicy),
        boundaryEvidence,
        retry: {
          retryable: retryPolicy.retryable === true,
          backoffMs: retryPolicy.backoffMs || 0,
          maxAttempts: retryPolicy.maxAttempts || 0,
          deadlineMs: incidentDeadlineMs(retryPolicy, index + 1)
        },
        handoff: {
          adapterVisible: true,
          providerVisible: owner === "provider-operator",
          clientVisible: owner === "client-runtime" || command.clientVisible === true,
          blocksRuntimeStart: diagnostic.blocksRuntimeHandoff === true
            || command.blocksRuntimeStart === true
            || boundaryEvidence.runtimeHandoff.blocksRuntimeStart === true,
          idempotencyKey: command.idempotencyKey || `${job.id}:${diagnostic.id}:${diagnostic.recoveryAction}`
        }
      };
    });
  const providerIncidents = [];
  if (providerServiceContract.externalHandoff?.ready === false) {
    providerIncidents.push({
      id: `${job.id}.incident.provider-service-handoff`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      order: diagnosticIncidents.length + 1,
      source: "provider-service-contract",
      diagnosticId: null,
      code: "provider.handoff.notReady",
      severity: providerServiceContract.status === "blocked" ? "error" : "warning",
      status: providerServiceContract.status === "blocked" ? "blocking" : "open",
      owner: "provider-operator",
      scope: { type: "provider-service", id: providerServiceContract.providerService },
      nextAction: providerServiceContract.nextAction || "repair-provider-service-handoff",
      commandId: null,
      failureClass: "provider-service-handoff",
      escalationBucket: providerServiceContract.status === "blocked" ? "hard-blocker" : "operator-action",
      retry: {
        retryable: providerServiceContract.status !== "blocked",
        backoffMs: providerServiceContract.status !== "blocked" ? 30000 : 0,
        maxAttempts: providerServiceContract.status !== "blocked" ? 3 : 0,
        deadlineMs: providerServiceContract.status !== "blocked" ? 90000 : 0
      },
      handoff: {
        adapterVisible: true,
        providerVisible: true,
        clientVisible: false,
        blocksRuntimeStart: providerServiceContract.status === "blocked",
        idempotencyKey: providerServiceContract.externalHandoff?.idempotencyKey || `${job.id}:provider-service-handoff`
      }
    });
  }
  const recoveryBlocked = statusRecoveryBundle.state === "blocked"
    || restartCheckpointManifest.status === "blocked";
  const incidents = [...diagnosticIncidents, ...providerIncidents]
    .sort((left, right) => {
      const severityDelta = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      if (severityDelta !== 0) return severityDelta;
      return left.order - right.order;
    })
    .map((incident, index) => ({ ...incident, order: index + 1 }));
  const blockers = incidents.filter((incident) => incident.handoff.blocksRuntimeStart);
  const retryable = incidents.filter((incident) => incident.retry.retryable);
  const ownerCounts = countBy(incidents, "owner");
  const boundarySummary = summarizeIncidentBoundaries(incidents, permissionBoundary);
  const nextIncident = blockers[0] || retryable[0] || incidents[0] || null;

  return {
    schemaVersion: "aios.mailchimp.operational-incident-queue.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: blockers.length > 0 || recoveryBlocked
      ? "blocked"
      : incidents.length > 0 || failureState.mode === "degraded"
        ? "degraded"
        : "ready",
    incidentCount: incidents.length,
    incidents,
    summary: {
      blocking: blockers.length,
      retryable: retryable.length,
      providerVisible: incidents.filter((incident) => incident.handoff.providerVisible).length,
      clientVisible: incidents.filter((incident) => incident.handoff.clientVisible).length,
      byOwner: ownerCounts,
      boundaryStatus: boundarySummary.status,
      boundaryBlocked: boundarySummary.blockedIncidentIds.length,
      auditAppendReady: boundarySummary.auditAppendReady,
      recoveryBlocked,
      failureMode: failureState.mode || "unknown"
    },
    boundarySummary,
    nextIncidentId: nextIncident?.id || null,
    nextAction: nextIncident?.nextAction
      || statusRecoveryBundle.nextAction
      || restartCheckpointManifest.nextAction
      || "handoff-to-runtime-adapter",
    adapterHandoff: {
      queueRequired: incidents.length > 0 || recoveryBlocked,
      resumeFromIncidentId: nextIncident?.id || null,
      nextRetryAtMs: retryable[0]?.retry.deadlineMs || failureState.nextRetry?.backoffMs || 0,
      boundaryIsolationKey: boundarySummary.isolationKey,
      auditAppendReady: boundarySummary.auditAppendReady,
      staleStatusPolicy: recoveryBlocked
        ? "reload-status-recovery-before-runtime-start"
        : "continue-runtime-handoff"
    },
    clientPatch: {
      operationalIncidentStatus: blockers.length > 0 ? "blocked" : incidents.length > 0 ? "degraded" : "ready",
      operationalIncidentCount: incidents.length,
      operationalIncidentNextAction: nextIncident?.nextAction || statusRecoveryBundle.nextAction || "handoff-to-runtime-adapter",
      operationalIncidentOwner: nextIncident?.owner || null,
      operationalIncidentId: nextIncident?.id || null,
      operationalIncidentBoundaryStatus: boundarySummary.status,
      operationalIncidentBoundaryBlockedIds: boundarySummary.blockedIncidentIds,
      operationalIncidentAuditAppendReady: boundarySummary.auditAppendReady
    }
  };
}

function buildClientRemediationPacket(job, status, counts, statusLedger, operationalIncidents, clientStatusHandoff, clientRuntimeAdoption, clientRuntimeSettings, previewHandoff, runtimeReleaseControls, serviceLevelObjectives) {
  const incidentRows = Array.isArray(operationalIncidents.incidents) ? operationalIncidents.incidents : [];
  const clientVisibleIncidents = incidentRows.filter((incident) => incident.handoff?.clientVisible === true);
  const blockingIncidents = incidentRows.filter((incident) => incident.handoff?.blocksRuntimeStart === true);
  const missingStateKeys = normalizeList(clientRuntimeAdoption.missingStateKeys || []);
  const pendingAckKeys = normalizeList([
    ...(clientRuntimeAdoption.commandAck?.pendingKeys || []),
    ...(clientStatusHandoff.commandAck?.pendingKeys || [])
  ]);
  const missingSettings = normalizeList(clientRuntimeSettings.missingRequiredSettings || []);
  const releaseBlockedGateIds = normalizeList(runtimeReleaseControls.clientPatch?.runtimeReleaseBlockedGateIds || []);
  const previewBlockedGateIds = normalizeList(previewHandoff.acceptance?.blockedGateIds || []);
  const blockingBreaches = Array.isArray(serviceLevelObjectives.breaches)
    ? serviceLevelObjectives.breaches.filter((breach) => breach.blocksRuntimeRelease === true)
    : [];
  const steps = [
    ...missingStateKeys.map((key) => ({
      id: `${job.id}:client-remediation:state:${key}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      kind: "hydrate-client-state",
      label: key,
      status: "blocked",
      owner: "client-runtime",
      nextAction: "hydrate-mailchimp-client-runtime-state",
      evidence: { missingStateKey: key }
    })),
    ...pendingAckKeys.map((key) => ({
      id: `${job.id}:client-remediation:ack:${key}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      kind: "acknowledge-command",
      label: key,
      status: "waiting",
      owner: "client-runtime",
      nextAction: "acknowledge-mailchimp-client-command",
      evidence: { ackKey: key }
    })),
    ...missingSettings.map((key) => ({
      id: `${job.id}:client-remediation:setting:${key}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      kind: "hydrate-client-setting",
      label: key,
      status: "blocked",
      owner: "client-runtime",
      nextAction: "hydrate-mailchimp-client-runtime-settings",
      evidence: { missingSetting: key }
    })),
    ...previewBlockedGateIds.map((gateId) => ({
      id: `${job.id}:client-remediation:preview:${gateId}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      kind: "preview-gate",
      label: gateId,
      status: "blocked",
      owner: "operator",
      nextAction: previewHandoff.primaryAction || previewHandoff.nextAction || "refresh-preview-handoff",
      evidence: { gateId }
    })),
    ...releaseBlockedGateIds.map((gateId) => ({
      id: `${job.id}:client-remediation:release:${gateId}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      kind: "runtime-release-gate",
      label: gateId,
      status: "blocked",
      owner: "operator",
      nextAction: runtimeReleaseControls.nextAction || "review-runtime-release-controls",
      evidence: { gateId }
    })),
    ...blockingBreaches.map((breach) => ({
      id: `${job.id}:client-remediation:slo:${breach.id || breach.objectiveId}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      kind: "service-level-objective",
      label: breach.objectiveId || breach.id,
      status: "blocked",
      owner: breach.owner || "operator",
      nextAction: breach.nextAction || serviceLevelObjectives.nextAction || "review-mailchimp-service-level-objective",
      evidence: { breachId: breach.id || null, objectiveId: breach.objectiveId || null }
    })),
    ...clientVisibleIncidents.slice(0, 5).map((incident) => ({
      id: `${job.id}:client-remediation:incident:${incident.id}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      kind: "operational-incident",
      label: incident.code,
      status: incident.handoff?.blocksRuntimeStart ? "blocked" : "waiting",
      owner: incident.owner || "runtime-adapter",
      nextAction: incident.nextAction,
      evidence: { incidentId: incident.id, diagnosticId: incident.diagnosticId || null }
    }))
  ];
  const blockingSteps = steps.filter((step) => step.status === "blocked");
  const waitingSteps = steps.filter((step) => step.status === "waiting");
  const nextStep = blockingSteps[0] || waitingSteps[0] || null;
  const packetStatus = blockingSteps.length > 0 || status === "blocked"
    ? "blocked"
    : waitingSteps.length > 0 || status === "needs-operator-action"
      ? "needs-operator-action"
      : "ready";
  const statusRevision = statusLedger.statusRevision || `${job.id}:${status}`;
  const resumeToken = statusLedger.resumeToken || `${job.id}:${status}`;
  const routeId = `${job.id}:client-remediation:${packetStatus}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.client-remediation-packet.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: packetStatus,
    visibleStatus: clientStatusHandoff.visibleStatus || packetStatus,
    readyForClient: packetStatus !== "blocked" && clientStatusHandoff.readyForClient === true,
    readyForRuntime: packetStatus === "ready"
      && clientStatusHandoff.readyForRuntime === true
      && runtimeReleaseControls.readyForRuntimeStart === true
      && serviceLevelObjectives.readyForRuntimeRelease === true,
    nextAction: nextStep?.nextAction
      || clientStatusHandoff.nextAction
      || operationalIncidents.nextAction
      || "handoff-to-runtime-adapter",
    route: {
      routeId,
      idempotencyKey: `${routeId}:${statusRevision}:${resumeToken}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      target: "client-runtime",
      statusRevision,
      resumeToken
    },
    counters: {
      steps: steps.length,
      blocking: blockingSteps.length,
      waiting: waitingSteps.length,
      errors: counts.bySeverity?.error || 0,
      warnings: counts.bySeverity?.warning || 0,
      clientVisibleIncidents: clientVisibleIncidents.length,
      runtimeBlockingIncidents: blockingIncidents.length
    },
    steps,
    clientPatch: {
      clientRemediationStatus: packetStatus,
      clientRemediationVisibleStatus: clientStatusHandoff.visibleStatus || packetStatus,
      clientRemediationNextAction: nextStep?.nextAction || clientStatusHandoff.nextAction || "handoff-to-runtime-adapter",
      clientRemediationRouteId: routeId,
      clientRemediationBlocking: blockingSteps.length,
      clientRemediationWaiting: waitingSteps.length,
      clientRemediationResumeToken: resumeToken,
      clientRemediationStatusRevision: statusRevision
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-remediation-route",
      resumeToken,
      statusRevision,
      externalWritesPerformed: false
    }
  };
}

function buildDiagnosticExportLedger(job, status, diagnostics, counts, statusLedger, recoveryCommands, failureState, statusRecoveryBundle, restartCheckpointManifest, operationalIncidents) {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.blocksRuntimeHandoff);
  const warningDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const commands = Array.isArray(recoveryCommands.commands) ? recoveryCommands.commands : [];
  const retryableCommands = commands.filter((command) => command.retryPolicy?.retryable === true);
  const checkpoints = Array.isArray(restartCheckpointManifest.checkpoints) ? restartCheckpointManifest.checkpoints : [];
  const requiredCheckpoints = checkpoints.filter((checkpoint) => checkpoint.required === true);
  const readyCheckpoints = requiredCheckpoints.filter((checkpoint) => checkpoint.ready === true);
  const incidents = Array.isArray(operationalIncidents.incidents) ? operationalIncidents.incidents : [];
  const blockingIncidents = incidents.filter((incident) => incident.handoff?.blocksRuntimeStart === true);
  const resumeToken = statusLedger.resumeToken || `${job.id}:${status}`;
  const statusRevision = statusLedger.statusRevision || `${job.id}:${status}`;
  const rows = [
    {
      id: `${job.id}:diagnostic-ledger:diagnostics`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: 1,
      phase: "diagnostics",
      status: blockingDiagnostics.length > 0 ? "blocked" : warningDiagnostics.length > 0 ? "needs-operator-action" : "ready",
      source: "diagnostic-emitter",
      nextAction: blockingDiagnostics[0]?.recoveryAction
        || warningDiagnostics[0]?.recoveryAction
        || recoveryCommands.restartCursor?.nextAction
        || "handoff-to-runtime-adapter",
      counters: {
        total: counts.total || 0,
        blocking: blockingDiagnostics.length,
        warnings: warningDiagnostics.length
      }
    },
    {
      id: `${job.id}:diagnostic-ledger:recovery-commands`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: 2,
      phase: "recovery-commands",
      status: commands.some((command) => command.blocksRuntimeStart) ? "blocked" : retryableCommands.length > 0 ? "retryable" : "ready",
      source: "recovery-command-plan",
      nextAction: recoveryCommands.restartCursor?.nextAction || statusRecoveryBundle.nextAction || "handoff-to-runtime-adapter",
      counters: {
        total: commands.length,
        blocking: commands.filter((command) => command.blocksRuntimeStart).length,
        retryable: retryableCommands.length
      }
    },
    {
      id: `${job.id}:diagnostic-ledger:restart-checkpoints`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: 3,
      phase: "restart-checkpoints",
      status: restartCheckpointManifest.readyForColdRestart === true ? "ready" : "waiting",
      source: "restart-checkpoint-manifest",
      nextAction: restartCheckpointManifest.nextAction || statusRecoveryBundle.nextAction || "repair-restart-checkpoints",
      counters: {
        total: checkpoints.length,
        required: requiredCheckpoints.length,
        readyRequired: readyCheckpoints.length,
        missingRequired: restartCheckpointManifest.blocking?.missingRequiredCheckpoints?.length || 0
      }
    },
    {
      id: `${job.id}:diagnostic-ledger:operational-incidents`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: 4,
      phase: "operational-incidents",
      status: operationalIncidents.status || (blockingIncidents.length > 0 ? "blocked" : incidents.length > 0 ? "degraded" : "ready"),
      source: "operational-incident-queue",
      nextAction: operationalIncidents.nextAction || failureState.adapterHandoff?.nextAction || "handoff-to-runtime-adapter",
      counters: {
        total: incidents.length,
        blocking: blockingIncidents.length,
        retryable: operationalIncidents.summary?.retryable || 0,
        clientVisible: operationalIncidents.summary?.clientVisible || 0
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const waitingRows = rows.filter((row) => row.status === "waiting" || row.status === "retryable" || row.status === "needs-operator-action");
  const exportReady = status !== "blocked"
    && blockedRows.length === 0
    && restartCheckpointManifest.restartSemantics?.externalWritesPerformed === false
    && statusRecoveryBundle.restartSemantics?.externalWritesPerformed === false;

  return {
    schemaVersion: "aios.mailchimp.diagnostic-export-ledger.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    exportReady,
    resumeToken,
    statusRevision,
    nextAction: exportReady
      ? "publish-diagnostic-export-ledger"
      : blockedRows[0]?.nextAction || waitingRows[0]?.nextAction || "repair-diagnostic-export-ledger",
    counters: {
      diagnostics: counts.total || 0,
      errors: counts.bySeverity?.error || 0,
      warnings: counts.bySeverity?.warning || 0,
      recoveryCommands: commands.length,
      retryableCommands: retryableCommands.length,
      failureStates: failureState.summary?.total || 0,
      operationalIncidents: incidents.length,
      restartCheckpoints: checkpoints.length,
      blockedRows: blockedRows.length,
      waitingRows: waitingRows.length
    },
    rows,
    historySnapshots: rows.map((row) => ({
      id: `${row.id}:${statusRevision}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      phase: row.phase,
      status: row.status,
      source: row.source,
      nextAction: row.nextAction,
      resumeToken,
      statusRevision,
      counters: row.counters
    })),
    exportSummary: {
      artifactName: "diagnostic-export-ledger.json",
      rowIds: rows.map((row) => row.id),
      blockerCodes: blockingDiagnostics.map((diagnostic) => diagnostic.code),
      warningCodes: warningDiagnostics.map((diagnostic) => diagnostic.code),
      historySnapshotIds: rows.map((row) => `${row.id}:${statusRevision}`.replace(/[^a-zA-Z0-9_.:-]/g, "_")),
      externalWritesPerformed: false
    },
    clientPatch: {
      diagnosticExportLedgerStatus: exportReady ? "ready" : blockedRows.length > 0 ? "blocked" : "waiting",
      diagnosticExportLedgerReady: exportReady,
      diagnosticExportLedgerNextAction: exportReady
        ? "publish-diagnostic-export-ledger"
        : blockedRows[0]?.nextAction || waitingRows[0]?.nextAction || "repair-diagnostic-export-ledger",
      diagnosticExportLedgerResumeToken: resumeToken,
      diagnosticExportLedgerRevision: statusRevision,
      diagnosticExportLedgerRows: rows.length
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-diagnostic-export-ledger-revision",
      resumeToken,
      externalWritesPerformed: false
    }
  };
}

function buildPreviewExportReadiness(job, status, runtimeHandoff, counts, previewHandoff, clientWorkflow, lifecycleControls, exportLedger, statusLedger) {
  const previewBlockedGateIds = normalizeList(previewHandoff.acceptance?.blockedGateIds || []);
  const previewPendingGateIds = normalizeList(previewHandoff.acceptance?.pendingGateIds || []);
  const workflowItems = Array.isArray(clientWorkflow.validationItems) ? clientWorkflow.validationItems : [];
  const blockedWorkflowItems = workflowItems.filter((item) => item.status === "blocked" || item.blocking === true);
  const pendingWorkflowItems = workflowItems.filter((item) => item.status === "pending" || item.status === "waiting");
  const ledgerRows = Array.isArray(exportLedger.rows) ? exportLedger.rows : [];
  const blockedLedgerRows = ledgerRows.filter((row) => row.status === "blocked");
  const waitingLedgerRows = ledgerRows.filter((row) => ["waiting", "retryable", "needs-operator-action"].includes(row.status));
  const readinessRows = [
    {
      id: `${job.id}:preview-export:preview-handoff`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: 1,
      phase: "preview-handoff",
      status: previewHandoff.readyForAcceptance === true
        ? "ready"
        : previewBlockedGateIds.length > 0
          ? "blocked"
          : "waiting",
      nextAction: previewHandoff.primaryAction || previewHandoff.nextAction || "refresh-preview-handoff",
      counters: {
        blockedGates: previewBlockedGateIds.length,
        pendingGates: previewPendingGateIds.length
      }
    },
    {
      id: `${job.id}:preview-export:client-workflow`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: 2,
      phase: "client-workflow",
      status: blockedWorkflowItems.length > 0
        ? "blocked"
        : pendingWorkflowItems.length > 0
          ? "waiting"
          : "ready",
      nextAction: clientWorkflow.explainNextStep?.action || clientWorkflow.primaryAction || "refresh-client-workflow",
      counters: {
        validationItems: workflowItems.length,
        blocked: blockedWorkflowItems.length,
        pending: pendingWorkflowItems.length
      }
    },
    {
      id: `${job.id}:preview-export:lifecycle-controls`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: 3,
      phase: "lifecycle-controls",
      status: lifecycleControls.preview?.enabled === false || lifecycleControls.runtimeStart?.enabled === false
        ? "blocked"
        : lifecycleControls.schedule?.paused === true
          ? "waiting"
          : "ready",
      nextAction: lifecycleControls.nextAction || "refresh-lifecycle-controls",
      counters: {
        previewEnabled: lifecycleControls.preview?.enabled === true ? 1 : 0,
        runtimeStartEnabled: lifecycleControls.runtimeStart?.enabled === true ? 1 : 0,
        schedulePaused: lifecycleControls.schedule?.paused === true ? 1 : 0
      }
    },
    {
      id: `${job.id}:preview-export:diagnostic-ledger`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: 4,
      phase: "diagnostic-ledger",
      status: blockedLedgerRows.length > 0
        ? "blocked"
        : waitingLedgerRows.length > 0
          ? "waiting"
          : "ready",
      nextAction: exportLedger.nextAction || "publish-diagnostic-export-ledger",
      counters: {
        ledgerRows: ledgerRows.length,
        blockedRows: blockedLedgerRows.length,
        waitingRows: waitingLedgerRows.length
      }
    }
  ];
  const blockedRows = readinessRows.filter((row) => row.status === "blocked");
  const waitingRows = readinessRows.filter((row) => row.status === "waiting");
  const acceptedForPreview = status !== "blocked" && runtimeHandoff.acceptedForClientPreview !== false;
  const readyForClientPreview = acceptedForPreview
    && blockedRows.length === 0
    && previewHandoff.readyForAcceptance === true;
  const readyForRuntimeStart = readyForClientPreview
    && runtimeHandoff.acceptedForRuntime === true
    && runtimeHandoff.controls?.canStartRuntime === true
    && previewHandoff.readyForRuntimeStart === true
    && lifecycleControls.runtimeStart?.enabled === true
    && exportLedger.exportReady === true;
  const nextRow = blockedRows[0] || waitingRows[0] || readinessRows.find((row) => row.status !== "ready") || null;
  const readinessStatus = blockedRows.length > 0 || status === "blocked"
    ? "blocked"
    : waitingRows.length > 0 || readyForRuntimeStart === false
      ? "needs-operator-action"
      : "ready";
  const statusRevision = statusLedger.statusRevision || exportLedger.statusRevision || `${job.id}:${status}`;
  const resumeToken = statusLedger.resumeToken || exportLedger.resumeToken || `${job.id}:${status}`;

  return {
    schemaVersion: "aios.mailchimp.preview-export-readiness.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: readinessStatus,
    readyForClientPreview,
    readyForRuntimeStart,
    exportReady: readyForClientPreview && exportLedger.exportReady === true,
    acceptanceToken: previewHandoff.acceptance?.token || null,
    routeId: previewHandoff.routeId || null,
    resumeToken,
    statusRevision,
    nextAction: nextRow?.nextAction
      || (readyForRuntimeStart ? "publish-preview-export-readiness" : previewHandoff.primaryAction || "accept-preview"),
    rows: readinessRows,
    validationSummary: {
      total: readinessRows.length,
      ready: readinessRows.filter((row) => row.status === "ready").length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      diagnostics: counts.total || 0,
      errors: counts.bySeverity?.error || 0,
      warnings: counts.bySeverity?.warning || 0
    },
    historySnapshots: readinessRows.map((row) => ({
      id: `${row.id}:${statusRevision}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      phase: row.phase,
      status: row.status,
      nextAction: row.nextAction,
      resumeToken,
      statusRevision,
      counters: row.counters
    })),
    exportSummary: {
      artifactName: "preview-export-readiness.json",
      rowIds: readinessRows.map((row) => row.id),
      blockedRowIds: blockedRows.map((row) => row.id),
      waitingRowIds: waitingRows.map((row) => row.id),
      historySnapshotIds: readinessRows.map((row) => `${row.id}:${statusRevision}`.replace(/[^a-zA-Z0-9_.:-]/g, "_")),
      externalWritesPerformed: false
    },
    clientPatch: {
      previewExportReadinessStatus: readinessStatus,
      previewExportReady: readyForClientPreview && exportLedger.exportReady === true,
      previewExportRuntimeStartReady: readyForRuntimeStart,
      previewExportNextAction: nextRow?.nextAction || "publish-preview-export-readiness",
      previewExportResumeToken: resumeToken,
      previewExportStatusRevision: statusRevision,
      previewExportBlockedRows: blockedRows.map((row) => row.id)
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-preview-export-readiness-revision",
      resumeToken,
      externalWritesPerformed: false
    }
  };
}

function deriveServiceLevelObjectiveState(
  job,
  status,
  counts,
  runtimeHandoff,
  providerServiceContract,
  providerSyncCheckpoint,
  failureState,
  operationalIncidents,
  statusRecoveryBundle,
  restartCheckpointManifest
) {
  const objectives = [
    {
      id: "diagnostic-error-budget",
      label: "Diagnostic error budget",
      target: 0,
      observed: counts.bySeverity?.error || 0,
      unit: "blocking-diagnostics",
      severity: "error",
      owner: "runtime",
      nextAction: "repair-before-runtime-handoff"
    },
    {
      id: "provider-handoff-readiness",
      label: "Provider service handoff readiness",
      target: 1,
      observed: providerServiceContract.externalHandoff?.ready === true ? 1 : 0,
      unit: "ready-flag",
      severity: providerServiceContract.status === "blocked" ? "error" : "warning",
      owner: "adapter",
      nextAction: providerServiceContract.nextAction || "review-mailchimp-service-level-objective"
    },
    {
      id: "provider-sync-checkpoint-readiness",
      label: "Provider sync checkpoint readiness",
      target: 1,
      observed: providerSyncCheckpoint.ready === true ? 1 : 0,
      unit: "ready-flag",
      severity: providerSyncCheckpoint.status === "blocked" ? "error" : "warning",
      owner: "adapter",
      nextAction: providerSyncCheckpoint.nextAction || "review-mailchimp-service-level-objective"
    },
    {
      id: "retry-queue-depth",
      label: "Retry queue depth",
      target: 3,
      observed: failureState.summary?.retryable || 0,
      unit: "retryable-failures",
      comparator: "max",
      severity: "warning",
      owner: "adapter",
      nextAction: failureState.nextRetry?.nextAction || failureState.adapterHandoff?.nextAction || "review-mailchimp-service-level-objective"
    },
    {
      id: "operational-incident-blockers",
      label: "Operational incident blockers",
      target: 0,
      observed: operationalIncidents.summary?.blocking || 0,
      unit: "blocking-incidents",
      severity: "error",
      owner: operationalIncidents.incidents?.find((incident) => incident.handoff?.blocksRuntimeStart)?.owner || "operator",
      nextAction: operationalIncidents.nextAction || "review-mailchimp-service-level-objective"
    },
    {
      id: "status-recovery-readiness",
      label: "Status recovery readiness",
      target: 1,
      observed: statusRecoveryBundle.readyForRuntimeResume === true ? 1 : 0,
      unit: "ready-flag",
      severity: statusRecoveryBundle.state === "blocked" ? "error" : "warning",
      owner: "runtime",
      nextAction: statusRecoveryBundle.nextAction || "review-mailchimp-service-level-objective"
    },
    {
      id: "restart-checkpoint-readiness",
      label: "Restart checkpoint readiness",
      target: 1,
      observed: restartCheckpointManifest.readyForColdRestart === true ? 1 : 0,
      unit: "ready-flag",
      severity: restartCheckpointManifest.status === "blocked" ? "error" : "warning",
      owner: "runtime",
      nextAction: restartCheckpointManifest.nextAction || "review-mailchimp-service-level-objective"
    }
  ];
  const evaluated = objectives.map((objective, index) => {
    const comparator = objective.comparator || "equals";
    const breached = comparator === "max"
      ? objective.observed > objective.target
      : objective.observed !== objective.target;
    const breachId = breached
      ? `${job.id}.slo.${String(index + 1).padStart(2, "0")}.${objective.id}`.replace(/[^a-zA-Z0-9_.-]/g, "_")
      : null;
    return {
      ...objective,
      comparator,
      status: breached ? "breached" : "satisfied",
      breached,
      breachId
    };
  });
  const breached = evaluated.filter((objective) => objective.breached);
  const blocking = breached.filter((objective) => objective.severity === "error");
  const retryable = breached.filter((objective) => {
    const policy = RETRY_POLICY_BY_ACTION[objective.nextAction] || RETRY_POLICY_BY_ACTION["review-mailchimp-service-level-objective"];
    return policy.retryable === true;
  });
  const nextObjective = blocking[0] || retryable[0] || breached[0] || null;
  const nextPolicy = nextObjective
    ? RETRY_POLICY_BY_ACTION[nextObjective.nextAction] || RETRY_POLICY_BY_ACTION["review-mailchimp-service-level-objective"]
    : RETRY_POLICY_BY_ACTION["handoff-to-runtime-adapter"];
  const objectiveStatus = blocking.length > 0 || status === "blocked"
    ? "blocked"
    : breached.length > 0 || status === "needs-operator-action"
      ? "degraded"
      : "ready";

  return {
    schemaVersion: "aios.mailchimp.service-level-objectives.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: objectiveStatus,
    healthLevel: objectiveStatus === "ready" ? "healthy" : objectiveStatus === "blocked" ? "unhealthy" : "degraded",
    readyForRuntimeRelease: objectiveStatus === "ready"
      && runtimeHandoff.acceptedForRuntime === true
      && runtimeHandoff.controls?.canStartRuntime === true,
    nextAction: nextObjective?.nextAction || "handoff-to-runtime-adapter",
    nextBreachId: nextObjective?.breachId || null,
    objectives: evaluated,
    breaches: breached.map((objective) => ({
      id: objective.breachId,
      objectiveId: objective.id,
      severity: objective.severity,
      owner: objective.owner,
      observed: objective.observed,
      target: objective.target,
      unit: objective.unit,
      nextAction: objective.nextAction,
      blocksRuntimeRelease: objective.severity === "error"
    })),
    counters: {
      objectives: evaluated.length,
      satisfied: evaluated.filter((objective) => objective.status === "satisfied").length,
      breached: breached.length,
      blocking: blocking.length,
      retryable: retryable.length
    },
    retry: {
      retryable: retryable.length > 0 && blocking.length === 0,
      backoffMs: blocking.length > 0 ? 0 : nextPolicy.backoffMs,
      maxAttempts: blocking.length > 0 ? 0 : nextPolicy.maxAttempts,
      failureClass: nextPolicy.failureClass,
      nextAction: nextObjective?.nextAction || "handoff-to-runtime-adapter"
    },
    clientPatch: {
      serviceLevelObjectiveStatus: objectiveStatus,
      serviceLevelObjectiveHealth: objectiveStatus === "ready" ? "healthy" : objectiveStatus === "blocked" ? "unhealthy" : "degraded",
      serviceLevelObjectiveNextAction: nextObjective?.nextAction || "handoff-to-runtime-adapter",
      serviceLevelObjectiveBreaches: breached.length,
      serviceLevelObjectiveBlocking: blocking.length
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-service-level-objective-job-id",
      resumeFromBreachId: nextObjective?.breachId || null,
      externalWritesPerformed: false
    }
  };
}

export function emitMailchimpDiagnostics(source = {}, options = {}) {
  const job = compileIfNeeded(source, options);
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const providerServiceContract = deriveProviderServiceContract(job, options);
  const serviceDiagnostics = providerServiceDiagnostics(providerServiceContract);
  const providerSyncCheckpoint = deriveProviderSyncCheckpoint(job, providerServiceContract, options);
  const providerSyncDiagnostics = providerSyncCheckpointDiagnostics(providerSyncCheckpoint);
  const permissionBoundary = derivePermissionBoundary(job, options);
  const boundaryDiagnostics = permissionBoundaryDiagnostics(permissionBoundary);
  const permissionGrantPlan = buildPermissionGrantPlan(job, permissionBoundary);
  const normalizedBoundaryDiagnostics = boundaryDiagnostics.map((diagnostic, index) => ({
    ...diagnostic,
    id: stableDiagnosticId(job.id, diagnostic, index),
    source: diagnostic.source || "permission-boundary"
  }));
  const tenantPermissionEnforcement = buildTenantPermissionEnforcement(
    job,
    permissionBoundary,
    permissionGrantPlan,
    normalizedBoundaryDiagnostics
  );
  const tenantBoundaryPosture = buildTenantBoundaryPosture(
    job,
    permissionBoundary,
    permissionGrantPlan,
    tenantPermissionEnforcement,
    normalizedBoundaryDiagnostics
  );
  const lifecycleControls = deriveLifecycleControls(job, permissionBoundary);
  const lifecycleDiagnostics = lifecycleControlDiagnostics(lifecycleControls);
  const initialClientRuntimeAdoption = deriveClientRuntimeAdoption(job, runtimeHandoff, options);
  const adoptionDiagnostics = clientRuntimeAdoptionDiagnostics(initialClientRuntimeAdoption);
  const initialClientRuntimeSettings = deriveClientRuntimeSettings(
    job,
    runtimeHandoff,
    lifecycleControls,
    initialClientRuntimeAdoption,
    options
  );
  const settingsDiagnostics = clientRuntimeSettingsDiagnostics(initialClientRuntimeSettings);
  const initialSettingsRolloutGate = deriveSettingsRolloutGate(
    job,
    runtimeHandoff,
    lifecycleControls,
    initialClientRuntimeSettings,
    options
  );
  const settingsRolloutDiagnostics = settingsRolloutGateDiagnostics(initialSettingsRolloutGate);
  const initialClientStatusHandoff = deriveClientStatusHandoff(
    job,
    runtimeHandoff,
    runtimeHandoff.readinessStatus || job.status || "ready",
    {
      statusLedger: {
        resumeToken: runtimeHandoff.clientContract?.resumeToken || null,
        statusRevision: runtimeHandoff.clientContract?.statusRevision || null,
        readinessStatus: runtimeHandoff.readinessStatus || job.status || "ready"
      },
      clientCommandAck: initialClientRuntimeAdoption.commandAck || {},
      restartContract: { replaySafe: true }
    },
    initialClientRuntimeAdoption,
    initialClientRuntimeSettings,
    options
  );
  const initialRuntimeReleaseControls = deriveRuntimeReleaseControls(
    job,
    runtimeHandoff,
    providerServiceContract,
    providerSyncCheckpoint,
    lifecycleControls,
    initialClientRuntimeSettings,
    initialSettingsRolloutGate,
    initialClientStatusHandoff,
    { clientAck: { required: false, ackKeys: [] } }
  );
  const clientStatusDiagnostics = clientStatusHandoffDiagnostics(initialClientStatusHandoff);
  const releaseControlDiagnostics = runtimeReleaseControlDiagnostics(initialRuntimeReleaseControls);
  const diagnostics = [
    ...(job.diagnostics || []),
    ...serviceDiagnostics,
    ...providerSyncDiagnostics,
    ...boundaryDiagnostics,
    ...lifecycleDiagnostics,
    ...adoptionDiagnostics,
    ...settingsDiagnostics,
    ...settingsRolloutDiagnostics,
    ...clientStatusDiagnostics,
    ...releaseControlDiagnostics
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
  const clientCommandLeaseReplayHandoff = deriveClientCommandLeaseReplayHandoff(
    job,
    status,
    clientCommandLeases,
    statusHandoff
  );
  const statusRecoveryBundle = buildStatusRecoveryBundle(
    job,
    statusHandoff,
    recoveryCommands,
    failureState,
    clientCommandLeases
  );
  const restartCheckpointManifest = buildRestartCheckpointManifest(
    job,
    statusHandoff,
    recoveryCommands,
    failureState,
    clientCommandLeases,
    statusRecoveryBundle
  );
  const restartReplayLedger = buildRestartReplayLedger(
    job,
    statusHandoff,
    recoveryCommands,
    failureState,
    clientCommandLeases,
    statusRecoveryBundle,
    restartCheckpointManifest
  );
  const clientRuntimeAdoption = deriveClientRuntimeAdoption(
    job,
    runtimeHandoff,
    options,
    statusHandoff,
    clientCommandLeases
  );
  const clientRuntimeSettings = deriveClientRuntimeSettings(
    job,
    runtimeHandoff,
    lifecycleControls,
    clientRuntimeAdoption,
    options
  );
  const settingsRolloutGate = deriveSettingsRolloutGate(
    job,
    runtimeHandoff,
    lifecycleControls,
    clientRuntimeSettings,
    options
  );
  const clientStatusHandoff = deriveClientStatusHandoff(
    job,
    runtimeHandoff,
    status,
    statusHandoff,
    clientRuntimeAdoption,
    clientRuntimeSettings,
    options
  );
  const runtimeReleaseControls = deriveRuntimeReleaseControls(
    job,
    runtimeHandoff,
    providerServiceContract,
    providerSyncCheckpoint,
    lifecycleControls,
    clientRuntimeSettings,
    settingsRolloutGate,
    clientStatusHandoff,
    clientCommandLeases
  );
  const operationalIncidents = buildOperationalIncidentQueue(
    job,
    status,
    diagnostics,
    nextActions,
    recoveryCommands,
    failureState,
    providerServiceContract,
    statusRecoveryBundle,
    restartCheckpointManifest,
    permissionBoundary
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
  const providerExportReadiness = deriveProviderExportReadiness(
    job,
    status,
    providerServiceContract,
    providerSyncCheckpoint,
    runtimeReleaseControls,
    statusLedger,
    options
  );
  const providerExportDiagnostics = providerExportReadinessDiagnostics(providerExportReadiness)
    .map((diagnostic, index) => ({
      ...diagnostic,
      id: stableDiagnosticId(job.id, diagnostic, diagnostics.length + index),
      provider: "mailchimp",
      scope: diagnosticScope(diagnostic),
      recoveryAction: recoveryActionFor(diagnostic, runtimeHandoff),
      blocksRuntimeHandoff: normalizeSeverity(diagnostic) === "error",
      userVisible: true,
      source: "provider-export-readiness"
    }));
  const providerCallbackHandoff = deriveProviderCallbackHandoff(
    job,
    providerServiceContract,
    statusLedger,
    options
  );
  const providerCallbackDiagnostics = providerCallbackHandoffDiagnostics(providerCallbackHandoff)
    .map((diagnostic, index) => ({
      ...diagnostic,
      id: stableDiagnosticId(
        job.id,
        diagnostic,
        diagnostics.length + providerExportDiagnostics.length + index
      ),
      provider: "mailchimp",
      severity: normalizeSeverity(diagnostic),
      scope: diagnosticScope(diagnostic),
      recoveryAction: recoveryActionFor(diagnostic, runtimeHandoff),
      blocksRuntimeHandoff: normalizeSeverity(diagnostic) === "error",
      userVisible: true,
      source: "provider-callback-handoff"
    }));
  const persistedStatusEnvelope = buildPersistedStatusEnvelope(
    job,
    status,
    statusLedger,
    statusHandoff,
    recoveryCommands,
    failureState,
    clientCommandLeases
  );
  const clientWorkflow = buildVisibleWorkflow(job, status, runtimeHandoff, counts, nextActions, clientCommandLeases);
  const previewHandoff = buildPreviewHandoffSnapshot(
    job,
    status,
    runtimeHandoff,
    counts,
    nextActions,
    clientWorkflow,
    lifecycleControls,
    permissionBoundary,
    clientRuntimeSettings
  );
  const exportLedger = buildDiagnosticExportLedger(
    job,
    status,
    diagnostics,
    counts,
    statusLedger,
    recoveryCommands,
    failureState,
    statusRecoveryBundle,
    restartCheckpointManifest,
    operationalIncidents
  );
  const previewExportReadiness = buildPreviewExportReadiness(
    job,
    status,
    runtimeHandoff,
    counts,
    previewHandoff,
    clientWorkflow,
    lifecycleControls,
    exportLedger,
    statusLedger
  );
  const previewAcceptancePacket = buildPreviewAcceptancePacket(
    job,
    status,
    counts,
    previewHandoff,
    previewExportReadiness,
    statusLedger,
    runtimeReleaseControls
  );
  const previewReleaseTicket = derivePreviewReleaseTicket(
    job,
    status,
    previewAcceptancePacket,
    runtimeReleaseControls,
    statusLedger,
    options
  );
  const serviceLevelObjectives = deriveServiceLevelObjectiveState(
    job,
    status,
    counts,
    runtimeHandoff,
    providerServiceContract,
    providerSyncCheckpoint,
    failureState,
    operationalIncidents,
    statusRecoveryBundle,
    restartCheckpointManifest
  );
  const clientRemediationPacket = buildClientRemediationPacket(
    job,
    status,
    counts,
    statusLedger,
    operationalIncidents,
    clientStatusHandoff,
    clientRuntimeAdoption,
    clientRuntimeSettings,
    previewHandoff,
    runtimeReleaseControls,
    serviceLevelObjectives
  );

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
      grantPlan: {
        status: permissionGrantPlan.status,
        commandIds: permissionGrantPlan.commands.map((command) => command.id),
        blocking: permissionGrantPlan.summary.blocking,
        nextAction: permissionGrantPlan.nextAction
      },
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "permission-boundary")
        .map((diagnostic) => diagnostic.id),
      status: permissionBoundary.safeBoundary
        ? boundaryDiagnostics.length > 0 ? "needs-operator-action" : "ready"
        : "blocked"
    },
    tenantBoundaryPosture: {
      ...tenantBoundaryPosture,
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "permission-boundary")
        .map((diagnostic) => diagnostic.id),
      auditHandoff: {
        ...tenantBoundaryPosture.auditHandoff,
        diagnosticIds: diagnostics
          .filter((diagnostic) => diagnostic.source === "permission-boundary")
          .map((diagnostic) => diagnostic.id)
      }
    },
    providerServiceContract: {
      ...providerServiceContract,
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "provider-service-contract")
        .map((diagnostic) => diagnostic.id)
    },
    providerSyncCheckpoint: {
      ...providerSyncCheckpoint,
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "provider-sync-checkpoint")
        .map((diagnostic) => diagnostic.id)
    },
    providerExportReadiness: {
      ...providerExportReadiness,
      diagnosticIds: providerExportDiagnostics.map((diagnostic) => diagnostic.id),
      diagnostics: providerExportDiagnostics
    },
    providerCallbackHandoff: {
      ...providerCallbackHandoff,
      diagnosticIds: providerCallbackDiagnostics.map((diagnostic) => diagnostic.id),
      diagnostics: providerCallbackDiagnostics
    },
    lifecycleControls,
    permissionGrantPlan,
    tenantPermissionEnforcement: {
      ...tenantPermissionEnforcement,
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "permission-boundary")
        .map((diagnostic) => diagnostic.id),
      audit: {
        ...tenantPermissionEnforcement.audit,
        diagnosticIds: diagnostics
          .filter((diagnostic) => diagnostic.source === "permission-boundary")
          .map((diagnostic) => diagnostic.id)
      }
    },
    clientRuntimeAdoption: {
      ...clientRuntimeAdoption,
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "client-runtime-adoption")
        .map((diagnostic) => diagnostic.id)
    },
    clientRuntimeSettings: {
      ...clientRuntimeSettings,
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "client-runtime-settings")
        .map((diagnostic) => diagnostic.id)
    },
    settingsRolloutGate: {
      ...settingsRolloutGate,
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "settings-rollout-gate")
        .map((diagnostic) => diagnostic.id)
    },
    clientStatusHandoff: {
      ...clientStatusHandoff,
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "client-status-handoff")
        .map((diagnostic) => diagnostic.id)
    },
    runtimeReleaseControls: {
      ...runtimeReleaseControls,
      diagnosticIds: diagnostics
        .filter((diagnostic) => diagnostic.source === "runtime-release-controls")
        .map((diagnostic) => diagnostic.id)
    },
    diagnostics,
    counts,
    nextActions,
    recoveryCommands,
    clientCommandLeases,
    clientCommandLeaseReplayHandoff,
    failureState,
    statusLedger,
    persistedStatusEnvelope,
    statusHandoff,
    statusRecoveryBundle,
    restartCheckpointManifest,
    restartReplayLedger,
    operationalIncidents,
    serviceLevelObjectives,
    clientRemediationPacket,
    clientWorkflow,
    previewHandoff,
    previewAcceptancePacket,
    previewReleaseTicket,
    previewExportReadiness,
    exportLedger,
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
      persistedStatusEnvelope: {
        status: persistedStatusEnvelope.status,
        readyForRuntimeResume: persistedStatusEnvelope.readyForRuntimeResume,
        nextAction: persistedStatusEnvelope.nextAction,
        resumeToken: persistedStatusEnvelope.resumeToken,
        statusRevision: persistedStatusEnvelope.statusRevision,
        blockedCommandIds: persistedStatusEnvelope.blocking.commandIds,
        unsafeCommandIds: persistedStatusEnvelope.blocking.unsafeCommandIds
      },
      statusRecoveryBundle: {
        state: statusRecoveryBundle.state,
        readyForRuntimeResume: statusRecoveryBundle.readyForRuntimeResume,
        nextAction: statusRecoveryBundle.nextAction,
        resumeToken: statusRecoveryBundle.resume.resumeToken,
        missingRequiredCheckpoints: statusRecoveryBundle.blocking.missingRequiredCheckpoints
      },
      restartCheckpointManifest: {
        status: restartCheckpointManifest.status,
        readyForColdRestart: restartCheckpointManifest.readyForColdRestart,
        nextAction: restartCheckpointManifest.nextAction,
        resumeToken: restartCheckpointManifest.resumeToken,
        missingRequiredCheckpoints: restartCheckpointManifest.blocking.missingRequiredCheckpoints
      },
      restartReplayLedger: {
        status: restartReplayLedger.status,
        replayReady: restartReplayLedger.replayReady,
        nextAction: restartReplayLedger.nextAction,
        resumeToken: restartReplayLedger.resumeToken,
        unsafeRows: restartReplayLedger.counters.unsafe,
        ackRequired: restartReplayLedger.counters.ackRequired,
        blocked: restartReplayLedger.counters.blocked
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
      clientStatusHandoff: {
        status: clientStatusHandoff.status,
        visibleStatus: clientStatusHandoff.visibleStatus,
        readyForClient: clientStatusHandoff.readyForClient,
        readyForRuntime: clientStatusHandoff.readyForRuntime,
        routeId: clientStatusHandoff.route.routeId,
        nextAction: clientStatusHandoff.nextAction,
        statusRevision: clientStatusHandoff.statusLedger.statusRevision,
        pendingAckKeys: clientStatusHandoff.commandAck.pendingKeys
      },
      clientCommandLeaseReplayHandoff: {
        status: clientCommandLeaseReplayHandoff.status,
        readyForClient: clientCommandLeaseReplayHandoff.readyForClient,
        readyForRuntime: clientCommandLeaseReplayHandoff.readyForRuntime,
        routeId: clientCommandLeaseReplayHandoff.routeId,
        resumeToken: clientCommandLeaseReplayHandoff.resumeToken,
        nextAction: clientCommandLeaseReplayHandoff.nextAction,
        ackRequired: clientCommandLeaseReplayHandoff.ack.required,
        blockedLeaseIds: clientCommandLeaseReplayHandoff.validationSummary.blockedLeaseIds,
        ackLeaseIds: clientCommandLeaseReplayHandoff.validationSummary.ackLeaseIds,
        unsafeLeaseIds: clientCommandLeaseReplayHandoff.validationSummary.unsafeLeaseIds
      },
      settingsRolloutGate: {
        status: settingsRolloutGate.status,
        readyForRuntimeStart: settingsRolloutGate.readyForRuntimeStart,
        rolloutKey: settingsRolloutGate.rolloutKey,
        settingsRevision: settingsRolloutGate.settingsRevision,
        nextAction: settingsRolloutGate.nextAction,
        nextGateId: settingsRolloutGate.nextGateId,
        blockedGateIds: settingsRolloutGate.clientPatch.mailchimpSettingsRolloutBlockedGateIds
      },
      previewHandoff: {
        status: previewHandoff.status,
        routeId: previewHandoff.routeId,
        visible: previewHandoff.visible,
        readyForAcceptance: previewHandoff.readyForAcceptance,
        readyForRuntimeStart: previewHandoff.readyForRuntimeStart,
        nextAction: previewHandoff.primaryAction,
        acceptanceToken: previewHandoff.acceptance.token,
        blockedGateIds: previewHandoff.acceptance.blockedGateIds,
        pendingGateIds: previewHandoff.acceptance.pendingGateIds
      },
      previewAcceptancePacket: {
        status: previewAcceptancePacket.status,
        readyForAcceptance: previewAcceptancePacket.readyForAcceptance,
        readyForRuntimeStart: previewAcceptancePacket.readyForRuntimeStart,
        acceptanceToken: previewAcceptancePacket.acceptanceToken,
        routeId: previewAcceptancePacket.routeId,
        nextAction: previewAcceptancePacket.nextAction,
        blocked: previewAcceptancePacket.validationSummary.blocked,
        pending: previewAcceptancePacket.validationSummary.pending
      },
      failureState: {
        mode: failureState.mode,
        queueLength: failureState.summary.total,
        retryableCount: failureState.summary.retryable,
        nextRetry: failureState.nextRetry,
        adapterHandoff: failureState.adapterHandoff
      },
      operationalIncidents: {
        status: operationalIncidents.status,
        incidentCount: operationalIncidents.incidentCount,
        blocking: operationalIncidents.summary.blocking,
        retryable: operationalIncidents.summary.retryable,
        nextIncidentId: operationalIncidents.nextIncidentId,
        nextAction: operationalIncidents.nextAction
      },
      serviceLevelObjectives: {
        status: serviceLevelObjectives.status,
        healthLevel: serviceLevelObjectives.healthLevel,
        readyForRuntimeRelease: serviceLevelObjectives.readyForRuntimeRelease,
        breached: serviceLevelObjectives.counters.breached,
        blocking: serviceLevelObjectives.counters.blocking,
        nextAction: serviceLevelObjectives.nextAction,
        nextBreachId: serviceLevelObjectives.nextBreachId
      },
      clientRemediationPacket: {
        status: clientRemediationPacket.status,
        visibleStatus: clientRemediationPacket.visibleStatus,
        readyForClient: clientRemediationPacket.readyForClient,
        readyForRuntime: clientRemediationPacket.readyForRuntime,
        routeId: clientRemediationPacket.route.routeId,
        nextAction: clientRemediationPacket.nextAction,
        blocking: clientRemediationPacket.counters.blocking,
        waiting: clientRemediationPacket.counters.waiting,
        resumeToken: clientRemediationPacket.route.resumeToken
      },
      providerSyncCheckpoint: {
        status: providerSyncCheckpoint.status,
        ready: providerSyncCheckpoint.ready,
        nextAction: providerSyncCheckpoint.nextAction,
        missingAckMounts: providerSyncCheckpoint.missingAckMounts,
        missingWatermarkMounts: providerSyncCheckpoint.missingWatermarkMounts
      },
      providerExportReadiness: {
        status: providerExportReadiness.status,
        ready: providerExportReadiness.ready,
        exportReady: providerExportReadiness.exportReady,
        nextAction: providerExportReadiness.nextAction,
        exportKey: providerExportReadiness.exportKey,
        resumeToken: providerExportReadiness.resumeToken,
        blockedRows: providerExportReadiness.validationSummary.blockedRowIds,
        waitingRows: providerExportReadiness.validationSummary.waitingRowIds
      },
      tenantBoundaryPosture: {
        status: tenantBoundaryPosture.status,
        postureKey: tenantBoundaryPosture.postureKey,
        safeForRuntime: tenantBoundaryPosture.safeForRuntime,
        safeForAuditAppend: tenantBoundaryPosture.safeForAuditAppend,
        nextAction: tenantBoundaryPosture.nextAction,
        driftCount: tenantBoundaryPosture.clientPatch.tenantBoundaryDriftCount
      },
      previewExportReadiness: {
        status: previewExportReadiness.status,
        readyForClientPreview: previewExportReadiness.readyForClientPreview,
        readyForRuntimeStart: previewExportReadiness.readyForRuntimeStart,
        exportReady: previewExportReadiness.exportReady,
        nextAction: previewExportReadiness.nextAction,
        blockedRows: previewExportReadiness.exportSummary.blockedRowIds,
        waitingRows: previewExportReadiness.exportSummary.waitingRowIds
      },
      runtimeReleaseControls: {
        status: runtimeReleaseControls.status,
        readyForRuntimeStart: runtimeReleaseControls.readyForRuntimeStart,
        releaseKey: runtimeReleaseControls.releaseKey,
        nextAction: runtimeReleaseControls.nextAction,
        nextGateId: runtimeReleaseControls.nextGateId,
        blockedGateIds: runtimeReleaseControls.clientPatch.runtimeReleaseBlockedGateIds,
        waitingGateIds: runtimeReleaseControls.clientPatch.runtimeReleaseWaitingGateIds
      },
      previewReleaseTicket: {
        status: previewReleaseTicket.status,
        readyForRuntimeRelease: previewReleaseTicket.readyForRuntimeRelease,
        ticketKey: previewReleaseTicket.ticketKey,
        nextAction: previewReleaseTicket.nextAction,
        blockedRows: previewReleaseTicket.validationSummary.blockedRowIds,
        waitingRows: previewReleaseTicket.validationSummary.waitingRowIds
      }
    },
    truthBoundary: {
      source: "diagnostic-emitter",
      deterministic: true,
      externalMailchimpStateVerified: false,
      compiledLocally: true,
      includesLifecycleControls: true,
      includesProviderServiceContract: true,
      includesProviderSyncCheckpoint: true,
      includesClientWorkflowValidation: true,
      includesClientCommandLeases: true,
      includesClientCommandLeaseReplayHandoff: true,
      includesStatusHandoff: true,
      includesStatusRecoveryBundle: true,
      includesRestartCheckpointManifest: true,
      includesRestartReplayLedger: true,
      includesClientRuntimeAdoption: true
      ,
      includesClientRuntimeSettings: true,
      includesSettingsRolloutGate: true,
      includesClientStatusHandoff: true,
      includesPreviewHandoff: true,
      includesPreviewAcceptancePacket: true,
      includesPreviewReleaseTicket: true,
      includesPermissionGrantPlan: true,
      includesTenantPermissionEnforcement: true,
      includesTenantBoundaryPosture: true,
      includesOperationalIncidentQueue: true,
      includesServiceLevelObjectives: true,
      includesClientRemediationPacket: true,
      includesDiagnosticExportLedger: true,
      includesPreviewExportReadiness: true,
      includesRuntimeReleaseControls: true,
      includesProviderExportReadiness: true
    }
  };
}

export function assertMailchimpDiagnosticsReady(emission) {
  const diagnostics = emission?.diagnostics || [];
  const statusLedger = emission?.statusLedger || {};
  const failureState = emission?.failureState || {};
  const lifecycleControls = emission?.lifecycleControls || {};
  const providerServiceContract = emission?.providerServiceContract || {};
  const providerSyncCheckpoint = emission?.providerSyncCheckpoint || {};
  const providerExportReadiness = emission?.providerExportReadiness || {};
  const clientWorkflow = emission?.clientWorkflow || {};
  const previewHandoff = emission?.previewHandoff || {};
  const previewAcceptancePacket = emission?.previewAcceptancePacket || {};
  const previewReleaseTicket = emission?.previewReleaseTicket || {};
  const clientCommandLeases = emission?.clientCommandLeases || {};
  const clientCommandLeaseReplayHandoff = emission?.clientCommandLeaseReplayHandoff || {};
  const statusHandoff = emission?.statusHandoff || {};
  const persistedStatusEnvelope = emission?.persistedStatusEnvelope || {};
  const statusRecoveryBundle = emission?.statusRecoveryBundle || {};
  const restartCheckpointManifest = emission?.restartCheckpointManifest || {};
  const restartReplayLedger = emission?.restartReplayLedger || {};
  const clientRuntimeAdoption = emission?.clientRuntimeAdoption || {};
  const clientRuntimeSettings = emission?.clientRuntimeSettings || {};
  const settingsRolloutGate = emission?.settingsRolloutGate || {};
  const clientStatusHandoff = emission?.clientStatusHandoff || {};
  const permissionGrantPlan = emission?.permissionGrantPlan || {};
  const tenantPermissionEnforcement = emission?.tenantPermissionEnforcement || {};
  const tenantBoundaryPosture = emission?.tenantBoundaryPosture || {};
  const operationalIncidents = emission?.operationalIncidents || {};
  const serviceLevelObjectives = emission?.serviceLevelObjectives || {};
  const clientRemediationPacket = emission?.clientRemediationPacket || {};
  const exportLedger = emission?.exportLedger || {};
  const previewExportReadiness = emission?.previewExportReadiness || {};
  const runtimeReleaseControls = emission?.runtimeReleaseControls || {};
  return {
    ok: emission?.provider === "mailchimp"
      && diagnostics.every((diagnostic) => diagnostic.id && diagnostic.code)
      && statusLedger.schemaVersion === "aios.mailchimp.status-ledger.v1"
      && Boolean(statusLedger.resumeToken)
      && statusHandoff.schemaVersion === "aios.mailchimp.status-handoff.v1"
      && Boolean(statusHandoff.statusLedger?.statusRevision)
      && Boolean(statusHandoff.clientPatch?.nextAction)
      && statusHandoff.restartContract?.replaySafe === true
      && persistedStatusEnvelope.schemaVersion === "aios.mailchimp.persisted-status-envelope.v1"
      && Boolean(persistedStatusEnvelope.resumeToken)
      && Boolean(persistedStatusEnvelope.statusRevision)
      && Array.isArray(persistedStatusEnvelope.rows)
      && persistedStatusEnvelope.restartSemantics?.externalWritesPerformed === false
      && statusRecoveryBundle.schemaVersion === "aios.mailchimp.status-recovery-bundle.v1"
      && Boolean(statusRecoveryBundle.resume?.resumeToken)
      && statusRecoveryBundle.restartSemantics?.externalWritesPerformed === false
      && restartCheckpointManifest.schemaVersion === "aios.mailchimp.restart-checkpoint-manifest.v1"
      && Boolean(restartCheckpointManifest.resumeToken)
      && Array.isArray(restartCheckpointManifest.checkpoints)
      && restartCheckpointManifest.restartSemantics?.externalWritesPerformed === false
      && restartReplayLedger.schemaVersion === "aios.mailchimp.restart-replay-ledger.v1"
      && Boolean(restartReplayLedger.resumeToken)
      && Array.isArray(restartReplayLedger.rows)
      && restartReplayLedger.restartSemantics?.externalWritesPerformed === false
      && clientRuntimeAdoption.schemaVersion === "aios.mailchimp.client-runtime-adoption.v1"
      && Boolean(clientRuntimeAdoption.adoptionId)
      && clientRuntimeSettings.schemaVersion === "aios.mailchimp.client-runtime-settings.v1"
      && Boolean(clientRuntimeSettings.settingsRevision)
      && clientRuntimeSettings.restartSemantics?.externalWritesPerformed === false
      && settingsRolloutGate.schemaVersion === "aios.mailchimp.settings-rollout-gate.v1"
      && Boolean(settingsRolloutGate.rolloutKey)
      && Array.isArray(settingsRolloutGate.checkpoints)
      && settingsRolloutGate.restartSemantics?.externalWritesPerformed === false
      && clientStatusHandoff.schemaVersion === "aios.mailchimp.client-status-handoff.v1"
      && Boolean(clientStatusHandoff.statusId)
      && Boolean(clientStatusHandoff.route?.idempotencyKey)
      && clientStatusHandoff.restartSemantics?.externalWritesPerformed === false
      && permissionGrantPlan.schemaVersion === "aios.mailchimp.permission-grant-plan.v1"
      && Array.isArray(permissionGrantPlan.commands)
      && permissionGrantPlan.restartSemantics?.externalWritesPerformed === false
      && operationalIncidents.schemaVersion === "aios.mailchimp.operational-incident-queue.v1"
      && Array.isArray(operationalIncidents.incidents)
      && Boolean(operationalIncidents.nextAction)
      && serviceLevelObjectives.schemaVersion === "aios.mailchimp.service-level-objectives.v1"
      && Array.isArray(serviceLevelObjectives.objectives)
      && Array.isArray(serviceLevelObjectives.breaches)
      && Boolean(serviceLevelObjectives.nextAction)
      && serviceLevelObjectives.restartSemantics?.externalWritesPerformed === false
      && clientRemediationPacket.schemaVersion === "aios.mailchimp.client-remediation-packet.v1"
      && Boolean(clientRemediationPacket.route?.idempotencyKey)
      && Array.isArray(clientRemediationPacket.steps)
      && clientRemediationPacket.restartSemantics?.externalWritesPerformed === false
      && exportLedger.schemaVersion === "aios.mailchimp.diagnostic-export-ledger.v1"
      && Boolean(exportLedger.resumeToken)
      && Array.isArray(exportLedger.rows)
      && exportLedger.restartSemantics?.externalWritesPerformed === false
      && previewExportReadiness.schemaVersion === "aios.mailchimp.preview-export-readiness.v1"
      && Boolean(previewExportReadiness.resumeToken)
      && Array.isArray(previewExportReadiness.rows)
      && previewExportReadiness.restartSemantics?.externalWritesPerformed === false
      && runtimeReleaseControls.schemaVersion === "aios.mailchimp.runtime-release-controls.v1"
      && Boolean(runtimeReleaseControls.releaseKey)
      && Array.isArray(runtimeReleaseControls.gates)
      && runtimeReleaseControls.restartSemantics?.externalWritesPerformed === false
      && clientRuntimeAdoption.restartSemantics?.externalWritesPerformed === false
      && failureState.schemaVersion === "aios.mailchimp.failure-state.v1"
      && Array.isArray(failureState.queue)
      && lifecycleControls.schemaVersion === "aios.mailchimp.lifecycle-controls.v1"
      && Boolean(lifecycleControls.nextAction)
      && providerServiceContract.schemaVersion === "aios.mailchimp.provider-service-contract.v1"
      && Boolean(providerServiceContract.externalHandoff?.idempotencyKey)
      && providerSyncCheckpoint.schemaVersion === "aios.mailchimp.provider-sync-checkpoint.v1"
      && Boolean(providerSyncCheckpoint.resumeToken)
      && Array.isArray(providerSyncCheckpoint.checkpointRows)
      && providerSyncCheckpoint.restartSemantics?.externalWritesPerformed === false
      && providerExportReadiness.schemaVersion === "aios.mailchimp.provider-export-readiness.v1"
      && Boolean(providerExportReadiness.exportKey)
      && Boolean(providerExportReadiness.resumeToken)
      && Array.isArray(providerExportReadiness.rows)
      && providerExportReadiness.restartSemantics?.externalWritesPerformed === false
      && tenantPermissionEnforcement.schemaVersion === "aios.mailchimp.tenant-permission-enforcement.v1"
      && Boolean(tenantPermissionEnforcement.enforcementKey)
      && Array.isArray(tenantPermissionEnforcement.decisions)
      && tenantPermissionEnforcement.restartSemantics?.externalWritesPerformed === false
      && tenantBoundaryPosture.schemaVersion === "aios.mailchimp.tenant-boundary-posture.v1"
      && Boolean(tenantBoundaryPosture.postureKey)
      && tenantBoundaryPosture.auditHandoff?.externalWritesPerformed === false
      && tenantBoundaryPosture.restartSemantics?.externalWritesPerformed === false
      && clientWorkflow.schemaVersion === "aios.mailchimp.client-workflow.v1"
      && Boolean(clientWorkflow.explainNextStep?.action)
      && previewHandoff.schemaVersion === "aios.mailchimp.preview-handoff.v1"
      && Boolean(previewHandoff.routePayload?.idempotencyKey)
      && Boolean(previewHandoff.acceptance?.token)
      && previewHandoff.restartSemantics?.externalWritesPerformed === false
      && previewAcceptancePacket.schemaVersion === "aios.mailchimp.preview-acceptance-packet.v1"
      && Boolean(previewAcceptancePacket.acceptanceToken)
      && Boolean(previewAcceptancePacket.routePayload?.idempotencyKey)
      && Array.isArray(previewAcceptancePacket.checkpoints)
      && previewAcceptancePacket.restartSemantics?.externalWritesPerformed === false
      && previewReleaseTicket.schemaVersion === "aios.mailchimp.preview-release-ticket.v1"
      && Boolean(previewReleaseTicket.ticketKey)
      && Array.isArray(previewReleaseTicket.rows)
      && Array.isArray(previewReleaseTicket.validationSummary?.blockedRowIds)
      && previewReleaseTicket.restartSemantics?.externalWritesPerformed === false
      && clientCommandLeases.schemaVersion === "aios.mailchimp.client-command-leases.v1"
      && Array.isArray(clientCommandLeases.leases)
      && Boolean(clientCommandLeases.clientAck?.resumeToken)
      && clientCommandLeaseReplayHandoff.schemaVersion === "aios.mailchimp.client-command-lease-replay-handoff.v1"
      && Boolean(clientCommandLeaseReplayHandoff.routePayload?.idempotencyKey)
      && Boolean(clientCommandLeaseReplayHandoff.resumeToken)
      && Array.isArray(clientCommandLeaseReplayHandoff.rows)
      && clientCommandLeaseReplayHandoff.restartSemantics?.externalWritesPerformed === false,
    blockingDiagnosticIds: diagnostics
      .filter((diagnostic) => diagnostic.blocksRuntimeHandoff)
      .map((diagnostic) => diagnostic.id),
    resumeToken: statusLedger.resumeToken || null,
    statusHandoffState: statusHandoff.handoffState || "unknown",
    statusHandoffVisibleStatus: statusHandoff.visibleStatus || "unknown",
    statusHandoffNextAction: statusHandoff.nextAction || null,
    statusHandoffAckRequired: statusHandoff.clientCommandAck?.required === true,
    persistedStatusEnvelopeStatus: persistedStatusEnvelope.status || "unknown",
    persistedStatusEnvelopeReady: persistedStatusEnvelope.readyForRuntimeResume === true,
    persistedStatusEnvelopeNextAction: persistedStatusEnvelope.nextAction || null,
    persistedStatusEnvelopeBlockedCommands: persistedStatusEnvelope.blocking?.commandIds || [],
    persistedStatusEnvelopeUnsafeCommands: persistedStatusEnvelope.blocking?.unsafeCommandIds || [],
    statusRecoveryState: statusRecoveryBundle.state || "unknown",
    statusRecoveryReady: statusRecoveryBundle.readyForRuntimeResume === true,
    statusRecoveryNextAction: statusRecoveryBundle.nextAction || null,
    restartCheckpointStatus: restartCheckpointManifest.status || "unknown",
    restartCheckpointReady: restartCheckpointManifest.readyForColdRestart === true,
    restartCheckpointNextAction: restartCheckpointManifest.nextAction || null,
    restartCheckpointMissing: restartCheckpointManifest.blocking?.missingRequiredCheckpoints || [],
    restartReplayStatus: restartReplayLedger.status || "unknown",
    restartReplayReady: restartReplayLedger.replayReady === true,
    restartReplayNextAction: restartReplayLedger.nextAction || null,
    restartReplayUnsafeRows: restartReplayLedger.counters?.unsafe || 0,
    restartReplayAckRequired: restartReplayLedger.counters?.ackRequired || 0,
    clientRuntimeAdoptionStatus: clientRuntimeAdoption.status || "unknown",
    clientRuntimeReady: clientRuntimeAdoption.readyForClientRuntime === true,
    clientRuntimeAdoptionNextAction: clientRuntimeAdoption.nextAction || null,
    clientRuntimeMissingStateKeys: clientRuntimeAdoption.missingStateKeys || [],
    clientRuntimePendingAckKeys: clientRuntimeAdoption.commandAck?.pendingKeys || [],
    clientRuntimeSettingsStatus: clientRuntimeSettings.status || "unknown",
    clientRuntimeSettingsRevision: clientRuntimeSettings.settingsRevision || null,
    clientRuntimeSettingsNextAction: clientRuntimeSettings.nextAction || null,
    clientRuntimeSettingsMissingKeys: clientRuntimeSettings.missingRequiredSettings || [],
    settingsRolloutGateStatus: settingsRolloutGate.status || "unknown",
    settingsRolloutGateReady: settingsRolloutGate.readyForRuntimeStart === true,
    settingsRolloutGateNextAction: settingsRolloutGate.nextAction || null,
    settingsRolloutGateNextGateId: settingsRolloutGate.nextGateId || null,
    settingsRolloutGateBlockedGateIds: settingsRolloutGate.clientPatch?.mailchimpSettingsRolloutBlockedGateIds || [],
    restartSafe: statusLedger.restartSafe?.replaySafe === true,
    failureMode: failureState.mode || "unknown",
    lifecycleStatus: lifecycleControls.status || "unknown",
    runtimeStartEnabled: lifecycleControls.runtimeStart?.enabled === true,
    providerServiceStatus: providerServiceContract.status || "unknown",
    providerSyncCheckpointStatus: providerSyncCheckpoint.status || "unknown",
    providerSyncCheckpointReady: providerSyncCheckpoint.ready === true,
    providerSyncCheckpointNextAction: providerSyncCheckpoint.nextAction || null,
    providerSyncCheckpointMissingAckMounts: providerSyncCheckpoint.missingAckMounts || [],
    providerSyncCheckpointMissingWatermarkMounts: providerSyncCheckpoint.missingWatermarkMounts || [],
    providerExportReadinessStatus: providerExportReadiness.status || "unknown",
    providerExportReady: providerExportReadiness.exportReady === true,
    providerExportNextAction: providerExportReadiness.nextAction || null,
    providerExportResumeToken: providerExportReadiness.resumeToken || null,
    providerExportBlockedRows: providerExportReadiness.validationSummary?.blockedRowIds || [],
    providerExportWaitingRows: providerExportReadiness.validationSummary?.waitingRowIds || [],
    previewReleaseTicketStatus: previewReleaseTicket.status || "unknown",
    previewReleaseTicketReady: previewReleaseTicket.readyForRuntimeRelease === true,
    previewReleaseTicketNextAction: previewReleaseTicket.nextAction || null,
    previewReleaseTicketKey: previewReleaseTicket.ticketKey || null,
    previewReleaseTicketBlockedRows: previewReleaseTicket.validationSummary?.blockedRowIds || [],
    previewReleaseTicketWaitingRows: previewReleaseTicket.validationSummary?.waitingRowIds || [],
    permissionGrantPlanStatus: permissionGrantPlan.status || "unknown",
    permissionGrantPlanNextAction: permissionGrantPlan.nextAction || null,
    permissionGrantBlockingCount: permissionGrantPlan.summary?.blocking || 0,
    tenantPermissionEnforcementStatus: tenantPermissionEnforcement.status || "unknown",
    tenantPermissionEnforcementKey: tenantPermissionEnforcement.enforcementKey || null,
    tenantPermissionEnforcementNextAction: tenantPermissionEnforcement.nextAction || null,
    tenantPermissionAuditReady: tenantPermissionEnforcement.audit?.ready === true,
    tenantPermissionBlockedDecisions: tenantPermissionEnforcement.counters?.blocked || 0,
    tenantBoundaryPostureStatus: tenantBoundaryPosture.status || "unknown",
    tenantBoundaryPostureKey: tenantBoundaryPosture.postureKey || null,
    tenantBoundarySafeForRuntime: tenantBoundaryPosture.safeForRuntime === true,
    tenantBoundarySafeForAuditAppend: tenantBoundaryPosture.safeForAuditAppend === true,
    tenantBoundaryPostureNextAction: tenantBoundaryPosture.nextAction || null,
    tenantBoundaryDriftCount: tenantBoundaryPosture.clientPatch?.tenantBoundaryDriftCount || 0,
    operationalIncidentStatus: operationalIncidents.status || "unknown",
    operationalIncidentCount: operationalIncidents.incidentCount || 0,
    operationalIncidentBlockingCount: operationalIncidents.summary?.blocking || 0,
    operationalIncidentNextAction: operationalIncidents.nextAction || null,
    serviceLevelObjectiveStatus: serviceLevelObjectives.status || "unknown",
    serviceLevelObjectiveHealth: serviceLevelObjectives.healthLevel || "unknown",
    serviceLevelObjectiveReadyForRuntimeRelease: serviceLevelObjectives.readyForRuntimeRelease === true,
    serviceLevelObjectiveBreaches: serviceLevelObjectives.counters?.breached || 0,
    serviceLevelObjectiveBlocking: serviceLevelObjectives.counters?.blocking || 0,
    serviceLevelObjectiveNextAction: serviceLevelObjectives.nextAction || null,
    clientRemediationStatus: clientRemediationPacket.status || "unknown",
    clientRemediationVisibleStatus: clientRemediationPacket.visibleStatus || "unknown",
    clientRemediationReadyForClient: clientRemediationPacket.readyForClient === true,
    clientRemediationReadyForRuntime: clientRemediationPacket.readyForRuntime === true,
    clientRemediationNextAction: clientRemediationPacket.nextAction || null,
    clientRemediationRouteId: clientRemediationPacket.route?.routeId || null,
    clientRemediationBlocking: clientRemediationPacket.counters?.blocking || 0,
    clientRemediationWaiting: clientRemediationPacket.counters?.waiting || 0,
    diagnosticExportLedgerReady: exportLedger.exportReady === true,
    diagnosticExportLedgerRows: exportLedger.rows?.length || 0,
    diagnosticExportLedgerNextAction: exportLedger.nextAction || null,
    previewExportReadinessStatus: previewExportReadiness.status || "unknown",
    previewExportReady: previewExportReadiness.exportReady === true,
    previewExportRuntimeStartReady: previewExportReadiness.readyForRuntimeStart === true,
    previewExportNextAction: previewExportReadiness.nextAction || null,
    previewExportBlockedRows: previewExportReadiness.exportSummary?.blockedRowIds || [],
    runtimeReleaseControlsStatus: runtimeReleaseControls.status || "unknown",
    runtimeReleaseControlsReady: runtimeReleaseControls.readyForRuntimeStart === true,
    runtimeReleaseControlsNextAction: runtimeReleaseControls.nextAction || null,
    runtimeReleaseControlsNextGateId: runtimeReleaseControls.nextGateId || null,
    runtimeReleaseControlsBlockedGateIds: runtimeReleaseControls.clientPatch?.runtimeReleaseBlockedGateIds || [],
    runtimeReleaseControlsWaitingGateIds: runtimeReleaseControls.clientPatch?.runtimeReleaseWaitingGateIds || [],
    providerService: providerServiceContract.providerService || null,
    providerServiceHandoffReady: providerServiceContract.externalHandoff?.ready === true,
    clientWorkflowPhase: clientWorkflow.phase || "unknown",
    clientWorkflowValidationBlocked: clientWorkflow.validationSummary?.blocked || 0,
    previewHandoffStatus: previewHandoff.status || "unknown",
    previewHandoffReadyForAcceptance: previewHandoff.readyForAcceptance === true,
    previewHandoffReadyForRuntimeStart: previewHandoff.readyForRuntimeStart === true,
    previewHandoffRouteId: previewHandoff.routeId || null,
    previewHandoffNextAction: previewHandoff.primaryAction || null,
    previewHandoffAcceptanceToken: previewHandoff.acceptance?.token || null,
    previewAcceptancePacketStatus: previewAcceptancePacket.status || "unknown",
    previewAcceptancePacketReady: previewAcceptancePacket.readyForAcceptance === true,
    previewAcceptancePacketRuntimeReady: previewAcceptancePacket.readyForRuntimeStart === true,
    previewAcceptancePacketNextAction: previewAcceptancePacket.nextAction || null,
    previewAcceptancePacketBlocked: previewAcceptancePacket.validationSummary?.blocked || 0,
    previewAcceptancePacketPending: previewAcceptancePacket.validationSummary?.pending || 0,
    clientCommandLeaseStatus: clientCommandLeases.leaseStatus || "unknown",
    clientCommandAckRequired: clientCommandLeases.clientAck?.required === true,
    clientCommandLeaseCount: clientCommandLeases.leases?.length || 0,
    clientCommandLeaseReplayHandoffStatus: clientCommandLeaseReplayHandoff.status || "unknown",
    clientCommandLeaseReplayHandoffReady: clientCommandLeaseReplayHandoff.readyForRuntime === true,
    clientCommandLeaseReplayHandoffRouteId: clientCommandLeaseReplayHandoff.routeId || null,
    clientCommandLeaseReplayHandoffNextAction: clientCommandLeaseReplayHandoff.nextAction || null,
    clientCommandLeaseReplayHandoffBlocked: clientCommandLeaseReplayHandoff.validationSummary?.blocked || 0,
    clientCommandLeaseReplayHandoffAckRequired: clientCommandLeaseReplayHandoff.ack?.required === true,
    retryableFailureCount: failureState.summary?.retryable || 0,
    nextAction: providerServiceContract.externalHandoff?.ready === false
      ? providerServiceContract.nextAction || "repair-provider-service-contract"
      : emission?.recovery?.nextAction || "emit-diagnostics"
  };
}
