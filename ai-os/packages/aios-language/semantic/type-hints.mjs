import { resolveAiosScopes } from "./scope-resolution.mjs";

function compactString(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function freezeArray(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

function getJobs(input = {}) {
  if (Array.isArray(input.jobs)) return input.jobs;
  if (Array.isArray(input.ast?.jobs)) return input.ast.jobs;
  return [];
}

function firstString(...values) {
  for (const value of values) {
    const text = compactString(value);
    if (text) return text;
  }
  return "";
}

function inferCapabilityType(capability = {}) {
  const boundary = compactString(capability.boundary || "internal");
  const name = compactString(capability.name || capability.scope || "capability");
  const provider = name.startsWith("campaign.") || name.startsWith("audience.") || name.startsWith("template.") || name.startsWith("report.")
    ? "mailchimp"
    : compactString(capability.provider || "local");

  return Object.freeze({
    kind: "capability",
    name,
    type: boundary === "external" || provider === "mailchimp" ? "ProviderCapability" : "LocalCapability",
    provider,
    boundary,
    runtimeShape: Object.freeze({
      scope: compactString(capability.scope || name),
      requiresLease: boundary === "external",
      requiresApproval: boundary === "external" && /create|update|schedule|delete|send/.test(name),
    }),
  });
}

function inferMemoryType(memory = {}) {
  const mode = compactString(memory.mode || "ephemeral");
  const name = compactString(memory.name || "memory");
  const durable = mode === "persistent" || mode === "durable";

  return Object.freeze({
    kind: "memory",
    name,
    type: durable ? "DurableMemoryMount" : "RuntimeMemoryMount",
    mode,
    runtimeShape: Object.freeze({
      retention: durable ? "explicit" : "runtime",
      readable: memory.readable !== false,
      writable: memory.writable !== false,
      providerSync: memory.providerSync === true || name === "campaignDraft" || name === "audienceSnapshot",
    }),
  });
}

function inferStepType(step = {}, runtimeScope = {}) {
  const name = compactString(step.name || step.id || "step");
  const adapter = compactString(step.adapter || "runtime");
  const reads = toArray(step.memoryReads || step.reads).map(compactString).filter(Boolean);
  const writes = toArray(step.memoryWrites || step.writes || step.output).map(compactString).filter(Boolean);
  const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability).map(compactString).filter(Boolean);
  const external = adapter.includes("mailchimp") || capabilityRefs.some((capability) => /create|update|schedule|send/.test(capability));
  const idempotencyKey = firstString(step.idempotencyKey, runtimeScope.idempotencyKey);

  return Object.freeze({
    kind: "step",
    name,
    type: external ? "AdapterEffectStep" : "PureRuntimeStep",
    adapter,
    runtimeShape: Object.freeze({
      reads: freezeArray(reads),
      writes: freezeArray(writes),
      capabilityRefs: freezeArray(capabilityRefs),
      returns: writes.length > 0 ? "MemoryPatch" : "RuntimeObservation",
      statusHandoff: external ? "requires-adapter-status" : "local-status",
      idempotencyKey,
      restartSafe: !external || Boolean(idempotencyKey),
    }),
  });
}

function inferVerifierType(verifier = {}) {
  const name = compactString(verifier.name || verifier.expression || "verifier");
  const expression = compactString(verifier.expression || verifier.claim || name);
  return Object.freeze({
    kind: "verifier",
    name,
    type: expression.includes("approval") || expression.includes("evidence") ? "EvidenceVerifier" : "ClaimVerifier",
    runtimeShape: Object.freeze({
      expression,
      blocking: verifier.blocking !== false,
      evidenceRequired: expression.includes("evidence") || expression.includes("approval"),
    }),
  });
}

function createTenantBoundaryShape(job = {}, scope = {}, hints = []) {
  const runtimeScope = scope?.runtimeScope || {};
  const persistedRuntime = scope?.persistedRuntime || {};
  const clientState = job.clientState || job.requestState || {};
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.provider === "mailchimp");
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const roles = [
    ...toArray(job.roles),
    ...toArray(job.actor?.roles),
    ...toArray(clientState.roles),
  ].map(compactString).filter(Boolean).sort();
  const permissions = [
    ...toArray(job.permissions),
    ...toArray(job.actor?.permissions),
    ...toArray(clientState.permissions),
  ].map(compactString).filter(Boolean).sort();
  const tenantId = firstString(clientState.tenantId, job.tenantId, runtimeScope.tenantId);
  const workspaceId = firstString(clientState.workspaceId, job.workspaceId, runtimeScope.workspaceId);
  const tenantScoped = providerCapabilities.length === 0 || (Boolean(tenantId) && Boolean(workspaceId));
  const actorScoped = adapterSteps.length === 0 || Boolean(firstString(clientState.userId, clientState.actorId, job.actor?.id, job.userId));
  const permissionDeclared = providerCapabilities.length === 0
    || permissions.length > 0
    || roles.length > 0
    || providerCapabilities.every((hint) => hint.runtimeShape.requiresApproval === false);

  return Object.freeze({
    protocol: "aios.type-hints.tenant-boundary.v1",
    tenantId,
    workspaceId,
    actorId: firstString(clientState.userId, clientState.actorId, job.actor?.id, job.userId),
    statusChannel: firstString(clientState.statusChannel, job.statusChannel, runtimeScope.statusChannel),
    restartToken: firstString(runtimeScope.restartToken, persistedRuntime.restartToken),
    tenantScoped,
    actorScoped,
    permissionDeclared,
    roles: freezeArray([...new Set(roles)]),
    permissions: freezeArray([...new Set(permissions)]),
    requiredAuditEvents: freezeArray([
      providerCapabilities.length > 0 && "mailchimp.type.boundary",
      adapterSteps.length > 0 && "aios.type.adapter_status",
      persistedRuntime.commands?.length > 0 && "aios.type.restart_commands",
    ].filter(Boolean)),
    violations: freezeArray([
      !tenantScoped && "tenant-workspace-required-for-mailchimp",
      !actorScoped && "actor-required-for-adapter-step",
      !permissionDeclared && "permission-or-role-required-for-provider-capability",
    ].filter(Boolean)),
  });
}

