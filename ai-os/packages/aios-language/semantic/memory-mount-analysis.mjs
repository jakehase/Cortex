import {
  compileMailchimpMemoryMounts,
  compileRollbackMemoryPlan,
} from "../compiler/memory-mount-compiler.mjs";

export const MAILCHIMP_MEMORY_ANALYSIS_VERSION = "aios.semantic.memory-mount-analysis.v1";

function levelOf(diagnostic) {
  return diagnostic?.level || diagnostic?.severity || "info";
}

function stableKey(parts) {
  const input = parts.map((part) => String(part ?? "")).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function summarizeDiagnostics(diagnostics) {
  const normalized = Array.isArray(diagnostics) ? diagnostics : [];
  const errors = normalized.filter((diagnostic) => levelOf(diagnostic) === "error");
  const warnings = normalized.filter((diagnostic) => levelOf(diagnostic) === "warning");
  return {
    total: normalized.length,
    errors: errors.length,
    warnings: warnings.length,
    blockingCodes: errors.map((diagnostic) => diagnostic.code).filter(Boolean).sort(),
    warningCodes: warnings.map((diagnostic) => diagnostic.code).filter(Boolean).sort(),
  };
}

function mountStatus(mount, diagnostics) {
  const mountDiagnostics = diagnostics.filter((diagnostic) => diagnostic.mount === mount.name);
  const summary = summarizeDiagnostics(mountDiagnostics);
  const providerContract = mount.providerContract || {};
  const syncDirection = providerContract.syncDirection || "local-only";
  const externalHandoff = providerContract.externalHandoff || "not-required";
  const providerSyncRequired = syncDirection !== "local-only";
  const writebackStaged = externalHandoff === "stage-local-before-provider-write";
  return {
    mount: mount.name,
    path: mount.path,
    mode: mount.mode,
    sensitivity: mount.sensitivity,
    tenantId: mount.tenantId || providerContract.tenantId || null,
    workspaceId: mount.workspaceId || providerContract.workspaceId || null,
    allowedRoles: asList(mount.allowedRoles || providerContract.allowedRoles).sort(),
    status: summary.errors ? "blocked" : summary.warnings ? "ready-with-warnings" : "ready",
    providerSyncRequired,
    writebackStaged,
    requiredCapabilities: providerContract.negotiatedCapabilities || [],
    handoff: {
      externalHandoff,
      statusChannel: providerSyncRequired ? `memory.status.mailchimp.${mount.name}` : "local-runtime-memory",
      recoveryCursor: providerContract.syncMetadata?.cursorPath || null,
      nextAction: summary.errors
        ? "repair-memory-mount"
        : providerSyncRequired
          ? writebackStaged
            ? "stage-local-before-provider-sync"
            : "read-through-provider-adapter"
          : "continue-local-runtime",
    },
  };
}

function countBy(items, select) {
  const counts = {};
  for (const item of items) {
    const key = select(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function buildHistorySnapshots(mounts, diagnostics, rollbackPlan) {
  const diagnosticSummary = summarizeDiagnostics(diagnostics);
  const blockedMounts = mounts.filter((mount) => mount.status === "blocked");
  const providerMounts = mounts.filter((mount) => mount.providerSyncRequired);
  const stagedWritebacks = mounts.filter((mount) => mount.writebackStaged);
  const rollbackSteps = Array.isArray(rollbackPlan?.steps) ? rollbackPlan.steps : [];
  return [
    {
      id: `memory-history:${stableKey(["compiled", mounts.map((mount) => mount.mount)])}`,
      phase: "compiled",
      status: mounts.length ? "complete" : "empty",
      counters: {
        mounts: mounts.length,
        diagnostics: diagnosticSummary.total,
        errors: diagnosticSummary.errors,
        warnings: diagnosticSummary.warnings,
      },
      nextAction: diagnosticSummary.errors ? "repair-memory-mount" : "evaluate-provider-handoff",
    },
    {
      id: `memory-history:${stableKey(["provider", providerMounts.map((mount) => mount.mount)])}`,
      phase: "provider-sync",
      status: blockedMounts.length ? "blocked" : providerMounts.length ? "ready" : "not-required",
      counters: {
        providerSyncMounts: providerMounts.length,
        stagedWritebacks: stagedWritebacks.length,
        localOnlyMounts: mounts.length - providerMounts.length,
      },
      nextAction: blockedMounts.length
        ? "resolve-provider-sync-blockers"
        : providerMounts.length
          ? "prepare-provider-sync"
          : "continue-local-runtime",
    },
    {
      id: `memory-history:${stableKey(["rollback", rollbackSteps.map((step) => step.id || step.name)])}`,
      phase: "recovery-plan",
      status: rollbackSteps.length ? "checkpointable" : "not-checkpointed",
      counters: {
        rollbackSteps: rollbackSteps.length,
        resumeCursors: mounts.filter((mount) => mount.handoff.recoveryCursor).length,
      },
      nextAction: rollbackSteps.length ? "checkpoint-memory-before-runtime" : "build-rollback-plan",
    },
  ];
}

function buildMemoryAnalytics(mounts, diagnostics, rollbackPlan) {
  const providerMounts = mounts.filter((mount) => mount.providerSyncRequired);
  const stagedWritebacks = mounts.filter((mount) => mount.writebackStaged);
  return {
    counters: {
      mountsTotal: mounts.length,
      readyMounts: mounts.filter((mount) => mount.status === "ready").length,
      warningMounts: mounts.filter((mount) => mount.status === "ready-with-warnings").length,
      blockedMounts: mounts.filter((mount) => mount.status === "blocked").length,
      providerSyncMounts: providerMounts.length,
      stagedWritebacks: stagedWritebacks.length,
      localOnlyMounts: mounts.length - providerMounts.length,
      diagnosticsTotal: diagnostics.length,
      rollbackSteps: Array.isArray(rollbackPlan?.steps) ? rollbackPlan.steps.length : 0,
    },
    byMode: countBy(mounts, (mount) => mount.mode),
    bySensitivity: countBy(mounts, (mount) => mount.sensitivity),
    byStatus: countBy(mounts, (mount) => mount.status),
  };
}

function buildExportSummary(mounts, analytics, summary) {
  const status = summary.errors
    ? "blocked"
    : summary.warnings
      ? "ready-with-warnings"
      : "ready";
  return {
    exportKind: "mailchimp.memoryMounts.summary",
    status,
    generatedDeterministically: true,
    rows: mounts.map((mount) => ({
      mount: mount.mount,
      path: mount.path,
      mode: mount.mode,
      status: mount.status,
      providerSyncRequired: mount.providerSyncRequired,
      nextAction: mount.handoff.nextAction,
    })),
    totals: analytics.counters,
    diagnostics: {
      blockingCodes: summary.blockingCodes,
      warningCodes: summary.warningCodes,
    },
  };
}

function buildTimelineState(historySnapshots) {
  return {
    phases: historySnapshots.map((snapshot, index) => ({
      index,
      phase: snapshot.phase,
      status: snapshot.status,
      nextAction: snapshot.nextAction,
    })),
    currentPhase: historySnapshots.find((snapshot) => snapshot.status === "blocked")?.phase
      || historySnapshots.find((snapshot) => snapshot.status === "checkpointable")?.phase
      || historySnapshots.at(-1)?.phase
      || "compiled",
    reportChannels: ["memory.status.mailchimp.provider-sync", "memory.status.local-only"],
  };
}

function normalizeMemoryLifecycleSettings(source = {}, options = {}) {
  const controls = options.lifecycleSettings || source.lifecycleSettings || source.memoryControls || {};
  const requestedInterval = Number(controls.scheduleEverySeconds ?? controls.scheduleIntervalSeconds ?? 0);
  const scheduleEverySeconds = Number.isFinite(requestedInterval) && requestedInterval > 0
    ? Math.max(60, Math.floor(requestedInterval))
    : null;
  const enabledMounts = new Set(asList(controls.enabledMounts || controls.enabled));
  const disabledMounts = new Set(asList(controls.disabledMounts || controls.disabled));
  const mode = controls.mode || "review-before-sync";
  return {
    mode,
    enabled: controls.enabled !== false,
    scheduleEverySeconds,
    allowProviderSync: controls.allowProviderSync === true || options.allowProviderSync === true,
    allowStagedWriteback: controls.allowStagedWriteback === true || options.allowStagedWriteback === true,
    requireCheckpointBeforeSync: controls.requireCheckpointBeforeSync !== false,
    enabledMounts: [...enabledMounts].sort(),
    disabledMounts: [...disabledMounts].sort(),
  };
}

function asList(value) {
  if (value == null || typeof value === "boolean") return [];
  return Array.isArray(value) ? value : [value];
}

function validateMemoryLifecycleSettings(settings, mounts) {
  const diagnostics = [];
  const mountNames = new Set(mounts.map((mount) => mount.mount));
  if (!["review-before-sync", "local-only", "provider-sync"].includes(settings.mode)) {
    diagnostics.push({
      level: "error",
      code: "memory.lifecycle.mode.invalid",
      mode: settings.mode,
    });
  }
  if (settings.allowProviderSync && settings.mode === "local-only") {
    diagnostics.push({
      level: "error",
      code: "memory.lifecycle.provider-sync.local-only",
    });
  }
  if (settings.allowStagedWriteback && !settings.allowProviderSync) {
    diagnostics.push({
      level: "error",
      code: "memory.lifecycle.writeback.requires-provider-sync",
    });
  }
  for (const mountName of [...settings.enabledMounts, ...settings.disabledMounts]) {
    if (!mountNames.has(mountName)) {
      diagnostics.push({
        level: "warning",
        code: "memory.lifecycle.mount.unknown",
        mount: mountName,
      });
    }
  }
  if (settings.scheduleEverySeconds != null && settings.scheduleEverySeconds < 60) {
    diagnostics.push({
      level: "warning",
      code: "memory.lifecycle.schedule.too-frequent",
      minimumSeconds: 60,
    });
  }
  return diagnostics;
}

function buildMemoryTenantBoundaryState(contract, mounts, lifecycleControls, source = {}, options = {}) {
  const tenantPolicy = options.tenantPolicy
    || source.tenantPolicy
    || contract.tenantPolicy
    || contract.providerServiceContract?.tenantPolicy
    || {};
  const activeBoundary = tenantPolicy.activeBoundary || {};
  const clientRuntime = options.clientRuntime || source.clientRuntime || source.requestRuntime || {};
  const actorRole = options.actorRole
    || clientRuntime.actorRole
    || tenantPolicy.actorRole
    || activeBoundary.actorRole
    || "operator";
  const tenantId = activeBoundary.tenantId
    || tenantPolicy.tenantId
    || clientRuntime.tenantId
    || source.tenantId
    || contract.tenantId
    || null;
  const workspaceId = activeBoundary.workspaceId
    || tenantPolicy.workspaceId
    || clientRuntime.workspaceId
    || source.workspaceId
    || contract.workspaceId
    || null;
  const allowedRoles = [
    ...asList(activeBoundary.allowedRoles),
    ...asList(tenantPolicy.allowedRoles),
    "operator",
    "approver",
    "admin",
  ];
  const uniqueAllowedRoles = [...new Set(allowedRoles)].sort();
  const rolePolicies = asList(tenantPolicy.rolePolicies);
  const rolePolicy = rolePolicies.find((policy) => policy?.role === actorRole) || {};
  const canRead = rolePolicy.canRead !== false && uniqueAllowedRoles.includes(actorRole);
  const canSync = rolePolicy.canSync !== false
    && rolePolicy.canExecute !== false
    && uniqueAllowedRoles.includes(actorRole);
  const canWriteback = rolePolicy.canWriteback === true
    || rolePolicy.canApprove === true
    || actorRole === "approver"
    || actorRole === "admin";
  const scopedMounts = mounts.map((mount) => {
    const mountTenantId = mount.tenantId || tenantId;
    const mountWorkspaceId = mount.workspaceId || workspaceId;
    const mountAllowedRoles = mount.allowedRoles.length ? mount.allowedRoles : uniqueAllowedRoles;
    const tenantMismatch = Boolean(tenantId && mountTenantId && mountTenantId !== tenantId);
    const workspaceMismatch = Boolean(workspaceId && mountWorkspaceId && mountWorkspaceId !== workspaceId);
    const roleAllowed = mountAllowedRoles.includes(actorRole);
    const syncRequested = lifecycleControls.syncMounts.includes(mount.mount);
    const writebackRequested = lifecycleControls.stagedWritebacks.includes(mount.mount);
    const blockedBy = [
      ...(tenantId ? [] : ["tenant:missing"]),
      ...(workspaceId ? [] : ["workspace:missing"]),
      ...(tenantMismatch ? [`tenant:${mountTenantId}:outside-active-boundary`] : []),
      ...(workspaceMismatch ? [`workspace:${mountWorkspaceId}:outside-active-boundary`] : []),
      ...(roleAllowed ? [] : [`role:${actorRole}:not-allowed`]),
      ...(syncRequested && !canSync ? [`role:${actorRole}:cannot-sync-memory`] : []),
      ...(writebackRequested && !canWriteback ? [`role:${actorRole}:cannot-writeback-memory`] : []),
    ].sort();
    return {
      mount: mount.mount,
      tenantId: mountTenantId,
      workspaceId: mountWorkspaceId,
      allowedRoles: [...new Set(mountAllowedRoles)].sort(),
      syncRequested,
      writebackRequested,
      status: blockedBy.length ? "blocked" : "scoped",
      blockedBy,
      nextAction: blockedBy.length ? "repair-memory-tenant-boundary" : "continue-memory-boundary",
    };
  });
  const tenantBlockedBy = [...new Set(scopedMounts.flatMap((mount) => mount.blockedBy))].sort();
  const auditEvents = [
    {
      event: "memory.mounts.scoped",
      subject: contract.id || "mailchimp-memory-contract",
      status: tenantBlockedBy.length ? "blocked" : "scoped",
    },
    {
      event: "memory.provider-sync.requested",
      subject: lifecycleControls.syncMounts.join(",") || "local-only",
      status: lifecycleControls.syncMounts.length ? "requested" : "not-required",
    },
    {
      event: "memory.writeback.requested",
      subject: lifecycleControls.stagedWritebacks.join(",") || "none",
      status: lifecycleControls.stagedWritebacks.length ? "approval-gated" : "not-required",
    },
  ];
  const auditId = `memory-tenant-audit:${stableKey([
    tenantId,
    workspaceId,
    actorRole,
    scopedMounts.map((mount) => [mount.mount, mount.status]),
  ])}`;

  return {
    auditId,
    tenantId,
    workspaceId,
    actorRole,
    allowedRoles: uniqueAllowedRoles,
    canRead,
    canSync,
    canWriteback,
    status: tenantBlockedBy.length ? "blocked" : "ready",
    scopedMounts,
    tenantBlockedBy,
    auditEvents,
    commandPolicy: [
      {
        command: "preview-memory-mounts",
        enabled: tenantBlockedBy.length === 0 && canRead,
        reason: canRead ? "actor can read scoped memory mounts" : "actor role cannot read workspace memory",
      },
      {
        command: "schedule-memory-sync",
        enabled: tenantBlockedBy.length === 0 && canSync && lifecycleControls.syncMounts.length > 0,
        reason: canSync ? "actor can schedule provider sync" : "actor role cannot sync provider memory",
      },
      {
        command: "handoff-memory-provider-sync",
        enabled: tenantBlockedBy.length === 0
          && canSync
          && (!lifecycleControls.stagedWritebacks.length || canWriteback),
        reason: canWriteback || !lifecycleControls.stagedWritebacks.length
          ? "tenant boundary permits provider handoff"
          : "staged writeback requires an approving role",
      },
    ],
    persistedState: {
      auditId,
      tenantId,
      workspaceId,
      actorRole,
      status: tenantBlockedBy.length ? "blocked" : "ready",
      nextAction: tenantBlockedBy.length ? "repair-memory-tenant-boundary" : "persist-memory-tenant-audit",
    },
    nextAction: tenantBlockedBy.length ? "repair-memory-tenant-boundary" : "persist-memory-tenant-audit",
  };
}

function buildMemoryLifecycleControls(mounts, settings, diagnostics, summary) {
  const invalidSettings = diagnostics.some((diagnostic) => diagnostic.level === "error");
  const disabled = new Set(settings.disabledMounts);
  const explicitEnabled = new Set(settings.enabledMounts);
  const selectableMounts = mounts.map((mount) => {
    const enabled = settings.enabled
      && !disabled.has(mount.mount)
      && (explicitEnabled.size === 0 || explicitEnabled.has(mount.mount));
    const providerSyncEnabled = enabled
      && mount.providerSyncRequired
      && settings.allowProviderSync
      && settings.mode !== "local-only";
    const stagedWritebackEnabled = providerSyncEnabled
      && mount.writebackStaged
      && settings.allowStagedWriteback;
    return {
      mount: mount.mount,
      enabled,
      status: enabled ? mount.status : "disabled",
      providerSyncEnabled,
      stagedWritebackEnabled,
      nextAction: !enabled
        ? "enable-memory-mount"
        : mount.status === "blocked"
          ? "repair-memory-mount"
          : providerSyncEnabled
            ? stagedWritebackEnabled
              ? "stage-memory-writeback"
              : "sync-memory-through-provider"
            : "continue-local-runtime",
    };
  });
  const activeMounts = selectableMounts.filter((mount) => mount.enabled);
  const syncMounts = selectableMounts.filter((mount) => mount.providerSyncEnabled);
  const canSchedule = settings.enabled
    && settings.scheduleEverySeconds != null
    && activeMounts.length > 0
    && syncMounts.length > 0
    && !invalidSettings
    && summary.errors === 0;
  const commands = [
    {
      command: settings.enabled ? "disable-memory-workflow" : "enable-memory-workflow",
      enabled: true,
      mounts: selectableMounts.map((mount) => mount.mount),
    },
    {
      command: "preview-memory-mounts",
      enabled: !invalidSettings,
      mounts: activeMounts.map((mount) => mount.mount),
    },
    {
      command: "schedule-memory-sync",
      enabled: canSchedule && syncMounts.length > 0,
      intervalSeconds: settings.scheduleEverySeconds,
      mounts: syncMounts.map((mount) => mount.mount),
    },
    {
      command: "checkpoint-memory-before-sync",
      enabled: activeMounts.length > 0 && settings.requireCheckpointBeforeSync && summary.errors === 0,
      mounts: activeMounts.map((mount) => mount.mount),
    },
  ];
  return {
    settings,
    diagnostics,
    enabled: settings.enabled && !invalidSettings,
    activeMounts: activeMounts.map((mount) => mount.mount),
    disabledMounts: selectableMounts.filter((mount) => !mount.enabled).map((mount) => mount.mount),
    syncMounts: syncMounts.map((mount) => mount.mount),
    stagedWritebacks: selectableMounts.filter((mount) => mount.stagedWritebackEnabled).map((mount) => mount.mount),
    canSchedule,
    commands,
    nextAction: invalidSettings
      ? "repair-memory-lifecycle-settings"
      : !settings.enabled
        ? "enable-memory-workflow"
        : summary.errors
          ? "resolve-memory-analysis-errors"
          : syncMounts.length
            ? "schedule-memory-sync"
            : "continue-local-runtime",
  };
}

function buildProviderContinuationContract(
  contract,
  mounts,
  lifecycleControls,
  rollbackPlan,
  summary,
  tenantBoundaryState = null,
) {
  const providerServiceContract = contract.providerServiceContract || {};
  const providerService = providerServiceContract.providerService || "mailchimp-marketing-api";
  const syncMounts = mounts.filter((mount) => lifecycleControls.syncMounts.includes(mount.mount));
  const stagedWritebacks = mounts.filter((mount) => lifecycleControls.stagedWritebacks.includes(mount.mount));
  const missingCapabilities = [...new Set(syncMounts.flatMap((mount) => (
    mount.requiredCapabilities || []
  )).filter((capability) => !lifecycleControls.settings.allowProviderSync && capability.startsWith("provider.")))].sort();
  const rollbackSteps = Array.isArray(rollbackPlan?.steps) ? rollbackPlan.steps : [];
  const checkpointCommand = lifecycleControls.commands.find((command) => (
    command.command === "checkpoint-memory-before-sync"
  ));
  const syncCommand = lifecycleControls.commands.find((command) => command.command === "schedule-memory-sync");
  const accepted = summary.errors === 0
    && lifecycleControls.enabled
    && syncMounts.length > 0
    && missingCapabilities.length === 0;
  const blockedBy = [
    ...summary.blockingCodes,
    ...missingCapabilities.map((capability) => `capability:${capability}`),
    ...asList(tenantBoundaryState?.tenantBlockedBy),
    ...lifecycleControls.diagnostics
      .filter((diagnostic) => diagnostic.level === "error")
      .map((diagnostic) => diagnostic.code),
  ].sort();

  return {
    continuationId: `memory-provider-continuation:${stableKey([
      contract.id,
      providerService,
      syncMounts.map((mount) => mount.mount),
      stagedWritebacks.map((mount) => mount.mount),
      blockedBy,
    ])}`,
    providerService,
    acceptedForProviderSync: accepted,
    status: accepted
      ? stagedWritebacks.length
        ? "ready-with-staged-writeback"
        : "ready"
      : blockedBy.length
        ? "blocked"
        : lifecycleControls.enabled
          ? "local-only"
          : "paused",
    syncMetadata: {
      statusChannel: accepted ? "memory.status.mailchimp.provider-sync" : "memory.status.mailchimp.continuation",
      cursorPaths: syncMounts.map((mount) => mount.handoff.recoveryCursor).filter(Boolean).sort(),
      checkpointRequired: lifecycleControls.settings.requireCheckpointBeforeSync,
      checkpointCommandEnabled: Boolean(checkpointCommand?.enabled),
      scheduleId: syncCommand?.enabled
        ? `memory-sync-schedule:${stableKey([contract.id, syncCommand.intervalSeconds, syncCommand.mounts])}`
        : null,
      intervalSeconds: syncCommand?.enabled ? syncCommand.intervalSeconds : null,
    },
    capabilityNegotiation: {
      requiredCapabilities: [...new Set(syncMounts.flatMap((mount) => mount.requiredCapabilities || []))].sort(),
      negotiatedCapabilities: [...new Set(syncMounts.flatMap((mount) => mount.requiredCapabilities || []))]
        .filter((capability) => !missingCapabilities.includes(capability))
        .sort(),
      missingCapabilities,
      status: missingCapabilities.length ? "capability-mismatch" : "negotiated",
    },
    externalHandoffState: {
      handoffMode: stagedWritebacks.length ? "stage-local-before-provider-write" : "read-through-provider-adapter",
      syncMounts: syncMounts.map((mount) => mount.mount),
      stagedWritebacks: stagedWritebacks.map((mount) => mount.mount),
      tenantAuditId: tenantBoundaryState?.auditId || null,
      restartSafe: rollbackSteps.length > 0 && lifecycleControls.settings.requireCheckpointBeforeSync,
      idempotencyKey: `memory-sync:${stableKey([
        contract.id,
        syncMounts.map((mount) => mount.mount),
        rollbackSteps.map((step) => step.id || step.name),
      ])}`,
      blockedBy,
    },
    commands: [
      {
        command: "persist-memory-tenant-audit",
        enabled: tenantBoundaryState?.status === "ready",
        auditId: tenantBoundaryState?.auditId || null,
      },
      {
        command: "persist-memory-provider-continuation",
        enabled: syncMounts.length > 0,
        continuationId: `memory-provider-continuation:${stableKey([contract.id, providerService])}`,
      },
      {
        command: "checkpoint-memory-before-provider-sync",
        enabled: Boolean(checkpointCommand?.enabled),
        rollbackSteps: rollbackSteps.length,
      },
      {
        command: "handoff-memory-provider-sync",
        enabled: accepted,
        mounts: syncMounts.map((mount) => mount.mount),
      },
    ],
    nextAction: accepted
      ? lifecycleControls.settings.requireCheckpointBeforeSync
        ? "checkpoint-memory-before-provider-sync"
        : "handoff-memory-provider-sync"
      : blockedBy.length
        ? "repair-memory-provider-continuation"
        : lifecycleControls.nextAction,
  };
}

function buildMemoryPreviewAcceptancePackage(contract, mounts, lifecycleControls, providerContinuationContract, summary, source, options) {
  const acceptanceInput = options.acceptance || source.acceptance || source.memoryAcceptance || {};
  const issueCodes = [
    ...summary.blockingCodes.map((code) => `diagnostic:${code}`),
    ...lifecycleControls.diagnostics
      .filter((diagnostic) => diagnostic.level === "error")
      .map((diagnostic) => `lifecycle:${diagnostic.code}`),
    ...providerContinuationContract.capabilityNegotiation.missingCapabilities
      .map((capability) => `capability:${capability}`),
  ].sort();
  const activeMounts = new Set(lifecycleControls.activeMounts);
  const syncMounts = new Set(lifecycleControls.syncMounts);
  const stagedWritebacks = new Set(lifecycleControls.stagedWritebacks);
  const previewRows = mounts.map((mount) => {
    const enabled = activeMounts.has(mount.mount);
    const providerSyncEnabled = syncMounts.has(mount.mount);
    const stagedWritebackEnabled = stagedWritebacks.has(mount.mount);
    const blocked = mount.status === "blocked" || issueCodes.length > 0;
    return {
      mount: mount.mount,
      path: mount.path,
      mode: mount.mode,
      sensitivity: mount.sensitivity,
      displayState: !enabled
        ? "disabled"
        : blocked
          ? "blocked"
          : providerSyncEnabled
            ? stagedWritebackEnabled
              ? "staged-writeback"
              : "provider-sync"
            : "local-ready",
      providerSyncEnabled,
      stagedWritebackEnabled,
      requiredCapabilities: mount.requiredCapabilities,
      statusChannel: mount.handoff.statusChannel,
      nextAction: !enabled
        ? "enable-memory-mount"
        : blocked
          ? "repair-memory-preview"
          : providerSyncEnabled
            ? "preview-provider-sync"
            : "continue-local-runtime",
    };
  });
  const providerAcceptanceRequired = lifecycleControls.syncMounts.length > 0
    || lifecycleControls.stagedWritebacks.length > 0;
  const checkpointRequired = providerContinuationContract.syncMetadata.checkpointRequired;
  const checkpointReady = !checkpointRequired
    || providerContinuationContract.syncMetadata.checkpointCommandEnabled;
  const acceptedByOperator = acceptanceInput.accepted === true
    || acceptanceInput.providerSyncAccepted === true
    || options.acceptProviderSync === true;
  const acceptedForRuntime = summary.errors === 0
    && lifecycleControls.enabled
    && lifecycleControls.activeMounts.length > 0
    && issueCodes.length === 0;
  const acceptedForProviderSync = acceptedForRuntime
    && providerContinuationContract.acceptedForProviderSync
    && (!providerAcceptanceRequired || acceptedByOperator);
  const validationChecks = [
    {
      check: "memory-diagnostics-clear",
      status: summary.errors ? "fail" : "pass",
      details: summary.blockingCodes,
    },
    {
      check: "lifecycle-settings-valid",
      status: lifecycleControls.diagnostics.some((diagnostic) => diagnostic.level === "error") ? "fail" : "pass",
      details: lifecycleControls.diagnostics
        .filter((diagnostic) => diagnostic.level === "error")
        .map((diagnostic) => diagnostic.code),
    },
    {
      check: "provider-capabilities-negotiated",
      status: providerContinuationContract.capabilityNegotiation.missingCapabilities.length ? "fail" : "pass",
      details: providerContinuationContract.capabilityNegotiation.missingCapabilities,
    },
    {
      check: "checkpoint-command-ready",
      status: checkpointReady ? "pass" : "pending",
      details: checkpointRequired ? ["checkpoint-required"] : [],
    },
    {
      check: "provider-sync-accepted",
      status: providerAcceptanceRequired && !acceptedByOperator ? "pending" : "pass",
      details: providerAcceptanceRequired ? lifecycleControls.syncMounts : [],
    },
  ];
  const failedChecks = validationChecks.filter((check) => check.status === "fail");
  const pendingChecks = validationChecks.filter((check) => check.status === "pending");
  const readinessStatus = failedChecks.length
    ? "blocked"
    : pendingChecks.length
      ? "pending-acceptance"
      : "ready";

  return {
    packageId: `memory-preview-package:${stableKey([
      contract.id,
      lifecycleControls.activeMounts,
      lifecycleControls.syncMounts,
      providerContinuationContract.continuationId,
      readinessStatus,
    ])}`,
    preview: {
      previewId: `memory-preview:${stableKey([
        contract.id,
        previewRows.map((row) => [row.mount, row.displayState]),
      ])}`,
      title: "Mailchimp memory mount preview",
      status: failedChecks.length ? "blocked" : "ready",
      rows: previewRows,
      counters: {
        mounts: previewRows.length,
        activeMounts: lifecycleControls.activeMounts.length,
        providerSyncMounts: lifecycleControls.syncMounts.length,
        stagedWritebacks: lifecycleControls.stagedWritebacks.length,
        blockedRows: previewRows.filter((row) => row.displayState === "blocked").length,
      },
    },
    acceptance: {
      acceptanceId: `memory-acceptance:${stableKey([
        contract.id,
        acceptanceInput.acceptedBy,
        acceptedByOperator,
        providerContinuationContract.continuationId,
      ])}`,
      required: providerAcceptanceRequired,
      acceptedForRuntime,
      acceptedForProviderSync,
      acceptedBy: acceptanceInput.acceptedBy || null,
      acceptedAt: acceptanceInput.acceptedAt || null,
      blockedBy: issueCodes,
      nextAction: issueCodes.length
        ? "repair-memory-preview"
        : providerAcceptanceRequired && !acceptedByOperator
          ? "collect-memory-provider-acceptance"
          : acceptedForProviderSync
            ? "handoff-memory-provider-sync"
            : "continue-local-runtime",
    },
    readiness: {
      status: readinessStatus,
      readyForRuntime: acceptedForRuntime,
      readyForProviderSync: acceptedForProviderSync,
      validationChecks,
      failedChecks: failedChecks.map((check) => check.check),
      pendingChecks: pendingChecks.map((check) => check.check),
      nextAction: failedChecks.length
        ? failedChecks[0].check === "provider-capabilities-negotiated"
          ? "refresh-provider-memory-capabilities"
          : "repair-memory-preview"
        : pendingChecks.length
          ? pendingChecks[0].check === "checkpoint-command-ready"
            ? "checkpoint-memory-before-provider-sync"
            : "collect-memory-provider-acceptance"
          : acceptedForProviderSync
            ? "handoff-memory-provider-sync"
            : "continue-local-runtime",
    },
    nextSteps: [
      ...failedChecks.map((check) => ({
        action: check.check === "provider-capabilities-negotiated"
          ? "refresh-provider-memory-capabilities"
          : "repair-memory-preview",
        subject: check.check,
        reason: "Memory mount preview has a blocking validation check",
        details: check.details,
      })),
      ...pendingChecks.map((check) => ({
        action: check.check === "checkpoint-command-ready"
          ? "checkpoint-memory-before-provider-sync"
          : "collect-memory-provider-acceptance",
        subject: check.check,
        reason: "Memory mount preview needs a restart-safe checkpoint or operator acceptance",
        details: check.details,
      })),
      ...(!failedChecks.length && !pendingChecks.length ? [{
        action: acceptedForProviderSync ? "handoff-memory-provider-sync" : "continue-local-runtime",
        subject: providerContinuationContract.continuationId,
        reason: "Memory mounts are validated for the selected runtime path",
        details: lifecycleControls.syncMounts,
      }] : []),
    ],
  };
}

function buildMemoryClientRuntimeAdoptionState(
  contract,
  previewAcceptancePackage,
  providerContinuationContract,
  lifecycleControls,
  rollbackPlan,
  source = {},
  options = {},
) {
  const clientRuntime = options.clientRuntime
    || source.clientRuntime
    || source.requestRuntime
    || {};
  const requestState = clientRuntime.requestState
    || source.requestState
    || source.persistedState
    || {};
  const preview = previewAcceptancePackage.preview;
  const acceptance = previewAcceptancePackage.acceptance;
  const readiness = previewAcceptancePackage.readiness;
  const requestId = requestState.requestId
    || clientRuntime.requestId
    || options.requestId
    || `mailchimp-memory-request-${stableKey([contract.id])}`;
  const workflowId = requestState.workflowId
    || clientRuntime.workflowId
    || options.workflowId
    || "mailchimp-memory-workflow";
  const requiredClientState = [
    "requestId",
    "workflowId",
    "previewId",
    "acceptanceId",
    "continuationId",
    ...asList(clientRuntime.requiredKeys),
  ];
  const observedState = {
    ...requestState,
    requestId,
    workflowId,
    previewId: requestState.previewId || preview.previewId,
    acceptanceId: requestState.acceptanceId || acceptance.acceptanceId,
    continuationId: requestState.continuationId || providerContinuationContract.continuationId,
    lifecycleMode: lifecycleControls.settings.mode,
    readinessStatus: readiness.status,
    providerService: providerContinuationContract.providerService,
  };
  const missingClientState = [...new Set(requiredClientState)]
    .filter((key) => observedState[key] == null)
    .sort();
  const failedChecks = asList(readiness.failedChecks);
  const pendingChecks = asList(readiness.pendingChecks);
  const blockedBy = [
    ...failedChecks.map((check) => `memory-check:${check}`),
    ...asList(acceptance.blockedBy),
    ...providerContinuationContract.externalHandoffState.blockedBy.map((blocker) => `provider:${blocker}`),
  ].sort();
  const acceptedForRuntime = missingClientState.length === 0
    && readiness.readyForRuntime === true
    && blockedBy.length === 0;
  const acceptedForProviderSync = acceptedForRuntime
    && readiness.readyForProviderSync === true
    && acceptance.acceptedForProviderSync === true;
  const stateKey = clientRuntime.stateKey || clientRuntime.clientStateKey || `memory-client-state:${stableKey([
    requestId,
    workflowId,
    preview.previewId,
  ])}`;
  const continuationToken = clientRuntime.continuationToken || `memory-continuation:${stableKey([
    requestId,
    providerContinuationContract.continuationId,
    readiness.status,
  ])}`;
  const adoptionStatus = missingClientState.length
    ? "needs-client-state"
    : blockedBy.length
      ? "blocked"
      : pendingChecks.length
        ? "pending-readiness"
        : acceptedForProviderSync
          ? "ready-for-provider-sync"
          : acceptedForRuntime
            ? "ready-for-runtime"
            : "waiting";
  const rollbackSteps = Array.isArray(rollbackPlan?.steps) ? rollbackPlan.steps : [];
  const routeCommands = [
    {
      command: "render-memory-preview",
      enabled: true,
      previewId: preview.previewId,
    },
    {
      command: "persist-memory-client-state",
      enabled: true,
      stateKey,
      idempotencyKey: `memory-state:${stableKey([
        stateKey,
        preview.previewId,
        acceptance.acceptanceId,
      ])}`,
    },
    {
      command: "checkpoint-memory-runtime",
      enabled: acceptedForRuntime && lifecycleControls.settings.requireCheckpointBeforeSync,
      rollbackSteps: rollbackSteps.length,
      idempotencyKey: `memory-checkpoint:${stableKey([
        stateKey,
        rollbackSteps.map((step) => step.id || step.name),
      ])}`,
    },
    {
      command: "handoff-memory-provider-sync",
      enabled: acceptedForProviderSync,
      continuationId: providerContinuationContract.continuationId,
      idempotencyKey: `memory-provider-sync:${providerContinuationContract.continuationId}`,
    },
  ];
  const nextSteps = [
    ...missingClientState.map((key) => ({
      action: "hydrate-memory-client-state",
      subject: key,
      reason: "Memory route state must be persisted before runtime adoption",
    })),
    ...blockedBy.map((blocker) => ({
      action: readiness.nextAction,
      subject: blocker,
      reason: "Memory adoption has a blocking validation condition",
    })),
    ...pendingChecks.map((check) => ({
      action: readiness.nextAction,
      subject: check,
      reason: "Memory adoption is waiting for a restart-safe checkpoint or acceptance",
    })),
    ...(acceptedForProviderSync ? [{
      action: "handoff-memory-provider-sync",
      subject: providerContinuationContract.continuationId,
      reason: "Memory client state and provider sync acceptance are complete",
    }] : acceptedForRuntime ? [{
      action: "continue-local-runtime",
      subject: stateKey,
      reason: "Memory client state is hydrated for local runtime adoption",
    }] : []),
  ];

  return {
    adoptionId: `memory-runtime-adoption:${stableKey([
      requestId,
      workflowId,
      providerContinuationContract.continuationId,
      adoptionStatus,
    ])}`,
    status: adoptionStatus,
    requestId,
    workflowId,
    stateKey,
    continuationToken,
    hydrated: missingClientState.length === 0,
    acceptedForRuntime,
    acceptedForProviderSync,
    requiredClientState: [...new Set(requiredClientState)].sort(),
    missingClientState,
    persistedState: {
      ...observedState,
      stateKey,
      continuationToken,
      adoptionStatus,
      nextAction: adoptionStatus === "needs-client-state"
        ? "hydrate-memory-client-state"
        : adoptionStatus === "blocked" || adoptionStatus === "pending-readiness"
          ? readiness.nextAction
          : acceptedForProviderSync
            ? "handoff-memory-provider-sync"
            : "continue-local-runtime",
    },
    routeCommands,
    nextSteps,
    nextAction: adoptionStatus === "needs-client-state"
      ? "hydrate-memory-client-state"
      : adoptionStatus === "blocked" || adoptionStatus === "pending-readiness"
        ? readiness.nextAction
        : acceptedForProviderSync
          ? "handoff-memory-provider-sync"
      : "continue-local-runtime",
  };
}

function normalizeMemoryHealthSource(source = {}, options = {}) {
  return options.operationalHealth
    || source.operationalHealth
    || source.health
    || source.providerServiceContract?.health
    || source.providerService?.health
    || {};
}

function buildMemoryOperationalHealthState(
  source,
  options,
  mounts,
  summary,
  lifecycleControls,
  tenantBoundaryState,
  providerContinuationContract,
  previewAcceptancePackage,
  clientRuntimeAdoptionState,
) {
  const healthSource = normalizeMemoryHealthSource(source, options);
  const retryPolicy = healthSource.retryPolicy || {};
  const attempts = Math.max(0, Math.floor(Number(
    healthSource.attempts ?? healthSource.retryAttempts ?? source.retryAttempts ?? 0,
  )));
  const maxAttempts = Math.max(1, Math.floor(Number(
    healthSource.maxAttempts ?? retryPolicy.maxAttempts ?? 4,
  )));
  const initialDelaySeconds = Math.max(10, Math.floor(Number(
    retryPolicy.initialDelaySeconds ?? healthSource.initialDelaySeconds ?? 30,
  )));
  const maxDelaySeconds = Math.max(initialDelaySeconds, Math.floor(Number(
    retryPolicy.maxDelaySeconds ?? healthSource.maxDelaySeconds ?? 480,
  )));
  const providerAvailable = healthSource.providerAvailable !== false
    && healthSource.status !== "down"
    && healthSource.status !== "unavailable";
  const adapterHealthy = healthSource.adapterHealthy !== false
    && healthSource.adapterStatus !== "down"
    && healthSource.adapterStatus !== "unavailable";
  const activeMountNames = new Set(lifecycleControls.activeMounts);
  const syncMountNames = new Set(lifecycleControls.syncMounts);
  const externallyReportedFailures = asList(healthSource.failures || healthSource.errors)
    .map((failure) => (typeof failure === "string" ? { code: failure } : failure))
    .filter(Boolean);
  const mountIncidents = mounts
    .filter((mount) => activeMountNames.has(mount.mount) || syncMountNames.has(mount.mount))
    .flatMap((mount) => {
      const incidents = [];
      if (mount.status === "blocked") {
        incidents.push({
          code: "memory.health.mount-blocked",
          mount: mount.mount,
          severity: "error",
          retryable: false,
          action: "repair-memory-preview",
          details: { status: mount.status, path: mount.path },
        });
      }
      if (syncMountNames.has(mount.mount) && !providerAvailable) {
        incidents.push({
          code: "memory.health.provider-unavailable",
          mount: mount.mount,
          severity: "error",
          retryable: true,
          action: "retry-memory-provider-health-check",
          details: { statusChannel: mount.handoff.statusChannel },
        });
      }
      if (syncMountNames.has(mount.mount) && !adapterHealthy) {
        incidents.push({
          code: "memory.health.adapter-unavailable",
          mount: mount.mount,
          severity: "error",
          retryable: true,
          action: "retry-memory-adapter-status",
          details: { statusChannel: "memory.health.mailchimp.adapter" },
        });
      }
      if (syncMountNames.has(mount.mount) && !mount.handoff.recoveryCursor) {
        incidents.push({
          code: "memory.health.recovery-cursor-missing",
          mount: mount.mount,
          severity: "warning",
          retryable: false,
          action: "persist-memory-recovery-cursor",
          details: { nextAction: mount.handoff.nextAction },
        });
      }
      return incidents;
    });
  const settingIncidents = lifecycleControls.diagnostics.map((diagnostic) => ({
    code: diagnostic.level === "error"
      ? "memory.health.lifecycle-invalid"
      : "memory.health.lifecycle-warning",
    mount: diagnostic.mount || null,
    severity: diagnostic.level || "warning",
    retryable: false,
    action: diagnostic.level === "error"
      ? "repair-memory-lifecycle-settings"
      : "review-memory-lifecycle-settings",
    details: diagnostic,
  }));
  const tenantIncidents = tenantBoundaryState.tenantBlockedBy.map((blocker) => ({
    code: "memory.health.tenant-boundary-blocked",
    mount: null,
    severity: "error",
    retryable: false,
    action: tenantBoundaryState.nextAction,
    details: { blocker },
  }));
  const capabilityIncidents = providerContinuationContract.capabilityNegotiation.missingCapabilities.map((capability) => ({
    code: "memory.health.capability-missing",
    mount: null,
    severity: "error",
    retryable: true,
    action: "refresh-provider-memory-capabilities",
    details: { capability },
  }));
  const clientStateIncidents = clientRuntimeAdoptionState.missingClientState.map((key) => ({
    code: "memory.health.client-state-missing",
    mount: null,
    severity: "warning",
    retryable: false,
    action: "hydrate-memory-client-state",
    details: { key },
  }));
  const readinessIncidents = [
    ...asList(previewAcceptancePackage.readiness.failedChecks).map((check) => ({
      code: "memory.health.readiness-failed",
      mount: null,
      severity: "error",
      retryable: false,
      action: previewAcceptancePackage.readiness.nextAction,
      details: { check },
    })),
    ...asList(previewAcceptancePackage.readiness.pendingChecks).map((check) => ({
      code: "memory.health.readiness-pending",
      mount: null,
      severity: "warning",
      retryable: check === "checkpoint-command-ready",
      action: previewAcceptancePackage.readiness.nextAction,
      details: { check },
    })),
  ];
  const externalIncidents = externallyReportedFailures.map((failure) => ({
    code: failure.code || "memory.health.external-failure",
    mount: failure.mount || null,
    severity: failure.severity || failure.level || "error",
    retryable: failure.retryable !== false,
    action: failure.action || "retry-memory-health-check",
    details: failure,
  }));
  const incidents = [
    ...mountIncidents,
    ...settingIncidents,
    ...tenantIncidents,
    ...capabilityIncidents,
    ...clientStateIncidents,
    ...readinessIncidents,
    ...externalIncidents,
  ].map((incident, index) => ({
    incidentId: `memory-incident:${stableKey([
      incident.code,
      incident.mount,
      incident.action,
      JSON.stringify(incident.details || {}),
      index,
    ])}`,
    ...incident,
  }));
  const blockingIncidents = incidents.filter((incident) => incident.severity === "error");
  const warningIncidents = incidents.filter((incident) => incident.severity === "warning");
  const retryableIncidents = incidents.filter((incident) => incident.retryable);
  const retryExhausted = attempts >= maxAttempts;
  const retryable = retryableIncidents.length > 0 && !retryExhausted;
  const degradedMode = incidents.length > 0 || summary.errors > 0 || summary.warnings > 0;
  const nextDelaySeconds = retryable
    ? Math.min(initialDelaySeconds * (2 ** attempts), maxDelaySeconds)
    : null;
  const healthStatus = blockingIncidents.length
    ? retryExhausted
      ? "failed"
      : providerAvailable && adapterHealthy
        ? "degraded"
        : "provider-unavailable"
    : warningIncidents.length
      ? "degraded"
      : "healthy";
  const actionableErrors = incidents.map((incident) => ({
    code: incident.code,
    incidentId: incident.incidentId,
    mount: incident.mount,
    severity: incident.severity,
    action: retryExhausted && incident.retryable ? "escalate-memory-recovery" : incident.action,
    retryable: incident.retryable && !retryExhausted,
    details: incident.details,
  }));
  const healthId = `memory-health:${stableKey([
    providerContinuationContract.continuationId,
    clientRuntimeAdoptionState.stateKey,
    healthStatus,
    attempts,
    incidents.map((incident) => incident.incidentId),
  ])}`;

  return {
    healthId,
    status: healthStatus,
    degradedMode,
    providerAvailable,
    adapterHealthy,
    retryable,
    attempts,
    maxAttempts,
    nextDelaySeconds,
    statusChannel: degradedMode ? "memory.health.mailchimp.degraded" : "memory.health.mailchimp",
    incidents,
    incidentSummary: {
      total: incidents.length,
      errors: blockingIncidents.length,
      warnings: warningIncidents.length,
      retryable: retryableIncidents.length,
      mountsAffected: [...new Set(incidents.map((incident) => incident.mount).filter(Boolean))].sort(),
      codes: [...new Set(incidents.map((incident) => incident.code))].sort(),
    },
    actionableErrors,
    degradedModeContract: {
      enabled: degradedMode,
      localRuntimeAllowed: blockingIncidents.every((incident) => (
        incident.code !== "memory.health.mount-blocked"
        && incident.code !== "memory.health.lifecycle-invalid"
        && incident.code !== "memory.health.tenant-boundary-blocked"
      )),
      providerSyncHeld: blockingIncidents.length > 0 || !providerAvailable || !adapterHealthy,
      heldMounts: [...new Set([
        ...incidents.map((incident) => incident.mount).filter(Boolean),
        ...(!providerAvailable || !adapterHealthy ? lifecycleControls.syncMounts : []),
      ])].sort(),
      nextAction: retryable
        ? "schedule-memory-health-retry"
        : actionableErrors[0]?.action || "continue-local-runtime",
    },
    retryPolicy: {
      strategy: retryPolicy.strategy || "bounded-exponential",
      attempts,
      maxAttempts,
      initialDelaySeconds,
      maxDelaySeconds,
      nextDelaySeconds,
      retryable,
      retryBlockedBy: retryExhausted ? ["retry:exhausted"] : [],
    },
    persistedState: {
      healthId,
      continuationId: providerContinuationContract.continuationId,
      stateKey: clientRuntimeAdoptionState.stateKey,
      status: healthStatus,
      degradedMode,
      attempts,
      incidentCodes: [...new Set(incidents.map((incident) => incident.code))].sort(),
      nextAction: retryable
        ? "schedule-memory-health-retry"
        : actionableErrors[0]?.action || clientRuntimeAdoptionState.nextAction,
    },
    commands: [
      {
        command: "persist-memory-health-state",
        enabled: true,
        idempotencyKey: `memory-health:${healthId}`,
      },
      {
        command: "schedule-memory-health-retry",
        enabled: retryable,
        delaySeconds: nextDelaySeconds,
        idempotencyKey: `memory-health-retry:${stableKey([healthId, attempts + 1])}`,
      },
      {
        command: "enter-memory-degraded-mode",
        enabled: degradedMode && !retryable,
        heldMounts: [...new Set(incidents.map((incident) => incident.mount).filter(Boolean))].sort(),
      },
      {
        command: "resume-memory-provider-sync",
        enabled: healthStatus === "healthy" && clientRuntimeAdoptionState.acceptedForProviderSync,
        continuationId: providerContinuationContract.continuationId,
      },
    ],
    nextAction: retryable
      ? "schedule-memory-health-retry"
      : actionableErrors[0]?.action || clientRuntimeAdoptionState.nextAction,
  };
}

function buildMemoryLifecycleCommandReport(
  contract,
  mounts,
  lifecycleControls,
  providerContinuationContract,
  previewAcceptancePackage,
  clientRuntimeAdoptionState,
  operationalHealthState,
  tenantBoundaryState,
  summary,
) {
  const mountByName = new Map(mounts.map((mount) => [mount.mount, mount]));
  const readiness = previewAcceptancePackage.readiness;
  const acceptance = previewAcceptancePackage.acceptance;
  const enabledCommands = [
    ...lifecycleControls.commands,
    ...clientRuntimeAdoptionState.routeCommands,
    ...operationalHealthState.commands,
    ...providerContinuationContract.commands,
  ].filter((command) => command.enabled === true);
  const disabledCommands = [
    ...lifecycleControls.commands,
    ...clientRuntimeAdoptionState.routeCommands,
    ...operationalHealthState.commands,
    ...providerContinuationContract.commands,
  ].filter((command) => command.enabled !== true);
  const syncMountRows = lifecycleControls.syncMounts.map((mountName) => {
    const mount = mountByName.get(mountName) || {};
    return {
      mount: mountName,
      path: mount.path || null,
      status: mount.status || "unknown",
      statusChannel: mount.handoff?.statusChannel || "memory.status.mailchimp.provider-sync",
      recoveryCursor: mount.handoff?.recoveryCursor || null,
      nextAction: mount.handoff?.nextAction || providerContinuationContract.nextAction,
    };
  });
  const blockedBy = [
    ...summary.blockingCodes,
    ...tenantBoundaryState.tenantBlockedBy.map((blocker) => `tenant:${blocker}`),
    ...clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
    ...providerContinuationContract.externalHandoffState.blockedBy.map((blocker) => `provider:${blocker}`),
    ...operationalHealthState.incidents
      .filter((incident) => incident.severity === "error")
      .map((incident) => `health:${incident.code}`),
  ].sort();
  const pendingBy = [
    ...asList(readiness.pendingChecks).map((check) => `readiness:${check}`),
    ...(acceptance.required && !acceptance.acceptedForProviderSync ? ["acceptance:provider-sync"] : []),
    ...(operationalHealthState.retryable ? ["health:retry-scheduled"] : []),
  ].sort();
  const scheduleCommand = lifecycleControls.commands.find((command) => command.command === "schedule-memory-sync");
  const handoffCommand = clientRuntimeAdoptionState.routeCommands.find((command) => command.command === "handoff-memory-provider-sync")
    || providerContinuationContract.commands.find((command) => command.command === "handoff-memory-provider-sync");
  const scheduleReady = scheduleCommand?.enabled === true
    && operationalHealthState.status === "healthy"
    && blockedBy.length === 0;
  const handoffReady = handoffCommand?.enabled === true
    && clientRuntimeAdoptionState.acceptedForProviderSync
    && tenantBoundaryState.status === "ready"
    && operationalHealthState.status === "healthy";
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : handoffReady
        ? "handoff-ready"
        : scheduleReady
          ? "scheduled"
          : lifecycleControls.enabled
            ? "preview-ready"
            : "paused";

  return {
    reportId: `memory-lifecycle-report:${stableKey([
      contract.id,
      lifecycleControls.settings.mode,
      lifecycleControls.activeMounts,
      lifecycleControls.syncMounts,
      status,
    ])}`,
    status,
    generatedDeterministically: true,
    lifecycleMode: lifecycleControls.settings.mode,
    enabled: lifecycleControls.enabled,
    schedule: {
      enabled: scheduleReady,
      scheduleId: providerContinuationContract.syncMetadata.scheduleId,
      intervalSeconds: providerContinuationContract.syncMetadata.intervalSeconds,
      statusChannel: scheduleReady ? "memory.schedule.mailchimp" : "memory.status.mailchimp.lifecycle",
      nextTickAction: scheduleReady ? "handoff-memory-provider-sync" : lifecycleControls.nextAction,
    },
    commandSummary: {
      enabledCommands: enabledCommands.length,
      disabledCommands: disabledCommands.length,
      idempotentCommands: enabledCommands.filter((command) => command.idempotencyKey).length,
      healthCommands: operationalHealthState.commands.length,
      routeCommands: clientRuntimeAdoptionState.routeCommands.length,
    },
    commandRows: [
      ...enabledCommands,
      ...disabledCommands,
    ].map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      idempotencyKey: command.idempotencyKey || null,
      delaySeconds: command.delaySeconds ?? null,
      continuationId: command.continuationId || providerContinuationContract.continuationId,
      reason: command.reason || null,
    })),
    syncMountRows,
    exportRows: mounts.map((mount) => ({
      mount: mount.mount,
      path: mount.path,
      status: mount.status,
      lifecycleEnabled: lifecycleControls.activeMounts.includes(mount.mount),
      providerSyncEnabled: lifecycleControls.syncMounts.includes(mount.mount),
      stagedWritebackEnabled: lifecycleControls.stagedWritebacks.includes(mount.mount),
      healthHeld: operationalHealthState.degradedModeContract.heldMounts.includes(mount.mount),
      nextAction: lifecycleControls.syncMounts.includes(mount.mount)
        ? providerContinuationContract.nextAction
        : mount.handoff.nextAction,
    })),
    handoff: {
      ready: handoffReady,
      command: handoffCommand?.command || "handoff-memory-provider-sync",
      continuationId: providerContinuationContract.continuationId,
      tenantAuditId: tenantBoundaryState.auditId,
      stateKey: clientRuntimeAdoptionState.stateKey,
      acceptedForProviderSync: clientRuntimeAdoptionState.acceptedForProviderSync,
    },
    blockedBy,
    pendingBy,
    nextAction: blockedBy.length
      ? blockedBy[0].startsWith("tenant:")
        ? tenantBoundaryState.nextAction
        : blockedBy[0].startsWith("client-state:")
          ? "hydrate-memory-client-state"
          : blockedBy[0].startsWith("health:")
            ? operationalHealthState.nextAction
            : "repair-memory-provider-continuation"
      : pendingBy.length
        ? pendingBy.includes("acceptance:provider-sync")
          ? "collect-memory-provider-acceptance"
          : readiness.nextAction
        : handoffReady
          ? "handoff-memory-provider-sync"
          : scheduleReady
            ? "schedule-memory-sync"
            : lifecycleControls.nextAction,
  };
}

function buildMemoryExportManifest(
  contract,
  exportSummary,
  lifecycleCommandReport,
  timelineState,
  operationalHealthState,
) {
  const blockedBy = [
    ...asList(lifecycleCommandReport.blockedBy),
    ...asList(exportSummary.diagnostics?.blockingCodes).map((code) => `diagnostic:${code}`),
  ].sort();
  const exportReady = exportSummary.status !== "blocked"
    && blockedBy.length === 0
    && operationalHealthState.status === "healthy";

  return {
    manifestId: `memory-export-manifest:${stableKey([
      contract.id,
      exportSummary.status,
      lifecycleCommandReport.reportId,
      operationalHealthState.healthId,
    ])}`,
    exportKind: "mailchimp.memoryMounts.lifecycleExport",
    exportReady,
    status: exportReady ? "ready" : blockedBy.length ? "blocked" : "waiting",
    rows: lifecycleCommandReport.exportRows,
    totals: exportSummary.totals,
    statusChannels: [
      ...new Set([
        lifecycleCommandReport.schedule.statusChannel,
        operationalHealthState.statusChannel,
        ...timelineState.reportChannels,
      ].filter(Boolean)),
    ].sort(),
    commands: [
      {
        command: "publish-memory-export-summary",
        enabled: exportReady,
        manifestId: `publish-memory-export:${stableKey([contract.id, lifecycleCommandReport.reportId])}`,
      },
      {
        command: "persist-memory-lifecycle-report",
        enabled: true,
        reportId: lifecycleCommandReport.reportId,
      },
    ],
    blockedBy,
    nextAction: exportReady
      ? "publish-memory-export-summary"
      : lifecycleCommandReport.nextAction,
  };
}

function buildMemoryDownstreamStatusPacket(
  contract,
  mounts,
  previewAcceptancePackage,
  clientRuntimeAdoptionState,
  providerContinuationContract,
  operationalHealthState,
  lifecycleCommandReport,
  memoryExportManifest,
) {
  const readiness = previewAcceptancePackage.readiness;
  const acceptance = previewAcceptancePackage.acceptance;
  const healthErrors = operationalHealthState.incidents
    .filter((incident) => incident.severity === "error")
    .map((incident) => `health:${incident.code}`);
  const blockedBy = [
    ...asList(readiness.failedChecks).map((check) => `readiness:${check}`),
    ...asList(acceptance.blockedBy).map((blocker) => `acceptance:${blocker}`),
    ...clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
    ...providerContinuationContract.externalHandoffState.blockedBy.map((blocker) => `provider:${blocker}`),
    ...healthErrors,
    ...asList(lifecycleCommandReport.blockedBy),
    ...asList(memoryExportManifest.blockedBy).map((blocker) => `export:${blocker}`),
  ].sort();
  const pendingBy = [
    ...asList(readiness.pendingChecks).map((check) => `readiness:${check}`),
    ...(acceptance.required && !acceptance.acceptedForProviderSync ? ["acceptance:provider-sync"] : []),
    ...(operationalHealthState.retryable ? ["health:retry-scheduled"] : []),
    ...asList(lifecycleCommandReport.pendingBy),
  ].sort();
  const acceptedForDownstream = blockedBy.length === 0
    && pendingBy.length === 0
    && clientRuntimeAdoptionState.acceptedForRuntime === true
    && operationalHealthState.status === "healthy";
  const acceptedForProviderSync = acceptedForDownstream
    && clientRuntimeAdoptionState.acceptedForProviderSync === true
    && providerContinuationContract.acceptedForProviderSync === true;
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : acceptedForProviderSync
        ? "provider-sync-ready"
        : acceptedForDownstream
          ? "runtime-ready"
          : "waiting";
  const statusRows = [
    {
      key: "memory-preview",
      status: previewAcceptancePackage.preview.status,
      accepted: readiness.readyForRuntime === true && asList(readiness.failedChecks).length === 0,
      restartSafe: true,
      statusPath: previewAcceptancePackage.preview.previewId,
      blockedBy: asList(readiness.failedChecks).map((check) => `readiness:${check}`),
      pendingBy: asList(readiness.pendingChecks).map((check) => `readiness:${check}`),
      nextAction: readiness.nextAction,
    },
    {
      key: "client-runtime",
      status: clientRuntimeAdoptionState.status,
      accepted: clientRuntimeAdoptionState.acceptedForRuntime === true,
      restartSafe: clientRuntimeAdoptionState.hydrated === true,
      statusPath: clientRuntimeAdoptionState.stateKey,
      blockedBy: clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
      pendingBy: [],
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      key: "provider-continuation",
      status: providerContinuationContract.status,
      accepted: providerContinuationContract.acceptedForProviderSync === true,
      restartSafe: providerContinuationContract.externalHandoffState.restartSafe === true,
      statusPath: providerContinuationContract.syncMetadata.statusChannel,
      blockedBy: providerContinuationContract.externalHandoffState.blockedBy.map((blocker) => `provider:${blocker}`),
      pendingBy: acceptance.required && !acceptance.acceptedForProviderSync ? ["acceptance:provider-sync"] : [],
      nextAction: providerContinuationContract.nextAction,
    },
    {
      key: "memory-health",
      status: operationalHealthState.status,
      accepted: operationalHealthState.status === "healthy",
      restartSafe: operationalHealthState.status !== "failed",
      statusPath: operationalHealthState.statusChannel,
      blockedBy: healthErrors,
      pendingBy: operationalHealthState.retryable ? ["health:retry-scheduled"] : [],
      nextAction: operationalHealthState.nextAction,
    },
    {
      key: "lifecycle-export",
      status: lifecycleCommandReport.status,
      accepted: memoryExportManifest.exportReady === true,
      restartSafe: lifecycleCommandReport.handoff.ready === true || status !== "blocked",
      statusPath: memoryExportManifest.manifestId,
      blockedBy: asList(memoryExportManifest.blockedBy).map((blocker) => `export:${blocker}`),
      pendingBy: asList(lifecycleCommandReport.pendingBy),
      nextAction: memoryExportManifest.nextAction,
    },
  ];
  const syncMounts = new Set(providerContinuationContract.externalHandoffState.syncMounts);
  const mountRows = mounts.map((mount) => ({
    mount: mount.mount,
    path: mount.path,
    status: mount.status,
    selectedForProviderSync: syncMounts.has(mount.mount),
    statusChannel: mount.handoff.statusChannel,
    recoveryCursor: mount.handoff.recoveryCursor,
    nextAction: mount.handoff.nextAction,
  }));
  const commands = [
    {
      command: "persist-memory-downstream-status",
      enabled: true,
      idempotencyKey: `memory-downstream-status:${stableKey([contract.id, status, clientRuntimeAdoptionState.stateKey])}`,
    },
    {
      command: "release-memory-runtime",
      enabled: acceptedForDownstream,
      idempotencyKey: `memory-runtime-release:${stableKey([clientRuntimeAdoptionState.continuationToken, status])}`,
    },
    {
      command: "release-memory-provider-sync",
      enabled: acceptedForProviderSync,
      idempotencyKey: `memory-provider-release:${providerContinuationContract.continuationId}`,
    },
    {
      command: "schedule-memory-downstream-retry",
      enabled: operationalHealthState.retryable === true,
      delaySeconds: operationalHealthState.nextDelaySeconds,
      idempotencyKey: `memory-downstream-retry:${stableKey([
        operationalHealthState.healthId,
        operationalHealthState.attempts + 1,
      ])}`,
    },
  ];

  return {
    format: "aios.mailchimp.memory.downstreamStatus.v1",
    packetId: `memory-downstream-status:${stableKey([
      contract.id,
      previewAcceptancePackage.packageId,
      providerContinuationContract.continuationId,
      operationalHealthState.healthId,
      status,
    ])}`,
    provider: "mailchimp",
    status,
    acceptedForDownstream,
    acceptedForProviderSync,
    restartSafe: status !== "blocked" && statusRows.every((row) => row.restartSafe !== false),
    retryable: operationalHealthState.retryable === true,
    nextDelaySeconds: operationalHealthState.nextDelaySeconds,
    statusChannel: operationalHealthState.degradedMode
      ? operationalHealthState.statusChannel
      : acceptedForProviderSync
        ? "memory.downstream.mailchimp.provider-sync"
        : "memory.downstream.mailchimp.runtime",
    previewId: previewAcceptancePackage.preview.previewId,
    acceptanceId: acceptance.acceptanceId,
    continuationId: providerContinuationContract.continuationId,
    stateKey: clientRuntimeAdoptionState.stateKey,
    healthId: operationalHealthState.healthId,
    exportManifestId: memoryExportManifest.manifestId,
    blockedBy,
    pendingBy,
    statusRows,
    mountRows,
    commands,
    payloadShape: {
      packetId: "string",
      status: "string",
      acceptedForDownstream: "boolean",
      acceptedForProviderSync: "boolean",
      statusRows: "array",
      mountRows: "array",
      blockedBy: "array",
      pendingBy: "array",
      commands: "array",
    },
    nextAction: blockedBy.length
      ? blockedBy[0].startsWith("client-state:")
        ? "hydrate-memory-client-state"
        : blockedBy[0].startsWith("health:")
          ? operationalHealthState.nextAction
          : lifecycleCommandReport.nextAction
      : pendingBy.length
        ? pendingBy.includes("health:retry-scheduled")
          ? "schedule-memory-health-retry"
          : readiness.nextAction
        : acceptedForProviderSync
          ? "release-memory-provider-sync"
          : acceptedForDownstream
            ? "release-memory-runtime"
            : clientRuntimeAdoptionState.nextAction,
  };
}

function buildMemoryOperatorReportDigest(
  contract,
  analytics,
  historySnapshots,
  exportSummary,
  timelineState,
  lifecycleControls,
  operationalHealthState,
  lifecycleCommandReport,
  memoryExportManifest,
  downstreamStatusPacket,
  tenantBoundaryState,
) {
  const blockedBy = [
    ...asList(downstreamStatusPacket.blockedBy),
    ...asList(memoryExportManifest.blockedBy).map((blocker) => `export:${blocker}`),
    ...asList(tenantBoundaryState.tenantBlockedBy).map((blocker) => `tenant:${blocker}`),
  ].sort();
  const pendingBy = [
    ...asList(downstreamStatusPacket.pendingBy),
    ...(operationalHealthState.retryable ? ["health:retry-scheduled"] : []),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const reportCards = [
    {
      card: "memory-mounts",
      status: exportSummary.status,
      primaryCount: analytics.counters.mountsTotal,
      secondaryCount: analytics.counters.providerSyncMounts,
      label: "mounts compiled",
      detail: `${analytics.counters.providerSyncMounts} provider sync mounts`,
      nextAction: timelineState.currentPhase === "provider-sync"
        ? "review-provider-sync-mounts"
        : "review-memory-mounts",
    },
    {
      card: "lifecycle",
      status: lifecycleCommandReport.status,
      primaryCount: lifecycleCommandReport.commandSummary.enabledCommands,
      secondaryCount: lifecycleCommandReport.commandSummary.disabledCommands,
      label: "enabled commands",
      detail: `${lifecycleControls.syncMounts.length} sync mounts selected`,
      nextAction: lifecycleCommandReport.nextAction,
    },
    {
      card: "health",
      status: operationalHealthState.status,
      primaryCount: operationalHealthState.incidentSummary.errors,
      secondaryCount: operationalHealthState.incidentSummary.warnings,
      label: "health errors",
      detail: operationalHealthState.retryable
        ? `retry in ${operationalHealthState.nextDelaySeconds}s`
        : "no retry scheduled",
      nextAction: operationalHealthState.nextAction,
    },
    {
      card: "downstream",
      status: downstreamStatusPacket.status,
      primaryCount: downstreamStatusPacket.statusRows.length,
      secondaryCount: downstreamStatusPacket.mountRows.length,
      label: "status rows",
      detail: downstreamStatusPacket.acceptedForProviderSync
        ? "provider sync release ready"
        : downstreamStatusPacket.acceptedForDownstream
          ? "runtime release ready"
          : "release held",
      nextAction: downstreamStatusPacket.nextAction,
    },
  ];
  const publishReady = memoryExportManifest.exportReady
    && downstreamStatusPacket.acceptedForDownstream
    && blockedBy.length === 0
    && pendingBy.length === 0;
  const currentCard = reportCards.find((card) => card.status === "blocked")
    || reportCards.find((card) => card.status === "pending")
    || reportCards.find((card) => card.status === "degraded")
    || reportCards.find((card) => card.status === "provider-unavailable")
    || reportCards.at(-1);
  const digestStatus = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : publishReady
        ? "ready"
        : "waiting";

  return {
    digestId: `memory-operator-digest:${stableKey([
      contract.id,
      memoryExportManifest.manifestId,
      downstreamStatusPacket.packetId,
      digestStatus,
    ])}`,
    format: "aios.mailchimp.memory.operatorDigest.v1",
    status: digestStatus,
    publishReady,
    generatedDeterministically: true,
    currentCard: currentCard?.card || "memory-mounts",
    counters: {
      mountsTotal: analytics.counters.mountsTotal,
      providerSyncMounts: analytics.counters.providerSyncMounts,
      stagedWritebacks: analytics.counters.stagedWritebacks,
      blockedMounts: analytics.counters.blockedMounts,
      diagnosticsTotal: analytics.counters.diagnosticsTotal,
      enabledCommands: lifecycleCommandReport.commandSummary.enabledCommands,
      healthErrors: operationalHealthState.incidentSummary.errors,
      healthWarnings: operationalHealthState.incidentSummary.warnings,
      downstreamRows: downstreamStatusPacket.statusRows.length,
      historySnapshots: historySnapshots.length,
    },
    reportCards,
    timeline: timelineState.phases.map((phase) => ({
      phase: phase.phase,
      status: phase.status,
      nextAction: phase.nextAction,
    })),
    publishControls: [
      {
        command: "publish-memory-operator-digest",
        enabled: publishReady,
        idempotencyKey: `memory-operator-digest:${memoryExportManifest.manifestId}`,
      },
      {
        command: "persist-memory-report-cards",
        enabled: true,
        idempotencyKey: `memory-report-cards:${lifecycleCommandReport.reportId}`,
      },
      {
        command: "schedule-memory-digest-retry",
        enabled: operationalHealthState.retryable === true,
        delaySeconds: operationalHealthState.nextDelaySeconds,
        idempotencyKey: `memory-digest-retry:${stableKey([
          operationalHealthState.healthId,
          operationalHealthState.attempts + 1,
        ])}`,
      },
    ],
    blockedBy,
    pendingBy,
    statusChannels: [
      ...new Set([
        downstreamStatusPacket.statusChannel,
        operationalHealthState.statusChannel,
        ...memoryExportManifest.statusChannels,
      ].filter(Boolean)),
    ].sort(),
    nextAction: blockedBy.length
      ? downstreamStatusPacket.nextAction
      : pendingBy.length
        ? pendingBy.includes("health:retry-scheduled")
          ? "schedule-memory-digest-retry"
          : lifecycleCommandReport.nextAction
        : publishReady
          ? "publish-memory-operator-digest"
          : currentCard?.nextAction || "review-memory-operator-digest",
  };
}

function buildMemoryControlPlaneState(
  contract,
  lifecycleControls,
  lifecycleCommandReport,
  providerContinuationContract,
  clientRuntimeAdoptionState,
  operationalHealthState,
  downstreamStatusPacket,
  operatorReportDigest,
  tenantBoundaryState,
) {
  const lifecycleErrors = lifecycleControls.diagnostics
    .filter((diagnostic) => diagnostic.level === "error")
    .map((diagnostic) => diagnostic.code)
    .sort();
  const healthBlockers = operationalHealthState.incidents
    .filter((incident) => incident.severity === "error")
    .map((incident) => `health:${incident.code}`);
  const blockedBy = [
    ...lifecycleErrors.map((code) => `settings:${code}`),
    ...tenantBoundaryState.tenantBlockedBy.map((blocker) => `tenant:${blocker}`),
    ...clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
    ...providerContinuationContract.externalHandoffState.blockedBy.map((blocker) => `provider:${blocker}`),
    ...healthBlockers,
    ...downstreamStatusPacket.blockedBy.map((blocker) => `downstream:${blocker}`),
  ].sort();
  const pendingBy = [
    ...downstreamStatusPacket.pendingBy.map((pending) => `downstream:${pending}`),
    ...operatorReportDigest.pendingBy.map((pending) => `digest:${pending}`),
    ...(operationalHealthState.retryable ? ["health:retry-scheduled"] : []),
    ...(lifecycleCommandReport.schedule.enabled ? [`schedule:${lifecycleCommandReport.schedule.scheduleId}`] : []),
  ].sort();
  const providerSyncReady = downstreamStatusPacket.acceptedForProviderSync === true
    && operationalHealthState.status === "healthy"
    && tenantBoundaryState.status === "ready"
    && blockedBy.length === 0;
  const runtimeReady = downstreamStatusPacket.acceptedForDownstream === true
    && clientRuntimeAdoptionState.acceptedForRuntime === true
    && blockedBy.length === 0;
  const commandCandidates = [
    {
      command: "apply-memory-lifecycle-settings",
      enabled: lifecycleErrors.length > 0,
      idempotencyKey: `memory-control-settings:${contract.id}`,
      reason: "Memory lifecycle settings must be corrected before provider handoff can continue.",
    },
    {
      command: "persist-memory-control-plane",
      enabled: true,
      idempotencyKey: `memory-control-plane:${providerContinuationContract.continuationId}`,
      reason: "Persist deterministic memory control state for route and adapter recovery.",
    },
    {
      command: "schedule-memory-control-tick",
      enabled: lifecycleCommandReport.schedule.enabled
        && operationalHealthState.retryable !== true
        && blockedBy.length === 0,
      idempotencyKey: `memory-control-schedule:${lifecycleCommandReport.schedule.scheduleId}`,
      delaySeconds: lifecycleCommandReport.schedule.intervalSeconds,
      reason: "Continue memory provider sync on the configured lifecycle cadence.",
    },
    {
      command: "schedule-memory-control-retry",
      enabled: operationalHealthState.retryable === true,
      idempotencyKey: `memory-control-retry:${stableKey([
        operationalHealthState.healthId,
        operationalHealthState.attempts + 1,
      ])}`,
      delaySeconds: operationalHealthState.nextDelaySeconds,
      reason: "Retry memory health or provider availability before releasing provider sync.",
    },
    {
      command: "handoff-memory-control-plane",
      enabled: providerSyncReady,
      idempotencyKey: `memory-control-handoff:${providerContinuationContract.continuationId}`,
      reason: "Client state, tenant boundary, health, and provider sync acceptance are complete.",
    },
  ];
  const enabledCommands = commandCandidates.filter((command) => command.enabled);
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.some((pending) => pending.includes("acceptance:") || pending.includes("health:retry"))
      ? "pending"
      : providerSyncReady
        ? "handoff-ready"
        : runtimeReady
          ? "runtime-ready"
          : lifecycleCommandReport.schedule.enabled
            ? "scheduled"
            : "observing";

  return {
    format: "aios.mailchimp.memory.controlPlane.v1",
    controlPlaneId: `memory-control-plane:${stableKey([
      contract.id,
      providerContinuationContract.continuationId,
      downstreamStatusPacket.packetId,
      status,
    ])}`,
    provider: "mailchimp",
    status,
    statusChannel: status === "blocked"
      ? "memory.control.mailchimp.blocked"
      : lifecycleCommandReport.schedule.enabled
        ? lifecycleCommandReport.schedule.statusChannel
        : "memory.control.mailchimp",
    blockedBy,
    pendingBy,
    commands: commandCandidates,
    enabledCommands: enabledCommands.map((command) => command.command),
    persistedState: {
      continuationId: providerContinuationContract.continuationId,
      stateKey: clientRuntimeAdoptionState.stateKey,
      scheduleId: lifecycleCommandReport.schedule.scheduleId,
      healthId: operationalHealthState.healthId,
      downstreamPacketId: downstreamStatusPacket.packetId,
      acceptedForRuntime: runtimeReady,
      acceptedForProviderSync: providerSyncReady,
      restartSafe: downstreamStatusPacket.restartSafe === true
        && providerContinuationContract.externalHandoffState.restartSafe === true,
      nextAction: enabledCommands[0]?.command || downstreamStatusPacket.nextAction,
    },
    nextAction: blockedBy.length
      ? blockedBy[0].startsWith("settings:")
        ? "repair-memory-lifecycle-settings"
        : blockedBy[0].startsWith("tenant:")
          ? tenantBoundaryState.nextAction
          : blockedBy[0].startsWith("client-state:")
            ? "hydrate-memory-client-state"
            : operationalHealthState.nextAction
      : operationalHealthState.retryable
        ? "schedule-memory-control-retry"
        : enabledCommands[0]?.command || downstreamStatusPacket.nextAction,
  };
}

export function analyzeMailchimpMemoryMounts(source = {}, options = {}) {
  const contract = compileMailchimpMemoryMounts(source, options);
  const diagnostics = contract.diagnostics || [];
  const summary = summarizeDiagnostics(diagnostics);
  const mounts = (contract.mounts || []).map((mount) => mountStatus(mount, diagnostics));
  const providerSyncMounts = mounts.filter((mount) => mount.providerSyncRequired);
  const stagedWritebacks = mounts.filter((mount) => mount.writebackStaged);
  const requiredCapabilities = [...new Set(mounts.flatMap((mount) => mount.requiredCapabilities))].sort();
  const rollbackPlan = compileRollbackMemoryPlan(
    options.jobId || `mailchimp-memory-${stableKey(mounts.map((mount) => mount.mount))}`,
    contract,
  );
  const acceptedForRuntime = summary.errors === 0 && mounts.length > 0;
  const acceptedForAdapterSync = acceptedForRuntime && providerSyncMounts.length > 0;
  const analytics = buildMemoryAnalytics(mounts, diagnostics, rollbackPlan);
  const historySnapshots = buildHistorySnapshots(mounts, diagnostics, rollbackPlan);
  const exportSummary = buildExportSummary(mounts, analytics, summary);
  const timelineState = buildTimelineState(historySnapshots);
  const lifecycleSettings = normalizeMemoryLifecycleSettings(source, options);
  const lifecycleDiagnostics = validateMemoryLifecycleSettings(lifecycleSettings, mounts);
  const lifecycleControls = buildMemoryLifecycleControls(mounts, lifecycleSettings, lifecycleDiagnostics, summary);
  const tenantBoundaryState = buildMemoryTenantBoundaryState(contract, mounts, lifecycleControls, source, options);
  const providerContinuationContract = buildProviderContinuationContract(
    contract,
    mounts,
    lifecycleControls,
    rollbackPlan,
    summary,
    tenantBoundaryState,
  );
  const previewAcceptancePackage = buildMemoryPreviewAcceptancePackage(
    contract,
    mounts,
    lifecycleControls,
    providerContinuationContract,
    summary,
    source,
    options,
  );
  const clientRuntimeAdoptionState = buildMemoryClientRuntimeAdoptionState(
    contract,
    previewAcceptancePackage,
    providerContinuationContract,
    lifecycleControls,
    rollbackPlan,
    source,
    options,
  );
  const operationalHealthState = buildMemoryOperationalHealthState(
    source,
    options,
    mounts,
    summary,
    lifecycleControls,
    tenantBoundaryState,
    providerContinuationContract,
    previewAcceptancePackage,
    clientRuntimeAdoptionState,
  );
  const lifecycleCommandReport = buildMemoryLifecycleCommandReport(
    contract,
    mounts,
    lifecycleControls,
    providerContinuationContract,
    previewAcceptancePackage,
    clientRuntimeAdoptionState,
    operationalHealthState,
    tenantBoundaryState,
    summary,
  );
  const memoryExportManifest = buildMemoryExportManifest(
    contract,
    exportSummary,
    lifecycleCommandReport,
    timelineState,
    operationalHealthState,
  );
  const downstreamStatusPacket = buildMemoryDownstreamStatusPacket(
    contract,
    mounts,
    previewAcceptancePackage,
    clientRuntimeAdoptionState,
    providerContinuationContract,
    operationalHealthState,
    lifecycleCommandReport,
    memoryExportManifest,
  );
  const operatorReportDigest = buildMemoryOperatorReportDigest(
    contract,
    analytics,
    historySnapshots,
    exportSummary,
    timelineState,
    lifecycleControls,
    operationalHealthState,
    lifecycleCommandReport,
    memoryExportManifest,
    downstreamStatusPacket,
    tenantBoundaryState,
  );
  const controlPlaneState = buildMemoryControlPlaneState(
    contract,
    lifecycleControls,
    lifecycleCommandReport,
    providerContinuationContract,
    clientRuntimeAdoptionState,
    operationalHealthState,
    downstreamStatusPacket,
    operatorReportDigest,
    tenantBoundaryState,
  );
  const acceptedForTenantRuntime = acceptedForRuntime && tenantBoundaryState.status !== "blocked";

  return {
    kind: "aios.semantic.memoryMountAnalysis",
    version: MAILCHIMP_MEMORY_ANALYSIS_VERSION,
    provider: "mailchimp",
    acceptedForRuntime: acceptedForTenantRuntime,
    status: acceptedForTenantRuntime
      ? summary.warnings
        ? "ready-with-warnings"
        : "ready"
      : "blocked",
    contract,
    mounts,
    runtimeContract: {
      memoryBindings: mounts.map((mount) => ({
        name: mount.mount,
        path: mount.path,
        mode: mount.mode,
        retention: "bounded",
        sensitivity: mount.sensitivity,
      })),
      requiredCapabilities,
      localOnly: providerSyncMounts.length === 0,
      externalWritesAllowed: false,
      clientStateKey: clientRuntimeAdoptionState.stateKey,
      continuationToken: clientRuntimeAdoptionState.continuationToken,
      requiredClientState: clientRuntimeAdoptionState.requiredClientState,
      missingClientState: clientRuntimeAdoptionState.missingClientState,
      persistedState: clientRuntimeAdoptionState.persistedState,
      tenantBoundary: tenantBoundaryState,
      downstreamStatusPacket,
      controlPlaneState,
    },
    adapterHandoff: {
      accepted: acceptedForAdapterSync
        && lifecycleControls.syncMounts.length > 0
        && clientRuntimeAdoptionState.acceptedForProviderSync
        && operationalHealthState.status === "healthy",
      providerService: contract.providerServiceContract?.providerService || "mailchimp-marketing-api",
      syncMounts: lifecycleControls.syncMounts,
      stagedWritebacks: lifecycleControls.stagedWritebacks,
      providerContinuationId: providerContinuationContract.continuationId,
      tenantAuditId: tenantBoundaryState.auditId,
      healthId: operationalHealthState.healthId,
      downstreamStatusPacketId: downstreamStatusPacket.packetId,
      controlPlaneId: controlPlaneState.controlPlaneId,
      statusChannel: operationalHealthState.degradedMode
        ? operationalHealthState.statusChannel
        : acceptedForAdapterSync && lifecycleControls.syncMounts.length > 0
        ? "memory.status.mailchimp.provider-sync"
        : "memory.status.local-only",
      nextAction: !acceptedForRuntime
        ? "resolve-memory-analysis-errors"
        : operationalHealthState.status !== "healthy"
          ? operationalHealthState.nextAction
        : !clientRuntimeAdoptionState.hydrated
          ? "hydrate-memory-client-state"
        : tenantBoundaryState.status === "blocked"
          ? tenantBoundaryState.nextAction
        : lifecycleControls.nextAction === "repair-memory-lifecycle-settings"
          ? lifecycleControls.nextAction
        : clientRuntimeAdoptionState.acceptedForProviderSync
          ? "prepare-provider-sync"
          : "continue-local-runtime",
    },
    recovery: {
      restartSafe: acceptedForTenantRuntime && clientRuntimeAdoptionState.hydrated,
      rollbackPlan,
      resumeCursors: mounts.map((mount) => mount.handoff.recoveryCursor).filter(Boolean).sort(),
      persistedStateKey: clientRuntimeAdoptionState.stateKey,
      continuationToken: clientRuntimeAdoptionState.continuationToken,
      tenantAudit: tenantBoundaryState,
      idempotentCommands: clientRuntimeAdoptionState.routeCommands
        .filter((command) => command.idempotencyKey)
        .map((command) => ({
          command: command.command,
          idempotencyKey: command.idempotencyKey,
          enabled: command.enabled,
        }))
        .concat(operationalHealthState.commands
          .filter((command) => command.idempotencyKey)
          .map((command) => ({
            command: command.command,
            idempotencyKey: command.idempotencyKey,
            enabled: command.enabled,
          }))),
      operationalHealth: operationalHealthState,
      downstreamStatusPacket,
      controlPlaneState,
      retryPlan: operationalHealthState.retryPolicy,
      nextAction: acceptedForTenantRuntime
        ? operationalHealthState.status === "healthy"
          ? clientRuntimeAdoptionState.nextAction
          : operationalHealthState.nextAction
        : "hold-runtime-handoff",
    },
    analytics,
    historySnapshots,
    exportSummary,
    timelineState,
    lifecycleControls,
    tenantBoundaryState,
    providerContinuationContract,
    previewAcceptancePackage,
    previewState: previewAcceptancePackage.preview,
    acceptanceState: previewAcceptancePackage.acceptance,
    readinessSummary: previewAcceptancePackage.readiness,
    clientRuntimeAdoptionState,
    operationalHealthState,
    lifecycleCommandReport,
    memoryExportManifest,
    downstreamStatusPacket,
    controlPlaneState,
    nextSteps: previewAcceptancePackage.nextSteps,
    nextActionState: {
      action: operationalHealthState.status === "healthy"
        ? clientRuntimeAdoptionState.nextAction
        : operationalHealthState.nextAction,
      command: operationalHealthState.commands.find((command) => command.enabled)?.command
        || (clientRuntimeAdoptionState.acceptedForProviderSync
        ? "handoff-memory-provider-sync"
        : clientRuntimeAdoptionState.routeCommands.find((command) => command.enabled)?.command
        || lifecycleControls.commands.find((command) => command.enabled)?.command
        || "hold-memory-workflow"),
      blockedBy: [
        ...summary.blockingCodes,
        ...providerContinuationContract.externalHandoffState.blockedBy,
        ...tenantBoundaryState.tenantBlockedBy,
        ...clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
        ...operationalHealthState.incidents
          .filter((incident) => incident.severity === "error")
          .map((incident) => `health:${incident.code}`),
        ...lifecycleDiagnostics
          .filter((diagnostic) => diagnostic.level === "error")
          .map((diagnostic) => diagnostic.code),
      ].sort(),
      statusChannel: operationalHealthState.degradedMode
        ? operationalHealthState.statusChannel
        : lifecycleControls.canSchedule
        ? "memory.schedule.mailchimp"
        : "memory.status.mailchimp.lifecycle",
    },
    reportingState: {
      reportId: `memory-report:${stableKey([contract.id, mounts.map((mount) => mount.mount), summary.blockingCodes])}`,
      exportReady: acceptedForTenantRuntime && memoryExportManifest.exportReady,
      lifecycleReportId: lifecycleCommandReport.reportId,
      exportManifestId: memoryExportManifest.manifestId,
      downstreamStatusPacketId: downstreamStatusPacket.packetId,
      operatorDigestId: operatorReportDigest.digestId,
      controlPlaneId: controlPlaneState.controlPlaneId,
      exportBlockedBy: [
        ...summary.blockingCodes,
        ...memoryExportManifest.blockedBy,
        ...tenantBoundaryState.tenantBlockedBy,
        ...operationalHealthState.incidents
          .filter((incident) => incident.severity === "error")
          .map((incident) => `health:${incident.code}`),
      ].sort(),
      commandSummary: lifecycleCommandReport.commandSummary,
      statusChannels: memoryExportManifest.statusChannels,
      downstreamStatus: downstreamStatusPacket.status,
      operatorDigestStatus: operatorReportDigest.status,
      controlPlaneStatus: controlPlaneState.status,
      nextAction: acceptedForTenantRuntime && memoryExportManifest.exportReady
        ? operationalHealthState.status === "healthy"
          ? "publish-memory-export-summary"
          : operationalHealthState.nextAction
        : tenantBoundaryState.status === "blocked"
          ? tenantBoundaryState.nextAction
          : "resolve-memory-analysis-errors",
    },
    operatorReportDigest,
    diagnosticsSummary: summary,
    diagnostics,
  };
}

export function validateMailchimpMemoryMountAnalysis(analysis) {
  const diagnostics = [];
  if (analysis?.kind !== "aios.semantic.memoryMountAnalysis") {
    diagnostics.push({ level: "error", code: "memory.analysis.kind.invalid" });
  }
  if (!Array.isArray(analysis?.mounts) || analysis.mounts.length === 0) {
    diagnostics.push({ level: "error", code: "memory.analysis.mounts.empty" });
  }
  if (analysis?.adapterHandoff?.accepted && analysis.adapterHandoff.syncMounts.length === 0) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-sync.empty" });
  }
  if (analysis?.adapterHandoff?.accepted && analysis?.tenantBoundaryState?.status === "blocked") {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-sync-with-tenant-blocker" });
  }
  if (analysis?.tenantBoundaryState?.status === "blocked"
    && analysis?.providerContinuationContract?.acceptedForProviderSync) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-sync-with-tenant-blocker" });
  }
  if (!analysis?.tenantBoundaryState?.auditEvents?.some((event) => event.event === "memory.mounts.scoped")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.tenant-audit-scope-event.missing" });
  }
  if (!analysis?.tenantBoundaryState?.commandPolicy?.some((policy) => policy.command === "handoff-memory-provider-sync")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.tenant-command-policy.missing" });
  }
  if ((analysis?.runtimeContract?.requiredCapabilities || []).some((capability) => typeof capability !== "string")) {
    diagnostics.push({ level: "error", code: "memory.analysis.capability.invalid" });
  }
  if (analysis?.reportingState?.exportReady && analysis?.diagnosticsSummary?.errors > 0) {
    diagnostics.push({ level: "error", code: "memory.analysis.export-ready-with-errors" });
  }
  if (!analysis?.exportSummary?.rows || analysis.exportSummary.rows.length !== analysis.mounts.length) {
    diagnostics.push({ level: "warning", code: "memory.analysis.export-summary.rows-mismatch" });
  }
  if (!analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "provider-sync")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.history.provider-sync.missing" });
  }
  if (analysis?.lifecycleControls?.canSchedule && !analysis.lifecycleControls.syncMounts.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.schedule-without-sync-mounts" });
  }
  if (analysis?.lifecycleControls?.settings?.allowStagedWriteback && !analysis.lifecycleControls.settings.allowProviderSync) {
    diagnostics.push({ level: "error", code: "memory.analysis.writeback-without-provider-sync" });
  }
  if (analysis?.providerContinuationContract?.acceptedForProviderSync && !analysis.providerContinuationContract.syncMetadata?.checkpointCommandEnabled) {
    diagnostics.push({ level: "warning", code: "memory.analysis.provider-sync-without-checkpoint-command" });
  }
  if (analysis?.providerContinuationContract?.capabilityNegotiation?.missingCapabilities?.length
    && analysis?.providerContinuationContract?.acceptedForProviderSync) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-sync-with-missing-capabilities" });
  }
  if (analysis?.providerContinuationContract?.externalHandoffState?.stagedWritebacks?.length
    && analysis?.providerContinuationContract?.externalHandoffState?.handoffMode !== "stage-local-before-provider-write") {
    diagnostics.push({ level: "error", code: "memory.analysis.staged-writeback-handoff.invalid" });
  }
  if (analysis?.readinessSummary?.status === "ready" && analysis?.acceptanceState?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.ready-with-acceptance-blockers" });
  }
  if (analysis?.acceptanceState?.acceptedForProviderSync && !analysis?.providerContinuationContract?.acceptedForProviderSync) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-accepted-without-continuation" });
  }
  if (analysis?.adapterHandoff?.accepted && analysis?.clientRuntimeAdoptionState?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-handoff-without-client-adoption" });
  }
  if (analysis?.clientRuntimeAdoptionState?.acceptedForRuntime && analysis?.clientRuntimeAdoptionState?.hydrated !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.runtime-adoption-without-client-state" });
  }
  if (analysis?.recovery?.restartSafe && analysis?.clientRuntimeAdoptionState?.hydrated !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.restart-safe-without-client-state" });
  }
  if (analysis?.adapterHandoff?.accepted && analysis?.operationalHealthState?.status !== "healthy") {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-handoff-while-degraded" });
  }
  if (analysis?.operationalHealthState?.retryable
    && analysis?.operationalHealthState?.retryPolicy?.nextDelaySeconds == null) {
    diagnostics.push({ level: "error", code: "memory.analysis.retryable-health-without-delay" });
  }
  if (analysis?.operationalHealthState?.status === "failed"
    && !analysis?.operationalHealthState?.actionableErrors?.some((error) => error.action === "escalate-memory-recovery")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.failed-health-without-escalation" });
  }
  if (!analysis?.recovery?.idempotentCommands?.some((command) => command.command === "persist-memory-health-state")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.health-state-command.missing" });
  }
  if (analysis?.operationalHealthState?.degradedModeContract?.providerSyncHeld
    && analysis?.adapterHandoff?.accepted) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-sync-accepted-while-health-held" });
  }
  if (!analysis?.clientRuntimeAdoptionState?.routeCommands?.some((command) => command.command === "persist-memory-client-state")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.persist-client-state-command.missing" });
  }
  if (!analysis?.lifecycleCommandReport?.reportId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.lifecycle-command-report.missing" });
  }
  if (analysis?.lifecycleCommandReport?.handoff?.ready
    && analysis?.clientRuntimeAdoptionState?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.lifecycle-handoff-without-provider-adoption" });
  }
  if (analysis?.lifecycleCommandReport?.schedule?.enabled
    && !analysis?.lifecycleCommandReport?.schedule?.intervalSeconds) {
    diagnostics.push({ level: "error", code: "memory.analysis.lifecycle-schedule-without-interval" });
  }
  if (analysis?.memoryExportManifest?.exportReady
    && analysis?.lifecycleCommandReport?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.export-ready-with-lifecycle-blockers" });
  }
  if (analysis?.memoryExportManifest?.rows?.length !== analysis?.mounts?.length) {
    diagnostics.push({ level: "warning", code: "memory.analysis.export-manifest.rows-mismatch" });
  }
  if (!analysis?.downstreamStatusPacket?.packetId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.downstream-status.missing" });
  }
  if (analysis?.downstreamStatusPacket?.acceptedForProviderSync
    && analysis?.adapterHandoff?.accepted !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.downstream-provider-sync-without-adapter" });
  }
  if (analysis?.downstreamStatusPacket?.acceptedForDownstream
    && analysis?.downstreamStatusPacket?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.downstream-accepted-with-blockers" });
  }
  if (analysis?.downstreamStatusPacket?.statusRows?.length < 4) {
    diagnostics.push({ level: "warning", code: "memory.analysis.downstream-status-rows.incomplete" });
  }
  if (analysis?.downstreamStatusPacket?.retryable
    && analysis?.downstreamStatusPacket?.nextDelaySeconds == null) {
    diagnostics.push({ level: "error", code: "memory.analysis.downstream-retryable-without-delay" });
  }
  if (analysis?.reportingState?.exportManifestId !== analysis?.memoryExportManifest?.manifestId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.reporting-export-manifest.inconsistent" });
  }
  if (analysis?.runtimeContract?.missingClientState?.length
    && analysis?.clientRuntimeAdoptionState?.missingClientState?.length === 0) {
    diagnostics.push({ level: "warning", code: "memory.analysis.runtime-missing-client-state.inconsistent" });
  }
  if (!analysis?.operatorReportDigest?.digestId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operator-digest.missing" });
  }
  if (analysis?.operatorReportDigest?.publishReady
    && analysis?.operatorReportDigest?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-digest-ready-with-blockers" });
  }
  if (analysis?.operatorReportDigest?.reportCards?.length < 4) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operator-digest.cards-incomplete" });
  }
  if (analysis?.operatorReportDigest?.publishReady
    && !analysis?.operatorReportDigest?.publishControls?.some((command) => (
      command.command === "publish-memory-operator-digest" && command.enabled === true
    ))) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-digest-publish-command.missing" });
  }
  if (!analysis?.controlPlaneState?.controlPlaneId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.control-plane.missing" });
  }
  if (analysis?.controlPlaneState?.status === "handoff-ready"
    && !analysis.controlPlaneState.enabledCommands?.includes("handoff-memory-control-plane")) {
    diagnostics.push({ level: "error", code: "memory.analysis.control-plane.ready-without-handoff-command" });
  }
  if (analysis?.controlPlaneState?.status === "blocked"
    && !analysis.controlPlaneState.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.control-plane.blocked-without-reason" });
  }
  if (analysis?.controlPlaneState?.persistedState?.acceptedForProviderSync
    && analysis?.downstreamStatusPacket?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.control-plane.provider-sync-without-downstream-acceptance" });
  }
  if (analysis?.adapterHandoff?.accepted
    && analysis?.controlPlaneState?.persistedState?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-handoff-with-unsafe-control-plane" });
  }
  if (analysis?.previewState?.rows?.length !== analysis?.mounts?.length) {
    diagnostics.push({ level: "warning", code: "memory.analysis.preview.rows-mismatch" });
  }
  if (!Array.isArray(analysis?.nextSteps)) {
    diagnostics.push({ level: "warning", code: "memory.analysis.next-steps.missing" });
  }
  for (const diagnostic of analysis?.lifecycleControls?.diagnostics || []) {
    diagnostics.push(diagnostic);
  }
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    diagnostics,
  };
}

export function selfCheckMailchimpMemoryMountAnalysis() {
  const analysis = analyzeMailchimpMemoryMounts();
  const validation = validateMailchimpMemoryMountAnalysis(analysis);
  return {
    ok: validation.ok && analysis.acceptedForRuntime,
    status: analysis.status,
    mountCount: analysis.mounts.length,
    requiredCapabilities: analysis.runtimeContract.requiredCapabilities,
    operationalHealth: analysis.operationalHealthState,
    downstreamStatus: analysis.downstreamStatusPacket,
    operatorReportDigest: analysis.operatorReportDigest,
    controlPlaneState: analysis.controlPlaneState,
    diagnostics: [...analysis.diagnostics, ...validation.diagnostics],
  };
}