function createBoundaryHealthContract(scope = {}, tenantBoundary = {}) {
  const permissionBoundary = scope?.permissionBoundary || {};
  const heldCapabilities = toArray(permissionBoundary.heldCapabilities);
  const matrix = toArray(permissionBoundary.capabilities);
  const missingPermissionHolds = heldCapabilities.filter((capability) => {
    return toArray(capability.reasons).some((reason) => compactString(reason).startsWith("missing-permission:"));
  });
  const missingIdentityHolds = heldCapabilities.filter((capability) => {
    const reasons = toArray(capability.reasons).map(compactString);
    return reasons.includes("missing-tenant") || reasons.includes("missing-workspace") || reasons.includes("missing-actor");
  });
  const missingRuntimeHolds = heldCapabilities.filter((capability) => {
    const reasons = toArray(capability.reasons).map(compactString);
    return reasons.includes("missing-idempotency-key") || reasons.includes("missing-status-channel");
  });
  const degraded = tenantBoundary.violations?.length > 0 || heldCapabilities.length > 0;

  return Object.freeze({
    protocol: "aios.type-hints.boundary-health.v1",
    state: heldCapabilities.length > 0
      ? "blocked"
      : degraded
        ? "degraded"
        : matrix.length > 0
          ? "healthy"
          : "not-applicable",
    permissionMatrixStatus: compactString(permissionBoundary.status || "not-applicable"),
    acceptedForAdapter: permissionBoundary.auditHandoff?.acceptedForAdapter !== false && heldCapabilities.length === 0,
    tenantScoped: tenantBoundary.tenantScoped === true,
    actorScoped: tenantBoundary.actorScoped === true,
    permissionDeclared: tenantBoundary.permissionDeclared === true,
    counters: Object.freeze({
      mailchimpCapabilities: matrix.length,
      heldCapabilities: heldCapabilities.length,
      missingPermissionHolds: missingPermissionHolds.length,
      missingIdentityHolds: missingIdentityHolds.length,
      missingRuntimeHolds: missingRuntimeHolds.length,
      tenantViolations: tenantBoundary.violations?.length ?? 0,
    }),
    nextActions: freezeArray([
      missingIdentityHolds.length > 0 && Object.freeze({
        command: "attach_client_runtime_request",
        reason: "tenant/workspace/actor state is required before Mailchimp adapter handoff",
      }),
      missingPermissionHolds.length > 0 && Object.freeze({
        command: "grant_mailchimp_permission",
        reason: "actor permissions or capability grants do not satisfy required Mailchimp scopes",
        requiredPermissions: freezeArray([...new Set(missingPermissionHolds.map((capability) => capability.requiredPermission).filter(Boolean))]),
      }),
      missingRuntimeHolds.length > 0 && Object.freeze({
        command: "attach_recovery_status_handoff",
        reason: "external Mailchimp writes need idempotency and status channel state",
      }),
    ].filter(Boolean)),
    heldCapabilities: freezeArray(heldCapabilities.map((capability) => ({
      action: capability.action,
      requiredPermission: capability.requiredPermission,
      reasons: capability.reasons,
    }))),
  });
}

function createAdapterStatusReadiness(scope = {}, hints = []) {
  const ledger = scope?.adapterStatusLedger || {};
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const failures = toArray(ledger.failures);
  const missing = toArray(ledger.missing);
  const latest = toArray(ledger.latestByCapability);
  const pending = latest.filter((row) => compactString(row.state) === "pending");
  const succeeded = latest.filter((row) => compactString(row.state) === "succeeded");
  const needsStatus = adapterSteps.length > 0 && (ledger.state === "missing-status" || ledger.state === "unobserved");
  const state = failures.length > 0
    ? "blocked"
    : needsStatus
      ? "needs-status-snapshot"
      : pending.length > 0 || ledger.state === "pending"
        ? "waiting-adapter"
        : ledger.state === "unknown"
          ? "needs-status-reconciliation"
          : adapterSteps.length > 0 || providerCapabilities.length > 0
            ? "status-ready"
            : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.adapter-status-readiness.v1",
    state,
    acceptedForReplay: failures.length === 0 && missing.length === 0,
    acceptedForAdapter: ["status-ready", "not-required"].includes(state),
    statusChannel: compactString(ledger.statusChannel || scope?.runtimeScope?.statusChannel),
    statusSnapshotKey: compactString(ledger.statusSnapshotKey || scope?.persistedRuntime?.statusSnapshotKey),
    restartToken: compactString(ledger.restartToken || scope?.runtimeScope?.restartToken),
    counters: Object.freeze({
      adapterSteps: adapterSteps.length,
      providerCapabilities: providerCapabilities.length,
      expected: ledger.counters?.expected ?? 0,
      events: ledger.counters?.events ?? 0,
      missing: missing.length,
      failures: failures.length,
      pending: pending.length,
      succeeded: succeeded.length,
    }),
    latestByCapability: freezeArray(latest.map((row) => ({
      capability: compactString(row.capability),
      state: compactString(row.state || "unknown"),
      stepName: compactString(row.stepName),
      providerRequestId: compactString(row.providerRequestId),
      idempotencyKey: compactString(row.idempotencyKey),
      statusSnapshotKey: compactString(row.statusSnapshotKey),
      retryAfterMs: Number.isFinite(Number(row.retryAfterMs)) ? Number(row.retryAfterMs) : 0,
      message: compactString(row.message),
    }))),
    failures: freezeArray(failures.map((failure) => ({
      capability: compactString(failure.capability),
      stepName: compactString(failure.stepName),
      state: compactString(failure.state),
      message: compactString(failure.message),
      nextCommand: compactString(failure.nextCommand || "inspect_adapter_failure"),
    }))),
    nextAction: Object.freeze({
      command: failures[0]?.nextCommand
        || (missing.length > 0 ? "load_adapter_status_snapshot" : "")
        || (pending.length > 0 ? "poll_adapter_status_channel" : "")
        || (state === "needs-status-reconciliation" ? "reconcile_adapter_status" : "observe"),
      reason: failures.length > 0
        ? "Adapter status contains terminal failure records."
        : missing.length > 0
          ? "Adapter status snapshot must be loaded before replay."
          : pending.length > 0
            ? "Adapter status is still pending."
            : "Adapter status is reconciled for typed handoff.",
    }),
  });
}

function createClientRuntimeAdoptionContract(job = {}, hints = [], scope = {}, persistedState = {}, tenantBoundary = {}, boundaryHealth = {}) {
  const preview = scope?.previewAcceptance || {};
  const operatorReview = preview.operatorReview || {};
  const runtimeScope = scope?.runtimeScope || {};
  const persistedRuntime = scope?.persistedRuntime || {};
  const runtimeHandoff = scope?.runtimeHandoff || {};
  const clientWorkflowHandoff = scope?.clientWorkflowHandoff || {};
  const adapterStatusReadiness = createAdapterStatusReadiness(scope, hints);
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const durableMemory = hints.filter((hint) => hint.kind === "memory" && hint.type === "DurableMemoryMount");
  const missingClientState = [
    ...toArray(preview.clientRuntimeRequirements?.missing),
    providerCapabilities.length > 0 && !tenantBoundary.tenantId && "tenantId",
    providerCapabilities.length > 0 && !tenantBoundary.workspaceId && "workspaceId",
    adapterSteps.length > 0 && !tenantBoundary.actorId && "actorId",
    adapterSteps.length > 0 && !persistedState.statusChannel && "statusChannel",
    adapterSteps.length > 0 && !persistedState.idempotencyKey && "idempotencyKey",
  ].map(compactString).filter(Boolean);
  const uniqueMissing = [...new Set(missingClientState)].sort();
  const validationItems = [
    ...toArray(preview.validationItems).map((item) => ({
      code: compactString(item.code || "aios.types.scope_preview_validation"),
      severity: compactString(item.severity || "warning"),
      message: compactString(item.message),
      nextCommand: compactString(item.nextCommand || preview.nextStep?.command || "resolve_scope_preview"),
    })),
    ...toArray(boundaryHealth.nextActions).map((action) => ({
      code: `aios.types.${compactString(action.command || "boundary_next_action")}`,
      severity: boundaryHealth.state === "blocked" ? "error" : "warning",
      message: compactString(action.reason),
      nextCommand: compactString(action.command),
    })),
    adapterStatusReadiness.state === "blocked" && {
      code: "aios.types.adapter_status_failed",
      severity: "error",
      message: "Adapter status contains failed provider records.",
      nextCommand: adapterStatusReadiness.nextAction.command,
    },
    adapterStatusReadiness.state === "needs-status-snapshot" && {
      code: "aios.types.adapter_status_snapshot_missing",
      severity: "warning",
      message: "Adapter status snapshot is required before replay-safe handoff.",
      nextCommand: adapterStatusReadiness.nextAction.command,
    },
    ...toArray(clientWorkflowHandoff.blockedCommands).map((command) => ({
      code: `aios.types.workflow.${compactString(command.command || "blocked")}`,
      severity: "error",
      message: compactString(command.reason || "Client workflow command is blocked."),
      nextCommand: compactString(command.nextCommand || command.command || "resolve_runtime_readiness"),
    })),
  ].filter(Boolean);
  const blockingValidation = validationItems.filter((item) => item.severity === "error");
  const state = blockingValidation.length > 0 || boundaryHealth.state === "blocked" || preview.state === "blocked"
    ? "blocked"
    : uniqueMissing.length > 0 || preview.state === "preview-only" || boundaryHealth.state === "degraded"
      ? "needs-client-state"
      : adapterSteps.length > 0 || providerCapabilities.length > 0
        ? "ready-for-adapter"
        : "local-ready";
  const restartSafe = persistedState.restartStatus !== "restart-blocked"
    && adapterSteps.every((hint) => hint.runtimeShape.restartSafe !== false);

  return Object.freeze({
    protocol: "aios.type-hints.client-runtime-adoption.v1",
    jobName: compactString(job.name || scope?.jobName || "anonymous"),
    state,
    acceptedForPreview: preview.acceptedForPreview !== false,
    acceptedForRuntime: state === "local-ready" || state === "ready-for-adapter",
    acceptedForAdapter: state === "ready-for-adapter"
      && boundaryHealth.acceptedForAdapter === true
      && preview.acceptedForAdapter !== false
      && restartSafe,
    runtimeIdentity: Object.freeze({
      tenantId: firstString(tenantBoundary.tenantId, runtimeScope.tenantId),
      workspaceId: firstString(tenantBoundary.workspaceId, runtimeScope.workspaceId),
      actorId: firstString(tenantBoundary.actorId, runtimeScope.userId),
      requestId: firstString(runtimeScope.requestId, runtimeHandoff.requestId),
      statusChannel: firstString(persistedState.statusChannel, runtimeScope.statusChannel),
      idempotencyKey: firstString(persistedState.idempotencyKey, runtimeScope.idempotencyKey),
      restartToken: firstString(persistedState.restartToken, runtimeScope.restartToken),
    }),
    persistedKeys: Object.freeze({
      storageKey: firstString(persistedState.storageKey, persistedRuntime.storageKey),
      commandKey: firstString(persistedState.commandKey, persistedRuntime.commandLedgerKey),
      resumeCursorKey: firstString(persistedState.resumeCursorKey, persistedRuntime.resumeCursorKey),
      statusSnapshotKey: firstString(persistedState.statusSnapshotKey, persistedRuntime.statusSnapshotKey),
    }),
    workflow: Object.freeze({
      missingClientState: freezeArray(uniqueMissing),
      validationItems: freezeArray(validationItems),
      restartSafe,
      clientWorkflowState: compactString(clientWorkflowHandoff.state || "not-provided"),
      clientWorkflowCommands: clientWorkflowHandoff.commands || freezeArray([]),
      blockedWorkflowCommands: clientWorkflowHandoff.blockedCommands || freezeArray([]),
      readyWorkflowCommands: clientWorkflowHandoff.readyCommands || freezeArray([]),
      restartCommandManifest: persistedState.restartCommandManifest || null,
      requiredAuditEvents: tenantBoundary.requiredAuditEvents || freezeArray([]),
      adapterStatusReadiness,
      requiredRuntimeShapes: freezeArray([
        ...providerCapabilities.map((hint) => `${hint.name}:ProviderCapability`),
        ...adapterSteps.map((hint) => `${hint.name}:AdapterEffectStep`),
        ...durableMemory.map((hint) => `${hint.name}:DurableMemoryMount`),
      ]),
      operatorReview: Object.freeze({
        state: compactString(operatorReview.state || "not-provided"),
        acceptedForClientRuntime: operatorReview.acceptedForClientRuntime === true,
        acceptedForAdapter: operatorReview.acceptedForAdapter === true,
        nextCommand: compactString(operatorReview.nextStep?.command || ""),
        lanes: freezeArray(toArray(operatorReview.lanes).map((lane) => ({
          lane: compactString(lane.lane),
          state: compactString(lane.state),
          count: Number.isInteger(lane.count) ? lane.count : 0,
          nextCommand: compactString(lane.nextCommand),
        }))),
      }),
    }),
    preview: Object.freeze({
      state: compactString(preview.state || "not-provided"),
      title: compactString(preview.title || job.name || "AI OS type preview"),
      cards: preview.cards || freezeArray([]),
      validationSummary: preview.validationSummary || Object.freeze({
        errors: blockingValidation.length,
        warnings: validationItems.filter((item) => item.severity === "warning").length,
      }),
    }),
    nextStep: Object.freeze({
      command: blockingValidation[0]?.nextCommand
        || clientWorkflowHandoff.nextStep?.command
        || (uniqueMissing.length > 0 ? "attach_client_runtime_request" : "")
        || preview.nextStep?.command
        || (state === "ready-for-adapter" ? "queue_adapter_handoff" : "observe"),
      reason: blockingValidation.length > 0
        ? "Type adoption is blocked by scope or boundary validation."
        : clientWorkflowHandoff.nextStep?.reason
          ? clientWorkflowHandoff.nextStep.reason
        : uniqueMissing.length > 0
          ? "Client runtime state must be attached before adapter handoff."
          : state === "ready-for-adapter"
            ? "Typed runtime shapes are ready for Mailchimp adapter handoff."
            : "Typed runtime shapes are ready for local execution.",
    }),
  });
}

function createRuntimeReadinessPacket(job = {}, hints = [], scope = {}, persistedState = {}, tenantBoundary = {}, boundaryHealth = {}, clientRuntimeAdoption = {}) {
  const jobName = compactString(job.name || scope?.jobName || "anonymous");
  const preview = scope?.previewAcceptance || {};
  const operatorReview = preview.operatorReview || {};
  const manifest = persistedState.restartCommandManifest || {};
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const durableMemory = hints.filter((hint) => hint.kind === "memory" && hint.type === "DurableMemoryMount");
  const blockedCommands = toArray(manifest.blockedCommands);
  const blockedWorkflowCommands = toArray(clientRuntimeAdoption.workflow?.blockedWorkflowCommands);
  const readyWorkflowCommands = toArray(clientRuntimeAdoption.workflow?.readyWorkflowCommands);
  const missingClientState = toArray(clientRuntimeAdoption.workflow?.missingClientState);
  const reviewLanes = toArray(operatorReview.lanes);
  const auditEvents = toArray(tenantBoundary.requiredAuditEvents);
  const adapterStatusReadiness = createAdapterStatusReadiness(scope, hints);
  const blockingReasons = [
    clientRuntimeAdoption.state === "blocked" && "client-runtime-blocked",
    boundaryHealth.state === "blocked" && "boundary-health-blocked",
    adapterStatusReadiness.state === "blocked" && "adapter-status-failed",
    operatorReview.state === "blocked" && "scope-preview-blocked",
    manifest.state === "blocked" && "restart-command-manifest-blocked",
    blockedWorkflowCommands.length > 0 && "client-workflow-command-blocked",
    tenantBoundary.violations?.length > 0 && "tenant-boundary-violations",
    missingClientState.length > 0 && "missing-client-runtime-state",
  ].filter(Boolean);
  const acceptanceState = blockingReasons.length > 0
    ? "blocked"
    : clientRuntimeAdoption.acceptedForAdapter === true && operatorReview.acceptedForAdapter === true
      ? "adapter-ready"
      : clientRuntimeAdoption.acceptedForRuntime === true
        ? "runtime-ready"
        : "preview-only";

  return Object.freeze({
    protocol: "aios.type-hints.runtime-readiness-packet.v1",
    jobName,
    state: acceptanceState,
    acceptedForPreview: preview.acceptedForPreview !== false,
    acceptedForRuntime: blockingReasons.length === 0 && clientRuntimeAdoption.acceptedForRuntime === true,
    acceptedForAdapter: acceptanceState === "adapter-ready",
    tenantId: firstString(tenantBoundary.tenantId, persistedState.tenantId),
    workspaceId: firstString(tenantBoundary.workspaceId, persistedState.workspaceId),
    actorId: tenantBoundary.actorId || "",
    statusChannel: firstString(persistedState.statusChannel, scope?.runtimeScope?.statusChannel),
    restartToken: firstString(persistedState.restartToken, scope?.runtimeScope?.restartToken),
    statusSnapshotKey: persistedState.statusSnapshotKey || "",
    counters: Object.freeze({
      providerCapabilities: providerCapabilities.length,
      adapterSteps: adapterSteps.length,
      durableMemoryMounts: durableMemory.length,
      auditEvents: auditEvents.length,
      reviewLanes: reviewLanes.length,
      blockedRestartCommands: blockedCommands.length,
      blockedWorkflowCommands: blockedWorkflowCommands.length,
      readyWorkflowCommands: readyWorkflowCommands.length,
      missingClientState: missingClientState.length,
      boundaryViolations: tenantBoundary.violations?.length ?? 0,
      heldCapabilities: boundaryHealth.counters?.heldCapabilities ?? 0,
      adapterStatusEvents: adapterStatusReadiness.counters.events,
      adapterStatusFailures: adapterStatusReadiness.counters.failures,
      adapterStatusMissing: adapterStatusReadiness.counters.missing,
    }),
    handoff: Object.freeze({
      adapter: providerCapabilities.length > 0 ? "mailchimp" : "local",
      queueable: acceptanceState === "adapter-ready",
      command: acceptanceState === "adapter-ready"
        ? "queue_adapter_handoff"
        : blockingReasons.length > 0
          ? clientRuntimeAdoption.nextStep?.command || operatorReview.nextStep?.command || "resolve_runtime_readiness"
          : "observe",
      auditEvents: freezeArray(auditEvents),
      restartManifestState: compactString(manifest.state || "not-required"),
      adapterStatusState: adapterStatusReadiness.state,
      adapterStatusNextCommand: adapterStatusReadiness.nextAction.command,
      workflowState: compactString(clientRuntimeAdoption.workflow?.clientWorkflowState || "not-provided"),
      workflowNextCommand: blockedWorkflowCommands[0]?.nextCommand || readyWorkflowCommands[0]?.nextCommand || "",
    }),
    blockingReasons: freezeArray(blockingReasons),
    reviewLanes: freezeArray(reviewLanes.map((lane) => ({
      lane: compactString(lane.lane),
      state: compactString(lane.state),
      count: Number.isInteger(lane.count) ? lane.count : 0,
      nextCommand: compactString(lane.nextCommand),
    }))),
    nextStep: Object.freeze({
      command: blockingReasons.length > 0
        ? blockedWorkflowCommands[0]?.nextCommand || clientRuntimeAdoption.nextStep?.command || operatorReview.nextStep?.command || "resolve_runtime_readiness"
        : acceptanceState === "adapter-ready"
          ? "queue_adapter_handoff"
          : clientRuntimeAdoption.nextStep?.command || "observe",
      reason: blockingReasons.length > 0
        ? "Typed runtime contracts are waiting on scope preview, boundary, or restart readiness."
        : acceptanceState === "adapter-ready"
          ? "Typed runtime contracts satisfy Mailchimp adapter handoff requirements."
          : "Typed runtime contracts are available for local runtime execution.",
    }),
  });
}

function createTypeHintHistorySnapshot(job = {}, hints = [], scope = {}, tenantBoundary = {}, boundaryHealth = {}, diagnostics = [], persistedState = {}) {
  const recoveryPlan = scope?.recoveryPlan || {};
  const persistedRuntime = scope?.persistedRuntime || {};
  const restartCommandManifest = persistedState.restartCommandManifest || persistedRuntime.restartCommandManifest || {};
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const durableMemory = hints.filter((hint) => hint.kind === "memory" && hint.type === "DurableMemoryMount");
  const blockingDiagnostics = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const warningDiagnostics = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "warning");
  const adapterStatusReadiness = createAdapterStatusReadiness(scope, hints);

  return Object.freeze({
    protocol: "aios.type-hints.history-snapshot.v1",
    jobName: compactString(job.name || scope?.jobName || "anonymous"),
    state: blockingDiagnostics.length > 0 || recoveryPlan.state === "blocked" || boundaryHealth.state === "blocked"
      ? "blocked"
      : recoveryPlan.state === "degraded" || boundaryHealth.state === "degraded"
        ? "degraded"
        : adapterSteps.length > 0
          ? "adapter-typed"
          : "typed",
    tenantId: tenantBoundary.tenantId || scope?.runtimeScope?.tenantId || "",
    workspaceId: tenantBoundary.workspaceId || scope?.runtimeScope?.workspaceId || "",
    statusChannel: tenantBoundary.statusChannel || scope?.runtimeScope?.statusChannel || "",
    restartToken: tenantBoundary.restartToken || scope?.runtimeScope?.restartToken || "",
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    restartCommandManifestState: restartCommandManifest.state || "not-required",
    counters: Object.freeze({
      hints: hints.length,
      providerCapabilities: providerCapabilities.length,
      adapterSteps: adapterSteps.length,
      durableMemoryMounts: durableMemory.length,
      boundaryViolations: tenantBoundary.violations?.length ?? 0,
      boundaryHolds: boundaryHealth.counters?.heldCapabilities ?? 0,
      actionableErrors: recoveryPlan.actionableErrors?.length ?? 0,
      restartManifestCommands: restartCommandManifest.commands?.length ?? 0,
      restartManifestBlocked: restartCommandManifest.blockedCommands?.length ?? 0,
      adapterStatusEvents: adapterStatusReadiness.counters.events,
      adapterStatusFailures: adapterStatusReadiness.counters.failures,
      adapterStatusMissing: adapterStatusReadiness.counters.missing,
      diagnostics: diagnostics.length,
      errors: blockingDiagnostics.length,
      warnings: warningDiagnostics.length,
    }),
    timeline: freezeArray([
      ...providerCapabilities.map((hint, index) => ({
        index,
        event: "provider-capability",
        name: hint.name,
        provider: hint.provider,
        state: boundaryHealth.acceptedForAdapter ? "accepted" : "held",
        nextCommand: recoveryPlan.nextCommand || "observe",
      })),
      ...adapterSteps.map((hint, index) => ({
        index: providerCapabilities.length + index,
        event: "adapter-step",
        name: hint.name,
        provider: hint.adapter,
        state: hint.runtimeShape.restartSafe ? "restart-safe" : "restart-blocked",
        nextCommand: hint.runtimeShape.restartSafe ? "observe" : "attach_recovery_status_handoff",
      })),
      ...toArray(restartCommandManifest.commands).map((command, index) => ({
        index: providerCapabilities.length + adapterSteps.length + index,
        event: "restart-command",
        name: command.command,
        provider: command.userVisible?.handoff || "runtime",
        state: command.state,
        nextCommand: command.nextCommand,
      })),
      ...adapterStatusReadiness.failures.map((failure, index) => ({
        index: providerCapabilities.length + adapterSteps.length + toArray(restartCommandManifest.commands).length + index,
        event: "adapter-status-failure",
        name: failure.capability || failure.stepName,
        provider: "mailchimp",
        state: failure.state,
        nextCommand: failure.nextCommand,
      })),
      ...durableMemory.map((hint, index) => ({
        index: providerCapabilities.length
          + adapterSteps.length
          + toArray(restartCommandManifest.commands).length
          + adapterStatusReadiness.failures.length
          + index,
        event: "durable-memory",
        name: hint.name,
        provider: hint.runtimeShape.providerSync ? "provider-sync" : "runtime",
        state: "persisted",
        nextCommand: "observe",
      })),
    ]),
  });
}

function createTypeHintAnalyticsExport(jobHints = [], diagnostics = []) {
  const snapshots = toArray(jobHints).map((job) => job.historySnapshot).filter(Boolean);
  const counters = snapshots.reduce((totals, snapshot) => {
    totals.hints += snapshot.counters?.hints ?? 0;
    totals.providerCapabilities += snapshot.counters?.providerCapabilities ?? 0;
    totals.adapterSteps += snapshot.counters?.adapterSteps ?? 0;
    totals.durableMemoryMounts += snapshot.counters?.durableMemoryMounts ?? 0;
    totals.boundaryViolations += snapshot.counters?.boundaryViolations ?? 0;
    totals.boundaryHolds += snapshot.counters?.boundaryHolds ?? 0;
    totals.actionableErrors += snapshot.counters?.actionableErrors ?? 0;
    totals.restartManifestCommands += snapshot.counters?.restartManifestCommands ?? 0;
    totals.restartManifestBlocked += snapshot.counters?.restartManifestBlocked ?? 0;
    totals.adapterStatusEvents += snapshot.counters?.adapterStatusEvents ?? 0;
    totals.adapterStatusFailures += snapshot.counters?.adapterStatusFailures ?? 0;
    totals.adapterStatusMissing += snapshot.counters?.adapterStatusMissing ?? 0;
    return totals;
  }, {
    jobs: snapshots.length,
    hints: 0,
    providerCapabilities: 0,
    adapterSteps: 0,
    durableMemoryMounts: 0,
    boundaryViolations: 0,
    boundaryHolds: 0,
    actionableErrors: 0,
    restartManifestCommands: 0,
    restartManifestBlocked: 0,
    adapterStatusEvents: 0,
    adapterStatusFailures: 0,
    adapterStatusMissing: 0,
  });
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");

  return Object.freeze({
    protocol: "aios.type-hints.analytics-export.v1",
    state: errors.length > 0 || snapshots.some((snapshot) => snapshot.state === "blocked")
      ? "blocked"
      : snapshots.some((snapshot) => snapshot.state === "degraded")
        ? "degraded"
        : "ready",
    exportReady: errors.length === 0,
    counters: Object.freeze({
      ...counters,
      diagnostics: diagnostics.length,
      errors: errors.length,
      warnings: toArray(diagnostics).filter((diagnostic) => diagnostic.level === "warning").length,
    }),
    snapshots: freezeArray(snapshots),
    timeline: freezeArray(snapshots
      .flatMap((snapshot) => snapshot.timeline.map((event) => ({ ...event, jobName: snapshot.jobName })))
      .sort((left, right) => left.jobName.localeCompare(right.jobName) || left.index - right.index)),
    report: Object.freeze({
      statusChannels: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.statusChannel).filter(Boolean))]),
      statusSnapshotKeys: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.statusSnapshotKey).filter(Boolean))]),
      restartTokens: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.restartToken).filter(Boolean))]),
      nextCommands: freezeArray([...new Set(snapshots.flatMap((snapshot) => snapshot.timeline.map((event) => event.nextCommand)).filter(Boolean))]),
      clientRuntimeStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.clientRuntimeAdoption?.state).filter(Boolean))]),
      clientRuntimeNextSteps: freezeArray([...new Set(toArray(jobHints).map((job) => job.clientRuntimeAdoption?.nextStep?.command).filter(Boolean))]),
      clientWorkflowStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.clientRuntimeAdoption?.workflow?.clientWorkflowState).filter(Boolean))]),
      blockedWorkflowCommands: toArray(jobHints).reduce((count, job) => count + (job.clientRuntimeAdoption?.workflow?.blockedWorkflowCommands?.length ?? 0), 0),
      readyWorkflowCommands: toArray(jobHints).reduce((count, job) => count + (job.clientRuntimeAdoption?.workflow?.readyWorkflowCommands?.length ?? 0), 0),
      runtimeReadinessStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.runtimeReadiness?.state).filter(Boolean))]),
      runtimeReadinessNextSteps: freezeArray([...new Set(toArray(jobHints).map((job) => job.runtimeReadiness?.nextStep?.command).filter(Boolean))]),
      adapterStatusStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.adapterStatusReadiness?.state).filter(Boolean))]),
      adapterStatusNextSteps: freezeArray([...new Set(toArray(jobHints).map((job) => job.adapterStatusReadiness?.nextAction?.command).filter(Boolean))]),
      restartManifestStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.persistedState?.restartCommandManifest?.state).filter(Boolean))]),
      restartWorkflowCommands: freezeArray([...new Set(toArray(jobHints).flatMap((job) => job.persistedState?.restartCommandManifest?.commands || []).map((command) => command.nextCommand).filter(Boolean))]),
    }),
  });
}

function createPersistedStateContract(job = {}, hints = [], scope = {}) {
  const runtimeScope = scope?.runtimeScope || {};
  const persistedRuntime = scope?.persistedRuntime || {};
  const clientWorkflowHandoff = scope?.clientWorkflowHandoff || {};
  const durableMemory = hints.filter((hint) => hint.kind === "memory" && hint.type === "DurableMemoryMount");
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const restartToken = firstString(runtimeScope.restartToken, persistedRuntime.restartToken, scope?.runtimeHandoff?.restartToken);
  const statusChannel = firstString(runtimeScope.statusChannel, scope?.runtimeHandoff?.statusChannel);
  const requiresResumeCursor = adapterSteps.length > 0 || durableMemory.some((hint) => hint.runtimeShape.providerSync);

  const persistedState = Object.freeze({
    contract: "aios.type-hints.persisted-state.v1",
    jobName: compactString(job.name || scope?.jobName || "anonymous"),
    tenantId: compactString(runtimeScope.tenantId),
    workspaceId: compactString(runtimeScope.workspaceId),
    requestId: compactString(runtimeScope.requestId),
    restartToken,
    statusChannel,
    idempotencyKey: compactString(runtimeScope.idempotencyKey),
    storageKey: firstString(persistedRuntime.storageKey, restartToken ? `${restartToken}:state` : ""),
    commandKey: firstString(persistedRuntime.commandLedgerKey, restartToken ? `${restartToken}:commands` : ""),
    resumeCursorKey: firstString(persistedRuntime.resumeCursorKey, requiresResumeCursor && restartToken ? `${restartToken}:cursor` : ""),
    statusSnapshotKey: firstString(persistedRuntime.statusSnapshotKey, restartToken ? `${restartToken}:status` : ""),
    restartCommands: persistedRuntime.commands || freezeArray([]),
    workflowCommands: clientWorkflowHandoff.commands || freezeArray([]),
    blockedWorkflowCommands: clientWorkflowHandoff.blockedCommands || freezeArray([]),
    readyWorkflowCommands: clientWorkflowHandoff.readyCommands || freezeArray([]),
    stateSlots: persistedRuntime.stateSlots || freezeArray([]),
    persistedMounts: freezeArray(durableMemory.map((hint) => ({
      name: hint.name,
      retention: hint.runtimeShape.retention,
      providerSync: hint.runtimeShape.providerSync,
    }))),
    idempotentCommands: freezeArray(adapterSteps.map((hint) => ({
      step: hint.name,
      adapter: hint.adapter,
      idempotencyKey: firstString(hint.runtimeShape.idempotencyKey, runtimeScope.idempotencyKey),
      statusHandoff: hint.runtimeShape.statusHandoff,
      restartSafe: hint.runtimeShape.restartSafe,
    }))),
    providerLeases: freezeArray(providerCapabilities.map((hint) => ({
      capability: hint.name,
      provider: hint.provider,
      requiresLease: hint.runtimeShape.requiresLease,
      requiresApproval: hint.runtimeShape.requiresApproval,
    }))),
    restartStatus: !restartToken
      ? "missing-restart-token"
      : adapterSteps.some((hint) => hint.runtimeShape.restartSafe === false)
        ? "restart-blocked"
        : requiresResumeCursor
          ? "restart-resumable"
          : "stateless",
  });

  return Object.freeze({
    ...persistedState,
    restartCommandManifest: createRestartCommandManifest(job, hints, scope, persistedState),
  });
}

function createRestartCommandManifest(job = {}, hints = [], scope = {}, persistedState = {}) {
  const runtimeScope = scope?.runtimeScope || {};
  const persistedRuntime = scope?.persistedRuntime || {};
  const runtimeHandoff = scope?.runtimeHandoff || {};
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const restartToken = firstString(persistedState.restartToken, runtimeScope.restartToken);
  const commandKey = firstString(persistedState.commandKey, persistedRuntime.commandLedgerKey);
  const statusChannel = firstString(persistedState.statusChannel, runtimeScope.statusChannel);
  const statusSnapshotKey = firstString(persistedState.statusSnapshotKey, persistedRuntime.statusSnapshotKey);
  const resumeCursorKey = firstString(persistedState.resumeCursorKey, persistedRuntime.resumeCursorKey);
  const explicitCommands = [
    ...toArray(persistedState.restartCommands || persistedRuntime.commands),
    ...toArray(persistedState.workflowCommands || scope?.clientWorkflowHandoff?.commands),
  ];
  const rows = [];
  const pushCommand = (row = {}) => {
    const command = compactString(row.command || row.name);
    if (!command) return;
    const phase = compactString(row.phase || "resume");
    const stepName = compactString(row.step || row.stepName || "");
    const capability = compactString(row.capability || row.action || "");
    const idempotencyKey = firstString(row.idempotencyKey, persistedState.idempotencyKey, runtimeScope.idempotencyKey);
    const workflowState = compactString(row.state);
    const missing = [
      !restartToken && "restartToken",
      (phase === "resume" || phase === "dedupe" || phase === "adapter") && !idempotencyKey && "idempotencyKey",
      (phase === "resume" || phase === "adapter") && !statusChannel && "statusChannel",
      (phase === "resume" || phase === "adapter-status") && !statusSnapshotKey && "statusSnapshotKey",
      workflowState === "blocked" && "workflowCommandBlocked",
    ].filter(Boolean);

    rows.push(Object.freeze({
      command,
      commandId: firstString(row.commandId, `${restartToken || "restart:missing"}:${commandKey || "commands"}:${command}`),
      phase,
      jobName: compactString(row.jobName || job.name || scope?.jobName || "anonymous"),
      stepName,
      capability,
      idempotencyKey,
      restartToken,
      statusChannel,
      statusSnapshotKey,
      resumeCursorKey,
      replayPolicy: compactString(row.replayPolicy || (phase === "resume" ? "resume-before-retry" : "dedupe-by-command-id")),
      required: row.required !== false,
      state: missing.length > 0
        ? "blocked"
        : workflowState === "ready" || phase === "resume" || phase === "adapter"
          ? "runnable"
          : "ready",
      missing: freezeArray(missing),
      nextCommand: missing.length > 0
        ? compactString(row.nextCommand || "attach_recovery_status_handoff")
        : phase === "resume"
          ? "resume_adapter_step"
          : phase === "adapter"
            ? "queue_adapter_handoff"
            : phase === "adapter-status"
              ? "load_adapter_status_snapshot"
          : phase === "dedupe"
            ? "dedupe_external_write"
            : phase === "verify"
              ? "replay_verifier_status"
              : "restore_client_runtime_state",
      userVisible: Object.freeze({
        label: stepName ? `Resume ${stepName}` : capability ? `Resume ${capability}` : command.replace(/_/g, " "),
        blocking: missing.length > 0 && row.required !== false,
        handoff: phase === "resume" ? "adapter" : "runtime",
      }),
    }));
  };

  for (const command of explicitCommands) pushCommand(command);

  for (const hint of adapterSteps) {
    const command = `resume_${hint.name}`.replace(/[^a-z0-9_.:-]+/gi, "_").toLowerCase();
    if (rows.some((row) => row.command === command || row.stepName === hint.name)) continue;
    pushCommand({
      command,
      phase: "resume",
      step: hint.name,
      idempotencyKey: hint.runtimeShape.idempotencyKey,
      replayPolicy: hint.runtimeShape.restartSafe ? "resume-before-retry" : "manual-resolution",
    });
  }

  for (const hint of providerCapabilities) {
    const command = `lease_${hint.name}`.replace(/[^a-z0-9_.:-]+/gi, "_").toLowerCase();
    if (rows.some((row) => row.command === command || row.capability === hint.name)) continue;
    pushCommand({
      command,
      phase: hint.runtimeShape.requiresLease ? "restore" : "verify",
      capability: hint.name,
      replayPolicy: hint.runtimeShape.requiresLease ? "restore-provider-lease" : "latest-status-wins",
      required: hint.runtimeShape.requiresLease,
    });
  }

  const commands = rows.sort((left, right) => left.phase.localeCompare(right.phase) || left.command.localeCompare(right.command));
  const blocked = commands.filter((row) => row.state === "blocked" && row.required !== false);
  const runnable = commands.filter((row) => row.state === "runnable");

  return Object.freeze({
    protocol: "aios.type-hints.restart-command-manifest.v1",
    jobName: compactString(job.name || scope?.jobName || "anonymous"),
    state: blocked.length > 0 ? "blocked" : runnable.length > 0 ? "resume-ready" : commands.length > 0 ? "restore-ready" : "not-required",
    commandKey,
    restartToken,
    statusChannel,
    statusSnapshotKey,
    resumeCursorKey,
    acceptedForReplay: blocked.length === 0,
    commands: freezeArray(commands),
    blockedCommands: freezeArray(blocked.map((row) => ({
      command: row.command,
      phase: row.phase,
      stepName: row.stepName,
      capability: row.capability,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }))),
    runnableCommands: freezeArray(runnable.map((row) => ({
      command: row.command,
      commandId: row.commandId,
      phase: row.phase,
      stepName: row.stepName,
      capability: row.capability,
      replayPolicy: row.replayPolicy,
      idempotencyKey: row.idempotencyKey,
    }))),
    userWorkflow: Object.freeze({
      nextCommand: blocked[0]?.nextCommand || runnable[0]?.nextCommand || runtimeHandoff.nextCommand || "observe",
      labels: freezeArray(commands.map((row) => row.userVisible.label)),
      blockingLabels: freezeArray(blocked.map((row) => row.userVisible.label)),
    }),
  });
}

function createJobHints(job = {}, scope) {
  const runtimeScope = scope?.runtimeScope || {};
  const hints = [
    ...toArray(job.capabilities).map(inferCapabilityType),
    ...toArray(job.memory).map(inferMemoryType),
    ...toArray(job.steps).map((step) => inferStepType(step, runtimeScope)),
    ...toArray(job.verifiers).map(inferVerifierType),
  ].sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
  const diagnostics = [];

  for (const hint of hints) {
    if (hint.kind === "step" && hint.runtimeShape.statusHandoff === "requires-adapter-status" && hint.runtimeShape.capabilityRefs.length === 0) {
      diagnostics.push(Object.freeze({
        level: "warning",
        code: "aios.types.adapter_step_missing_capability",
        message: `Step "${hint.name}" uses an adapter-like effect without an explicit capability reference.`,
        jobName: job.name,
        stepName: hint.name,
      }));
    }

    if (hint.kind === "step" && hint.type === "AdapterEffectStep" && hint.runtimeShape.restartSafe === false) {
      diagnostics.push(Object.freeze({
        level: "error",
        code: "aios.types.adapter_step_not_restart_safe",
        message: `Step "${hint.name}" requires adapter status but has no idempotency key for restart recovery.`,
        jobName: job.name,
        stepName: hint.name,
      }));
    }
  }

  const persistedState = createPersistedStateContract(job, hints, scope);
  const tenantBoundary = createTenantBoundaryShape(job, scope, hints);
  const boundaryHealth = createBoundaryHealthContract(scope, tenantBoundary);
  const adapterStatusReadiness = createAdapterStatusReadiness(scope, hints);
  const clientRuntimeAdoption = createClientRuntimeAdoptionContract(job, hints, scope, persistedState, tenantBoundary, boundaryHealth);
  const runtimeReadiness = createRuntimeReadinessPacket(job, hints, scope, persistedState, tenantBoundary, boundaryHealth, clientRuntimeAdoption);

  for (const violation of tenantBoundary.violations) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.tenant_boundary_violation",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" violates tenant boundary rule "${violation}".`,
      jobName: job.name,
      violation,
    }));
  }
  const historySnapshot = createTypeHintHistorySnapshot(job, hints, scope, tenantBoundary, boundaryHealth, diagnostics, persistedState);

  return Object.freeze({
    jobName: compactString(job.name || scope?.jobName || "anonymous"),
    scope,
    status: scope?.status === "invalid" ? "blocked-by-scope" : diagnostics.some((diagnostic) => diagnostic.level === "error") ? "invalid" : "typed",
    hints: freezeArray(hints),
    persistedState,
    tenantBoundary,
    boundaryHealth,
    adapterStatusReadiness,
    clientRuntimeAdoption,
    runtimeReadiness,
    historySnapshot,
    diagnostics: freezeArray(diagnostics),
    contract: createTypeHintContract(hints, scope, persistedState, tenantBoundary, boundaryHealth, clientRuntimeAdoption, runtimeReadiness, adapterStatusReadiness),
  });
}

export function createTypeHintContract(
  hints = [],
  scope = {},
  persistedState = createPersistedStateContract({}, hints, scope),
  tenantBoundary = createTenantBoundaryShape({}, scope, hints),
  boundaryHealth = createBoundaryHealthContract(scope, tenantBoundary),
  clientRuntimeAdoption = createClientRuntimeAdoptionContract({}, hints, scope, persistedState, tenantBoundary, boundaryHealth),
  runtimeReadiness = createRuntimeReadinessPacket({}, hints, scope, persistedState, tenantBoundary, boundaryHealth, clientRuntimeAdoption),
  adapterStatusReadiness = createAdapterStatusReadiness(scope, hints)
) {
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const durableMemory = hints.filter((hint) => hint.kind === "memory" && hint.type === "DurableMemoryMount");
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");

  return Object.freeze({
    provider: providerCapabilities.some((hint) => hint.provider === "mailchimp") ? "mailchimp" : "local",
    requiresAdapterStatus: adapterSteps.length > 0,
    requiresRecoveryPlan: providerCapabilities.some((hint) => hint.runtimeShape.requiresApproval),
    restartStatus: persistedState.restartStatus,
    restartCommandManifest: persistedState.restartCommandManifest,
    statusChannel: persistedState.statusChannel,
    storageKey: persistedState.storageKey,
    commandKey: persistedState.commandKey,
    statusSnapshotKey: persistedState.statusSnapshotKey,
    tenantScoped: tenantBoundary.tenantScoped,
    actorScoped: tenantBoundary.actorScoped,
    permissionDeclared: tenantBoundary.permissionDeclared,
    boundaryHealth,
    adapterStatusReadiness,
    clientRuntimeAdoption,
    runtimeReadiness,
    auditEvents: tenantBoundary.requiredAuditEvents,
    requiredRuntimeShapes: freezeArray([
      ...providerCapabilities.map((hint) => `${hint.name}:ProviderCapability`),
      ...durableMemory.map((hint) => `${hint.name}:DurableMemoryMount`),
      ...adapterSteps.map((hint) => `${hint.name}:AdapterEffectStep`),
      ...(persistedState.storageKey ? [`${persistedState.storageKey}:PersistedRuntimeState`] : []),
      ...(persistedState.statusSnapshotKey ? [`${persistedState.statusSnapshotKey}:StatusSnapshot`] : []),
    ]),
    scopeReady: scope?.status !== "invalid" && tenantBoundary.violations.length === 0 && boundaryHealth.acceptedForAdapter,
    clientRuntimeReady: clientRuntimeAdoption.acceptedForRuntime === true,
    adapterHandoffReady: runtimeReadiness.acceptedForAdapter === true,
    adapterStatusReady: adapterStatusReadiness.acceptedForAdapter === true,
    nextCommand: runtimeReadiness.nextStep?.command || clientRuntimeAdoption.nextStep?.command || "observe",
  });
}

export function inferAiosTypeHints(input = {}) {
  const jobs = getJobs(input);
  const scopeResolution = input.scopeResolution || resolveAiosScopes(input);
  const jobHints = jobs.map((job, index) => createJobHints(job, scopeResolution.jobs?.[index]));
  const diagnostics = [
    ...(scopeResolution.diagnostics || []),
    ...jobHints.flatMap((job) => job.diagnostics),
  ];
  const errors = diagnostics.filter((diagnostic) => diagnostic.level === "error");

  return Object.freeze({
    protocol: "aios.semantic.type-hints.v1",
    status: errors.length > 0 ? "blocked" : "typed",
    scopeResolution,
    jobs: freezeArray(jobHints),
    diagnostics: freezeArray(diagnostics),
    analyticsExport: createTypeHintAnalyticsExport(jobHints, diagnostics),
    summary: summarizeAiosTypeHints(jobHints, diagnostics),
  });
}

export function summarizeAiosTypeHints(jobHints = [], diagnostics = []) {
  const hints = toArray(jobHints).flatMap((job) => job.hints || []);
  return Object.freeze({
    jobs: jobHints.length,
    hints: hints.length,
    providerCapabilities: hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability").length,
    adapterSteps: hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep").length,
    durableMemoryMounts: hints.filter((hint) => hint.kind === "memory" && hint.type === "DurableMemoryMount").length,
    restartResumableJobs: toArray(jobHints).filter((job) => job.persistedState?.restartStatus === "restart-resumable").length,
    restartBlockedJobs: toArray(jobHints).filter((job) => job.persistedState?.restartStatus === "restart-blocked").length,
    restartCommandManifestBlockedJobs: toArray(jobHints).filter((job) => job.persistedState?.restartCommandManifest?.state === "blocked").length,
    restartCommandManifestCommands: toArray(jobHints).reduce((count, job) => count + (job.persistedState?.restartCommandManifest?.commands?.length ?? 0), 0),
    tenantBoundaryViolations: toArray(jobHints).reduce((count, job) => count + (job.tenantBoundary?.violations?.length ?? 0), 0),
    mailchimpBoundaryHolds: toArray(jobHints).reduce((count, job) => count + (job.boundaryHealth?.counters?.heldCapabilities ?? 0), 0),
    boundaryHealthBlocked: toArray(jobHints).filter((job) => job.boundaryHealth?.state === "blocked").length,
    clientRuntimeReadyJobs: toArray(jobHints).filter((job) => job.clientRuntimeAdoption?.acceptedForRuntime).length,
    adapterHandoffReadyJobs: toArray(jobHints).filter((job) => job.runtimeReadiness?.acceptedForAdapter).length,
    runtimeReadinessBlockedJobs: toArray(jobHints).filter((job) => job.runtimeReadiness?.state === "blocked").length,
    runtimeReadinessAdapterReadyJobs: toArray(jobHints).filter((job) => job.runtimeReadiness?.state === "adapter-ready").length,
    blockedWorkflowCommands: toArray(jobHints).reduce((count, job) => count + (job.clientRuntimeAdoption?.workflow?.blockedWorkflowCommands?.length ?? 0), 0),
    readyWorkflowCommands: toArray(jobHints).reduce((count, job) => count + (job.clientRuntimeAdoption?.workflow?.readyWorkflowCommands?.length ?? 0), 0),
    adapterStatusReadyJobs: toArray(jobHints).filter((job) => job.adapterStatusReadiness?.acceptedForAdapter).length,
    adapterStatusBlockedJobs: toArray(jobHints).filter((job) => job.adapterStatusReadiness?.state === "blocked").length,
    adapterStatusWaitingJobs: toArray(jobHints).filter((job) => job.adapterStatusReadiness?.state === "waiting-adapter").length,
    clientRuntimeBlockedJobs: toArray(jobHints).filter((job) => job.clientRuntimeAdoption?.state === "blocked").length,
    actionableErrors: toArray(jobHints).reduce((count, job) => count + (job.historySnapshot?.counters?.actionableErrors ?? 0), 0),
    historySnapshots: toArray(jobHints).filter((job) => job.historySnapshot).length,
    auditReadyJobs: toArray(jobHints).filter((job) => job.tenantBoundary?.violations?.length === 0).length,
    diagnostics: diagnostics.length,
    readyForCapabilityAnalysis: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
  });
}

export function createAiosPersistedStateManifest(typeHintResult = {}) {
  const jobs = toArray(typeHintResult.jobs);
  return Object.freeze({
    protocol: "aios.semantic.persisted-state-manifest.v1",
    status: jobs.some((job) => job.persistedState?.restartStatus === "restart-blocked" || job.persistedState?.restartCommandManifest?.state === "blocked") ? "blocked" : "ready",
    jobs: freezeArray(jobs.map((job) => ({
      jobName: job.jobName,
      restartStatus: job.persistedState?.restartStatus || "unknown",
      storageKey: job.persistedState?.storageKey || "",
      commandKey: job.persistedState?.commandKey || "",
      resumeCursorKey: job.persistedState?.resumeCursorKey || "",
      statusSnapshotKey: job.persistedState?.statusSnapshotKey || "",
      statusChannel: job.persistedState?.statusChannel || "",
      idempotentCommands: job.persistedState?.idempotentCommands || freezeArray([]),
      restartCommands: job.persistedState?.restartCommands || freezeArray([]),
      restartCommandManifest: job.persistedState?.restartCommandManifest || null,
      tenantBoundary: job.tenantBoundary || null,
      boundaryHealth: job.boundaryHealth || null,
      adapterStatusReadiness: job.adapterStatusReadiness || null,
      clientRuntimeAdoption: job.clientRuntimeAdoption || null,
      runtimeReadiness: job.runtimeReadiness || null,
      clientWorkflowCommands: job.clientRuntimeAdoption?.workflow?.clientWorkflowCommands || freezeArray([]),
      blockedWorkflowCommands: job.clientRuntimeAdoption?.workflow?.blockedWorkflowCommands || freezeArray([]),
      readyWorkflowCommands: job.clientRuntimeAdoption?.workflow?.readyWorkflowCommands || freezeArray([]),
    }))),
  });
}
