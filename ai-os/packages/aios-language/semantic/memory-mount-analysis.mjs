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

function compactReasonToken(value) {
  const parts = String(value || "unknown").split(":").filter(Boolean);
  if (parts.length <= 3) return parts.join(":") || "unknown";
  return `${parts[0]}:${parts[1]}:${parts.at(-1)}`;
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

function buildMemoryBoundaryLeasePacket(contract, mounts, lifecycleControls, tenantBoundaryState, source = {}, options = {}) {
  const leaseSource = options.boundaryLease
    || source.boundaryLease
    || source.tenantBoundaryLease
    || source.memoryBoundaryLease
    || {};
  const requestedTtlSeconds = Number(
    leaseSource.ttlSeconds
      ?? leaseSource.leaseTtlSeconds
      ?? options.leaseTtlSeconds
      ?? 900,
  );
  const ttlSeconds = Number.isFinite(requestedTtlSeconds)
    ? Math.min(86400, Math.max(60, Math.floor(requestedTtlSeconds)))
    : 900;
  const revokedMounts = new Set(asList(leaseSource.revokedMounts).map(String));
  const suspendedMounts = new Set(asList(leaseSource.suspendedMounts).map(String));
  const activeMounts = new Set(lifecycleControls.activeMounts);
  const syncMounts = new Set(lifecycleControls.syncMounts);
  const writebackMounts = new Set(lifecycleControls.stagedWritebacks);
  const tenantBlockedBy = asList(tenantBoundaryState.tenantBlockedBy);
  const leaseRows = mounts.map((mount) => {
    const scoped = tenantBoundaryState.scopedMounts.find((item) => item.mount === mount.mount) || {};
    const active = activeMounts.has(mount.mount);
    const revoked = revokedMounts.has(mount.mount);
    const suspended = suspendedMounts.has(mount.mount);
    const blockedBy = [
      ...asList(scoped.blockedBy).map((blocker) => `tenant:${blocker}`),
      ...(active ? [] : ["lifecycle:mount-disabled"]),
      ...(revoked ? ["lease:revoked"] : []),
      ...(suspended ? ["lease:suspended"] : []),
      ...(syncMounts.has(mount.mount) && tenantBoundaryState.canSync !== true ? ["lease:sync-not-permitted"] : []),
      ...(writebackMounts.has(mount.mount) && tenantBoundaryState.canWriteback !== true
        ? ["lease:writeback-not-permitted"]
        : []),
    ].sort();
    const releaseReady = active
      && blockedBy.length === 0
      && tenantBoundaryState.status === "ready"
      && (syncMounts.has(mount.mount) ? tenantBoundaryState.canSync === true : true);
    return {
      mount: mount.mount,
      leaseId: `memory-boundary-lease:${stableKey([
        contract.id,
        tenantBoundaryState.auditId,
        mount.mount,
        ttlSeconds,
      ])}`,
      tenantId: scoped.tenantId || mount.tenantId || tenantBoundaryState.tenantId,
      workspaceId: scoped.workspaceId || mount.workspaceId || tenantBoundaryState.workspaceId,
      actorRole: tenantBoundaryState.actorRole,
      active,
      providerSyncRequested: syncMounts.has(mount.mount),
      writebackRequested: writebackMounts.has(mount.mount),
      releaseReady,
      restartSafe: releaseReady && ttlSeconds >= 60,
      status: blockedBy.length ? "blocked" : releaseReady ? "leased" : "held",
      blockedBy,
      expiresAfterSeconds: ttlSeconds,
      statusPath: `memory.boundary.${mount.mount}`,
      nextAction: blockedBy.length
        ? "repair-memory-boundary-lease"
        : releaseReady
          ? "persist-memory-boundary-lease"
          : "hold-memory-boundary-lease",
    };
  });
  const blockedBy = [
    ...tenantBlockedBy.map((blocker) => `tenant:${blocker}`),
    ...leaseRows.flatMap((row) => row.blockedBy.map((blocker) => `${row.mount}:${blocker}`)),
  ].sort();
  const releaseReady = blockedBy.length === 0
    && leaseRows.some((row) => row.active)
    && leaseRows.every((row) => !row.active || row.releaseReady);
  const leaseId = `memory-boundary-lease-packet:${stableKey([
    contract.id,
    tenantBoundaryState.auditId,
    leaseRows.map((row) => [row.mount, row.status]),
    ttlSeconds,
  ])}`;

  return {
    format: "aios.mailchimp.memory.boundaryLease.v1",
    packetId: leaseId,
    tenantAuditId: tenantBoundaryState.auditId,
    tenantId: tenantBoundaryState.tenantId,
    workspaceId: tenantBoundaryState.workspaceId,
    actorRole: tenantBoundaryState.actorRole,
    status: blockedBy.length ? "blocked" : releaseReady ? "leased" : "held",
    releaseReady,
    acceptedForRuntime: releaseReady,
    acceptedForProviderSync: releaseReady
      && lifecycleControls.syncMounts.length > 0
      && tenantBoundaryState.canSync === true,
    restartSafe: releaseReady && leaseRows.every((row) => row.restartSafe),
    ttlSeconds,
    blockedBy,
    leaseRows,
    commands: [
      {
        command: "persist-memory-boundary-lease",
        enabled: releaseReady,
        idempotencyKey: `memory-boundary-lease:${leaseId}`,
      },
      {
        command: "renew-memory-boundary-lease",
        enabled: releaseReady && ttlSeconds <= 300,
        delaySeconds: Math.max(30, Math.floor(ttlSeconds / 2)),
        idempotencyKey: `memory-boundary-renew:${stableKey([leaseId, ttlSeconds])}`,
      },
      {
        command: "revoke-memory-boundary-lease",
        enabled: leaseRows.some((row) => row.status === "blocked"),
        mounts: leaseRows.filter((row) => row.status === "blocked").map((row) => row.mount),
      },
    ],
    nextAction: blockedBy.length
      ? "repair-memory-boundary-lease"
      : releaseReady
        ? "persist-memory-boundary-lease"
        : "hold-memory-boundary-lease",
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

function buildMemoryRuntimeDispatchReleaseReceipt(
  contract,
  clientRuntimeAdoptionState,
  clientWorkflowHandoffPacket,
  boundaryLeasePacket,
  providerSyncReleaseReceipt,
  audienceContinuityReceipt,
  operatorReleasePacket,
  dispatchReleaseLedger,
  claimRuntimeAdoptionReceipt,
  operatorCommandReceipt,
  adapterResumeReceipt,
  operationalTriagePacket,
) {
  const receiptRows = [
    {
      gate: "client-runtime-adoption",
      packetId: clientRuntimeAdoptionState.adoptionId,
      status: clientRuntimeAdoptionState.status,
      acceptedForRuntime: clientRuntimeAdoptionState.acceptedForRuntime === true,
      acceptedForProviderSync: clientRuntimeAdoptionState.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: clientRuntimeAdoptionState.acceptedForProviderSync === true,
      restartSafe: clientRuntimeAdoptionState.hydrated === true,
      blockedBy: clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
      pendingBy: [],
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      gate: "client-workflow-handoff",
      packetId: clientWorkflowHandoffPacket.packetId,
      status: clientWorkflowHandoffPacket.status,
      acceptedForRuntime: clientWorkflowHandoffPacket.acceptedForRuntime === true,
      acceptedForProviderSync: clientWorkflowHandoffPacket.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: clientWorkflowHandoffPacket.acceptedForProviderSync === true,
      restartSafe: clientWorkflowHandoffPacket.restartSafe !== false
        && clientWorkflowHandoffPacket.releaseReceipt?.restartSafe !== false,
      blockedBy: [
        ...asList(clientWorkflowHandoffPacket.blockedBy).map((blocker) => `client-workflow:${blocker}`),
        ...asList(clientWorkflowHandoffPacket.releaseReceipt?.blockedBy)
          .map((blocker) => `client-workflow-receipt:${blocker}`),
      ].sort(),
      pendingBy: [
        ...asList(clientWorkflowHandoffPacket.pendingBy).map((pending) => `client-workflow:${pending}`),
        ...asList(clientWorkflowHandoffPacket.releaseReceipt?.pendingBy)
          .map((pending) => `client-workflow-receipt:${pending}`),
      ].sort(),
      nextAction: clientWorkflowHandoffPacket.releaseReceipt?.nextAction || clientWorkflowHandoffPacket.nextAction,
    },
    {
      gate: "boundary-lease",
      packetId: boundaryLeasePacket.packetId,
      status: boundaryLeasePacket.status,
      acceptedForRuntime: boundaryLeasePacket.acceptedForRuntime !== false,
      acceptedForProviderSync: boundaryLeasePacket.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: boundaryLeasePacket.acceptedForProviderSync === true,
      restartSafe: boundaryLeasePacket.restartSafe !== false,
      blockedBy: asList(boundaryLeasePacket.blockedBy).map((blocker) => `boundary:${blocker}`),
      pendingBy: asList(boundaryLeasePacket.pendingBy).map((pending) => `boundary:${pending}`),
      nextAction: boundaryLeasePacket.nextAction,
    },
    {
      gate: "provider-sync-release",
      packetId: providerSyncReleaseReceipt.receiptId,
      status: providerSyncReleaseReceipt.status,
      acceptedForRuntime: providerSyncReleaseReceipt.acceptedForProviderSync === true,
      acceptedForProviderSync: providerSyncReleaseReceipt.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: providerSyncReleaseReceipt.acceptedForSyscallDispatch === true,
      restartSafe: providerSyncReleaseReceipt.restartSafe !== false,
      blockedBy: asList(providerSyncReleaseReceipt.blockedBy).map((blocker) => `provider-sync:${blocker}`),
      pendingBy: asList(providerSyncReleaseReceipt.pendingBy).map((pending) => `provider-sync:${pending}`),
      nextAction: providerSyncReleaseReceipt.nextAction,
    },
    {
      gate: "audience-continuity",
      packetId: audienceContinuityReceipt.receiptId,
      status: audienceContinuityReceipt.status,
      acceptedForRuntime: audienceContinuityReceipt.acceptedForProviderSync === true,
      acceptedForProviderSync: audienceContinuityReceipt.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: audienceContinuityReceipt.acceptedForSyscallDispatch === true,
      restartSafe: audienceContinuityReceipt.restartSafe !== false,
      blockedBy: asList(audienceContinuityReceipt.blockedBy).map((blocker) => `audience-continuity:${blocker}`),
      pendingBy: asList(audienceContinuityReceipt.pendingBy).map((pending) => `audience-continuity:${pending}`),
      nextAction: audienceContinuityReceipt.nextAction,
    },
    {
      gate: "operator-release",
      packetId: operatorReleasePacket.packetId,
      status: operatorReleasePacket.status,
      acceptedForRuntime: operatorReleasePacket.acceptedForProviderSync === true,
      acceptedForProviderSync: operatorReleasePacket.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: operatorReleasePacket.acceptedForSyscallDispatch === true,
      restartSafe: operatorReleasePacket.restartSafe !== false,
      blockedBy: asList(operatorReleasePacket.blockedBy).map((blocker) => `operator-release:${blocker}`),
      pendingBy: asList(operatorReleasePacket.pendingBy).map((pending) => `operator-release:${pending}`),
      nextAction: operatorReleasePacket.nextAction,
    },
    {
      gate: "dispatch-release-ledger",
      packetId: dispatchReleaseLedger.ledgerId,
      status: dispatchReleaseLedger.status,
      acceptedForRuntime: dispatchReleaseLedger.acceptedForProviderSync === true,
      acceptedForProviderSync: dispatchReleaseLedger.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: dispatchReleaseLedger.acceptedForSyscallDispatch === true,
      restartSafe: dispatchReleaseLedger.restartSafe !== false,
      blockedBy: asList(dispatchReleaseLedger.blockedBy).map((blocker) => `dispatch-ledger:${blocker}`),
      pendingBy: asList(dispatchReleaseLedger.pendingBy).map((pending) => `dispatch-ledger:${pending}`),
      nextAction: dispatchReleaseLedger.nextAction,
    },
    {
      gate: "claim-runtime-adoption",
      packetId: claimRuntimeAdoptionReceipt.receiptId,
      status: claimRuntimeAdoptionReceipt.status,
      acceptedForRuntime: claimRuntimeAdoptionReceipt.acceptedForClaimRuntime === true,
      acceptedForProviderSync: claimRuntimeAdoptionReceipt.acceptedForClaimProviderSync === true,
      acceptedForSyscallDispatch: claimRuntimeAdoptionReceipt.acceptedForSyscallDispatch === true,
      restartSafe: claimRuntimeAdoptionReceipt.restartSafe !== false,
      blockedBy: asList(claimRuntimeAdoptionReceipt.blockedBy).map((blocker) => `claim-runtime:${blocker}`),
      pendingBy: asList(claimRuntimeAdoptionReceipt.pendingBy).map((pending) => `claim-runtime:${pending}`),
      nextAction: claimRuntimeAdoptionReceipt.nextAction,
    },
    {
      gate: "operator-command",
      packetId: operatorCommandReceipt.receiptId,
      status: operatorCommandReceipt.status,
      acceptedForRuntime: operatorCommandReceipt.acceptedForProviderSync === true,
      acceptedForProviderSync: operatorCommandReceipt.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: operatorCommandReceipt.acceptedForSyscallDispatch === true,
      restartSafe: operatorCommandReceipt.restartSafe !== false,
      blockedBy: asList(operatorCommandReceipt.blockedBy).map((blocker) => `operator-command:${blocker}`),
      pendingBy: asList(operatorCommandReceipt.pendingBy).map((pending) => `operator-command:${pending}`),
      nextAction: operatorCommandReceipt.nextAction,
    },
    {
      gate: "adapter-resume",
      packetId: adapterResumeReceipt.receiptId,
      status: adapterResumeReceipt.status,
      acceptedForRuntime: adapterResumeReceipt.acceptedForRuntime !== false,
      acceptedForProviderSync: adapterResumeReceipt.acceptedForProviderSync !== false,
      acceptedForSyscallDispatch: adapterResumeReceipt.acceptedForSyscallDispatch !== false,
      restartSafe: adapterResumeReceipt.restartSafe !== false,
      blockedBy: asList(adapterResumeReceipt.blockedBy).map((blocker) => `adapter-resume:${blocker}`),
      pendingBy: asList(adapterResumeReceipt.pendingBy).map((pending) => `adapter-resume:${pending}`),
      nextAction: adapterResumeReceipt.nextAction,
    },
  ];
  const blockedBy = receiptRows.flatMap((row) => row.blockedBy.map((blocker) => `${row.gate}:${blocker}`)).sort();
  const pendingBy = receiptRows
    .filter((row) => row.acceptedForSyscallDispatch !== true)
    .flatMap((row) => row.pendingBy.length ? row.pendingBy.map((pending) => `${row.gate}:${pending}`) : [
      `${row.gate}:awaiting-release`,
    ])
    .sort();
  const acceptedForRuntime = blockedBy.length === 0
    && receiptRows.every((row) => row.acceptedForRuntime === true && row.restartSafe !== false);
  const acceptedForProviderSync = acceptedForRuntime
    && receiptRows.every((row) => row.acceptedForProviderSync === true);
  const acceptedForSyscallDispatch = acceptedForProviderSync
    && pendingBy.length === 0
    && receiptRows.every((row) => row.acceptedForSyscallDispatch === true);
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending-release"
      : acceptedForSyscallDispatch
        ? "dispatch-ready"
        : "waiting";

  return {
    format: "aios.mailchimp.memory.runtimeDispatchReleaseReceipt.v1",
    receiptId: `memory-runtime-dispatch-release:${stableKey([
      contract.id,
      receiptRows.map((row) => [row.gate, row.status, row.acceptedForSyscallDispatch]),
      status,
    ])}`,
    status,
    acceptedForRuntime,
    acceptedForProviderSync,
    acceptedForSyscallDispatch,
    releaseReady: acceptedForSyscallDispatch,
    restartSafe: receiptRows.every((row) => row.restartSafe !== false),
    stateKey: clientRuntimeAdoptionState.stateKey,
    continuationToken: clientRuntimeAdoptionState.continuationToken,
    operationalTriageId: operationalTriagePacket.packetId || null,
    blockedBy,
    pendingBy,
    receiptRows,
    commands: [
      {
        command: "persist-memory-runtime-dispatch-release",
        enabled: true,
        idempotencyKey: `memory-runtime-dispatch-release:${stableKey([
          clientRuntimeAdoptionState.stateKey,
          status,
          blockedBy,
          pendingBy,
        ])}`,
      },
      {
        command: "release-memory-syscall-dispatch",
        enabled: acceptedForSyscallDispatch,
        idempotencyKey: `memory-syscall-dispatch:${dispatchReleaseLedger.ledgerId}`,
      },
      {
        command: "hold-memory-syscall-dispatch",
        enabled: !acceptedForSyscallDispatch,
        reasons: blockedBy.length ? blockedBy : pendingBy,
      },
    ],
    nextAction: blockedBy.length
      ? receiptRows.find((row) => row.blockedBy.length)?.nextAction || "repair-memory-runtime-dispatch-release"
      : pendingBy.length
        ? receiptRows.find((row) => row.acceptedForSyscallDispatch !== true)?.nextAction
          || "complete-memory-runtime-dispatch-release"
        : "release-memory-syscall-dispatch",
  };
}

function buildMemoryRouteAcceptanceReceipt(
  contract,
  previewAcceptancePackage,
  clientRuntimeAdoptionState,
  downstreamStatusPacket,
  controlPlaneState,
  workflowControlPacket,
  clientWorkflowHandoffPacket,
  boundaryLeasePacket,
  providerHandoffEnvelope,
  operatorResumePacket,
  providerSyncReleaseReceipt,
  syscallDispatchGate,
  operatorReleasePacket,
) {
  const routeReceiptRows = [
    {
      gate: "preview",
      packetId: previewAcceptancePackage.packageId,
      status: previewAcceptancePackage.readiness.status,
      acceptedForRuntime: previewAcceptancePackage.readiness.readyForRuntime === true,
      acceptedForProviderSync: previewAcceptancePackage.readiness.readyForProviderSync === true,
      acceptedForSyscallDispatch: previewAcceptancePackage.readiness.readyForProviderSync === true,
      restartSafe: true,
      blockedBy: asList(previewAcceptancePackage.readiness.failedChecks).map((check) => `preview:${check}`),
      pendingBy: asList(previewAcceptancePackage.readiness.pendingChecks).map((check) => `preview:${check}`),
      nextAction: previewAcceptancePackage.readiness.nextAction,
    },
    {
      gate: "client-state",
      packetId: clientRuntimeAdoptionState.adoptionId,
      status: clientRuntimeAdoptionState.status,
      acceptedForRuntime: clientRuntimeAdoptionState.acceptedForRuntime === true,
      acceptedForProviderSync: clientRuntimeAdoptionState.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: clientRuntimeAdoptionState.acceptedForProviderSync === true,
      restartSafe: clientRuntimeAdoptionState.hydrated === true,
      blockedBy: clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
      pendingBy: [],
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      gate: "downstream-status",
      packetId: downstreamStatusPacket.packetId,
      status: downstreamStatusPacket.status,
      acceptedForRuntime: downstreamStatusPacket.acceptedForDownstream === true,
      acceptedForProviderSync: downstreamStatusPacket.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: downstreamStatusPacket.acceptedForProviderSync === true,
      restartSafe: downstreamStatusPacket.restartSafe !== false,
      blockedBy: asList(downstreamStatusPacket.blockedBy).map((blocker) => `downstream:${blocker}`),
      pendingBy: asList(downstreamStatusPacket.pendingBy).map((pending) => `downstream:${pending}`),
      nextAction: downstreamStatusPacket.nextAction,
    },
    {
      gate: "control-plane",
      packetId: controlPlaneState.controlPlaneId,
      status: controlPlaneState.status,
      acceptedForRuntime: controlPlaneState.persistedState?.acceptedForRuntime === true,
      acceptedForProviderSync: controlPlaneState.persistedState?.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: controlPlaneState.persistedState?.acceptedForProviderSync === true,
      restartSafe: controlPlaneState.persistedState?.restartSafe !== false,
      blockedBy: asList(controlPlaneState.blockedBy).map((blocker) => `control:${blocker}`),
      pendingBy: asList(controlPlaneState.pendingBy).map((pending) => `control:${pending}`),
      nextAction: controlPlaneState.nextAction,
    },
    {
      gate: "workflow-control",
      packetId: workflowControlPacket.packetId,
      status: workflowControlPacket.status,
      acceptedForRuntime: workflowControlPacket.acceptedForRuntime === true,
      acceptedForProviderSync: workflowControlPacket.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: workflowControlPacket.acceptedForProviderSync === true,
      restartSafe: workflowControlPacket.restartSafe !== false,
      blockedBy: asList(workflowControlPacket.blockedBy).map((blocker) => `workflow:${blocker}`),
      pendingBy: asList(workflowControlPacket.pendingBy).map((pending) => `workflow:${pending}`),
      nextAction: workflowControlPacket.nextAction,
    },
    {
      gate: "client-workflow-handoff",
      packetId: clientWorkflowHandoffPacket.packetId,
      status: clientWorkflowHandoffPacket.status,
      acceptedForRuntime: clientWorkflowHandoffPacket.acceptedForRuntime === true,
      acceptedForProviderSync: clientWorkflowHandoffPacket.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: clientWorkflowHandoffPacket.acceptedForProviderSync === true,
      restartSafe: clientWorkflowHandoffPacket.restartSafe !== false,
      blockedBy: asList(clientWorkflowHandoffPacket.blockedBy).map((blocker) => `client-workflow:${blocker}`),
      pendingBy: asList(clientWorkflowHandoffPacket.pendingBy).map((pending) => `client-workflow:${pending}`),
      nextAction: clientWorkflowHandoffPacket.nextAction,
    },
    {
      gate: "boundary-lease",
      packetId: boundaryLeasePacket.packetId,
      status: boundaryLeasePacket.status,
      acceptedForRuntime: boundaryLeasePacket.acceptedForRuntime === true,
      acceptedForProviderSync: boundaryLeasePacket.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: boundaryLeasePacket.acceptedForProviderSync === true,
      restartSafe: boundaryLeasePacket.restartSafe !== false,
      blockedBy: asList(boundaryLeasePacket.blockedBy).map((blocker) => `boundary:${blocker}`),
      pendingBy: asList(boundaryLeasePacket.pendingBy).map((pending) => `boundary:${pending}`),
      nextAction: boundaryLeasePacket.nextAction,
    },
    {
      gate: "provider-handoff",
      packetId: providerHandoffEnvelope.packetId,
      status: providerHandoffEnvelope.status,
      acceptedForRuntime: providerHandoffEnvelope.acceptedForRuntime === true,
      acceptedForProviderSync: providerHandoffEnvelope.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: providerHandoffEnvelope.acceptedForSyscallDispatch === true,
      restartSafe: providerHandoffEnvelope.restartSafe !== false,
      blockedBy: asList(providerHandoffEnvelope.blockedBy).map((blocker) => `provider:${blocker}`),
      pendingBy: asList(providerHandoffEnvelope.pendingBy).map((pending) => `provider:${pending}`),
      nextAction: providerHandoffEnvelope.nextAction,
    },
    {
      gate: "operator-resume",
      packetId: operatorResumePacket.packetId,
      status: operatorResumePacket.status,
      acceptedForRuntime: operatorResumePacket.acceptedForRuntime !== false,
      acceptedForProviderSync: operatorResumePacket.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: operatorResumePacket.acceptedForProviderSync === true,
      restartSafe: operatorResumePacket.restartSafe !== false,
      blockedBy: asList(operatorResumePacket.blockedBy).map((blocker) => `resume:${blocker}`),
      pendingBy: asList(operatorResumePacket.pendingBy).map((pending) => `resume:${pending}`),
      nextAction: operatorResumePacket.nextAction,
    },
    {
      gate: "provider-sync-release",
      packetId: providerSyncReleaseReceipt.receiptId,
      status: providerSyncReleaseReceipt.status,
      acceptedForRuntime: providerSyncReleaseReceipt.acceptedForProviderSync === true,
      acceptedForProviderSync: providerSyncReleaseReceipt.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: providerSyncReleaseReceipt.acceptedForSyscallDispatch === true,
      restartSafe: providerSyncReleaseReceipt.restartSafe !== false,
      blockedBy: asList(providerSyncReleaseReceipt.blockedBy).map((blocker) => `provider-release:${blocker}`),
      pendingBy: asList(providerSyncReleaseReceipt.pendingBy).map((pending) => `provider-release:${pending}`),
      nextAction: providerSyncReleaseReceipt.nextAction,
    },
    {
      gate: "syscall-dispatch-gate",
      packetId: syscallDispatchGate.gateId,
      status: syscallDispatchGate.status,
      acceptedForRuntime: syscallDispatchGate.acceptedForRuntime !== false,
      acceptedForProviderSync: syscallDispatchGate.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: syscallDispatchGate.acceptedForSyscallDispatch === true,
      restartSafe: syscallDispatchGate.restartSafe !== false,
      blockedBy: asList(syscallDispatchGate.blockedBy).map((blocker) => `syscall-gate:${blocker}`),
      pendingBy: asList(syscallDispatchGate.pendingBy).map((pending) => `syscall-gate:${pending}`),
      nextAction: syscallDispatchGate.nextAction,
    },
    {
      gate: "operator-release",
      packetId: operatorReleasePacket.packetId,
      status: operatorReleasePacket.status,
      acceptedForRuntime: operatorReleasePacket.acceptedForRuntime !== false,
      acceptedForProviderSync: operatorReleasePacket.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: operatorReleasePacket.acceptedForSyscallDispatch === true,
      restartSafe: operatorReleasePacket.restartSafe !== false,
      blockedBy: asList(operatorReleasePacket.blockedBy).map((blocker) => `operator-release:${blocker}`),
      pendingBy: asList(operatorReleasePacket.pendingBy).map((pending) => `operator-release:${pending}`),
      nextAction: operatorReleasePacket.nextAction,
    },
  ];
  const blockedBy = routeReceiptRows.flatMap((row) => row.blockedBy).sort();
  const pendingBy = routeReceiptRows.flatMap((row) => row.pendingBy)
    .filter((pending, index, all) => all.indexOf(pending) === index)
    .sort();
  const acceptedForRuntime = blockedBy.length === 0
    && routeReceiptRows.every((row) => row.acceptedForRuntime !== false);
  const acceptedForProviderSync = acceptedForRuntime
    && routeReceiptRows.every((row) => row.acceptedForProviderSync !== false);
  const acceptedForSyscallDispatch = acceptedForProviderSync
    && pendingBy.length === 0
    && routeReceiptRows.every((row) => row.acceptedForSyscallDispatch !== false);
  const restartSafe = blockedBy.length === 0
    && routeReceiptRows.every((row) => row.restartSafe !== false);
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : acceptedForSyscallDispatch
        ? "syscall-dispatch-ready"
        : acceptedForProviderSync
          ? "provider-sync-ready"
          : acceptedForRuntime
            ? "runtime-ready"
            : "waiting";
  const nextAction = blockedBy.length
    ? routeReceiptRows.find((row) => row.blockedBy.length)?.nextAction || "repair-memory-route-acceptance"
    : pendingBy.length
      ? routeReceiptRows.find((row) => row.pendingBy.length)?.nextAction || "continue-memory-route-acceptance"
      : acceptedForSyscallDispatch
        ? "release-memory-route-acceptance"
        : clientRuntimeAdoptionState.nextAction;

  return {
    format: "aios.mailchimp.memory.routeAcceptanceReceipt.v1",
    receiptId: `memory-route-acceptance:${stableKey([
      contract.id,
      clientRuntimeAdoptionState.stateKey,
      clientWorkflowHandoffPacket.packetId,
      providerSyncReleaseReceipt.receiptId,
      operatorReleasePacket.packetId,
      status,
    ])}`,
    status,
    acceptedForRuntime,
    acceptedForProviderSync,
    acceptedForSyscallDispatch,
    restartSafe,
    stateKey: clientRuntimeAdoptionState.stateKey,
    continuationToken: clientRuntimeAdoptionState.continuationToken,
    previewId: previewAcceptancePackage.preview.previewId,
    acceptanceId: previewAcceptancePackage.acceptance.acceptanceId,
    clientWorkflowPacketId: clientWorkflowHandoffPacket.packetId,
    providerReleaseReceiptId: providerSyncReleaseReceipt.receiptId,
    operatorReleasePacketId: operatorReleasePacket.packetId,
    statusChannel: acceptedForSyscallDispatch
      ? "memory.route-acceptance.mailchimp.release"
      : "memory.route-acceptance.mailchimp",
    blockedBy,
    pendingBy,
    validationSummary: {
      gates: routeReceiptRows.length,
      acceptedRuntimeGates: routeReceiptRows.filter((row) => row.acceptedForRuntime).length,
      acceptedProviderGates: routeReceiptRows.filter((row) => row.acceptedForProviderSync).length,
      acceptedSyscallGates: routeReceiptRows.filter((row) => row.acceptedForSyscallDispatch).length,
      blockedGates: routeReceiptRows.filter((row) => row.blockedBy.length).map((row) => row.gate),
      pendingGates: routeReceiptRows.filter((row) => row.pendingBy.length).map((row) => row.gate),
      restartUnsafeGates: routeReceiptRows.filter((row) => row.restartSafe === false).map((row) => row.gate),
    },
    receiptRows: routeReceiptRows,
    commands: [
      {
        command: "persist-memory-route-acceptance-receipt",
        enabled: true,
        idempotencyKey: `memory-route-acceptance:${stableKey([clientRuntimeAdoptionState.stateKey, status])}`,
      },
      {
        command: "release-memory-route-runtime",
        enabled: acceptedForRuntime,
        idempotencyKey: `memory-route-runtime:${clientRuntimeAdoptionState.continuationToken}`,
      },
      {
        command: "release-memory-route-provider-sync",
        enabled: acceptedForProviderSync,
        idempotencyKey: `memory-route-provider:${providerSyncReleaseReceipt.receiptId}`,
      },
      {
        command: "release-memory-route-syscall-dispatch",
        enabled: acceptedForSyscallDispatch,
        idempotencyKey: `memory-route-syscall:${operatorReleasePacket.packetId}`,
      },
    ],
    nextSteps: [
      ...blockedBy.map((blocker) => ({
        action: nextAction,
        subject: blocker,
        reason: "Memory route acceptance receipt has a blocking gate",
      })),
      ...pendingBy.map((pending) => ({
        action: nextAction,
        subject: pending,
        reason: "Memory route acceptance receipt is waiting on a release gate",
      })),
      ...(!blockedBy.length && !pendingBy.length ? [{
        action: acceptedForSyscallDispatch
          ? "release-memory-route-syscall-dispatch"
          : acceptedForProviderSync
            ? "release-memory-route-provider-sync"
            : "release-memory-route-runtime",
        subject: clientRuntimeAdoptionState.continuationToken,
        reason: "Memory route state is accepted for the next runtime handoff",
      }] : []),
    ],
    nextAction,
  };
}

function buildMemoryOperatorCommandReceipt(
  contract,
  lifecycleControls,
  controlPlaneState,
  routeAcceptanceReceipt,
  dispatchReleaseLedger,
  adapterResumeReceipt,
  operatorReleasePacket,
) {
  const commandSources = [
    ["lifecycle", lifecycleControls.commands],
    ["control-plane", controlPlaneState.commands],
    ["route-acceptance", routeAcceptanceReceipt.commands],
    ["dispatch-ledger", dispatchReleaseLedger.commands],
    ["adapter-resume", adapterResumeReceipt.commands],
    ["operator-release", operatorReleasePacket.commands],
  ];
  const commandRows = commandSources.flatMap(([source, commands]) => (
    asList(commands).map((command) => ({
      source,
      command: command.command || "memory-command",
      enabled: command.enabled === true,
      idempotencyKey: command.idempotencyKey || command.receiptId || command.exportId || null,
      statusChannel: command.statusChannel || routeAcceptanceReceipt.statusChannel || controlPlaneState.statusChannel || null,
      delaySeconds: command.delaySeconds ?? null,
    }))
  ));
  const blockedBy = [
    ...asList(controlPlaneState.blockedBy).map((blocker) => `control:${blocker}`),
    ...asList(routeAcceptanceReceipt.blockedBy).map((blocker) => `route:${blocker}`),
    ...asList(dispatchReleaseLedger.blockedBy).map((blocker) => `dispatch-ledger:${blocker}`),
    ...asList(adapterResumeReceipt.blockedBy).map((blocker) => `adapter-resume:${blocker}`),
    ...asList(operatorReleasePacket.blockedBy).map((blocker) => `operator-release:${blocker}`),
  ].sort();
  const pendingBy = [
    ...asList(controlPlaneState.pendingBy).map((pending) => `control:${pending}`),
    ...asList(routeAcceptanceReceipt.pendingBy).map((pending) => `route:${pending}`),
    ...asList(dispatchReleaseLedger.pendingBy).map((pending) => `dispatch-ledger:${pending}`),
    ...asList(adapterResumeReceipt.pendingBy).map((pending) => `adapter-resume:${pending}`),
    ...asList(operatorReleasePacket.pendingBy).map((pending) => `operator-release:${pending}`),
  ].sort();
  const enabledCommands = commandRows.filter((command) => command.enabled);
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && routeAcceptanceReceipt.acceptedForSyscallDispatch === true
    && dispatchReleaseLedger.acceptedForSyscallDispatch === true
    && adapterResumeReceipt.acceptedForSyscallDispatch === true
    && operatorReleasePacket.acceptedForSyscallDispatch === true;
  const restartSafe = blockedBy.length === 0
    && routeAcceptanceReceipt.restartSafe !== false
    && dispatchReleaseLedger.restartSafe !== false
    && adapterResumeReceipt.restartSafe !== false
    && operatorReleasePacket.restartSafe !== false;
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : releaseReady
        ? "released"
        : enabledCommands.length
          ? "commands-ready"
          : "waiting";

  return {
    format: "aios.mailchimp.memory.operatorCommandReceipt.v1",
    receiptId: `memory-operator-command-receipt:${stableKey([
      contract.id,
      routeAcceptanceReceipt.receiptId,
      dispatchReleaseLedger.ledgerId,
      adapterResumeReceipt.receiptId,
      operatorReleasePacket.packetId,
      status,
    ])}`,
    status,
    releaseReady,
    acceptedForProviderSync: releaseReady && routeAcceptanceReceipt.acceptedForProviderSync === true,
    acceptedForSyscallDispatch: releaseReady,
    restartSafe,
    statusChannel: releaseReady
      ? "memory.operator-command.mailchimp.release"
      : "memory.operator-command.mailchimp",
    blockedBy,
    pendingBy,
    commandRows,
    enabledCommands: enabledCommands.map((command) => command.command).sort(),
    commandSummary: {
      total: commandRows.length,
      enabled: enabledCommands.length,
      idempotent: commandRows.filter((command) => command.idempotencyKey).length,
      delayed: commandRows.filter((command) => command.delaySeconds != null).length,
    },
    commands: [
      {
        command: "persist-memory-operator-command-receipt",
        enabled: true,
        idempotencyKey: `memory-operator-command-receipt:${stableKey([
          routeAcceptanceReceipt.receiptId,
          dispatchReleaseLedger.ledgerId,
          adapterResumeReceipt.receiptId,
        ])}`,
      },
      {
        command: "release-memory-operator-commands-to-syscall",
        enabled: releaseReady,
        idempotencyKey: `memory-operator-command-release:${stableKey([
          operatorReleasePacket.packetId,
          routeAcceptanceReceipt.receiptId,
        ])}`,
      },
      {
        command: "retry-memory-operator-command-release",
        enabled: !releaseReady && adapterResumeReceipt.retryable === true,
        delaySeconds: adapterResumeReceipt.nextDelaySeconds ?? 60,
        idempotencyKey: `memory-operator-command-retry:${stableKey([
          adapterResumeReceipt.receiptId,
          adapterResumeReceipt.nextDelaySeconds,
        ])}`,
      },
    ],
    nextAction: blockedBy.length
      ? routeAcceptanceReceipt.blockedBy?.length
        ? routeAcceptanceReceipt.nextAction
        : dispatchReleaseLedger.blockedBy?.length
          ? dispatchReleaseLedger.nextAction
          : adapterResumeReceipt.blockedBy?.length
            ? adapterResumeReceipt.nextAction
            : operatorReleasePacket.nextAction
      : pendingBy.length
        ? routeAcceptanceReceipt.pendingBy?.length
          ? routeAcceptanceReceipt.nextAction
          : dispatchReleaseLedger.pendingBy?.length
            ? dispatchReleaseLedger.nextAction
            : adapterResumeReceipt.pendingBy?.length
              ? adapterResumeReceipt.nextAction
              : operatorReleasePacket.nextAction
        : releaseReady
          ? "release-memory-operator-commands-to-syscall"
          : "persist-memory-operator-command-receipt",
  };
}

function buildMemoryDispatchReleaseLedger(
  contract,
  mounts,
  clientRuntimeAdoptionState,
  providerContinuationContract,
  providerSyncReleaseReceipt,
  routeAcceptanceReceipt,
  operatorReleasePacket,
  syscallDispatchGate,
  releaseRiskBudget,
) {
  const syncMounts = new Set(providerContinuationContract.externalHandoffState.syncMounts);
  const sourceRows = [
    {
      source: "client-runtime",
      packetId: clientRuntimeAdoptionState.adoptionId,
      status: clientRuntimeAdoptionState.status,
      acceptedForSyscallDispatch: clientRuntimeAdoptionState.acceptedForProviderSync === true,
      restartSafe: clientRuntimeAdoptionState.hydrated === true,
      blockedBy: clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
      pendingBy: [],
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      source: "provider-sync-release",
      packetId: providerSyncReleaseReceipt.receiptId,
      status: providerSyncReleaseReceipt.status,
      acceptedForSyscallDispatch: providerSyncReleaseReceipt.acceptedForSyscallDispatch === true,
      restartSafe: providerSyncReleaseReceipt.restartSafe !== false,
      blockedBy: asList(providerSyncReleaseReceipt.blockedBy).map((blocker) => `provider-release:${blocker}`),
      pendingBy: asList(providerSyncReleaseReceipt.pendingBy).map((pending) => `provider-release:${pending}`),
      nextAction: providerSyncReleaseReceipt.nextAction,
    },
    {
      source: "route-acceptance",
      packetId: routeAcceptanceReceipt.receiptId,
      status: routeAcceptanceReceipt.status,
      acceptedForSyscallDispatch: routeAcceptanceReceipt.acceptedForSyscallDispatch === true,
      restartSafe: routeAcceptanceReceipt.restartSafe !== false,
      blockedBy: asList(routeAcceptanceReceipt.blockedBy).map((blocker) => `route:${blocker}`),
      pendingBy: asList(routeAcceptanceReceipt.pendingBy).map((pending) => `route:${pending}`),
      nextAction: routeAcceptanceReceipt.nextAction,
    },
    {
      source: "operator-release",
      packetId: operatorReleasePacket.packetId,
      status: operatorReleasePacket.status,
      acceptedForSyscallDispatch: operatorReleasePacket.acceptedForSyscallDispatch === true,
      restartSafe: operatorReleasePacket.restartSafe !== false,
      blockedBy: asList(operatorReleasePacket.blockedBy).map((blocker) => `operator:${blocker}`),
      pendingBy: asList(operatorReleasePacket.pendingBy).map((pending) => `operator:${pending}`),
      nextAction: operatorReleasePacket.nextAction,
    },
    {
      source: "syscall-dispatch-gate",
      packetId: syscallDispatchGate.gateId,
      status: syscallDispatchGate.status,
      acceptedForSyscallDispatch: syscallDispatchGate.acceptedForSyscallDispatch === true,
      restartSafe: syscallDispatchGate.restartSafe !== false,
      blockedBy: asList(syscallDispatchGate.blockedBy).map((blocker) => `syscall-gate:${blocker}`),
      pendingBy: asList(syscallDispatchGate.pendingBy).map((pending) => `syscall-gate:${pending}`),
      nextAction: syscallDispatchGate.nextAction,
    },
    {
      source: "release-risk-budget",
      packetId: releaseRiskBudget.budgetId,
      status: releaseRiskBudget.status,
      acceptedForSyscallDispatch: releaseRiskBudget.acceptedForSyscallDispatch === true,
      restartSafe: releaseRiskBudget.restartSafe !== false,
      blockedBy: asList(releaseRiskBudget.blockedBy).map((blocker) => `risk:${blocker}`),
      pendingBy: asList(releaseRiskBudget.pendingBy).map((pending) => `risk:${pending}`),
      nextAction: releaseRiskBudget.nextAction,
    },
  ];
  const mountRows = mounts.map((mount) => ({
    mount: mount.mount,
    path: mount.path,
    status: mount.status,
    selectedForProviderSync: syncMounts.has(mount.mount),
    acceptedForSyscallDispatch: !syncMounts.has(mount.mount)
      || (routeAcceptanceReceipt.acceptedForSyscallDispatch === true
        && providerSyncReleaseReceipt.acceptedForSyscallDispatch === true),
    restartSafe: mount.handoff.recoveryCursor != null || !syncMounts.has(mount.mount),
    recoveryCursor: mount.handoff.recoveryCursor,
    statusChannel: mount.handoff.statusChannel,
    nextAction: syncMounts.has(mount.mount)
      ? routeAcceptanceReceipt.nextAction
      : "continue-local-runtime",
  }));
  const blockedBy = [
    ...sourceRows.flatMap((row) => row.blockedBy),
    ...mountRows
      .filter((row) => row.selectedForProviderSync && row.restartSafe === false)
      .map((row) => `mount:${row.mount}:recovery-cursor-missing`),
  ].sort();
  const pendingBy = sourceRows.flatMap((row) => row.pendingBy)
    .filter((pending, index, pendingItems) => pendingItems.indexOf(pending) === index)
    .sort();
  const acceptedForSyscallDispatch = blockedBy.length === 0
    && pendingBy.length === 0
    && sourceRows.every((row) => row.acceptedForSyscallDispatch === true)
    && mountRows.every((row) => row.acceptedForSyscallDispatch === true);
  const restartSafe = blockedBy.length === 0
    && sourceRows.every((row) => row.restartSafe !== false)
    && mountRows.every((row) => row.restartSafe !== false);
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : acceptedForSyscallDispatch
        ? "dispatch-released"
        : "waiting";
  const ledgerId = `memory-dispatch-release-ledger:${stableKey([
    contract.id,
    clientRuntimeAdoptionState.stateKey,
    providerSyncReleaseReceipt.receiptId,
    routeAcceptanceReceipt.receiptId,
    status,
  ])}`;

  return {
    format: "aios.mailchimp.memory.dispatchReleaseLedger.v1",
    ledgerId,
    provider: "mailchimp",
    status,
    acceptedForProviderSync: providerSyncReleaseReceipt.acceptedForProviderSync === true
      && routeAcceptanceReceipt.acceptedForProviderSync === true,
    acceptedForSyscallDispatch,
    restartSafe,
    stateKey: clientRuntimeAdoptionState.stateKey,
    continuationToken: clientRuntimeAdoptionState.continuationToken,
    providerContinuationId: providerContinuationContract.continuationId,
    providerSyncReleaseReceiptId: providerSyncReleaseReceipt.receiptId,
    routeAcceptanceReceiptId: routeAcceptanceReceipt.receiptId,
    operatorReleasePacketId: operatorReleasePacket.packetId,
    syscallDispatchGateId: syscallDispatchGate.gateId,
    statusChannel: acceptedForSyscallDispatch
      ? "memory.dispatch-release.mailchimp.released"
      : "memory.dispatch-release.mailchimp",
    blockedBy,
    pendingBy,
    sourceRows,
    mountRows,
    persistedState: {
      ledgerId,
      stateKey: clientRuntimeAdoptionState.stateKey,
      continuationToken: clientRuntimeAdoptionState.continuationToken,
      status,
      acceptedForSyscallDispatch,
      restartSafe,
      nextAction: acceptedForSyscallDispatch
        ? "release-memory-dispatch-ledger"
        : sourceRows.find((row) => row.blockedBy.length || row.pendingBy.length)?.nextAction
          || routeAcceptanceReceipt.nextAction,
    },
    commands: [
      {
        command: "persist-memory-dispatch-release-ledger",
        enabled: true,
        idempotencyKey: `memory-dispatch-ledger:${ledgerId}`,
      },
      {
        command: "release-memory-dispatch-ledger",
        enabled: acceptedForSyscallDispatch,
        idempotencyKey: `memory-dispatch-release:${providerContinuationContract.continuationId}`,
      },
      {
        command: "schedule-memory-dispatch-ledger-retry",
        enabled: !acceptedForSyscallDispatch
          && (providerSyncReleaseReceipt.retryable === true || syscallDispatchGate.retryable === true),
        delaySeconds: providerSyncReleaseReceipt.nextDelaySeconds
          ?? syscallDispatchGate.nextDelaySeconds
          ?? 60,
        idempotencyKey: `memory-dispatch-ledger-retry:${stableKey([
          ledgerId,
          providerSyncReleaseReceipt.nextDelaySeconds,
          syscallDispatchGate.nextDelaySeconds,
        ])}`,
      },
    ],
    nextAction: acceptedForSyscallDispatch
      ? "release-memory-dispatch-ledger"
      : blockedBy.length
        ? sourceRows.find((row) => row.blockedBy.length)?.nextAction || "repair-memory-dispatch-release-ledger"
        : pendingBy.length
          ? sourceRows.find((row) => row.pendingBy.length)?.nextAction || "wait-for-memory-dispatch-release-ledger"
          : routeAcceptanceReceipt.nextAction,
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

function buildMemoryOperationalErrorRunbook(
  contract,
  mounts,
  lifecycleControls,
  tenantBoundaryState,
  providerContinuationContract,
  operationalHealthState,
) {
  const activeMounts = new Set(lifecycleControls.activeMounts);
  const syncMounts = new Set(lifecycleControls.syncMounts);
  const incidents = asList(operationalHealthState.incidents);
  const actionableErrors = asList(operationalHealthState.actionableErrors);
  const incidentsByAction = actionableErrors.reduce((groups, error) => {
    const action = error.action || "review-memory-health";
    groups[action] = groups[action] || [];
    groups[action].push({
      incidentId: error.incidentId || null,
      code: error.code || "memory.health.unknown",
      mount: error.mount || null,
      severity: error.severity || "warning",
      retryable: error.retryable === true,
    });
    return groups;
  }, {});
  const mountRows = mounts.map((mount) => {
    const mountIncidents = incidents.filter((incident) => incident.mount === mount.mount);
    const blocking = mountIncidents.filter((incident) => incident.severity === "error");
    const warnings = mountIncidents.filter((incident) => incident.severity === "warning");
    const providerSyncSelected = syncMounts.has(mount.mount);
    return {
      mount: mount.mount,
      path: mount.path,
      status: blocking.length
        ? "blocked"
        : warnings.length
          ? "degraded"
          : activeMounts.has(mount.mount)
            ? "ready"
            : "disabled",
      active: activeMounts.has(mount.mount),
      providerSyncSelected,
      retryable: mountIncidents.some((incident) => incident.retryable),
      incidentCodes: [...new Set(mountIncidents.map((incident) => incident.code))].sort(),
      nextAction: blocking[0]?.action
        || warnings[0]?.action
        || (providerSyncSelected ? "handoff-memory-provider-sync" : "continue-local-runtime"),
    };
  });
  const retryQueue = actionableErrors
    .filter((error) => error.retryable)
    .map((error, index) => ({
      index,
      incidentId: error.incidentId,
      mount: error.mount || null,
      action: error.action,
      delaySeconds: operationalHealthState.nextDelaySeconds,
      statusChannel: operationalHealthState.statusChannel,
      idempotencyKey: `memory-runbook-retry:${stableKey([
        operationalHealthState.healthId,
        error.incidentId,
        operationalHealthState.attempts + 1,
      ])}`,
    }));
  const escalationQueue = actionableErrors
    .filter((error) => !error.retryable && error.severity === "error")
    .map((error, index) => ({
      index,
      incidentId: error.incidentId,
      code: error.code,
      mount: error.mount || null,
      action: error.action,
      owner: error.code === "memory.health.tenant-boundary-blocked"
        ? "tenant-admin"
        : error.code === "memory.health.lifecycle-invalid"
          ? "workflow-operator"
          : "adapter-operator",
    }));
  const degradedProviderSync = operationalHealthState.degradedModeContract?.providerSyncHeld === true
    || providerContinuationContract.status === "blocked";
  const runbookStatus = escalationQueue.length
    ? "operator-action-required"
    : retryQueue.length
      ? "retry-scheduled"
      : operationalHealthState.status === "healthy"
        ? "clear"
        : "degraded";
  const runbookId = `memory-operational-runbook:${stableKey([
    contract.id,
    operationalHealthState.healthId,
    runbookStatus,
    mountRows.map((row) => [row.mount, row.status]),
  ])}`;

  return {
    format: "aios.mailchimp.memory.operationalErrorRunbook.v1",
    runbookId,
    status: runbookStatus,
    healthId: operationalHealthState.healthId,
    continuationId: providerContinuationContract.continuationId,
    tenantAuditId: tenantBoundaryState.auditId,
    degradedProviderSync,
    localRuntimeAllowed: operationalHealthState.degradedModeContract?.localRuntimeAllowed !== false,
    counters: {
      incidents: incidents.length,
      retryableIncidents: retryQueue.length,
      escalations: escalationQueue.length,
      activeMounts: lifecycleControls.activeMounts.length,
      degradedMounts: mountRows.filter((row) => row.status === "degraded").length,
      blockedMounts: mountRows.filter((row) => row.status === "blocked").length,
    },
    incidentsByAction: Object.fromEntries(
      Object.entries(incidentsByAction).sort(([left], [right]) => left.localeCompare(right)),
    ),
    mountRows,
    retryQueue,
    escalationQueue,
    commands: [
      {
        command: "persist-memory-operational-runbook",
        enabled: true,
        idempotencyKey: `memory-operational-runbook:${runbookId}`,
      },
      {
        command: "schedule-memory-runbook-retries",
        enabled: retryQueue.length > 0,
        retryCount: retryQueue.length,
        delaySeconds: operationalHealthState.nextDelaySeconds,
      },
      {
        command: "escalate-memory-runbook",
        enabled: escalationQueue.length > 0,
        escalationCount: escalationQueue.length,
      },
    ],
    nextAction: retryQueue.length
      ? "schedule-memory-runbook-retries"
      : escalationQueue.length
        ? "escalate-memory-runbook"
        : degradedProviderSync
          ? "hold-memory-provider-sync"
          : "continue-local-runtime",
  };
}

function buildMemoryOperationalTriagePacket(
  contract,
  mounts,
  lifecycleControls,
  operationalHealthState,
  downstreamStatusPacket,
  controlPlaneState,
  providerHandoffEnvelope,
  adapterResumeReceipt,
  claimRuntimeAdoptionReceipt,
) {
  const healthErrors = asList(operationalHealthState.actionableErrors)
    .filter((error) => error.severity === "error" || error.retryable === false);
  const healthWarnings = asList(operationalHealthState.actionableErrors)
    .filter((error) => !healthErrors.includes(error));
  const providerHeldMounts = new Set(asList(operationalHealthState.degradedModeContract?.heldMounts));
  const disabledMounts = new Set(asList(lifecycleControls.disabledMounts));
  const syncMounts = new Set(asList(lifecycleControls.syncMounts));
  const mountRows = mounts.map((mount) => {
    const held = providerHeldMounts.has(mount.mount);
    const disabled = disabledMounts.has(mount.mount);
    const syncRequested = syncMounts.has(mount.mount);
    const rowBlockedBy = [
      ...(mount.status === "blocked" ? [`mount:${mount.mount}:blocked`] : []),
      ...(held ? [`health:${mount.mount}:held`] : []),
      ...(disabled ? [`lifecycle:${mount.mount}:disabled`] : []),
      ...(syncRequested && operationalHealthState.status !== "healthy"
        ? [`provider-sync:${mount.mount}:health-not-ready`]
        : []),
    ].sort();
    return {
      mount: mount.mount,
      path: mount.path,
      status: rowBlockedBy.length ? "blocked" : syncRequested ? "sync-ready" : "runtime-ready",
      providerSyncRequested: syncRequested,
      disabled,
      held,
      blockedBy: rowBlockedBy,
      statusPath: mount.handoff?.statusChannel || "memory.status.mailchimp",
      nextAction: rowBlockedBy.length
        ? held
          ? operationalHealthState.nextAction
          : disabled
            ? "enable-memory-mount"
            : "repair-memory-mount"
        : syncRequested
          ? providerHandoffEnvelope.nextAction
          : "continue-local-runtime",
    };
  });
  const blockedBy = [
    ...healthErrors.map((error) => `health:${error.code}`),
    ...asList(downstreamStatusPacket.blockedBy).map((blocker) => `downstream:${blocker}`),
    ...asList(controlPlaneState.blockedBy).map((blocker) => `control-plane:${blocker}`),
    ...asList(providerHandoffEnvelope.blockedBy).map((blocker) => `provider-handoff:${blocker}`),
    ...asList(adapterResumeReceipt.blockedBy).map((blocker) => `adapter-resume:${blocker}`),
    ...asList(claimRuntimeAdoptionReceipt.blockedBy).map((blocker) => `claim-runtime:${blocker}`),
  ].sort();
  const pendingBy = [
    ...(operationalHealthState.retryable ? ["health:retry-scheduled"] : []),
    ...healthWarnings.map((error) => `health:${error.code}`),
    ...asList(downstreamStatusPacket.pendingBy).map((pending) => `downstream:${pending}`),
    ...asList(controlPlaneState.pendingBy).map((pending) => `control-plane:${pending}`),
    ...asList(providerHandoffEnvelope.pendingBy).map((pending) => `provider-handoff:${pending}`),
    ...asList(adapterResumeReceipt.pendingBy).map((pending) => `adapter-resume:${pending}`),
    ...asList(claimRuntimeAdoptionReceipt.pendingBy).map((pending) => `claim-runtime:${pending}`),
  ].sort();
  const retryDelay = operationalHealthState.retryable
    ? operationalHealthState.nextDelaySeconds
    : null;
  const status = blockedBy.length
    ? operationalHealthState.retryable
      ? "retrying"
      : "blocked"
    : pendingBy.length
      ? "degraded"
      : providerHandoffEnvelope.acceptedForAdapter
        ? "handoff-ready"
        : "observing";

  return {
    format: "aios.mailchimp.memory.operationalTriage.v1",
    packetId: `memory-operational-triage:${stableKey([
      contract.id,
      operationalHealthState.healthId,
      downstreamStatusPacket.packetId,
      controlPlaneState.controlPlaneId,
      status,
    ])}`,
    provider: "mailchimp",
    status,
    healthId: operationalHealthState.healthId,
    downstreamStatusPacketId: downstreamStatusPacket.packetId,
    controlPlaneId: controlPlaneState.controlPlaneId,
    providerHandoffPacketId: providerHandoffEnvelope.packetId,
    retryable: operationalHealthState.retryable === true,
    nextDelaySeconds: retryDelay,
    degradedMode: operationalHealthState.degradedMode === true,
    blockedBy,
    pendingBy,
    mountRows,
    actionableErrors: asList(operationalHealthState.actionableErrors).map((error) => ({
      code: error.code,
      mount: error.mount || null,
      severity: error.severity || "warning",
      action: error.action,
      retryable: error.retryable === true,
    })),
    statusChannels: [
      operationalHealthState.statusChannel,
      downstreamStatusPacket.statusChannel,
      controlPlaneState.statusChannel,
      providerHandoffEnvelope.statusChannel,
    ].filter(Boolean).sort(),
    commands: [
      {
        command: "persist-memory-operational-triage",
        enabled: true,
        idempotencyKey: `memory-operational-triage:${operationalHealthState.healthId}`,
      },
      {
        command: "schedule-memory-operational-retry",
        enabled: operationalHealthState.retryable === true,
        delaySeconds: retryDelay,
        idempotencyKey: `memory-operational-triage-retry:${stableKey([
          operationalHealthState.healthId,
          operationalHealthState.attempts + 1,
        ])}`,
      },
      {
        command: "handoff-memory-triage-to-provider",
        enabled: status === "handoff-ready",
        idempotencyKey: `memory-operational-triage-handoff:${providerHandoffEnvelope.packetId}`,
      },
    ],
    nextAction: blockedBy.length
      ? operationalHealthState.retryable
        ? "schedule-memory-operational-retry"
        : operationalHealthState.nextAction
      : pendingBy.length
        ? operationalHealthState.nextAction
        : status === "handoff-ready"
          ? "handoff-memory-triage-to-provider"
          : controlPlaneState.nextAction,
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

function buildMemoryWorkflowControlPacket(
  contract,
  previewAcceptancePackage,
  clientRuntimeAdoptionState,
  downstreamStatusPacket,
  controlPlaneState,
) {
  const blockedBy = [
    ...asList(controlPlaneState.blockedBy).map((blocker) => `control:${blocker}`),
    ...asList(downstreamStatusPacket.blockedBy).map((blocker) => `downstream:${blocker}`),
    ...asList(clientRuntimeAdoptionState.missingClientState).map((key) => `client-state:${key}`),
  ].sort();
  const pendingBy = [
    ...asList(controlPlaneState.pendingBy).map((pending) => `control:${pending}`),
    ...asList(downstreamStatusPacket.pendingBy).map((pending) => `downstream:${pending}`),
    ...(previewAcceptancePackage.acceptance.required && !previewAcceptancePackage.acceptance.acceptedForProviderSync
      ? ["acceptance:provider-sync"]
      : []),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && controlPlaneState.persistedState.acceptedForProviderSync === true
    && clientRuntimeAdoptionState.acceptedForProviderSync === true;

  return {
    format: "aios.mailchimp.memory.workflowControl.v1",
    packetId: `memory-workflow-control:${stableKey([
      contract.id,
      controlPlaneState.controlPlaneId,
      downstreamStatusPacket.packetId,
      releaseReady,
    ])}`,
    provider: "mailchimp",
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : releaseReady ? "release-ready" : "observing",
    releaseReady,
    stateKey: clientRuntimeAdoptionState.stateKey,
    continuationToken: clientRuntimeAdoptionState.continuationToken,
    controlPlaneId: controlPlaneState.controlPlaneId,
    downstreamPacketId: downstreamStatusPacket.packetId,
    previewId: previewAcceptancePackage.preview.previewId,
    acceptanceId: previewAcceptancePackage.acceptance.acceptanceId,
    statusChannel: controlPlaneState.statusChannel,
    blockedBy,
    pendingBy,
    commands: [
      {
        command: "persist-memory-workflow-control-packet",
        enabled: true,
        idempotencyKey: `memory-workflow-control:${controlPlaneState.controlPlaneId}`,
      },
      {
        command: "sync-memory-workflow-status",
        enabled: blockedBy.length === 0,
        statusChannel: controlPlaneState.statusChannel,
        idempotencyKey: `memory-workflow-status:${downstreamStatusPacket.packetId}`,
      },
      {
        command: "release-memory-workflow-provider-sync",
        enabled: releaseReady,
        continuationToken: clientRuntimeAdoptionState.continuationToken,
        idempotencyKey: `memory-workflow-provider-sync:${controlPlaneState.controlPlaneId}`,
      },
    ],
    nextAction: blockedBy.length
      ? controlPlaneState.nextAction
      : pendingBy.length
        ? previewAcceptancePackage.readiness.nextAction
        : releaseReady
          ? "release-memory-workflow-provider-sync"
      : controlPlaneState.nextAction,
  };
}

function buildMemoryClientWorkflowHandoffPacket(
  contract,
  mounts,
  previewAcceptancePackage,
  clientRuntimeAdoptionState,
  downstreamStatusPacket,
  controlPlaneState,
  workflowControlPacket,
  tenantBoundaryState,
) {
  const readiness = previewAcceptancePackage.readiness;
  const acceptance = previewAcceptancePackage.acceptance;
  const selectedSyncMounts = new Set(
    mounts
      .filter((mount) => mount.providerSyncRequired)
      .map((mount) => mount.mount),
  );
  const blockedBy = [
    ...asList(readiness.failedChecks).map((check) => `readiness:${check}`),
    ...asList(acceptance.blockedBy).map((blocker) => `acceptance:${blocker}`),
    ...asList(clientRuntimeAdoptionState.missingClientState).map((key) => `client-state:${key}`),
    ...asList(downstreamStatusPacket.blockedBy).map((blocker) => `downstream:${blocker}`),
    ...asList(controlPlaneState.blockedBy).map((blocker) => `control:${blocker}`),
    ...asList(tenantBoundaryState.tenantBlockedBy).map((blocker) => `tenant:${blocker}`),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const pendingBy = [
    ...asList(readiness.pendingChecks).map((check) => `readiness:${check}`),
    ...asList(downstreamStatusPacket.pendingBy).map((pending) => `downstream:${pending}`),
    ...asList(controlPlaneState.pendingBy).map((pending) => `control:${pending}`),
    ...asList(workflowControlPacket.pendingBy).map((pending) => `workflow:${pending}`),
    ...(acceptance.required && !acceptance.acceptedForProviderSync ? ["acceptance:provider-sync"] : []),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const hydrated = clientRuntimeAdoptionState.hydrated === true;
  const restartSafe = hydrated
    && downstreamStatusPacket.restartSafe === true
    && controlPlaneState.persistedState.restartSafe === true
    && tenantBoundaryState.status !== "blocked";
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && restartSafe
    && workflowControlPacket.releaseReady === true
    && downstreamStatusPacket.acceptedForProviderSync === true;
  const runtimeReady = blockedBy.length === 0
    && hydrated
    && downstreamStatusPacket.acceptedForDownstream === true;
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : releaseReady
        ? "provider-sync-ready"
        : runtimeReady
          ? "runtime-ready"
          : "waiting";
  const mountContracts = mounts.map((mount) => ({
    mount: mount.mount,
    path: mount.path,
    status: mount.status,
    selectedForProviderSync: selectedSyncMounts.has(mount.mount),
    restartSafe: mount.handoff.recoveryCursor != null || !selectedSyncMounts.has(mount.mount),
    statusChannel: mount.handoff.statusChannel,
    recoveryCursor: mount.handoff.recoveryCursor,
    blockedBy: mount.status === "blocked" ? [`mount:${mount.mount}:blocked`] : [],
    pendingBy: selectedSyncMounts.has(mount.mount) && !mount.handoff.recoveryCursor
      ? [`mount:${mount.mount}:recovery-cursor`]
      : [],
    nextAction: mount.status === "blocked" ? "repair-memory-preview" : mount.handoff.nextAction,
  }));
  const gates = [
    {
      gate: "client-state",
      status: hydrated ? "hydrated" : "needs-client-state",
      accepted: hydrated,
      restartSafe: hydrated,
      packetId: clientRuntimeAdoptionState.adoptionId,
      blockedBy: clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
      pendingBy: [],
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      gate: "downstream-status",
      status: downstreamStatusPacket.status,
      accepted: downstreamStatusPacket.acceptedForDownstream === true,
      restartSafe: downstreamStatusPacket.restartSafe === true,
      packetId: downstreamStatusPacket.packetId,
      blockedBy: asList(downstreamStatusPacket.blockedBy).map((blocker) => `downstream:${blocker}`),
      pendingBy: asList(downstreamStatusPacket.pendingBy).map((pending) => `downstream:${pending}`),
      nextAction: downstreamStatusPacket.nextAction,
    },
    {
      gate: "workflow-control",
      status: workflowControlPacket.status,
      accepted: workflowControlPacket.releaseReady === true,
      restartSafe: controlPlaneState.persistedState.restartSafe === true,
      packetId: workflowControlPacket.packetId,
      blockedBy: asList(workflowControlPacket.blockedBy).map((blocker) => `workflow:${blocker}`),
      pendingBy: asList(workflowControlPacket.pendingBy).map((pending) => `workflow:${pending}`),
      nextAction: workflowControlPacket.nextAction,
    },
    {
      gate: "tenant-boundary",
      status: tenantBoundaryState.status,
      accepted: tenantBoundaryState.status === "ready",
      restartSafe: tenantBoundaryState.status !== "blocked",
      packetId: tenantBoundaryState.auditId,
      blockedBy: asList(tenantBoundaryState.tenantBlockedBy).map((blocker) => `tenant:${blocker}`),
      pendingBy: [],
      nextAction: tenantBoundaryState.nextAction,
    },
  ];
  const releaseReceipt = {
    receiptId: `memory-client-workflow-receipt:${stableKey([
      contract.id,
      clientRuntimeAdoptionState.stateKey,
      workflowControlPacket.packetId,
      releaseReady,
      status,
    ])}`,
    packetId: `memory-client-workflow:${stableKey([
      contract.id,
      clientRuntimeAdoptionState.stateKey,
      workflowControlPacket.packetId,
      status,
    ])}`,
    status,
    acceptedForRuntime: runtimeReady,
    acceptedForProviderSync: releaseReady,
    releaseReady,
    restartSafe,
    stateKey: clientRuntimeAdoptionState.stateKey,
    continuationToken: clientRuntimeAdoptionState.continuationToken,
    tenantAuditId: tenantBoundaryState.auditId,
    blockedBy,
    pendingBy,
    gateReceipts: gates.map((gate) => ({
      gate: gate.gate,
      packetId: gate.packetId,
      status: gate.status,
      accepted: gate.accepted,
      restartSafe: gate.restartSafe,
      blockedBy: gate.blockedBy,
      pendingBy: gate.pendingBy,
      nextAction: gate.nextAction,
    })),
    commandReceipt: {
      command: "release-memory-client-workflow",
      enabled: releaseReady,
      idempotencyKey: `memory-client-workflow-release:${workflowControlPacket.packetId}`,
      statusChannel: releaseReady
        ? "memory.client-workflow.mailchimp.provider-sync-ready"
        : "memory.client-workflow.mailchimp",
    },
    nextAction: blockedBy.length
      ? gates.find((gate) => gate.blockedBy.length)?.nextAction || downstreamStatusPacket.nextAction
      : pendingBy.length
        ? gates.find((gate) => gate.pendingBy.length)?.nextAction || workflowControlPacket.nextAction
        : releaseReady
          ? "release-memory-client-workflow"
          : runtimeReady
            ? "publish-memory-client-workflow-status"
            : clientRuntimeAdoptionState.nextAction,
  };

  return {
    format: "aios.mailchimp.memory.clientWorkflowHandoff.v1",
    packetId: `memory-client-workflow:${stableKey([
      contract.id,
      clientRuntimeAdoptionState.stateKey,
      workflowControlPacket.packetId,
      status,
    ])}`,
    provider: "mailchimp",
    status,
    releaseReady,
    acceptedForRuntime: runtimeReady,
    acceptedForProviderSync: releaseReady,
    restartSafe,
    stateKey: clientRuntimeAdoptionState.stateKey,
    continuationToken: clientRuntimeAdoptionState.continuationToken,
    previewId: previewAcceptancePackage.preview.previewId,
    acceptanceId: acceptance.acceptanceId,
    controlPlaneId: controlPlaneState.controlPlaneId,
    workflowControlPacketId: workflowControlPacket.packetId,
    downstreamPacketId: downstreamStatusPacket.packetId,
    tenantAuditId: tenantBoundaryState.auditId,
    statusChannel: releaseReady
      ? "memory.client-workflow.mailchimp.provider-sync-ready"
      : "memory.client-workflow.mailchimp",
    gates,
    mountContracts,
    releaseReceipt,
    blockedBy,
    pendingBy,
    commands: [
      {
        command: "persist-memory-client-workflow-handoff",
        enabled: true,
        idempotencyKey: `memory-client-workflow:${clientRuntimeAdoptionState.stateKey}`,
      },
      {
        command: "publish-memory-client-workflow-status",
        enabled: blockedBy.length === 0,
        statusChannel: releaseReady
          ? "memory.client-workflow.mailchimp.provider-sync-ready"
          : "memory.client-workflow.mailchimp",
        idempotencyKey: `memory-client-workflow-status:${workflowControlPacket.packetId}`,
      },
      {
        command: "release-memory-client-workflow",
        enabled: releaseReady,
        continuationToken: clientRuntimeAdoptionState.continuationToken,
        idempotencyKey: `memory-client-workflow-release:${workflowControlPacket.packetId}`,
      },
    ],
    nextAction: releaseReceipt.nextAction,
  };
}

function buildMemoryProviderHandoffEnvelope(
  contract,
  mounts,
  providerContinuationContract,
  previewAcceptancePackage,
  clientRuntimeAdoptionState,
  operationalHealthState,
  downstreamStatusPacket,
  controlPlaneState,
  workflowControlPacket,
  tenantBoundaryState,
) {
  const providerSyncMounts = new Set(providerContinuationContract.externalHandoffState.syncMounts);
  const stagedWritebacks = new Set(providerContinuationContract.externalHandoffState.stagedWritebacks);
  const failedChecks = [
    ...asList(previewAcceptancePackage.readiness.failedChecks).map((check) => `readiness:${check}`),
    ...asList(downstreamStatusPacket.blockedBy).map((blocker) => `downstream:${blocker}`),
    ...asList(controlPlaneState.blockedBy).map((blocker) => `control:${blocker}`),
    ...asList(tenantBoundaryState.tenantBlockedBy).map((blocker) => `tenant:${blocker}`),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const pendingChecks = [
    ...asList(previewAcceptancePackage.readiness.pendingChecks).map((check) => `readiness:${check}`),
    ...asList(downstreamStatusPacket.pendingBy).map((pending) => `downstream:${pending}`),
    ...asList(controlPlaneState.pendingBy).map((pending) => `control:${pending}`),
    ...(operationalHealthState.retryable ? ["health:retry-scheduled"] : []),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const releaseReady = failedChecks.length === 0
    && pendingChecks.length === 0
    && workflowControlPacket.releaseReady === true
    && downstreamStatusPacket.acceptedForProviderSync === true;
  const runtimeReady = failedChecks.length === 0
    && clientRuntimeAdoptionState.acceptedForRuntime === true
    && downstreamStatusPacket.acceptedForDownstream === true;
  const status = failedChecks.length
    ? "blocked"
    : pendingChecks.length
      ? "pending"
      : releaseReady
        ? "provider-sync-ready"
        : runtimeReady
          ? "runtime-ready"
          : "observing";
  const mountContracts = mounts.map((mount) => ({
    mount: mount.mount,
    path: mount.path,
    mode: mount.mode,
    sensitivity: mount.sensitivity,
    selectedForProviderSync: providerSyncMounts.has(mount.mount),
    stagedWriteback: stagedWritebacks.has(mount.mount),
    statusChannel: mount.handoff.statusChannel,
    recoveryCursor: mount.handoff.recoveryCursor,
    requiredCapabilities: mount.requiredCapabilities,
    restartSafe: mount.handoff.recoveryCursor != null || !providerSyncMounts.has(mount.mount),
    nextAction: providerSyncMounts.has(mount.mount)
      ? providerContinuationContract.nextAction
      : mount.handoff.nextAction,
  }));
  const statusGates = [
    {
      gate: "memory-runtime",
      status: runtimeReady ? "pass" : failedChecks.length ? "fail" : "pending",
      accepted: runtimeReady,
      restartSafe: clientRuntimeAdoptionState.hydrated === true,
      packetId: clientRuntimeAdoptionState.adoptionId,
      blockedBy: clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
      pendingBy: [],
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      gate: "provider-continuation",
      status: providerContinuationContract.acceptedForProviderSync ? "pass" : failedChecks.length ? "fail" : "pending",
      accepted: providerContinuationContract.acceptedForProviderSync === true,
      restartSafe: providerContinuationContract.externalHandoffState.restartSafe === true,
      packetId: providerContinuationContract.continuationId,
      blockedBy: providerContinuationContract.externalHandoffState.blockedBy,
      pendingBy: previewAcceptancePackage.acceptance.required
        && !previewAcceptancePackage.acceptance.acceptedForProviderSync
        ? ["acceptance:provider-sync"]
        : [],
      nextAction: providerContinuationContract.nextAction,
    },
    {
      gate: "memory-health",
      status: operationalHealthState.status === "healthy" ? "pass" : "fail",
      accepted: operationalHealthState.status === "healthy",
      restartSafe: operationalHealthState.status !== "failed",
      packetId: operationalHealthState.healthId,
      blockedBy: operationalHealthState.incidents
        .filter((incident) => incident.severity === "error")
        .map((incident) => `health:${incident.code}`),
      pendingBy: operationalHealthState.retryable ? ["health:retry-scheduled"] : [],
      nextAction: operationalHealthState.nextAction,
    },
    {
      gate: "memory-control-plane",
      status: controlPlaneState.status,
      accepted: controlPlaneState.persistedState.acceptedForProviderSync === true,
      restartSafe: controlPlaneState.persistedState.restartSafe === true,
      packetId: controlPlaneState.controlPlaneId,
      blockedBy: controlPlaneState.blockedBy,
      pendingBy: controlPlaneState.pendingBy,
      nextAction: controlPlaneState.nextAction,
    },
  ];
  const requiredProviderCapabilities = [
    ...new Set(mountContracts
      .filter((mount) => mount.selectedForProviderSync || mount.stagedWriteback)
      .flatMap((mount) => mount.requiredCapabilities || [])),
  ].sort();
  const negotiatedProviderCapabilities = [
    ...new Set(providerContinuationContract.capabilityNegotiation.negotiatedCapabilities || []),
  ].sort();
  const missingProviderCapabilities = requiredProviderCapabilities
    .filter((capability) => !negotiatedProviderCapabilities.includes(capability))
    .sort();
  const serviceBindingRows = mountContracts.map((mount) => {
    const required = [...new Set(asList(mount.requiredCapabilities))].sort();
    const missing = required
      .filter((capability) => mount.selectedForProviderSync && !negotiatedProviderCapabilities.includes(capability))
      .sort();
    const externalHandoffRequired = mount.selectedForProviderSync || mount.stagedWriteback;
    const blockedBy = [
      ...missing.map((capability) => `capability:${capability}`),
      ...(mount.selectedForProviderSync && !mount.recoveryCursor ? ["recovery-cursor:missing"] : []),
    ].sort();
    return {
      mount: mount.mount,
      providerService: providerContinuationContract.providerService,
      selectedForProviderSync: mount.selectedForProviderSync,
      stagedWriteback: mount.stagedWriteback,
      externalHandoffRequired,
      requiredCapabilities: required,
      negotiatedCapabilities: required.filter((capability) => negotiatedProviderCapabilities.includes(capability)),
      missingCapabilities: missing,
      cursorPath: mount.recoveryCursor,
      statusPath: `memory.provider-service.${mount.mount}`,
      status: blockedBy.length
        ? "blocked"
        : externalHandoffRequired
          ? releaseReady
            ? "handoff-ready"
            : "awaiting-release"
          : "local-only",
      restartSafe: !externalHandoffRequired || (mount.restartSafe && blockedBy.length === 0),
      blockedBy,
      nextAction: blockedBy.length
        ? "repair-memory-provider-service-binding"
        : externalHandoffRequired
          ? releaseReady
            ? "release-memory-provider-service-binding"
            : providerContinuationContract.nextAction
          : "continue-local-runtime",
    };
  });
  const serviceBlockedBy = [
    ...missingProviderCapabilities.map((capability) => `capability:${capability}`),
    ...serviceBindingRows.flatMap((row) => row.blockedBy.map((blocker) => `${row.mount}:${blocker}`)),
  ].sort();
  const healthBlockedBy = operationalHealthState.actionableErrors
    .filter((error) => error.severity === "error")
    .map((error) => `health:${error.code}`);
  const healthPendingBy = [
    ...(operationalHealthState.retryable ? ["health:retry-scheduled"] : []),
    ...operationalHealthState.actionableErrors
      .filter((error) => error.severity !== "error" && error.retryable)
      .map((error) => `health:${error.code}`),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const providerHealthReady = operationalHealthState.status === "healthy"
    && healthBlockedBy.length === 0
    && !operationalHealthState.degradedModeContract.providerSyncHeld;
  const providerHealthHandoff = {
    format: "aios.mailchimp.memory.providerHealthHandoff.v1",
    packetId: `memory-provider-health:${stableKey([
      contract.id,
      providerContinuationContract.continuationId,
      operationalHealthState.healthId,
      operationalHealthState.status,
    ])}`,
    provider: "mailchimp",
    providerService: providerContinuationContract.providerService,
    healthId: operationalHealthState.healthId,
    status: providerHealthReady
      ? "healthy"
      : healthBlockedBy.length
        ? operationalHealthState.retryable
          ? "retryable-degraded"
          : "blocked"
        : healthPendingBy.length
          ? "pending"
          : operationalHealthState.status,
    acceptedForRuntime: operationalHealthState.degradedModeContract.localRuntimeAllowed !== false,
    acceptedForProviderSync: providerHealthReady,
    acceptedForSyscallDispatch: providerHealthReady && releaseReady,
    degradedMode: operationalHealthState.degradedMode,
    providerAvailable: operationalHealthState.providerAvailable,
    adapterHealthy: operationalHealthState.adapterHealthy,
    providerSyncHeld: operationalHealthState.degradedModeContract.providerSyncHeld === true,
    heldMounts: operationalHealthState.degradedModeContract.heldMounts,
    retryable: operationalHealthState.retryable === true,
    attempts: operationalHealthState.attempts,
    maxAttempts: operationalHealthState.maxAttempts,
    nextDelaySeconds: operationalHealthState.nextDelaySeconds,
    statusChannel: operationalHealthState.statusChannel,
    incidentSummary: operationalHealthState.incidentSummary,
    actionableErrors: operationalHealthState.actionableErrors,
    blockedBy: healthBlockedBy,
    pendingBy: healthPendingBy,
    mountHealthRows: serviceBindingRows.map((row) => {
      const rowIncidents = operationalHealthState.incidents
        .filter((incident) => incident.mount === row.mount);
      const rowErrors = rowIncidents.filter((incident) => incident.severity === "error");
      const rowWarnings = rowIncidents.filter((incident) => incident.severity === "warning");
      return {
        mount: row.mount,
        selectedForProviderSync: row.selectedForProviderSync,
        status: rowErrors.length
          ? "blocked"
          : rowWarnings.length
            ? "degraded"
            : row.externalHandoffRequired
              ? providerHealthReady
                ? "healthy"
                : "held"
              : "local-only",
        providerSyncHeld: row.externalHandoffRequired && !providerHealthReady,
        incidents: rowIncidents.map((incident) => incident.incidentId),
        blockedBy: rowErrors.map((incident) => `health:${incident.code}`).sort(),
        pendingBy: rowWarnings.map((incident) => `health:${incident.code}`).sort(),
        nextAction: rowErrors[0]?.action
          || rowWarnings[0]?.action
          || (row.externalHandoffRequired && !providerHealthReady
            ? operationalHealthState.nextAction
            : row.nextAction),
      };
    }),
    commands: [
      {
        command: "persist-memory-provider-health-handoff",
        enabled: true,
        idempotencyKey: `memory-provider-health:${operationalHealthState.healthId}`,
      },
      {
        command: "schedule-memory-provider-health-retry",
        enabled: operationalHealthState.retryable === true,
        delaySeconds: operationalHealthState.nextDelaySeconds,
        idempotencyKey: `memory-provider-health-retry:${stableKey([
          operationalHealthState.healthId,
          operationalHealthState.attempts + 1,
        ])}`,
      },
      {
        command: "release-memory-provider-health-handoff",
        enabled: providerHealthReady,
        idempotencyKey: `memory-provider-health-release:${providerContinuationContract.continuationId}`,
      },
    ],
    nextAction: operationalHealthState.retryable
      ? "schedule-memory-provider-health-retry"
      : healthBlockedBy.length
        ? operationalHealthState.nextAction
        : providerHealthReady
          ? "release-memory-provider-health-handoff"
          : "hold-memory-provider-health-handoff",
  };
  const providerServiceContract = {
    contractId: `memory-provider-service-contract:${stableKey([
      contract.id,
      providerContinuationContract.providerService,
      requiredProviderCapabilities,
      negotiatedProviderCapabilities,
      serviceBindingRows.map((row) => [row.mount, row.status]),
    ])}`,
    provider: "mailchimp",
    providerService: providerContinuationContract.providerService,
    status: serviceBlockedBy.length
      ? "capability-mismatch"
      : releaseReady && providerHealthReady
        ? "handoff-ready"
      : "negotiated",
    requestedCapabilities: requiredProviderCapabilities,
    negotiatedCapabilities: negotiatedProviderCapabilities
      .filter((capability) => requiredProviderCapabilities.includes(capability))
      .sort(),
    missingCapabilities: missingProviderCapabilities,
    syncMetadata: {
      continuationId: providerContinuationContract.continuationId,
      cursorPaths: providerContinuationContract.syncMetadata.cursorPaths,
      scheduleId: providerContinuationContract.syncMetadata.scheduleId,
      statusChannel: releaseReady
        ? "memory.provider-service.mailchimp.ready"
        : "memory.provider-service.mailchimp.pending",
    },
    healthHandoff: {
      packetId: providerHealthHandoff.packetId,
      status: providerHealthHandoff.status,
      acceptedForProviderSync: providerHealthHandoff.acceptedForProviderSync,
      retryable: providerHealthHandoff.retryable,
      nextDelaySeconds: providerHealthHandoff.nextDelaySeconds,
      blockedBy: providerHealthHandoff.blockedBy,
      pendingBy: providerHealthHandoff.pendingBy,
      statusChannel: providerHealthHandoff.statusChannel,
      nextAction: providerHealthHandoff.nextAction,
    },
    externalHandoffState: {
      acceptedForProviderSync: releaseReady && serviceBlockedBy.length === 0 && providerHealthReady,
      acceptedForSyscallDispatch: releaseReady
        && serviceBlockedBy.length === 0
        && providerHealthReady
        && statusGates.every((gate) => gate.accepted === true),
      restartSafe: serviceBindingRows.every((row) => row.restartSafe !== false)
        && operationalHealthState.status !== "failed",
      blockedBy: [...serviceBlockedBy, ...healthBlockedBy].sort(),
      pendingBy: [...pendingChecks, ...healthPendingBy].sort(),
      nextAction: serviceBlockedBy.length
        ? "repair-memory-provider-service-binding"
        : !providerHealthReady
          ? providerHealthHandoff.nextAction
        : releaseReady
          ? "release-memory-provider-service-contract"
          : "wait-for-memory-provider-handoff-release",
    },
    serviceBindingRows,
  };
  const audienceBindings = serviceBindingRows
    .filter((row) => row.externalHandoffRequired)
    .map((row) => {
      const mount = mountContracts.find((candidate) => candidate.mount === row.mount) || {};
      const cursorPath = row.cursorPath || mount.recoveryCursor || null;
      const blockedBy = [
        ...asList(row.blockedBy).map((blocker) => `provider-service:${blocker}`),
        ...(cursorPath ? [] : ["audience-cursor:missing"]),
        ...(tenantBoundaryState.tenantId ? [] : ["tenant:missing"]),
        ...(tenantBoundaryState.workspaceId ? [] : ["workspace:missing"]),
        ...(providerHealthHandoff.acceptedForProviderSync ? [] : [`provider-health:${providerHealthHandoff.status}`]),
      ].sort();
      return {
        mount: row.mount,
        audienceId: contract.audienceId || contract.providerServiceContract?.audienceId || null,
        segmentId: contract.segmentId || contract.providerServiceContract?.segmentId || null,
        tenantId: tenantBoundaryState.tenantId,
        workspaceId: tenantBoundaryState.workspaceId,
        cursorPath,
        selectedForProviderSync: row.selectedForProviderSync,
        stagedWriteback: row.stagedWriteback,
        statusPath: `memory.provider-audience.${row.mount}`,
        acceptedForProviderSync: blockedBy.length === 0 && row.status === "handoff-ready",
        acceptedForSyscallDispatch: blockedBy.length === 0
          && row.status === "handoff-ready"
          && providerServiceContract.externalHandoffState.acceptedForSyscallDispatch === true,
        restartSafe: row.restartSafe !== false && cursorPath != null,
        blockedBy,
        nextAction: blockedBy.length
          ? blockedBy.includes("audience-cursor:missing")
            ? "hydrate-memory-audience-cursor"
            : "repair-memory-provider-audience-contract"
          : "release-memory-provider-audience-contract",
      };
    });
  const audienceBlockedBy = audienceBindings
    .flatMap((binding) => binding.blockedBy.map((blocker) => `${binding.mount}:${blocker}`))
    .sort();
  const audiencePendingBy = [
    ...(audienceBindings.length === 0 ? [] : providerServiceContract.externalHandoffState.pendingBy),
    ...(providerHealthHandoff.retryable ? ["provider-health:retry-scheduled"] : []),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const providerAudienceContract = {
    format: "aios.mailchimp.memory.providerAudienceContract.v1",
    contractId: `memory-provider-audience:${stableKey([
      contract.id,
      providerContinuationContract.continuationId,
      tenantBoundaryState.tenantId,
      tenantBoundaryState.workspaceId,
      audienceBindings.map((binding) => [binding.mount, binding.acceptedForSyscallDispatch]),
    ])}`,
    provider: "mailchimp",
    providerService: providerContinuationContract.providerService,
    tenantId: tenantBoundaryState.tenantId,
    workspaceId: tenantBoundaryState.workspaceId,
    audienceId: contract.audienceId || contract.providerServiceContract?.audienceId || null,
    segmentId: contract.segmentId || contract.providerServiceContract?.segmentId || null,
    status: audienceBlockedBy.length
      ? "blocked"
      : audiencePendingBy.length
        ? "pending"
        : audienceBindings.length
          ? "release-ready"
          : "not-required",
    releaseReady: audienceBindings.length === 0
      || (audienceBlockedBy.length === 0 && audiencePendingBy.length === 0),
    acceptedForProviderSync: audienceBindings.length === 0
      || audienceBindings.every((binding) => binding.acceptedForProviderSync),
    acceptedForSyscallDispatch: audienceBindings.length === 0
      || audienceBindings.every((binding) => binding.acceptedForSyscallDispatch),
    restartSafe: audienceBindings.every((binding) => binding.restartSafe !== false)
      && providerServiceContract.externalHandoffState.restartSafe !== false,
    statusChannel: audienceBindings.length
      ? "memory.provider-audience.mailchimp"
      : "memory.provider-audience.mailchimp.not-required",
    bindingRows: audienceBindings,
    blockedBy: audienceBlockedBy,
    pendingBy: audiencePendingBy,
    commands: [
      {
        command: "persist-memory-provider-audience-contract",
        enabled: true,
        idempotencyKey: `memory-provider-audience:${providerContinuationContract.continuationId}`,
      },
      {
        command: "hydrate-memory-audience-cursor",
        enabled: audienceBindings.some((binding) => binding.blockedBy.includes("audience-cursor:missing")),
        mounts: audienceBindings
          .filter((binding) => binding.blockedBy.includes("audience-cursor:missing"))
          .map((binding) => binding.mount),
      },
      {
        command: "release-memory-provider-audience-contract",
        enabled: audienceBlockedBy.length === 0 && audiencePendingBy.length === 0 && audienceBindings.length > 0,
        idempotencyKey: `memory-provider-audience-release:${providerContinuationContract.continuationId}`,
      },
    ],
    nextAction: audienceBlockedBy.length
      ? audienceBlockedBy[0].includes("audience-cursor:missing")
        ? "hydrate-memory-audience-cursor"
        : "repair-memory-provider-audience-contract"
      : audiencePendingBy.length
        ? providerHealthHandoff.retryable
          ? providerHealthHandoff.nextAction
          : "wait-for-memory-provider-audience-release"
        : audienceBindings.length
          ? "release-memory-provider-audience-contract"
          : "continue-local-runtime",
  };

  return {
    format: "aios.mailchimp.memory.providerHandoff.v1",
    packetId: `memory-provider-handoff:${stableKey([
      contract.id,
      providerContinuationContract.continuationId,
      workflowControlPacket.packetId,
      status,
    ])}`,
    provider: "mailchimp",
    providerService: providerContinuationContract.providerService,
    providerServiceContract,
    providerHealthHandoff,
    providerAudienceContract,
    status,
    releaseReady: releaseReady && providerAudienceContract.releaseReady !== false,
    acceptedForRuntime: runtimeReady,
    acceptedForProviderSync: releaseReady
      && providerServiceContract.externalHandoffState.acceptedForProviderSync
      && providerAudienceContract.acceptedForProviderSync,
    acceptedForSyscallDispatch: providerServiceContract.externalHandoffState.acceptedForSyscallDispatch
      && providerAudienceContract.acceptedForSyscallDispatch,
    restartSafe: status !== "blocked"
      && statusGates.every((gate) => gate.restartSafe !== false)
      && mountContracts.every((mount) => mount.restartSafe !== false)
      && providerServiceContract.externalHandoffState.restartSafe
      && providerAudienceContract.restartSafe,
    stateKey: clientRuntimeAdoptionState.stateKey,
    continuationToken: clientRuntimeAdoptionState.continuationToken,
    continuationId: providerContinuationContract.continuationId,
    controlPlaneId: controlPlaneState.controlPlaneId,
    workflowControlPacketId: workflowControlPacket.packetId,
    downstreamPacketId: downstreamStatusPacket.packetId,
    tenantAuditId: tenantBoundaryState.auditId,
    syncMetadata: {
      statusChannel: releaseReady
        ? "memory.provider-handoff.mailchimp.ready"
        : controlPlaneState.statusChannel,
      cursorPaths: providerContinuationContract.syncMetadata.cursorPaths,
      scheduleId: providerContinuationContract.syncMetadata.scheduleId,
      intervalSeconds: providerContinuationContract.syncMetadata.intervalSeconds,
      negotiatedCapabilities: providerContinuationContract.capabilityNegotiation.negotiatedCapabilities,
      missingCapabilities: providerContinuationContract.capabilityNegotiation.missingCapabilities,
      healthStatus: providerHealthHandoff.status,
      healthPacketId: providerHealthHandoff.packetId,
      audienceContractId: providerAudienceContract.contractId,
      audienceStatus: providerAudienceContract.status,
    },
    mountContracts,
    serviceBindingRows,
    gates: statusGates,
    blockedBy: [...failedChecks, ...serviceBlockedBy, ...healthBlockedBy, ...audienceBlockedBy].sort(),
    pendingBy: [...pendingChecks, ...healthPendingBy, ...audiencePendingBy].sort(),
    commands: [
      {
        command: "persist-memory-provider-handoff",
        enabled: true,
        idempotencyKey: `memory-provider-handoff:${providerContinuationContract.continuationId}`,
      },
      {
        command: "publish-memory-provider-handoff-status",
        enabled: status !== "blocked",
        statusChannel: releaseReady
          ? "memory.provider-handoff.mailchimp.ready"
          : controlPlaneState.statusChannel,
        idempotencyKey: `memory-provider-handoff-status:${workflowControlPacket.packetId}`,
      },
      {
        command: "release-memory-provider-handoff",
        enabled: releaseReady && providerAudienceContract.acceptedForProviderSync,
        continuationToken: clientRuntimeAdoptionState.continuationToken,
        idempotencyKey: `memory-provider-handoff-release:${providerContinuationContract.continuationId}`,
      },
      {
        command: "persist-memory-provider-service-contract",
        enabled: true,
        providerServiceContractId: providerServiceContract.contractId,
        idempotencyKey: `memory-provider-service-contract:${providerServiceContract.contractId}`,
      },
      {
        command: "release-memory-provider-service-contract",
        enabled: providerServiceContract.externalHandoffState.acceptedForSyscallDispatch,
        providerServiceContractId: providerServiceContract.contractId,
        idempotencyKey: `memory-provider-service-release:${providerServiceContract.contractId}`,
      },
      ...providerHealthHandoff.commands,
      ...providerAudienceContract.commands,
    ],
    nextAction: audienceBlockedBy.length || audiencePendingBy.length
      ? providerAudienceContract.nextAction
      : serviceBlockedBy.length
      ? "repair-memory-provider-service-binding"
      : !providerHealthReady
        ? providerHealthHandoff.nextAction
      : failedChecks.length
      ? statusGates.find((gate) => gate.blockedBy.length)?.nextAction || controlPlaneState.nextAction
      : pendingChecks.length
        ? statusGates.find((gate) => gate.pendingBy.length)?.nextAction || workflowControlPacket.nextAction
        : releaseReady
          ? "release-memory-provider-service-contract"
          : runtimeReady
            ? "publish-memory-provider-handoff-status"
      : workflowControlPacket.nextAction,
  };
}

function buildMemoryProviderAssertionDigest(
  contract,
  mounts,
  tenantBoundaryState,
  boundaryLeasePacket,
  providerHandoffEnvelope,
  operatorResumePacket,
  releaseEvidenceLedger,
  syscallDispatchGate,
) {
  const leaseRows = new Map(asList(boundaryLeasePacket.leaseRows).map((row) => [row.mount, row]));
  const serviceRows = new Map(asList(providerHandoffEnvelope.serviceBindingRows).map((row) => [row.mount, row]));
  const mountContracts = new Map(asList(providerHandoffEnvelope.mountContracts).map((row) => [row.mount, row]));
  const scopedMounts = new Map(asList(tenantBoundaryState.scopedMounts).map((row) => [row.mount, row]));
  const negotiatedCapabilities = new Set(asList(providerHandoffEnvelope.syncMetadata?.negotiatedCapabilities));
  const assertionRows = mounts.map((mount) => {
    const lease = leaseRows.get(mount.mount) || {};
    const service = serviceRows.get(mount.mount) || {};
    const contractRow = mountContracts.get(mount.mount) || {};
    const scoped = scopedMounts.get(mount.mount) || {};
    const selectedForProviderSync = service.selectedForProviderSync === true
      || contractRow.selectedForProviderSync === true
      || boundaryLeasePacket.leaseRows?.some((row) => row.mount === mount.mount && row.providerSyncRequested === true);
    const requiredCapabilities = [...new Set([
      ...asList(mount.requiredCapabilities),
      ...asList(service.requiredCapabilities),
      ...asList(contractRow.requiredCapabilities),
    ])].sort();
    const missingCapabilities = requiredCapabilities
      .filter((capability) => selectedForProviderSync && !negotiatedCapabilities.has(capability))
      .sort();
    const tenantMismatch = Boolean(
      tenantBoundaryState.tenantId
        && (scoped.tenantId || lease.tenantId)
        && (scoped.tenantId || lease.tenantId) !== tenantBoundaryState.tenantId,
    );
    const workspaceMismatch = Boolean(
      tenantBoundaryState.workspaceId
        && (scoped.workspaceId || lease.workspaceId)
        && (scoped.workspaceId || lease.workspaceId) !== tenantBoundaryState.workspaceId,
    );
    const blockedBy = [
      ...asList(scoped.blockedBy).map((blocker) => `tenant:${blocker}`),
      ...asList(lease.blockedBy).map((blocker) => `lease:${blocker}`),
      ...asList(service.blockedBy).map((blocker) => `service:${blocker}`),
      ...missingCapabilities.map((capability) => `capability:${capability}`),
      ...(tenantMismatch ? ["tenant:assertion-mismatch"] : []),
      ...(workspaceMismatch ? ["workspace:assertion-mismatch"] : []),
      ...(selectedForProviderSync && !contractRow.recoveryCursor ? ["cursor:missing"] : []),
    ].filter((item, index, items) => items.indexOf(item) === index).sort();
    const pendingBy = [
      ...asList(lease.pendingBy).map((pending) => `lease:${pending}`),
      ...asList(service.pendingBy).map((pending) => `service:${pending}`),
      ...(selectedForProviderSync && lease.releaseReady !== true && blockedBy.length === 0
        ? ["lease:awaiting-release"]
        : []),
      ...(selectedForProviderSync && service.status === "awaiting-release" && blockedBy.length === 0
        ? ["service:awaiting-release"]
        : []),
    ].filter((item, index, items) => items.indexOf(item) === index).sort();
    const verified = blockedBy.length === 0
      && pendingBy.length === 0
      && (!selectedForProviderSync || (
        lease.releaseReady === true
        && service.restartSafe !== false
        && contractRow.restartSafe !== false
      ));

    return {
      mount: mount.mount,
      tenantId: scoped.tenantId || lease.tenantId || tenantBoundaryState.tenantId,
      workspaceId: scoped.workspaceId || lease.workspaceId || tenantBoundaryState.workspaceId,
      selectedForProviderSync,
      stagedWriteback: contractRow.stagedWriteback === true || service.stagedWriteback === true,
      requiredCapabilities,
      negotiatedCapabilities: requiredCapabilities.filter((capability) => negotiatedCapabilities.has(capability)),
      missingCapabilities,
      leaseId: lease.leaseId || null,
      serviceStatusPath: service.statusPath || null,
      recoveryCursor: contractRow.recoveryCursor || service.cursorPath || null,
      restartSafe: lease.restartSafe !== false && service.restartSafe !== false && contractRow.restartSafe !== false,
      status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : verified ? "verified" : "observing",
      blockedBy,
      pendingBy,
      nextAction: blockedBy.length
        ? "repair-memory-provider-assertion"
        : pendingBy.length
          ? "wait-for-memory-provider-assertion"
          : selectedForProviderSync
            ? "release-memory-provider-assertion"
            : "continue-local-runtime",
    };
  });
  const blockedBy = [
    ...asList(providerHandoffEnvelope.blockedBy).map((blocker) => `provider:${blocker}`),
    ...asList(boundaryLeasePacket.blockedBy).map((blocker) => `lease:${blocker}`),
    ...assertionRows.flatMap((row) => row.blockedBy.map((blocker) => `${row.mount}:${blocker}`)),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const pendingBy = [
    ...asList(providerHandoffEnvelope.pendingBy).map((pending) => `provider:${pending}`),
    ...asList(boundaryLeasePacket.pendingBy).map((pending) => `lease:${pending}`),
    ...assertionRows.flatMap((row) => row.pendingBy.map((pending) => `${row.mount}:${pending}`)),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const acceptedForSyscallDispatch = blockedBy.length === 0
    && pendingBy.length === 0
    && providerHandoffEnvelope.acceptedForSyscallDispatch === true
    && operatorResumePacket.acceptedForProviderSync === true
    && releaseEvidenceLedger.releaseReady === true
    && syscallDispatchGate.acceptedForSyscallDispatch === true;
  const restartSafe = assertionRows.every((row) => row.restartSafe !== false)
    && providerHandoffEnvelope.restartSafe === true
    && releaseEvidenceLedger.restartSafe === true
    && syscallDispatchGate.restartSafe === true;

  return {
    format: "aios.mailchimp.memory.providerAssertionDigest.v1",
    digestId: `memory-provider-assertions:${stableKey([
      contract.id,
      providerHandoffEnvelope.packetId,
      boundaryLeasePacket.packetId,
      assertionRows.map((row) => [row.mount, row.status]),
    ])}`,
    provider: "mailchimp",
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : acceptedForSyscallDispatch ? "verified" : "observing",
    acceptedForProviderSync: providerHandoffEnvelope.acceptedForProviderSync === true && blockedBy.length === 0,
    acceptedForSyscallDispatch,
    restartSafe,
    tenantAuditId: tenantBoundaryState.auditId,
    providerHandoffPacketId: providerHandoffEnvelope.packetId,
    boundaryLeasePacketId: boundaryLeasePacket.packetId,
    releaseLedgerId: releaseEvidenceLedger.ledgerId,
    syscallDispatchGateId: syscallDispatchGate.gateId,
    assertionRows,
    counters: {
      mounts: assertionRows.length,
      providerSyncMounts: assertionRows.filter((row) => row.selectedForProviderSync).length,
      verifiedRows: assertionRows.filter((row) => row.status === "verified").length,
      blockedRows: assertionRows.filter((row) => row.status === "blocked").length,
      pendingRows: assertionRows.filter((row) => row.status === "pending").length,
      missingCapabilities: assertionRows.reduce((total, row) => total + row.missingCapabilities.length, 0),
    },
    blockedBy,
    pendingBy,
    commands: [
      {
        command: "persist-memory-provider-assertion-digest",
        enabled: true,
        idempotencyKey: `memory-provider-assertions:${providerHandoffEnvelope.packetId}`,
      },
      {
        command: "release-memory-provider-assertions",
        enabled: acceptedForSyscallDispatch,
        idempotencyKey: `memory-provider-assertion-release:${syscallDispatchGate.gateId}`,
      },
    ],
    nextAction: blockedBy.length
      ? "repair-memory-provider-assertion"
      : pendingBy.length
        ? "wait-for-memory-provider-assertion"
        : acceptedForSyscallDispatch
          ? "release-memory-provider-assertions"
      : syscallDispatchGate.nextAction,
  };
}

function buildMemoryOperatorReleasePacket(
  contract,
  controlPlaneState,
  clientWorkflowHandoffPacket,
  boundaryLeasePacket,
  providerHandoffEnvelope,
  operatorResumePacket,
  releaseEvidenceLedger,
  syscallDispatchGate,
  providerAssertionDigest,
  releaseRiskBudget,
  restartStatusLedger,
) {
  const gateRows = [
    {
      gate: "control-plane",
      packetId: controlPlaneState.controlPlaneId,
      status: controlPlaneState.status,
      accepted: controlPlaneState.persistedState?.acceptedForProviderSync === true,
      restartSafe: controlPlaneState.persistedState?.restartSafe !== false,
      blockedBy: asList(controlPlaneState.blockedBy).map((blocker) => `control:${blocker}`),
      pendingBy: asList(controlPlaneState.pendingBy).map((pending) => `control:${pending}`),
      nextAction: controlPlaneState.nextAction,
    },
    {
      gate: "client-workflow",
      packetId: clientWorkflowHandoffPacket.packetId,
      status: clientWorkflowHandoffPacket.status,
      accepted: clientWorkflowHandoffPacket.acceptedForProviderSync === true,
      restartSafe: clientWorkflowHandoffPacket.restartSafe !== false
        && clientWorkflowHandoffPacket.releaseReceipt?.restartSafe !== false,
      blockedBy: [
        ...asList(clientWorkflowHandoffPacket.blockedBy).map((blocker) => `client-workflow:${blocker}`),
        ...asList(clientWorkflowHandoffPacket.releaseReceipt?.blockedBy)
          .map((blocker) => `client-workflow-receipt:${blocker}`),
      ].sort(),
      pendingBy: [
        ...asList(clientWorkflowHandoffPacket.pendingBy).map((pending) => `client-workflow:${pending}`),
        ...asList(clientWorkflowHandoffPacket.releaseReceipt?.pendingBy)
          .map((pending) => `client-workflow-receipt:${pending}`),
      ].sort(),
      nextAction: clientWorkflowHandoffPacket.nextAction,
    },
    {
      gate: "boundary-lease",
      packetId: boundaryLeasePacket.packetId,
      status: boundaryLeasePacket.status,
      accepted: boundaryLeasePacket.acceptedForProviderSync === true,
      restartSafe: boundaryLeasePacket.restartSafe !== false,
      blockedBy: asList(boundaryLeasePacket.blockedBy).map((blocker) => `boundary-lease:${blocker}`),
      pendingBy: asList(boundaryLeasePacket.pendingBy).map((pending) => `boundary-lease:${pending}`),
      nextAction: boundaryLeasePacket.nextAction,
    },
    {
      gate: "provider-handoff",
      packetId: providerHandoffEnvelope.packetId,
      status: providerHandoffEnvelope.status,
      accepted: providerHandoffEnvelope.acceptedForSyscallDispatch === true,
      restartSafe: providerHandoffEnvelope.restartSafe !== false,
      blockedBy: asList(providerHandoffEnvelope.blockedBy).map((blocker) => `provider-handoff:${blocker}`),
      pendingBy: asList(providerHandoffEnvelope.pendingBy).map((pending) => `provider-handoff:${pending}`),
      nextAction: providerHandoffEnvelope.nextAction,
    },
    {
      gate: "operator-resume",
      packetId: operatorResumePacket.packetId,
      status: operatorResumePacket.status,
      accepted: operatorResumePacket.acceptedForProviderSync === true,
      restartSafe: operatorResumePacket.restartSafe !== false,
      blockedBy: asList(operatorResumePacket.blockedBy).map((blocker) => `operator-resume:${blocker}`),
      pendingBy: asList(operatorResumePacket.pendingBy).map((pending) => `operator-resume:${pending}`),
      nextAction: operatorResumePacket.nextAction,
    },
    {
      gate: "release-evidence",
      packetId: releaseEvidenceLedger.ledgerId,
      status: releaseEvidenceLedger.status,
      accepted: releaseEvidenceLedger.releaseReady === true,
      restartSafe: releaseEvidenceLedger.restartSafe !== false,
      blockedBy: asList(releaseEvidenceLedger.blockedBy).map((blocker) => `release-evidence:${blocker}`),
      pendingBy: asList(releaseEvidenceLedger.pendingBy).map((pending) => `release-evidence:${pending}`),
      nextAction: releaseEvidenceLedger.nextAction,
    },
    {
      gate: "syscall-dispatch",
      packetId: syscallDispatchGate.gateId,
      status: syscallDispatchGate.status,
      accepted: syscallDispatchGate.acceptedForSyscallDispatch === true,
      restartSafe: syscallDispatchGate.restartSafe !== false,
      blockedBy: asList(syscallDispatchGate.blockedBy).map((blocker) => `syscall-dispatch:${blocker}`),
      pendingBy: asList(syscallDispatchGate.pendingBy).map((pending) => `syscall-dispatch:${pending}`),
      nextAction: syscallDispatchGate.nextAction,
    },
    {
      gate: "provider-assertions",
      packetId: providerAssertionDigest.digestId,
      status: providerAssertionDigest.status,
      accepted: providerAssertionDigest.acceptedForSyscallDispatch === true,
      restartSafe: providerAssertionDigest.restartSafe !== false,
      blockedBy: asList(providerAssertionDigest.blockedBy).map((blocker) => `provider-assertions:${blocker}`),
      pendingBy: asList(providerAssertionDigest.pendingBy).map((pending) => `provider-assertions:${pending}`),
      nextAction: providerAssertionDigest.nextAction,
    },
    {
      gate: "release-risk",
      packetId: releaseRiskBudget.budgetId,
      status: releaseRiskBudget.status,
      accepted: releaseRiskBudget.acceptedForSyscallDispatch === true
        && releaseRiskBudget.releaseReady === true,
      restartSafe: releaseRiskBudget.restartSafe !== false,
      blockedBy: asList(releaseRiskBudget.blockedBy).map((blocker) => `release-risk:${blocker}`),
      pendingBy: asList(releaseRiskBudget.pendingBy).map((pending) => `release-risk:${pending}`),
      nextAction: releaseRiskBudget.nextAction,
    },
    {
      gate: "restart-ledger",
      packetId: restartStatusLedger.ledgerId,
      status: restartStatusLedger.status,
      accepted: restartStatusLedger.restartSafe === true && restartStatusLedger.status !== "blocked",
      restartSafe: restartStatusLedger.restartSafe !== false,
      blockedBy: asList(restartStatusLedger.blockedBy).map((blocker) => `restart-ledger:${blocker}`),
      pendingBy: asList(restartStatusLedger.pendingBy).map((pending) => `restart-ledger:${pending}`),
      nextAction: restartStatusLedger.nextAction,
    },
  ];
  const blockedBy = [...new Set(gateRows.flatMap((gate) => gate.blockedBy))].sort();
  const pendingBy = [...new Set(gateRows.flatMap((gate) => gate.pendingBy))].sort();
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && gateRows.every((gate) => gate.accepted === true);
  const restartSafe = gateRows.every((gate) => gate.restartSafe !== false);
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : releaseReady
        ? "syscall-dispatch-ready"
        : "waiting";
  const packetId = `memory-operator-release:${stableKey([
    contract.id,
    gateRows.map((gate) => [gate.gate, gate.status, gate.accepted]),
    status,
  ])}`;

  return {
    format: "aios.mailchimp.memory.operatorRelease.v1",
    packetId,
    provider: "mailchimp",
    status,
    releaseReady,
    acceptedForProviderSync: releaseReady,
    acceptedForSyscallDispatch: releaseReady,
    restartSafe,
    statusChannel: releaseReady
      ? "memory.operator-release.mailchimp.syscall-dispatch-ready"
      : "memory.operator-release.mailchimp",
    blockedBy,
    pendingBy,
    gateRows,
    commands: [
      {
        command: "persist-memory-operator-release",
        enabled: true,
        idempotencyKey: `memory-operator-release:${packetId}`,
      },
      {
        command: "publish-memory-operator-release-status",
        enabled: blockedBy.length === 0,
        statusChannel: releaseReady
          ? "memory.operator-release.mailchimp.syscall-dispatch-ready"
          : "memory.operator-release.mailchimp",
        idempotencyKey: `memory-operator-release-status:${packetId}`,
      },
      {
        command: "release-memory-operator-syscall-dispatch",
        enabled: releaseReady,
        idempotencyKey: `memory-operator-syscall-dispatch:${packetId}`,
      },
    ],
    payloadShape: {
      packetId: "string",
      status: "string",
      acceptedForProviderSync: "boolean",
      acceptedForSyscallDispatch: "boolean",
      restartSafe: "boolean",
      gateRows: "array",
      blockedBy: "array",
      pendingBy: "array",
      commands: "array",
    },
    nextAction: blockedBy.length
      ? gateRows.find((gate) => gate.blockedBy.length)?.nextAction || "repair-memory-operator-release"
      : pendingBy.length
        ? gateRows.find((gate) => gate.pendingBy.length)?.nextAction || "wait-for-memory-operator-release"
        : releaseReady
          ? "release-memory-operator-syscall-dispatch"
          : restartStatusLedger.nextAction,
  };
}

function buildMemoryOperatorResumePacket(
  contract,
  previewAcceptancePackage,
  clientRuntimeAdoptionState,
  operationalHealthState,
  downstreamStatusPacket,
  controlPlaneState,
  workflowControlPacket,
  providerHandoffEnvelope,
  memoryExportManifest,
) {
  const gates = [
    {
      gate: "preview-acceptance",
      status: previewAcceptancePackage.readiness.status,
      accepted: previewAcceptancePackage.acceptance.acceptedForRuntime === true,
      restartSafe: true,
      packetId: previewAcceptancePackage.packageId,
      blockedBy: asList(previewAcceptancePackage.acceptance.blockedBy).map((blocker) => `acceptance:${blocker}`),
      pendingBy: asList(previewAcceptancePackage.readiness.pendingChecks).map((check) => `readiness:${check}`),
      nextAction: previewAcceptancePackage.acceptance.nextAction,
    },
    {
      gate: "client-runtime",
      status: clientRuntimeAdoptionState.status,
      accepted: clientRuntimeAdoptionState.acceptedForRuntime === true,
      restartSafe: clientRuntimeAdoptionState.hydrated === true,
      packetId: clientRuntimeAdoptionState.adoptionId,
      blockedBy: clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
      pendingBy: [],
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      gate: "operational-health",
      status: operationalHealthState.status,
      accepted: operationalHealthState.status === "healthy",
      restartSafe: operationalHealthState.status !== "failed",
      packetId: operationalHealthState.healthId,
      blockedBy: operationalHealthState.incidents
        .filter((incident) => incident.severity === "error")
        .map((incident) => `health:${incident.code}`),
      pendingBy: operationalHealthState.retryable ? ["health:retry-scheduled"] : [],
      nextAction: operationalHealthState.nextAction,
    },
    {
      gate: "workflow-control",
      status: workflowControlPacket.status,
      accepted: workflowControlPacket.releaseReady === true,
      restartSafe: controlPlaneState.persistedState.restartSafe === true,
      packetId: workflowControlPacket.packetId,
      blockedBy: asList(workflowControlPacket.blockedBy).map((blocker) => `workflow:${blocker}`),
      pendingBy: asList(workflowControlPacket.pendingBy).map((pending) => `workflow:${pending}`),
      nextAction: workflowControlPacket.nextAction,
    },
    {
      gate: "provider-handoff",
      status: providerHandoffEnvelope.status,
      accepted: providerHandoffEnvelope.acceptedForProviderSync === true,
      restartSafe: providerHandoffEnvelope.restartSafe === true,
      packetId: providerHandoffEnvelope.packetId,
      blockedBy: asList(providerHandoffEnvelope.blockedBy).map((blocker) => `provider:${blocker}`),
      pendingBy: asList(providerHandoffEnvelope.pendingBy).map((pending) => `provider:${pending}`),
      nextAction: providerHandoffEnvelope.nextAction,
    },
  ];
  const blockedBy = [...new Set(gates.flatMap((gate) => gate.blockedBy))].sort();
  const pendingBy = [...new Set(gates.flatMap((gate) => gate.pendingBy))].sort();
  const providerSyncReady = blockedBy.length === 0
    && pendingBy.length === 0
    && providerHandoffEnvelope.acceptedForProviderSync === true
    && gates.every((gate) => gate.restartSafe !== false);
  const runtimeReady = blockedBy.length === 0
    && clientRuntimeAdoptionState.acceptedForRuntime === true
    && downstreamStatusPacket.acceptedForDownstream === true;
  const resumeStatus = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : providerSyncReady
        ? "provider-sync-ready"
        : runtimeReady
          ? "runtime-ready"
          : "waiting";
  const currentGate = gates.find((gate) => gate.blockedBy.length)
    || gates.find((gate) => gate.pendingBy.length)
    || gates.find((gate) => gate.accepted !== true)
    || gates.at(-1);

  return {
    format: "aios.mailchimp.memory.operatorResume.v1",
    packetId: `memory-operator-resume:${stableKey([
      contract.id,
      providerHandoffEnvelope.packetId,
      memoryExportManifest.manifestId,
      resumeStatus,
    ])}`,
    provider: "mailchimp",
    status: resumeStatus,
    releaseReady: providerSyncReady,
    acceptedForRuntime: runtimeReady,
    acceptedForProviderSync: providerSyncReady,
    restartSafe: gates.every((gate) => gate.restartSafe !== false),
    stateKey: clientRuntimeAdoptionState.stateKey,
    continuationToken: clientRuntimeAdoptionState.continuationToken,
    previewId: previewAcceptancePackage.preview.previewId,
    acceptanceId: previewAcceptancePackage.acceptance.acceptanceId,
    controlPlaneId: controlPlaneState.controlPlaneId,
    workflowControlPacketId: workflowControlPacket.packetId,
    providerHandoffPacketId: providerHandoffEnvelope.packetId,
    exportManifestId: memoryExportManifest.manifestId,
    statusChannel: providerSyncReady
      ? "memory.operator-resume.mailchimp.ready"
      : controlPlaneState.statusChannel,
    gates,
    blockedBy,
    pendingBy,
    operatorCards: gates.map((gate, index) => ({
      index,
      card: gate.gate,
      status: gate.status,
      accepted: gate.accepted,
      restartSafe: gate.restartSafe,
      packetId: gate.packetId,
      nextAction: gate.nextAction,
    })),
    commands: [
      {
        command: "persist-memory-operator-resume",
        enabled: true,
        idempotencyKey: `memory-operator-resume:${providerHandoffEnvelope.packetId}`,
      },
      {
        command: "publish-memory-operator-resume",
        enabled: blockedBy.length === 0,
        statusChannel: providerSyncReady
          ? "memory.operator-resume.mailchimp.ready"
          : controlPlaneState.statusChannel,
        idempotencyKey: `memory-operator-resume-publish:${workflowControlPacket.packetId}`,
      },
      {
        command: "release-memory-provider-sync-from-resume",
        enabled: providerSyncReady,
        continuationToken: clientRuntimeAdoptionState.continuationToken,
        idempotencyKey: `memory-operator-resume-release:${providerHandoffEnvelope.packetId}`,
      },
    ],
    nextAction: blockedBy.length
      ? currentGate?.nextAction || "repair-memory-operator-resume"
      : pendingBy.length
        ? currentGate?.nextAction || "wait-for-memory-operator-resume"
        : providerSyncReady
          ? "release-memory-provider-sync-from-resume"
          : runtimeReady
            ? "publish-memory-operator-resume"
            : currentGate?.nextAction || "review-memory-operator-resume",
  };
}

function buildMemoryReleaseEvidenceLedger(
  contract,
  mounts,
  analytics,
  clientRuntimeAdoptionState,
  operationalHealthState,
  downstreamStatusPacket,
  controlPlaneState,
  workflowControlPacket,
  providerHandoffEnvelope,
  operatorResumePacket,
  memoryExportManifest,
) {
  const releaseGates = [
    {
      gate: "client-runtime",
      packetId: clientRuntimeAdoptionState.adoptionId,
      status: clientRuntimeAdoptionState.status,
      accepted: clientRuntimeAdoptionState.acceptedForRuntime === true,
      restartSafe: clientRuntimeAdoptionState.hydrated === true,
      blockedBy: clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
      pendingBy: [],
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      gate: "health",
      packetId: operationalHealthState.healthId,
      status: operationalHealthState.status,
      accepted: operationalHealthState.status === "healthy",
      restartSafe: operationalHealthState.status !== "failed",
      blockedBy: operationalHealthState.incidents
        .filter((incident) => incident.severity === "error")
        .map((incident) => `health:${incident.code}`),
      pendingBy: operationalHealthState.retryable ? ["health:retry-scheduled"] : [],
      nextAction: operationalHealthState.nextAction,
    },
    {
      gate: "downstream-status",
      packetId: downstreamStatusPacket.packetId,
      status: downstreamStatusPacket.status,
      accepted: downstreamStatusPacket.acceptedForDownstream === true,
      restartSafe: downstreamStatusPacket.restartSafe === true,
      blockedBy: asList(downstreamStatusPacket.blockedBy).map((blocker) => `downstream:${blocker}`),
      pendingBy: asList(downstreamStatusPacket.pendingBy).map((pending) => `downstream:${pending}`),
      nextAction: downstreamStatusPacket.nextAction,
    },
    {
      gate: "control-plane",
      packetId: controlPlaneState.controlPlaneId,
      status: controlPlaneState.status,
      accepted: controlPlaneState.persistedState.acceptedForRuntime === true,
      restartSafe: controlPlaneState.persistedState.restartSafe === true,
      blockedBy: asList(controlPlaneState.blockedBy).map((blocker) => `control:${blocker}`),
      pendingBy: asList(controlPlaneState.pendingBy).map((pending) => `control:${pending}`),
      nextAction: controlPlaneState.nextAction,
    },
    {
      gate: "workflow-control",
      packetId: workflowControlPacket.packetId,
      status: workflowControlPacket.status,
      accepted: workflowControlPacket.releaseReady === true,
      restartSafe: controlPlaneState.persistedState.restartSafe === true,
      blockedBy: asList(workflowControlPacket.blockedBy).map((blocker) => `workflow:${blocker}`),
      pendingBy: asList(workflowControlPacket.pendingBy).map((pending) => `workflow:${pending}`),
      nextAction: workflowControlPacket.nextAction,
    },
    {
      gate: "provider-handoff",
      packetId: providerHandoffEnvelope.packetId,
      status: providerHandoffEnvelope.status,
      accepted: providerHandoffEnvelope.acceptedForProviderSync === true,
      restartSafe: providerHandoffEnvelope.restartSafe === true,
      blockedBy: asList(providerHandoffEnvelope.blockedBy).map((blocker) => `provider:${blocker}`),
      pendingBy: asList(providerHandoffEnvelope.pendingBy).map((pending) => `provider:${pending}`),
      nextAction: providerHandoffEnvelope.nextAction,
    },
    {
      gate: "operator-resume",
      packetId: operatorResumePacket.packetId,
      status: operatorResumePacket.status,
      accepted: operatorResumePacket.acceptedForRuntime === true || operatorResumePacket.acceptedForProviderSync === true,
      restartSafe: operatorResumePacket.restartSafe === true,
      blockedBy: asList(operatorResumePacket.blockedBy).map((blocker) => `resume:${blocker}`),
      pendingBy: asList(operatorResumePacket.pendingBy).map((pending) => `resume:${pending}`),
      nextAction: operatorResumePacket.nextAction,
    },
  ];
  const blockedBy = [...new Set(releaseGates.flatMap((gate) => gate.blockedBy))].sort();
  const pendingBy = [...new Set(releaseGates.flatMap((gate) => gate.pendingBy))].sort();
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && operatorResumePacket.acceptedForProviderSync === true
    && providerHandoffEnvelope.acceptedForProviderSync === true;
  const replayCursors = [
    clientRuntimeAdoptionState.continuationToken,
    ...asList(providerHandoffEnvelope.syncMetadata?.cursorPaths),
    ...mounts.map((mount) => mount.handoff.recoveryCursor).filter(Boolean),
  ].filter((cursor, index, cursors) => cursor && cursors.indexOf(cursor) === index).sort();
  const releaseCommands = [
    ...asList(clientRuntimeAdoptionState.routeCommands),
    ...asList(downstreamStatusPacket.commands),
    ...asList(controlPlaneState.commands),
    ...asList(workflowControlPacket.commands),
    ...asList(providerHandoffEnvelope.commands),
    ...asList(operatorResumePacket.commands),
  ].map((command) => ({
    command: command.command,
    enabled: command.enabled === true,
    idempotencyKey: command.idempotencyKey || null,
    statusChannel: command.statusChannel || null,
  }));
  const nextGate = releaseGates.find((gate) => gate.blockedBy.length)
    || releaseGates.find((gate) => gate.pendingBy.length)
    || releaseGates.find((gate) => gate.accepted !== true)
    || releaseGates.at(-1);
  const status = blockedBy.length ? "blocked" : pendingBy.length ? "pending" : releaseReady ? "release-ready" : "observing";

  return {
    format: "aios.mailchimp.memory.releaseEvidenceLedger.v1",
    ledgerId: `memory-release-ledger:${stableKey([
      contract.id,
      providerHandoffEnvelope.packetId,
      operatorResumePacket.packetId,
      status,
    ])}`,
    provider: "mailchimp",
    status,
    releaseReady,
    restartSafe: releaseGates.every((gate) => gate.restartSafe !== false),
    exportManifestId: memoryExportManifest.manifestId,
    providerHandoffPacketId: providerHandoffEnvelope.packetId,
    operatorResumePacketId: operatorResumePacket.packetId,
    replayCursors,
    releaseGates,
    counters: {
      mounts: analytics.counters.mountsTotal,
      providerSyncMounts: analytics.counters.providerSyncMounts,
      stagedWritebacks: analytics.counters.stagedWritebacks,
      blockedGates: releaseGates.filter((gate) => gate.blockedBy.length).length,
      pendingGates: releaseGates.filter((gate) => gate.pendingBy.length).length,
      replayCursors: replayCursors.length,
      idempotentCommands: releaseCommands.filter((command) => command.idempotencyKey).length,
    },
    persistedState: {
      ledgerId: `memory-release-ledger-state:${stableKey([
        clientRuntimeAdoptionState.stateKey,
        providerHandoffEnvelope.packetId,
        operatorResumePacket.packetId,
      ])}`,
      stateKey: clientRuntimeAdoptionState.stateKey,
      continuationToken: clientRuntimeAdoptionState.continuationToken,
      status,
      restartSafe: releaseGates.every((gate) => gate.restartSafe !== false),
      nextAction: releaseReady ? "release-memory-provider-sync-from-ledger" : nextGate?.nextAction,
    },
    commands: [
      {
        command: "persist-memory-release-ledger",
        enabled: true,
        idempotencyKey: `memory-release-ledger:${providerHandoffEnvelope.packetId}`,
      },
      {
        command: "publish-memory-release-evidence",
        enabled: blockedBy.length === 0,
        idempotencyKey: `memory-release-evidence:${operatorResumePacket.packetId}`,
      },
      {
        command: "release-memory-provider-sync-from-ledger",
        enabled: releaseReady,
        idempotencyKey: `memory-release-ledger-release:${providerHandoffEnvelope.packetId}`,
      },
    ],
    blockedBy,
    pendingBy,
    nextAction: releaseReady ? "release-memory-provider-sync-from-ledger" : nextGate?.nextAction,
  };
}

function buildMemoryProviderSyncReleaseReceipt(
  contract,
  providerContinuationContract,
  previewAcceptancePackage,
  clientRuntimeAdoptionState,
  boundaryLeasePacket,
  providerHandoffEnvelope,
  providerAssertionDigest,
  syscallDispatchGate,
  operatorReleasePacket,
) {
  const providerSyncMounts = new Set(providerContinuationContract.externalHandoffState.syncMounts);
  const providerRows = asList(providerHandoffEnvelope.serviceBindingRows);
  const assertionRows = new Map(asList(providerAssertionDigest.assertionRows).map((row) => [row.mount, row]));
  const leaseRows = new Map(asList(boundaryLeasePacket.leaseRows).map((row) => [row.mount, row]));
  const receiptRows = providerRows
    .filter((row) => row.selectedForProviderSync || providerSyncMounts.has(row.mount))
    .map((row) => {
      const assertion = assertionRows.get(row.mount) || {};
      const lease = leaseRows.get(row.mount) || {};
      const blockedBy = [
        ...asList(row.blockedBy).map((blocker) => `service:${blocker}`),
        ...asList(assertion.blockedBy).map((blocker) => `assertion:${blocker}`),
        ...asList(lease.blockedBy).map((blocker) => `lease:${blocker}`),
        ...(row.restartSafe === false ? ["service:restart-unsafe"] : []),
        ...(assertion.restartSafe === false ? ["assertion:restart-unsafe"] : []),
        ...(lease.restartSafe === false ? ["lease:restart-unsafe"] : []),
      ].filter((item, index, items) => items.indexOf(item) === index).sort();
      const pendingBy = [
        ...asList(row.pendingBy).map((pending) => `service:${pending}`),
        ...asList(assertion.pendingBy).map((pending) => `assertion:${pending}`),
        ...(lease.releaseReady === true ? [] : ["lease:release-not-ready"]),
        ...(providerHandoffEnvelope.releaseReady === true ? [] : ["provider-handoff:release-not-ready"]),
      ].filter((item, index, items) => items.indexOf(item) === index).sort();
      const accepted = blockedBy.length === 0
        && pendingBy.length === 0
        && row.status === "handoff-ready"
        && assertion.status === "verified"
        && lease.releaseReady === true;
      return {
        mount: row.mount,
        status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : accepted ? "released" : "waiting",
        accepted,
        restartSafe: row.restartSafe !== false && assertion.restartSafe !== false && lease.restartSafe !== false,
        cursorPath: row.cursorPath || assertion.recoveryCursor || null,
        requiredCapabilities: asList(row.requiredCapabilities),
        negotiatedCapabilities: asList(row.negotiatedCapabilities),
        blockedBy,
        pendingBy,
        nextAction: blockedBy.length
          ? "repair-memory-provider-sync-release"
          : pendingBy.length
            ? "wait-for-memory-provider-sync-release"
            : accepted
              ? "release-memory-provider-sync-receipt"
              : row.nextAction || providerHandoffEnvelope.nextAction,
      };
    });
  const blockedBy = [
    ...asList(providerHandoffEnvelope.blockedBy).map((blocker) => `provider-handoff:${blocker}`),
    ...asList(providerAssertionDigest.blockedBy).map((blocker) => `provider-assertion:${blocker}`),
    ...asList(syscallDispatchGate.blockedBy).map((blocker) => `syscall-gate:${blocker}`),
    ...asList(operatorReleasePacket.blockedBy).map((blocker) => `operator-release:${blocker}`),
    ...receiptRows.flatMap((row) => row.blockedBy.map((blocker) => `${row.mount}:${blocker}`)),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const pendingBy = [
    ...asList(providerHandoffEnvelope.pendingBy).map((pending) => `provider-handoff:${pending}`),
    ...asList(providerAssertionDigest.pendingBy).map((pending) => `provider-assertion:${pending}`),
    ...asList(syscallDispatchGate.pendingBy).map((pending) => `syscall-gate:${pending}`),
    ...asList(operatorReleasePacket.pendingBy).map((pending) => `operator-release:${pending}`),
    ...receiptRows.flatMap((row) => row.pendingBy.map((pending) => `${row.mount}:${pending}`)),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const releaseReady = receiptRows.length > 0
    && receiptRows.every((row) => row.accepted)
    && providerHandoffEnvelope.acceptedForProviderSync === true
    && providerAssertionDigest.acceptedForProviderSync === true
    && syscallDispatchGate.acceptedForSyscallDispatch === true
    && operatorReleasePacket.acceptedForProviderSync === true;
  const restartSafe = releaseReady
    && providerHandoffEnvelope.restartSafe !== false
    && providerAssertionDigest.restartSafe !== false
    && syscallDispatchGate.restartSafe !== false
    && operatorReleasePacket.restartSafe !== false
    && receiptRows.every((row) => row.restartSafe !== false);
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : releaseReady
        ? "released"
        : "waiting";
  const receiptId = `memory-provider-sync-release:${stableKey([
    contract.id,
    providerContinuationContract.continuationId,
    providerHandoffEnvelope.packetId,
    providerAssertionDigest.digestId,
    syscallDispatchGate.gateId,
    operatorReleasePacket.packetId,
    status,
  ])}`;

  return {
    format: "aios.mailchimp.memory.providerSyncReleaseReceipt.v1",
    receiptId,
    provider: "mailchimp",
    providerService: providerContinuationContract.providerService,
    continuationId: providerContinuationContract.continuationId,
    providerHandoffPacketId: providerHandoffEnvelope.packetId,
    providerAssertionDigestId: providerAssertionDigest.digestId,
    syscallDispatchGateId: syscallDispatchGate.gateId,
    operatorReleasePacketId: operatorReleasePacket.packetId,
    previewId: previewAcceptancePackage.preview.previewId,
    acceptanceId: previewAcceptancePackage.acceptance.acceptanceId,
    stateKey: clientRuntimeAdoptionState.stateKey,
    status,
    releaseReady,
    acceptedForProviderSync: releaseReady,
    acceptedForSyscallDispatch: releaseReady && syscallDispatchGate.acceptedForSyscallDispatch === true,
    restartSafe,
    retryable: syscallDispatchGate.retryable === true || operatorReleasePacket.retryable === true,
    nextDelaySeconds: syscallDispatchGate.nextDelaySeconds ?? operatorReleasePacket.nextDelaySeconds ?? null,
    statusChannel: releaseReady
      ? "memory.provider-sync-release.mailchimp.released"
      : "memory.provider-sync-release.mailchimp.pending",
    blockedBy,
    pendingBy,
    receiptRows,
    payloadShape: {
      receiptId: "string",
      continuationId: "string",
      acceptedForProviderSync: "boolean",
      acceptedForSyscallDispatch: "boolean",
      restartSafe: "boolean",
      receiptRows: "array",
      blockedBy: "array",
      pendingBy: "array",
      commands: "array",
    },
    commands: [
      {
        command: "persist-memory-provider-sync-release-receipt",
        enabled: true,
        idempotencyKey: `memory-provider-sync-release:${receiptId}`,
      },
      {
        command: "release-memory-provider-sync-to-syscall",
        enabled: releaseReady,
        receiptId,
        idempotencyKey: `memory-provider-sync-to-syscall:${providerContinuationContract.continuationId}`,
      },
      {
        command: "schedule-memory-provider-sync-release-retry",
        enabled: !releaseReady && (syscallDispatchGate.retryable === true || operatorReleasePacket.retryable === true),
        delaySeconds: syscallDispatchGate.nextDelaySeconds ?? operatorReleasePacket.nextDelaySeconds ?? 60,
        idempotencyKey: `memory-provider-sync-release-retry:${stableKey([
          receiptId,
          syscallDispatchGate.nextDelaySeconds,
          operatorReleasePacket.nextDelaySeconds,
        ])}`,
      },
    ],
    nextAction: blockedBy.length
      ? "repair-memory-provider-sync-release"
      : pendingBy.length
        ? "wait-for-memory-provider-sync-release"
        : releaseReady
          ? "release-memory-provider-sync-to-syscall"
          : providerHandoffEnvelope.nextAction,
  };
}

function buildMemoryAudienceSyncWatermark(
  contract,
  providerContinuationContract,
  providerSyncReleaseReceipt,
  dispatchReleaseLedger,
  clientRuntimeAdoptionState,
  source = {},
  options = {},
) {
  const audienceSource = options.audienceSync
    || source.audienceSync
    || source.providerAudienceSync
    || source.mailchimpAudienceSync
    || {};
  const audienceId = audienceSource.audienceId
    || source.audienceId
    || contract.providerServiceContract?.audienceId
    || null;
  const segmentId = audienceSource.segmentId
    || source.segmentId
    || contract.providerServiceContract?.segmentId
    || null;
  const providerRows = asList(providerSyncReleaseReceipt.receiptRows);
  const dispatchRows = asList(dispatchReleaseLedger.sourceRows);
  const rowWatermarks = providerRows.map((row) => {
    const dispatchRow = dispatchRows.find((item) => item.source === row.mount || item.mount === row.mount) || {};
    const blockedBy = [
      ...asList(row.blockedBy).map((blocker) => `provider-release:${blocker}`),
      ...asList(dispatchRow.blockedBy).map((blocker) => `dispatch-release:${blocker}`),
      ...(row.accepted === true ? [] : ["provider-release:not-accepted"]),
      ...(row.restartSafe === false ? ["provider-release:restart-unsafe"] : []),
      ...(dispatchRow.restartSafe === false ? ["dispatch-release:restart-unsafe"] : []),
    ].sort();
    const pendingBy = [
      ...asList(row.pendingBy).map((pending) => `provider-release:${pending}`),
      ...asList(dispatchRow.pendingBy).map((pending) => `dispatch-release:${pending}`),
      ...(dispatchRow.acceptedForSyscallDispatch === false ? ["dispatch-release:not-accepted"] : []),
    ].sort();
    const releaseReady = blockedBy.length === 0
      && pendingBy.length === 0
      && row.accepted === true
      && row.restartSafe !== false
      && dispatchRow.restartSafe !== false;
    return {
      mount: row.mount || dispatchRow.source || dispatchRow.mount || "unknown",
      audienceId,
      segmentId,
      cursorPath: row.cursorPath || dispatchRow.cursorPath || null,
      watermarkKey: `memory-audience-watermark:${stableKey([
        contract.id,
        providerContinuationContract.continuationId,
        row.mount || dispatchRow.source || dispatchRow.mount,
        row.cursorPath || dispatchRow.cursorPath,
      ])}`,
      status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : releaseReady ? "released" : "waiting",
      releaseReady,
      restartSafe: releaseReady,
      requiredCapabilities: asList(row.requiredCapabilities),
      negotiatedCapabilities: asList(row.negotiatedCapabilities),
      blockedBy,
      pendingBy,
      nextAction: blockedBy.length
        ? "repair-memory-audience-sync-watermark"
        : pendingBy.length
          ? "wait-for-memory-audience-sync-watermark"
          : releaseReady
            ? "persist-memory-audience-sync-watermark"
            : row.nextAction || dispatchRow.nextAction || providerSyncReleaseReceipt.nextAction,
    };
  });
  const blockedBy = [
    ...(audienceId ? [] : ["audience:missing"]),
    ...asList(providerSyncReleaseReceipt.blockedBy).map((blocker) => `provider-release:${blocker}`),
    ...asList(dispatchReleaseLedger.blockedBy).map((blocker) => `dispatch-release:${blocker}`),
    ...rowWatermarks.flatMap((row) => row.blockedBy.map((blocker) => `${row.mount}:${blocker}`)),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const pendingBy = [
    ...asList(providerSyncReleaseReceipt.pendingBy).map((pending) => `provider-release:${pending}`),
    ...asList(dispatchReleaseLedger.pendingBy).map((pending) => `dispatch-release:${pending}`),
    ...rowWatermarks.flatMap((row) => row.pendingBy.map((pending) => `${row.mount}:${pending}`)),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const releaseReady = rowWatermarks.length > 0
    && rowWatermarks.every((row) => row.releaseReady)
    && providerSyncReleaseReceipt.acceptedForProviderSync === true
    && providerSyncReleaseReceipt.acceptedForSyscallDispatch === true
    && dispatchReleaseLedger.acceptedForSyscallDispatch === true
    && blockedBy.length === 0
    && pendingBy.length === 0;
  const restartSafe = releaseReady
    && providerSyncReleaseReceipt.restartSafe !== false
    && dispatchReleaseLedger.restartSafe !== false
    && rowWatermarks.every((row) => row.restartSafe);
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : releaseReady
        ? "watermarked"
        : "waiting";
  const watermarkId = `memory-audience-sync-watermark:${stableKey([
    contract.id,
    providerContinuationContract.continuationId,
    providerSyncReleaseReceipt.receiptId,
    dispatchReleaseLedger.ledgerId,
    audienceId,
    segmentId,
    status,
  ])}`;

  return {
    format: "aios.mailchimp.memory.audienceSyncWatermark.v1",
    watermarkId,
    provider: "mailchimp",
    providerService: providerContinuationContract.providerService,
    continuationId: providerContinuationContract.continuationId,
    providerSyncReleaseReceiptId: providerSyncReleaseReceipt.receiptId,
    dispatchReleaseLedgerId: dispatchReleaseLedger.ledgerId,
    audienceId,
    segmentId,
    stateKey: clientRuntimeAdoptionState.stateKey,
    status,
    releaseReady,
    acceptedForProviderSync: releaseReady,
    acceptedForSyscallDispatch: releaseReady,
    restartSafe,
    statusChannel: releaseReady
      ? "memory.audience-sync.mailchimp.watermarked"
      : "memory.audience-sync.mailchimp.pending",
    cursorPaths: rowWatermarks.map((row) => row.cursorPath).filter(Boolean).sort(),
    blockedBy,
    pendingBy,
    rowWatermarks,
    persistedState: {
      watermarkId,
      stateKey: clientRuntimeAdoptionState.stateKey,
      continuationId: providerContinuationContract.continuationId,
      audienceId,
      segmentId,
      status,
      restartSafe,
      nextAction: blockedBy.length
        ? "repair-memory-audience-sync-watermark"
        : pendingBy.length
          ? "wait-for-memory-audience-sync-watermark"
          : releaseReady
            ? "release-memory-audience-sync-watermark"
            : providerSyncReleaseReceipt.nextAction,
    },
    commands: [
      {
        command: "persist-memory-audience-sync-watermark",
        enabled: true,
        idempotencyKey: `memory-audience-sync-watermark:${watermarkId}`,
      },
      {
        command: "release-memory-audience-sync-watermark-to-syscall",
        enabled: releaseReady,
        watermarkId,
        idempotencyKey: `memory-audience-sync-watermark-release:${providerContinuationContract.continuationId}`,
      },
    ],
    nextAction: blockedBy.length
      ? "repair-memory-audience-sync-watermark"
      : pendingBy.length
        ? "wait-for-memory-audience-sync-watermark"
        : releaseReady
          ? "release-memory-audience-sync-watermark"
          : providerSyncReleaseReceipt.nextAction,
  };
}

function buildMemoryAudienceContinuityReceipt(
  contract,
  audienceSyncWatermark,
  providerSyncReleaseReceipt,
  dispatchReleaseLedger,
  clientRuntimeAdoptionState,
  source = {},
  options = {},
) {
  const continuitySource = options.audienceContinuity
    || source.audienceContinuity
    || source.mailchimpAudienceContinuity
    || {};
  const expectedAudienceId = continuitySource.audienceId
    || continuitySource.expectedAudienceId
    || audienceSyncWatermark.audienceId
    || null;
  const expectedSegmentId = continuitySource.segmentId
    || continuitySource.expectedSegmentId
    || audienceSyncWatermark.segmentId
    || null;
  const expectedCursorPaths = new Set(asList(
    continuitySource.cursorPaths
      || continuitySource.expectedCursorPaths
      || audienceSyncWatermark.cursorPaths,
  ));
  const watermarkRows = asList(audienceSyncWatermark.rowWatermarks);
  const providerRows = asList(providerSyncReleaseReceipt.receiptRows);
  const dispatchRows = asList(dispatchReleaseLedger.mountRows);
  const continuityRows = watermarkRows.map((row) => {
    const providerRow = providerRows.find((item) => item.mount === row.mount) || {};
    const dispatchRow = dispatchRows.find((item) => item.mount === row.mount) || {};
    const cursorPath = row.cursorPath || providerRow.cursorPath || dispatchRow.recoveryCursor || null;
    const audienceMatches = !expectedAudienceId || row.audienceId === expectedAudienceId;
    const segmentMatches = !expectedSegmentId || row.segmentId === expectedSegmentId;
    const cursorObserved = !expectedCursorPaths.size || (cursorPath && expectedCursorPaths.has(cursorPath));
    const blockedBy = [
      ...asList(row.blockedBy).map((blocker) => `watermark:${compactReasonToken(blocker)}`),
      ...asList(providerRow.blockedBy).map((blocker) => `provider-release:${compactReasonToken(blocker)}`),
      ...(audienceMatches ? [] : ["audience:mismatch"]),
      ...(segmentMatches ? [] : ["segment:mismatch"]),
      ...(row.restartSafe === false ? ["watermark:restart-unsafe"] : []),
      ...(providerRow.restartSafe === false ? ["provider-release:restart-unsafe"] : []),
    ].filter((item, index, items) => items.indexOf(item) === index).sort();
    const pendingBy = [
      ...asList(row.pendingBy).map((pending) => `watermark:${compactReasonToken(pending)}`),
      ...asList(providerRow.pendingBy).map((pending) => `provider-release:${compactReasonToken(pending)}`),
      ...(cursorObserved ? [] : ["cursor:not-observed"]),
      ...(dispatchRow.acceptedForSyscallDispatch === false ? ["dispatch-release:not-accepted"] : []),
    ].filter((item, index, items) => items.indexOf(item) === index).sort();
    const accepted = blockedBy.length === 0
      && pendingBy.length === 0
      && row.releaseReady === true
      && row.restartSafe !== false
      && providerRow.restartSafe !== false
      && dispatchRow.restartSafe !== false;
    return {
      mount: row.mount || "unknown",
      audienceId: row.audienceId || audienceSyncWatermark.audienceId || null,
      segmentId: row.segmentId || audienceSyncWatermark.segmentId || null,
      cursorPath,
      status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : accepted ? "continuous" : "waiting",
      accepted,
      restartSafe: accepted,
      blockedBy,
      pendingBy,
      nextAction: blockedBy.length
        ? "repair-memory-audience-continuity"
        : pendingBy.length
          ? "wait-for-memory-audience-continuity"
          : accepted
            ? "release-memory-audience-continuity"
            : row.nextAction || audienceSyncWatermark.nextAction,
    };
  });
  const blockedBy = [
    ...(expectedAudienceId ? [] : ["audience:missing"]),
    ...asList(audienceSyncWatermark.blockedBy).map((blocker) => `watermark:${compactReasonToken(blocker)}`),
    ...continuityRows.flatMap((row) => row.blockedBy.map((blocker) => `${row.mount}:${blocker}`)),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const pendingBy = [
    ...asList(audienceSyncWatermark.pendingBy).map((pending) => `watermark:${compactReasonToken(pending)}`),
    ...continuityRows.flatMap((row) => row.pendingBy.map((pending) => `${row.mount}:${pending}`)),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const releaseReady = continuityRows.length > 0
    && blockedBy.length === 0
    && pendingBy.length === 0
    && continuityRows.every((row) => row.accepted);
  const restartSafe = releaseReady
    && audienceSyncWatermark.restartSafe !== false
    && providerSyncReleaseReceipt.restartSafe !== false
    && dispatchReleaseLedger.restartSafe !== false;
  const receiptId = `memory-audience-continuity:${stableKey([
    contract.id,
    audienceSyncWatermark.watermarkId,
    providerSyncReleaseReceipt.receiptId,
    dispatchReleaseLedger.ledgerId,
    expectedAudienceId,
    expectedSegmentId,
    [...expectedCursorPaths].sort(),
    blockedBy,
    pendingBy,
  ])}`;

  return {
    format: "aios.mailchimp.memory.audienceContinuityReceipt.v1",
    receiptId,
    provider: "mailchimp",
    status: blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : releaseReady
          ? "continuous"
          : "waiting",
    releaseReady,
    acceptedForProviderSync: releaseReady,
    acceptedForSyscallDispatch: releaseReady,
    restartSafe,
    audienceId: expectedAudienceId,
    segmentId: expectedSegmentId,
    watermarkId: audienceSyncWatermark.watermarkId,
    providerSyncReleaseReceiptId: providerSyncReleaseReceipt.receiptId,
    dispatchReleaseLedgerId: dispatchReleaseLedger.ledgerId,
    stateKey: clientRuntimeAdoptionState.stateKey,
    continuationToken: clientRuntimeAdoptionState.continuationToken,
    statusChannel: releaseReady
      ? "memory.audience-continuity.mailchimp.release"
      : "memory.audience-continuity.mailchimp",
    cursorPaths: continuityRows.map((row) => row.cursorPath).filter(Boolean).sort(),
    blockedBy,
    pendingBy,
    continuityRows,
    persistedState: {
      receiptId,
      stateKey: clientRuntimeAdoptionState.stateKey,
      audienceId: expectedAudienceId,
      segmentId: expectedSegmentId,
      status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : releaseReady ? "continuous" : "waiting",
      restartSafe,
      nextAction: blockedBy.length
        ? "repair-memory-audience-continuity"
        : pendingBy.length
          ? "wait-for-memory-audience-continuity"
          : releaseReady
            ? "release-memory-audience-continuity"
            : audienceSyncWatermark.nextAction,
    },
    commands: [
      {
        command: "persist-memory-audience-continuity-receipt",
        enabled: true,
        idempotencyKey: `memory-audience-continuity:${receiptId}`,
      },
      {
        command: "release-memory-audience-continuity-to-syscall",
        enabled: releaseReady,
        receiptId,
        idempotencyKey: `memory-audience-continuity-release:${audienceSyncWatermark.watermarkId}`,
      },
    ],
    nextAction: blockedBy.length
      ? "repair-memory-audience-continuity"
      : pendingBy.length
        ? "wait-for-memory-audience-continuity"
        : releaseReady
          ? "release-memory-audience-continuity"
          : audienceSyncWatermark.nextAction,
  };
}

function buildMemoryAnalyticsExportBundle(
  contract,
  analytics,
  historySnapshots,
  exportSummary,
  timelineState,
  lifecycleCommandReport,
  memoryExportManifest,
  downstreamStatusPacket,
  operatorReportDigest,
  clientWorkflowHandoffPacket,
  providerHandoffEnvelope,
  operatorResumePacket,
  releaseEvidenceLedger,
  syscallDispatchGate,
  tenantBoundaryState,
) {
  const sourcePackets = [
    {
      packet: "export-manifest",
      packetId: memoryExportManifest.manifestId,
      status: memoryExportManifest.status,
      accepted: memoryExportManifest.exportReady === true,
      blockedBy: asList(memoryExportManifest.blockedBy).map((blocker) => `export:${blocker}`),
      pendingBy: [],
      nextAction: memoryExportManifest.nextAction,
    },
    {
      packet: "downstream-status",
      packetId: downstreamStatusPacket.packetId,
      status: downstreamStatusPacket.status,
      accepted: downstreamStatusPacket.acceptedForDownstream === true,
      blockedBy: asList(downstreamStatusPacket.blockedBy).map((blocker) => `downstream:${blocker}`),
      pendingBy: asList(downstreamStatusPacket.pendingBy).map((pending) => `downstream:${pending}`),
      nextAction: downstreamStatusPacket.nextAction,
    },
    {
      packet: "operator-digest",
      packetId: operatorReportDigest.digestId,
      status: operatorReportDigest.status,
      accepted: operatorReportDigest.publishReady === true,
      blockedBy: asList(operatorReportDigest.blockedBy).map((blocker) => `digest:${blocker}`),
      pendingBy: asList(operatorReportDigest.pendingBy).map((pending) => `digest:${pending}`),
      nextAction: operatorReportDigest.nextAction,
    },
    {
      packet: "client-workflow-handoff",
      packetId: clientWorkflowHandoffPacket.packetId,
      status: clientWorkflowHandoffPacket.status,
      accepted: clientWorkflowHandoffPacket.acceptedForProviderSync === true,
      blockedBy: asList(clientWorkflowHandoffPacket.blockedBy).map((blocker) => `client-workflow:${blocker}`),
      pendingBy: asList(clientWorkflowHandoffPacket.pendingBy).map((pending) => `client-workflow:${pending}`),
      nextAction: clientWorkflowHandoffPacket.nextAction,
    },
    {
      packet: "provider-handoff",
      packetId: providerHandoffEnvelope.packetId,
      status: providerHandoffEnvelope.status,
      accepted: providerHandoffEnvelope.acceptedForProviderSync === true,
      blockedBy: asList(providerHandoffEnvelope.blockedBy).map((blocker) => `provider:${blocker}`),
      pendingBy: asList(providerHandoffEnvelope.pendingBy).map((pending) => `provider:${pending}`),
      nextAction: providerHandoffEnvelope.nextAction,
    },
    {
      packet: "operator-resume",
      packetId: operatorResumePacket.packetId,
      status: operatorResumePacket.status,
      accepted: operatorResumePacket.acceptedForProviderSync === true,
      blockedBy: asList(operatorResumePacket.blockedBy).map((blocker) => `resume:${blocker}`),
      pendingBy: asList(operatorResumePacket.pendingBy).map((pending) => `resume:${pending}`),
      nextAction: operatorResumePacket.nextAction,
    },
    {
      packet: "release-ledger",
      packetId: releaseEvidenceLedger.ledgerId,
      status: releaseEvidenceLedger.status,
      accepted: releaseEvidenceLedger.releaseReady === true,
      blockedBy: asList(releaseEvidenceLedger.blockedBy).map((blocker) => `release:${blocker}`),
      pendingBy: asList(releaseEvidenceLedger.pendingBy).map((pending) => `release:${pending}`),
      nextAction: releaseEvidenceLedger.nextAction,
    },
    {
      packet: "syscall-dispatch-gate",
      packetId: syscallDispatchGate.gateId,
      status: syscallDispatchGate.status,
      accepted: syscallDispatchGate.acceptedForSyscallDispatch === true,
      blockedBy: asList(syscallDispatchGate.blockedBy).map((blocker) => `syscall:${blocker}`),
      pendingBy: asList(syscallDispatchGate.pendingBy).map((pending) => `syscall:${pending}`),
      nextAction: syscallDispatchGate.nextAction,
    },
  ];
  const blockedBy = [
    ...sourcePackets.flatMap((packet) => packet.blockedBy),
    ...asList(tenantBoundaryState.tenantBlockedBy).map((blocker) => `tenant:${blocker}`),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const pendingBy = sourcePackets
    .flatMap((packet) => packet.pendingBy)
    .filter((item, index, items) => items.indexOf(item) === index)
    .sort();
  const exportReady = blockedBy.length === 0
    && pendingBy.length === 0
    && memoryExportManifest.exportReady === true
    && downstreamStatusPacket.acceptedForDownstream === true;
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : exportReady
        ? "export-ready"
        : "observing";
  const currentPacket = sourcePackets.find((packet) => packet.blockedBy.length)
    || sourcePackets.find((packet) => packet.pendingBy.length)
    || sourcePackets.find((packet) => packet.accepted !== true)
    || sourcePackets.at(-1);
  const timeline = [
    ...historySnapshots.map((snapshot, index) => ({
      eventId: snapshot.id,
      index,
      phase: snapshot.phase,
      status: snapshot.status,
      counters: snapshot.counters,
      nextAction: snapshot.nextAction,
    })),
    ...sourcePackets.map((packet, offset) => ({
      eventId: `memory-report-event:${stableKey([contract.id, packet.packet, packet.status, offset])}`,
      index: historySnapshots.length + offset,
      phase: packet.packet,
      status: packet.status,
      counters: {
        blocked: packet.blockedBy.length,
        pending: packet.pendingBy.length,
        accepted: packet.accepted ? 1 : 0,
      },
      nextAction: packet.nextAction,
    })),
  ];

  return {
    format: "aios.mailchimp.memory.analyticsExportBundle.v1",
    bundleId: `memory-analytics-export:${stableKey([
      contract.id,
      memoryExportManifest.manifestId,
      downstreamStatusPacket.packetId,
      status,
    ])}`,
    provider: "mailchimp",
    status,
    exportReady,
    generatedDeterministically: true,
    exportKind: "mailchimp.memoryMounts.analyticsBundle",
    tenantAuditId: tenantBoundaryState.auditId,
    exportManifestId: memoryExportManifest.manifestId,
    downstreamStatusPacketId: downstreamStatusPacket.packetId,
    operatorDigestId: operatorReportDigest.digestId,
    clientWorkflowHandoffPacketId: clientWorkflowHandoffPacket.packetId,
    clientWorkflowReleaseReceiptId: clientWorkflowHandoffPacket.releaseReceipt?.receiptId || null,
    providerHandoffPacketId: providerHandoffEnvelope.packetId,
    operatorResumePacketId: operatorResumePacket.packetId,
    releaseLedgerId: releaseEvidenceLedger.ledgerId,
    syscallDispatchGateId: syscallDispatchGate.gateId,
    counters: {
      ...analytics.counters,
      packets: sourcePackets.length,
      acceptedPackets: sourcePackets.filter((packet) => packet.accepted).length,
      blockedPackets: sourcePackets.filter((packet) => packet.blockedBy.length).length,
      pendingPackets: sourcePackets.filter((packet) => packet.pendingBy.length).length,
      historySnapshots: historySnapshots.length,
      timelineEvents: timeline.length,
    },
    packetRows: sourcePackets.map((packet, index) => ({
      index,
      packet: packet.packet,
      packetId: packet.packetId,
      status: packet.status,
      accepted: packet.accepted,
      blockedBy: packet.blockedBy,
      pendingBy: packet.pendingBy,
      nextAction: packet.nextAction,
    })),
    claimRuntimeAdoptionReceipt: {
      receiptId: `memory-claim-adoption:${stableKey([
        contract.id,
        clientWorkflowHandoffPacket.packetId,
        clientWorkflowHandoffPacket.releaseReceipt?.receiptId,
        status,
      ])}`,
      sourcePacketId: clientWorkflowHandoffPacket.packetId,
      sourceReceiptId: clientWorkflowHandoffPacket.releaseReceipt?.receiptId || null,
      acceptedForClaimRuntime: clientWorkflowHandoffPacket.acceptedForRuntime === true
        && clientWorkflowHandoffPacket.restartSafe !== false
        && asList(clientWorkflowHandoffPacket.blockedBy).length === 0,
      acceptedForClaimProviderSync: clientWorkflowHandoffPacket.acceptedForProviderSync === true
        && clientWorkflowHandoffPacket.releaseReceipt?.acceptedForProviderSync === true
        && asList(clientWorkflowHandoffPacket.pendingBy).length === 0,
      restartSafe: clientWorkflowHandoffPacket.restartSafe !== false
        && clientWorkflowHandoffPacket.releaseReceipt?.restartSafe !== false,
      stateKey: clientWorkflowHandoffPacket.stateKey || null,
      continuationToken: clientWorkflowHandoffPacket.continuationToken || null,
      tenantAuditId: clientWorkflowHandoffPacket.tenantAuditId || null,
      blockedBy: [
        ...asList(clientWorkflowHandoffPacket.blockedBy).map((blocker) => `client-workflow:${blocker}`),
        ...asList(clientWorkflowHandoffPacket.releaseReceipt?.blockedBy)
          .map((blocker) => `client-workflow-receipt:${blocker}`),
      ].sort(),
      pendingBy: [
        ...asList(clientWorkflowHandoffPacket.pendingBy).map((pending) => `client-workflow:${pending}`),
        ...asList(clientWorkflowHandoffPacket.releaseReceipt?.pendingBy)
          .map((pending) => `client-workflow-receipt:${pending}`),
      ].sort(),
      gateReceipts: asList(clientWorkflowHandoffPacket.releaseReceipt?.gateReceipts).map((gate) => ({
        gate: gate.gate || "memory-client-workflow",
        packetId: gate.packetId || null,
        status: gate.status || "unknown",
        accepted: gate.accepted === true,
        restartSafe: gate.restartSafe !== false,
        blockedBy: asList(gate.blockedBy).sort(),
        pendingBy: asList(gate.pendingBy).sort(),
        nextAction: gate.nextAction || clientWorkflowHandoffPacket.nextAction,
      })),
      commands: asList(clientWorkflowHandoffPacket.commands).map((command) => ({
        command: command.command,
        enabled: command.enabled === true,
        idempotencyKey: command.idempotencyKey || null,
        statusChannel: command.statusChannel || clientWorkflowHandoffPacket.statusChannel || null,
      })),
      nextAction: clientWorkflowHandoffPacket.releaseReceipt?.nextAction
        || clientWorkflowHandoffPacket.nextAction
        || "review-memory-client-workflow-handoff",
    },
    exportRows: exportSummary.rows.map((row) => ({
      ...row,
      exportManifestId: memoryExportManifest.manifestId,
      lifecycleReportId: lifecycleCommandReport.reportId,
    })),
    timeline,
    timelineState: {
      currentPhase: timeline.find((event) => event.status === "blocked")?.phase
        || timeline.find((event) => event.status === "pending")?.phase
        || currentPacket?.packet
        || timelineState.currentPhase,
      phases: timeline.map((event) => ({
        index: event.index,
        phase: event.phase,
        status: event.status,
        nextAction: event.nextAction,
      })),
      reportChannels: [
        ...new Set([
          ...asList(timelineState.reportChannels),
          ...asList(memoryExportManifest.statusChannels),
          downstreamStatusPacket.statusChannel,
          operatorReportDigest.statusChannels?.[0],
          "memory.analytics-export.mailchimp",
        ].filter(Boolean)),
      ].sort(),
    },
    blockedBy,
    pendingBy,
    commands: [
      {
        command: "persist-memory-analytics-export-bundle",
        enabled: true,
        idempotencyKey: `memory-analytics-export:${memoryExportManifest.manifestId}`,
      },
      {
        command: "publish-memory-analytics-export-bundle",
        enabled: exportReady,
        idempotencyKey: `memory-analytics-export-publish:${downstreamStatusPacket.packetId}`,
      },
      {
        command: "publish-memory-report-timeline",
        enabled: blockedBy.length === 0,
        idempotencyKey: `memory-report-timeline:${stableKey([contract.id, timeline.length, status])}`,
      },
    ],
    nextAction: exportReady
      ? "publish-memory-analytics-export-bundle"
      : currentPacket?.nextAction || memoryExportManifest.nextAction,
  };
}

function buildMemoryClaimEvidenceManifest(
  contract,
  mounts,
  analyticsExportBundle,
  operatorReleasePacket,
  dispatchReleaseLedger,
  adapterResumeReceipt,
) {
  const evidenceRows = [
    {
      evidence: "analytics-export",
      packetId: analyticsExportBundle.bundleId,
      status: analyticsExportBundle.status,
      accepted: analyticsExportBundle.exportReady === true,
      restartSafe: analyticsExportBundle.restartSafe !== false,
      counters: analyticsExportBundle.counters,
      blockedBy: asList(analyticsExportBundle.blockedBy).map((blocker) => `analytics-export:${blocker}`),
      pendingBy: asList(analyticsExportBundle.pendingBy).map((pending) => `analytics-export:${pending}`),
      nextAction: analyticsExportBundle.nextAction,
    },
    {
      evidence: "operator-release",
      packetId: operatorReleasePacket.packetId,
      status: operatorReleasePacket.status,
      accepted: operatorReleasePacket.releaseReady === true,
      restartSafe: operatorReleasePacket.restartSafe === true,
      counters: {
        gates: asList(operatorReleasePacket.gateRows).length,
        blocked: asList(operatorReleasePacket.blockedBy).length,
        pending: asList(operatorReleasePacket.pendingBy).length,
      },
      blockedBy: asList(operatorReleasePacket.blockedBy).map((blocker) => `operator-release:${blocker}`),
      pendingBy: asList(operatorReleasePacket.pendingBy).map((pending) => `operator-release:${pending}`),
      nextAction: operatorReleasePacket.nextAction,
    },
    {
      evidence: "dispatch-release-ledger",
      packetId: dispatchReleaseLedger.ledgerId,
      status: dispatchReleaseLedger.status,
      accepted: dispatchReleaseLedger.acceptedForSyscallDispatch === true,
      restartSafe: dispatchReleaseLedger.restartSafe === true,
      counters: {
        sources: asList(dispatchReleaseLedger.sourceRows).length,
        blocked: asList(dispatchReleaseLedger.blockedBy).length,
        pending: asList(dispatchReleaseLedger.pendingBy).length,
      },
      blockedBy: asList(dispatchReleaseLedger.blockedBy).map((blocker) => `dispatch-release:${blocker}`),
      pendingBy: asList(dispatchReleaseLedger.pendingBy).map((pending) => `dispatch-release:${pending}`),
      nextAction: dispatchReleaseLedger.nextAction,
    },
    {
      evidence: "adapter-resume",
      packetId: adapterResumeReceipt.receiptId,
      status: adapterResumeReceipt.status,
      accepted: adapterResumeReceipt.acceptedForAdapterResume === true,
      restartSafe: adapterResumeReceipt.restartSafe === true,
      counters: {
        mounts: asList(adapterResumeReceipt.mountRows).length,
        blocked: asList(adapterResumeReceipt.blockedBy).length,
        pending: asList(adapterResumeReceipt.pendingBy).length,
      },
      blockedBy: asList(adapterResumeReceipt.blockedBy).map((blocker) => `adapter-resume:${blocker}`),
      pendingBy: asList(adapterResumeReceipt.pendingBy).map((pending) => `adapter-resume:${pending}`),
      nextAction: adapterResumeReceipt.nextAction,
    },
  ];
  const blockedBy = [...new Set(evidenceRows.flatMap((row) => row.blockedBy))].sort();
  const pendingBy = [...new Set(evidenceRows.flatMap((row) => row.pendingBy))].sort();
  const acceptedForClaimRuntime = blockedBy.length === 0
    && pendingBy.length === 0
    && evidenceRows.every((row) => row.accepted);
  const restartSafe = evidenceRows.every((row) => row.restartSafe !== false);
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : acceptedForClaimRuntime
        ? "claim-ready"
        : "observing";
  const requiredClaimFacts = [
    "audience_id",
    "campaign_id",
    "segment_id",
    "template_id",
    ...mounts
      .filter((mount) => mount.providerSyncRequired)
      .map((mount) => `memory_mount:${mount.mount}`),
  ];

  return {
    format: "aios.mailchimp.memory.claimEvidenceManifest.v1",
    manifestId: `memory-claim-evidence:${stableKey([
      contract.id,
      analyticsExportBundle.bundleId,
      operatorReleasePacket.packetId,
      dispatchReleaseLedger.ledgerId,
      adapterResumeReceipt.receiptId,
      status,
    ])}`,
    provider: "mailchimp",
    status,
    acceptedForClaimRuntime,
    restartSafe,
    generatedDeterministically: true,
    analyticsExportBundleId: analyticsExportBundle.bundleId,
    operatorReleasePacketId: operatorReleasePacket.packetId,
    dispatchReleaseLedgerId: dispatchReleaseLedger.ledgerId,
    adapterResumeReceiptId: adapterResumeReceipt.receiptId,
    requiredClaimFacts: [...new Set(requiredClaimFacts)].sort(),
    observedClaimFacts: [
      ...new Set([
        ...asList(contract.verifierContract?.evidenceFacts),
        ...mounts.map((mount) => `memory_mount:${mount.mount}`),
      ]),
    ].sort(),
    counters: {
      evidenceRows: evidenceRows.length,
      acceptedRows: evidenceRows.filter((row) => row.accepted).length,
      blockedRows: evidenceRows.filter((row) => row.blockedBy.length).length,
      pendingRows: evidenceRows.filter((row) => row.pendingBy.length).length,
      restartSafeRows: evidenceRows.filter((row) => row.restartSafe !== false).length,
      requiredClaimFacts: [...new Set(requiredClaimFacts)].length,
    },
    evidenceRows,
    blockedBy,
    pendingBy,
    timeline: evidenceRows.map((row, index) => ({
      index,
      phase: row.evidence,
      packetId: row.packetId,
      status: row.status,
      accepted: row.accepted,
      restartSafe: row.restartSafe,
      nextAction: row.nextAction,
    })),
    commands: [
      {
        command: "persist-memory-claim-evidence-manifest",
        enabled: true,
        idempotencyKey: `memory-claim-evidence:${analyticsExportBundle.bundleId}`,
      },
      {
        command: "publish-memory-claim-evidence-manifest",
        enabled: acceptedForClaimRuntime,
        idempotencyKey: `memory-claim-evidence-publish:${dispatchReleaseLedger.ledgerId}`,
      },
    ],
    nextAction: blockedBy.length
      ? evidenceRows.find((row) => row.blockedBy.length)?.nextAction || "repair-memory-claim-evidence"
      : pendingBy.length
        ? evidenceRows.find((row) => row.pendingBy.length)?.nextAction || "wait-for-memory-claim-evidence"
        : acceptedForClaimRuntime
          ? "publish-memory-claim-evidence-manifest"
          : "review-memory-claim-evidence",
  };
}

function buildMemoryClaimRuntimeAdoptionReceipt(
  contract,
  analyticsExportBundle,
  claimEvidenceManifest,
  clientWorkflowHandoffPacket,
  operatorCommandReceipt,
) {
  const baseReceipt = analyticsExportBundle.claimRuntimeAdoptionReceipt || {};
  const blockedBy = [
    ...asList(baseReceipt.blockedBy),
    ...asList(claimEvidenceManifest.blockedBy).map((blocker) => `claim-evidence:${blocker}`),
    ...asList(operatorCommandReceipt.blockedBy).map((blocker) => `operator-command:${blocker}`),
  ].sort();
  const pendingBy = [
    ...asList(baseReceipt.pendingBy),
    ...asList(claimEvidenceManifest.pendingBy).map((pending) => `claim-evidence:${pending}`),
    ...asList(operatorCommandReceipt.pendingBy).map((pending) => `operator-command:${pending}`),
  ].sort();
  const acceptedForClaimRuntime = baseReceipt.acceptedForClaimRuntime === true
    && claimEvidenceManifest.acceptedForClaimRuntime === true
    && operatorCommandReceipt.acceptedForSyscallDispatch !== false
    && blockedBy.length === 0;
  const acceptedForClaimProviderSync = baseReceipt.acceptedForClaimProviderSync === true
    && acceptedForClaimRuntime
    && pendingBy.length === 0;
  const restartSafe = baseReceipt.restartSafe !== false
    && claimEvidenceManifest.restartSafe !== false
    && operatorCommandReceipt.restartSafe !== false;
  const receiptId = `memory-claim-runtime-adoption:${stableKey([
    contract.id,
    baseReceipt.receiptId,
    claimEvidenceManifest.manifestId,
    operatorCommandReceipt.receiptId,
    acceptedForClaimRuntime,
    acceptedForClaimProviderSync,
  ])}`;

  return {
    format: "aios.mailchimp.memory.claimRuntimeAdoptionReceipt.v1",
    receiptId,
    sourceReceiptId: baseReceipt.receiptId || null,
    sourcePacketId: baseReceipt.sourcePacketId || clientWorkflowHandoffPacket.packetId,
    analyticsExportBundleId: analyticsExportBundle.bundleId,
    claimEvidenceManifestId: claimEvidenceManifest.manifestId,
    operatorCommandReceiptId: operatorCommandReceipt.receiptId,
    status: blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : acceptedForClaimProviderSync
          ? "claim-provider-sync-ready"
          : acceptedForClaimRuntime
            ? "claim-runtime-ready"
            : "observing",
    acceptedForClaimRuntime,
    acceptedForClaimProviderSync,
    acceptedForRuntime: acceptedForClaimRuntime,
    acceptedForProviderSync: acceptedForClaimProviderSync,
    releaseReady: acceptedForClaimProviderSync,
    restartSafe,
    stateKey: baseReceipt.stateKey || clientWorkflowHandoffPacket.stateKey || null,
    continuationToken: baseReceipt.continuationToken || clientWorkflowHandoffPacket.continuationToken || null,
    tenantAuditId: baseReceipt.tenantAuditId || clientWorkflowHandoffPacket.tenantAuditId || null,
    requiredClaimFacts: asList(claimEvidenceManifest.requiredClaimFacts).sort(),
    observedClaimFacts: asList(claimEvidenceManifest.observedClaimFacts).sort(),
    evidenceRows: asList(claimEvidenceManifest.evidenceRows).map((row) => ({
      fact: row.evidence || row.fact || "unknown",
      status: row.status || "unknown",
      accepted: row.accepted === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asList(row.blockedBy),
      pendingBy: asList(row.pendingBy),
      nextAction: row.nextAction || claimEvidenceManifest.nextAction,
    })),
    gateReceipts: [
      ...asList(baseReceipt.gateReceipts),
      {
        gate: "memory-claim-evidence",
        packetId: claimEvidenceManifest.manifestId,
        status: claimEvidenceManifest.status,
        accepted: claimEvidenceManifest.acceptedForClaimRuntime === true,
        restartSafe: claimEvidenceManifest.restartSafe !== false,
        blockedBy: asList(claimEvidenceManifest.blockedBy),
        pendingBy: asList(claimEvidenceManifest.pendingBy),
        nextAction: claimEvidenceManifest.nextAction,
      },
      {
        gate: "memory-operator-command",
        packetId: operatorCommandReceipt.receiptId,
        status: operatorCommandReceipt.status,
        accepted: operatorCommandReceipt.acceptedForSyscallDispatch !== false,
        restartSafe: operatorCommandReceipt.restartSafe !== false,
        blockedBy: asList(operatorCommandReceipt.blockedBy),
        pendingBy: asList(operatorCommandReceipt.pendingBy),
        nextAction: operatorCommandReceipt.nextAction,
      },
    ],
    blockedBy,
    pendingBy,
    commands: [
      {
        command: "persist-memory-claim-runtime-adoption-receipt",
        enabled: true,
        idempotencyKey: `memory-claim-runtime-adoption:${receiptId}`,
      },
      {
        command: "release-memory-claim-runtime-adoption",
        enabled: acceptedForClaimRuntime,
        continuationToken: baseReceipt.continuationToken || clientWorkflowHandoffPacket.continuationToken || null,
        idempotencyKey: `memory-claim-runtime-release:${receiptId}`,
      },
      {
        command: "sync-memory-claim-provider-status",
        enabled: acceptedForClaimProviderSync,
        statusChannel: "memory.claim-runtime.mailchimp",
        idempotencyKey: `memory-claim-provider-status:${receiptId}`,
      },
    ],
    nextAction: blockedBy.length
      ? "repair-memory-claim-runtime-adoption"
      : pendingBy.length
        ? "wait-for-memory-claim-runtime-adoption"
        : acceptedForClaimProviderSync
          ? "release-memory-claim-provider-sync"
          : acceptedForClaimRuntime
            ? "release-memory-claim-runtime"
            : "review-memory-claim-runtime-adoption",
  };
}

function buildMemoryClaimRuntimeAnalyticsDigest(
  contract,
  analytics,
  historySnapshots,
  analyticsExportBundle,
  claimEvidenceManifest,
  claimRuntimeAdoptionReceipt,
) {
  const digestRows = [
    {
      channel: "analytics-export",
      subject: analyticsExportBundle.bundleId,
      status: analyticsExportBundle.status,
      accepted: analyticsExportBundle.exportReady === true,
      restartSafe: analyticsExportBundle.restartSafe !== false,
      counters: analyticsExportBundle.counters,
      blockedBy: asList(analyticsExportBundle.blockedBy).map((blocker) => `analytics-export:${blocker}`),
      pendingBy: asList(analyticsExportBundle.pendingBy).map((pending) => `analytics-export:${pending}`),
      nextAction: analyticsExportBundle.nextAction,
    },
    {
      channel: "claim-evidence",
      subject: claimEvidenceManifest.manifestId,
      status: claimEvidenceManifest.status,
      accepted: claimEvidenceManifest.acceptedForClaimRuntime === true,
      restartSafe: claimEvidenceManifest.restartSafe !== false,
      counters: claimEvidenceManifest.counters,
      blockedBy: asList(claimEvidenceManifest.blockedBy).map((blocker) => `claim-evidence:${blocker}`),
      pendingBy: asList(claimEvidenceManifest.pendingBy).map((pending) => `claim-evidence:${pending}`),
      nextAction: claimEvidenceManifest.nextAction,
    },
    {
      channel: "claim-runtime-adoption",
      subject: claimRuntimeAdoptionReceipt.receiptId,
      status: claimRuntimeAdoptionReceipt.status,
      accepted: claimRuntimeAdoptionReceipt.acceptedForClaimRuntime === true,
      restartSafe: claimRuntimeAdoptionReceipt.restartSafe !== false,
      counters: {
        gateReceipts: asList(claimRuntimeAdoptionReceipt.gateReceipts).length,
        commands: asList(claimRuntimeAdoptionReceipt.commands).length,
        blockers: asList(claimRuntimeAdoptionReceipt.blockedBy).length,
        pending: asList(claimRuntimeAdoptionReceipt.pendingBy).length,
      },
      blockedBy: asList(claimRuntimeAdoptionReceipt.blockedBy).map((blocker) => `claim-runtime:${blocker}`),
      pendingBy: asList(claimRuntimeAdoptionReceipt.pendingBy).map((pending) => `claim-runtime:${pending}`),
      nextAction: claimRuntimeAdoptionReceipt.nextAction,
    },
  ].map((row, index) => ({
    rowId: `memory-claim-runtime-digest-row:${stableKey([
      contract.id,
      row.channel,
      row.status,
      row.subject,
      index,
    ])}`,
    index,
    ...row,
    blockedBy: [...new Set(row.blockedBy)].sort(),
    pendingBy: [...new Set(row.pendingBy)].sort(),
  }));
  const blockedBy = digestRows.flatMap((row) => row.blockedBy).sort();
  const pendingBy = digestRows
    .flatMap((row) => row.pendingBy)
    .filter((pending, index, items) => items.indexOf(pending) === index)
    .sort();
  const acceptedForClaimRuntime = blockedBy.length === 0
    && pendingBy.length === 0
    && digestRows.every((row) => row.accepted === true);
  const restartSafe = blockedBy.length === 0
    && digestRows.every((row) => row.restartSafe !== false)
    && historySnapshots.length > 0;
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : acceptedForClaimRuntime
        ? "claim-runtime-ready"
        : "observing";

  return {
    format: "aios.mailchimp.memory.claimRuntimeAnalyticsDigest.v1",
    digestId: `memory-claim-runtime-analytics:${stableKey([
      contract.id,
      analyticsExportBundle.bundleId,
      claimRuntimeAdoptionReceipt.receiptId,
      status,
    ])}`,
    status,
    acceptedForClaimRuntime,
    acceptedForClaimProviderSync: acceptedForClaimRuntime
      && claimRuntimeAdoptionReceipt.acceptedForClaimProviderSync === true,
    restartSafe,
    generatedDeterministically: true,
    analyticsExportBundleId: analyticsExportBundle.bundleId,
    claimEvidenceManifestId: claimEvidenceManifest.manifestId,
    claimRuntimeAdoptionReceiptId: claimRuntimeAdoptionReceipt.receiptId,
    counters: {
      mounts: analytics.counters.mountsTotal,
      readyMounts: analytics.counters.readyMounts,
      blockedMounts: analytics.counters.blockedMounts,
      providerSyncMounts: analytics.counters.providerSyncMounts,
      historySnapshots: historySnapshots.length,
      digestRows: digestRows.length,
      acceptedRows: digestRows.filter((row) => row.accepted).length,
      blockedRows: digestRows.filter((row) => row.blockedBy.length).length,
      pendingRows: digestRows.filter((row) => row.pendingBy.length).length,
    },
    rows: digestRows,
    blockedBy,
    pendingBy,
    commands: [
      {
        command: "persist-memory-claim-runtime-analytics-digest",
        enabled: true,
        idempotencyKey: `memory-claim-runtime-analytics:${claimRuntimeAdoptionReceipt.receiptId}`,
      },
      {
        command: "publish-memory-claim-runtime-analytics-digest",
        enabled: acceptedForClaimRuntime,
        idempotencyKey: `memory-claim-runtime-analytics-publish:${analyticsExportBundle.bundleId}`,
      },
    ],
    nextAction: blockedBy.length
      ? digestRows.find((row) => row.blockedBy.length)?.nextAction || "repair-memory-claim-runtime-analytics"
      : pendingBy.length
        ? digestRows.find((row) => row.pendingBy.length)?.nextAction || "wait-for-memory-claim-runtime-analytics"
        : acceptedForClaimRuntime
          ? "publish-memory-claim-runtime-analytics-digest"
          : "review-memory-claim-runtime-analytics",
  };
}

function buildMemorySyscallDispatchGate(
  operationalHealthState,
  downstreamStatusPacket,
  controlPlaneState,
  workflowControlPacket,
  clientWorkflowHandoffPacket,
  boundaryLeasePacket,
  providerHandoffEnvelope,
  operatorResumePacket,
  releaseEvidenceLedger,
  clientRuntimeAdoptionState,
  lifecycleControls,
) {
  const gateRows = [
    {
      gate: "memory-health",
      packetId: operationalHealthState.healthId,
      status: operationalHealthState.status,
      accepted: operationalHealthState.status === "healthy",
      restartSafe: operationalHealthState.status !== "failed",
      retryable: operationalHealthState.retryable === true,
      statusPath: operationalHealthState.statusChannel,
      blockedBy: operationalHealthState.incidents
        .filter((incident) => incident.severity === "error")
        .map((incident) => `health:${incident.code}`),
      pendingBy: operationalHealthState.retryable ? ["health:retry-scheduled"] : [],
      nextAction: operationalHealthState.nextAction,
    },
    {
      gate: "memory-downstream-status",
      packetId: downstreamStatusPacket.packetId,
      status: downstreamStatusPacket.status,
      accepted: downstreamStatusPacket.acceptedForProviderSync === true,
      restartSafe: downstreamStatusPacket.restartSafe === true,
      retryable: downstreamStatusPacket.retryable === true,
      statusPath: downstreamStatusPacket.statusChannel,
      blockedBy: asList(downstreamStatusPacket.blockedBy).map((blocker) => `downstream:${blocker}`),
      pendingBy: asList(downstreamStatusPacket.pendingBy).map((pending) => `downstream:${pending}`),
      nextAction: downstreamStatusPacket.nextAction,
    },
    {
      gate: "memory-control-plane",
      packetId: controlPlaneState.controlPlaneId,
      status: controlPlaneState.status,
      accepted: controlPlaneState.persistedState?.acceptedForProviderSync === true,
      restartSafe: controlPlaneState.persistedState?.restartSafe !== false,
      retryable: false,
      statusPath: controlPlaneState.statusChannel,
      blockedBy: asList(controlPlaneState.blockedBy).map((blocker) => `control:${blocker}`),
      pendingBy: asList(controlPlaneState.pendingBy).map((pending) => `control:${pending}`),
      nextAction: controlPlaneState.nextAction,
    },
    {
      gate: "memory-workflow-control",
      packetId: workflowControlPacket.packetId,
      status: workflowControlPacket.status,
      accepted: workflowControlPacket.releaseReady === true,
      restartSafe: workflowControlPacket.restartSafe !== false,
      retryable: false,
      statusPath: workflowControlPacket.statusChannel,
      blockedBy: asList(workflowControlPacket.blockedBy).map((blocker) => `workflow-control:${blocker}`),
      pendingBy: asList(workflowControlPacket.pendingBy).map((pending) => `workflow-control:${pending}`),
      nextAction: workflowControlPacket.nextAction,
    },
    {
      gate: "memory-client-workflow",
      packetId: clientWorkflowHandoffPacket.packetId,
      status: clientWorkflowHandoffPacket.status,
      accepted: clientWorkflowHandoffPacket.acceptedForProviderSync === true,
      restartSafe: clientWorkflowHandoffPacket.restartSafe !== false,
      retryable: false,
      statusPath: clientWorkflowHandoffPacket.statusChannel,
      blockedBy: asList(clientWorkflowHandoffPacket.blockedBy).map((blocker) => `client-workflow:${blocker}`),
      pendingBy: asList(clientWorkflowHandoffPacket.pendingBy).map((pending) => `client-workflow:${pending}`),
      nextAction: clientWorkflowHandoffPacket.nextAction,
    },
    {
      gate: "memory-boundary-lease",
      packetId: boundaryLeasePacket.packetId,
      status: boundaryLeasePacket.status,
      accepted: boundaryLeasePacket.acceptedForProviderSync === true,
      restartSafe: boundaryLeasePacket.restartSafe === true,
      retryable: false,
      statusPath: `memory.boundary.${boundaryLeasePacket.packetId}`,
      blockedBy: asList(boundaryLeasePacket.blockedBy).map((blocker) => `boundary:${blocker}`),
      pendingBy: asList(boundaryLeasePacket.pendingBy).map((pending) => `boundary:${pending}`),
      nextAction: boundaryLeasePacket.nextAction,
    },
    {
      gate: "memory-provider-handoff",
      packetId: providerHandoffEnvelope.packetId,
      status: providerHandoffEnvelope.status,
      accepted: providerHandoffEnvelope.acceptedForProviderSync === true,
      restartSafe: providerHandoffEnvelope.restartSafe === true,
      retryable: false,
      statusPath: providerHandoffEnvelope.statusChannel,
      blockedBy: asList(providerHandoffEnvelope.blockedBy).map((blocker) => `provider-handoff:${blocker}`),
      pendingBy: asList(providerHandoffEnvelope.pendingBy).map((pending) => `provider-handoff:${pending}`),
      nextAction: providerHandoffEnvelope.nextAction,
    },
    {
      gate: "memory-operator-resume",
      packetId: operatorResumePacket.packetId,
      status: operatorResumePacket.status,
      accepted: operatorResumePacket.acceptedForProviderSync === true,
      restartSafe: operatorResumePacket.restartSafe === true,
      retryable: false,
      statusPath: operatorResumePacket.statusChannel,
      blockedBy: asList(operatorResumePacket.blockedBy).map((blocker) => `operator-resume:${blocker}`),
      pendingBy: asList(operatorResumePacket.pendingBy).map((pending) => `operator-resume:${pending}`),
      nextAction: operatorResumePacket.nextAction,
    },
    {
      gate: "memory-release-ledger",
      packetId: releaseEvidenceLedger.ledgerId,
      status: releaseEvidenceLedger.status,
      accepted: releaseEvidenceLedger.releaseReady === true,
      restartSafe: releaseEvidenceLedger.restartSafe === true,
      retryable: false,
      statusPath: releaseEvidenceLedger.statusChannel,
      blockedBy: asList(releaseEvidenceLedger.blockedBy).map((blocker) => `release-ledger:${blocker}`),
      pendingBy: asList(releaseEvidenceLedger.pendingBy).map((pending) => `release-ledger:${pending}`),
      nextAction: releaseEvidenceLedger.nextAction,
    },
  ];
  const blockedBy = [...new Set(gateRows.flatMap((gate) => gate.blockedBy))].sort();
  const pendingBy = [...new Set(gateRows.flatMap((gate) => gate.pendingBy))].sort();
  const retryable = gateRows.some((gate) => gate.retryable);
  const acceptedForSyscallDispatch = blockedBy.length === 0
    && pendingBy.length === 0
    && clientRuntimeAdoptionState.acceptedForProviderSync === true
    && lifecycleControls.syncMounts.length > 0
    && gateRows.every((gate) => gate.accepted);
  const status = blockedBy.length
    ? retryable
      ? "retryable-blocked"
      : "blocked"
    : pendingBy.length
      ? "pending"
      : acceptedForSyscallDispatch
        ? "dispatch-ready"
        : "waiting";
  const nextDelaySeconds = retryable
    ? operationalHealthState.nextDelaySeconds ?? downstreamStatusPacket.nextDelaySeconds ?? 30
    : null;
  const nextAction = blockedBy.length
    ? gateRows.find((gate) => gate.blockedBy.length)?.nextAction || "repair-memory-syscall-dispatch-gate"
    : pendingBy.length
      ? retryable
        ? "schedule-memory-syscall-dispatch-gate-retry"
        : gateRows.find((gate) => gate.pendingBy.length)?.nextAction || "wait-for-memory-syscall-dispatch-gate"
      : acceptedForSyscallDispatch
        ? "release-memory-syscall-dispatch"
        : clientRuntimeAdoptionState.nextAction;

  return {
    format: "aios.mailchimp.memory.syscallDispatchGate.v1",
    gateId: `memory-syscall-dispatch-gate:${stableKey([
      clientRuntimeAdoptionState.stateKey,
      gateRows.map((gate) => [gate.gate, gate.status, gate.accepted]),
      status,
    ])}`,
    status,
    acceptedForSyscallDispatch,
    restartSafe: gateRows.every((gate) => gate.restartSafe !== false) && clientRuntimeAdoptionState.hydrated === true,
    retryable,
    nextDelaySeconds,
    statusChannel: status === "dispatch-ready"
      ? "memory.syscall-gate.mailchimp.ready"
      : retryable
        ? "memory.syscall-gate.mailchimp.retry"
        : "memory.syscall-gate.mailchimp",
    blockedBy,
    pendingBy,
    gateRows,
    actionableErrors: [
      ...operationalHealthState.actionableErrors.map((error) => ({
        ...error,
        source: "memory-health",
      })),
      ...blockedBy.map((blocker) => ({
        code: "memory.syscall-gate.blocked",
        source: "memory-syscall-gate",
        reason: blocker,
        action: nextAction,
        retryable,
      })),
    ],
    commands: [
      {
        command: "persist-memory-syscall-dispatch-gate",
        enabled: true,
        idempotencyKey: `memory-syscall-gate:${stableKey([clientRuntimeAdoptionState.stateKey, status])}`,
      },
      {
        command: "schedule-memory-syscall-dispatch-gate-retry",
        enabled: retryable && status !== "dispatch-ready",
        delaySeconds: nextDelaySeconds,
        idempotencyKey: `memory-syscall-gate-retry:${stableKey([
          clientRuntimeAdoptionState.stateKey,
          operationalHealthState.attempts + 1,
          status,
        ])}`,
      },
      {
        command: "release-memory-syscall-dispatch",
        enabled: acceptedForSyscallDispatch,
        idempotencyKey: `memory-syscall-release:${stableKey([
          clientRuntimeAdoptionState.continuationToken,
          providerHandoffEnvelope.packetId,
        ])}`,
      },
    ],
    nextAction,
  };
}

function buildMemoryOperatorActionEnvelope(
  contract,
  lifecycleControls,
  previewAcceptancePackage,
  clientRuntimeAdoptionState,
  operationalHealthState,
  controlPlaneState,
  workflowControlPacket,
  providerHandoffEnvelope,
  operatorResumePacket,
  releaseEvidenceLedger,
  syscallDispatchGate,
  analyticsExportBundle,
) {
  const commandSources = [
    ["lifecycle", lifecycleControls.commands],
    ["client-runtime", clientRuntimeAdoptionState.routeCommands],
    ["health", operationalHealthState.commands],
    ["control-plane", controlPlaneState.commands],
    ["workflow-control", workflowControlPacket.commands],
    ["provider-handoff", providerHandoffEnvelope.commands],
    ["operator-resume", operatorResumePacket.commands],
    ["release-ledger", releaseEvidenceLedger.commands],
    ["syscall-dispatch-gate", syscallDispatchGate.commands],
    ["analytics-export", analyticsExportBundle.commands],
  ];
  const commandQueue = commandSources
    .flatMap(([sourceName, commands]) => asList(commands).map((command) => ({
      source: sourceName,
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || command.packetId || command.exportId || null,
    })))
    .filter((command) => command.command)
    .map((command, index) => ({
      index,
      ...command,
      dispatchState: command.enabled ? "queued" : "held",
    }));
  const blockedBy = [
    ...asList(previewAcceptancePackage.acceptance?.blockedBy).map((blocker) => `preview:${blocker}`),
    ...asList(clientRuntimeAdoptionState.blockedBy).map((blocker) => `client-runtime:${blocker}`),
    ...asList(operationalHealthState.degradedReasons).map((reason) => `health:${reason}`),
    ...asList(controlPlaneState.blockedBy).map((blocker) => `control-plane:${blocker}`),
    ...asList(workflowControlPacket.blockedBy).map((blocker) => `workflow-control:${blocker}`),
    ...asList(providerHandoffEnvelope.blockedBy).map((blocker) => `provider-handoff:${blocker}`),
    ...asList(operatorResumePacket.blockedBy).map((blocker) => `operator-resume:${blocker}`),
    ...asList(releaseEvidenceLedger.blockedBy).map((blocker) => `release-ledger:${blocker}`),
    ...asList(syscallDispatchGate.blockedBy).map((blocker) => `syscall-dispatch-gate:${blocker}`),
    ...asList(analyticsExportBundle.blockedBy).map((blocker) => `analytics-export:${blocker}`),
  ].sort();
  const pendingBy = [
    ...asList(previewAcceptancePackage.readiness?.pendingChecks).map((check) => `preview:${check}`),
    ...asList(clientRuntimeAdoptionState.missingClientState).map((key) => `client-state:${key}`),
    ...(operationalHealthState.retryable ? ["health:retry-scheduled"] : []),
    ...asList(workflowControlPacket.pendingBy).map((pending) => `workflow-control:${pending}`),
    ...asList(providerHandoffEnvelope.pendingBy).map((pending) => `provider-handoff:${pending}`),
    ...asList(operatorResumePacket.pendingBy).map((pending) => `operator-resume:${pending}`),
    ...asList(syscallDispatchGate.pendingBy).map((pending) => `syscall-dispatch-gate:${pending}`),
  ].sort();
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && providerHandoffEnvelope.acceptedForProviderSync === true
    && operatorResumePacket.acceptedForProviderSync === true
    && releaseEvidenceLedger.releaseReady === true
    && syscallDispatchGate.acceptedForSyscallDispatch === true;
  const nextCommand = commandQueue.find((command) => command.enabled)
    || commandQueue.find((command) => command.dispatchState === "held")
    || null;

  return {
    format: "aios.mailchimp.memory.operatorActionEnvelope.v1",
    envelopeId: `memory-operator-action:${stableKey([
      contract.id,
      providerHandoffEnvelope.packetId,
      operatorResumePacket.packetId,
      releaseEvidenceLedger.ledgerId,
      releaseReady,
    ])}`,
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : releaseReady ? "release-ready" : "waiting",
    releaseReady,
    restartSafe: releaseReady
      && operatorResumePacket.restartSafe === true
      && releaseEvidenceLedger.restartSafe === true
      && syscallDispatchGate.restartSafe === true,
    blockedBy,
    pendingBy,
    commandQueue,
    enabledCommands: commandQueue.filter((command) => command.enabled).map((command) => command.command),
    statusRows: [
      {
        key: "preview-acceptance",
        status: previewAcceptancePackage.readiness.status,
        accepted: previewAcceptancePackage.acceptance.acceptedForRuntime === true,
        blockedBy: asList(previewAcceptancePackage.acceptance.blockedBy),
        pendingBy: asList(previewAcceptancePackage.readiness.pendingChecks),
        nextAction: previewAcceptancePackage.readiness.nextAction,
      },
      {
        key: "client-runtime",
        status: clientRuntimeAdoptionState.hydrated ? "hydrated" : "needs-client-state",
        accepted: clientRuntimeAdoptionState.acceptedForRuntime === true,
        blockedBy: asList(clientRuntimeAdoptionState.blockedBy),
        pendingBy: asList(clientRuntimeAdoptionState.missingClientState),
        nextAction: clientRuntimeAdoptionState.nextAction,
      },
      {
        key: "provider-handoff",
        status: providerHandoffEnvelope.status,
        accepted: providerHandoffEnvelope.acceptedForProviderSync === true,
        blockedBy: asList(providerHandoffEnvelope.blockedBy),
        pendingBy: asList(providerHandoffEnvelope.pendingBy),
        nextAction: providerHandoffEnvelope.nextAction,
      },
      {
        key: "operator-resume",
        status: operatorResumePacket.status,
        accepted: operatorResumePacket.acceptedForProviderSync === true,
        blockedBy: asList(operatorResumePacket.blockedBy),
        pendingBy: asList(operatorResumePacket.pendingBy),
        nextAction: operatorResumePacket.nextAction,
      },
      {
        key: "syscall-dispatch-gate",
        status: syscallDispatchGate.status,
        accepted: syscallDispatchGate.acceptedForSyscallDispatch === true,
        blockedBy: asList(syscallDispatchGate.blockedBy),
        pendingBy: asList(syscallDispatchGate.pendingBy),
        nextAction: syscallDispatchGate.nextAction,
      },
    ],
    nextAction: blockedBy.length
      ? "repair-memory-operator-action-envelope"
      : pendingBy.length
        ? nextCommand?.command || "wait-for-memory-operator-action"
      : releaseReady
        ? "release-memory-operator-action"
        : nextCommand?.command || "hold-memory-operator-action",
  };
}

function buildMemoryRestartStatusLedger(
  contract,
  mounts,
  clientRuntimeAdoptionState,
  operationalHealthState,
  downstreamStatusPacket,
  controlPlaneState,
  workflowControlPacket,
  clientWorkflowHandoffPacket,
  providerHandoffEnvelope,
  operatorResumePacket,
  releaseEvidenceLedger,
  syscallDispatchGate,
  analyticsExportBundle,
  operatorActionEnvelope,
) {
  const rows = [
    {
      stage: "client-runtime",
      status: clientRuntimeAdoptionState.status,
      stateKey: clientRuntimeAdoptionState.stateKey,
      accepted: clientRuntimeAdoptionState.acceptedForRuntime === true,
      providerAccepted: clientRuntimeAdoptionState.acceptedForProviderSync === true,
      restartSafe: clientRuntimeAdoptionState.hydrated === true,
      blockedBy: asList(clientRuntimeAdoptionState.blockedBy),
      pendingBy: asList(clientRuntimeAdoptionState.missingClientState).map((key) => `client-state:${key}`),
      commandIds: asList(clientRuntimeAdoptionState.routeCommands)
        .filter((command) => command.idempotencyKey)
        .map((command) => command.idempotencyKey),
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      stage: "health",
      status: operationalHealthState.status,
      stateKey: operationalHealthState.healthId,
      accepted: operationalHealthState.status === "healthy",
      providerAccepted: operationalHealthState.providerAvailable === true && operationalHealthState.adapterHealthy === true,
      restartSafe: operationalHealthState.retryable !== true,
      blockedBy: asList(operationalHealthState.actionableErrors)
        .filter((error) => error.severity === "error")
        .map((error) => error.code),
      pendingBy: operationalHealthState.retryable ? ["health:retry-scheduled"] : [],
      commandIds: asList(operationalHealthState.commands)
        .filter((command) => command.idempotencyKey)
        .map((command) => command.idempotencyKey),
      nextAction: operationalHealthState.nextAction,
    },
    {
      stage: "downstream-status",
      status: downstreamStatusPacket.status,
      stateKey: downstreamStatusPacket.packetId,
      accepted: downstreamStatusPacket.acceptedForRuntime === true,
      providerAccepted: downstreamStatusPacket.acceptedForProviderSync === true,
      restartSafe: downstreamStatusPacket.restartSafe !== false,
      blockedBy: asList(downstreamStatusPacket.blockedBy),
      pendingBy: asList(downstreamStatusPacket.pendingBy),
      commandIds: asList(downstreamStatusPacket.commands)
        .filter((command) => command.idempotencyKey)
        .map((command) => command.idempotencyKey),
      nextAction: downstreamStatusPacket.nextAction,
    },
    {
      stage: "control-plane",
      status: controlPlaneState.status,
      stateKey: controlPlaneState.controlPlaneId,
      accepted: controlPlaneState.releaseReady === true || controlPlaneState.status !== "blocked",
      providerAccepted: controlPlaneState.acceptedForProviderSync === true || controlPlaneState.status !== "blocked",
      restartSafe: controlPlaneState.restartSafe !== false,
      blockedBy: asList(controlPlaneState.blockedBy),
      pendingBy: asList(controlPlaneState.pendingBy),
      commandIds: asList(controlPlaneState.commands)
        .filter((command) => command.idempotencyKey)
        .map((command) => command.idempotencyKey),
      nextAction: controlPlaneState.nextAction,
    },
    {
      stage: "workflow-control",
      status: workflowControlPacket.status,
      stateKey: workflowControlPacket.packetId,
      accepted: workflowControlPacket.acceptedForRuntime === true,
      providerAccepted: workflowControlPacket.acceptedForProviderSync === true,
      restartSafe: workflowControlPacket.restartSafe !== false,
      blockedBy: asList(workflowControlPacket.blockedBy),
      pendingBy: asList(workflowControlPacket.pendingBy),
      commandIds: asList(workflowControlPacket.commands)
        .filter((command) => command.idempotencyKey)
        .map((command) => command.idempotencyKey),
      nextAction: workflowControlPacket.nextAction,
    },
    {
      stage: "client-workflow-handoff",
      status: clientWorkflowHandoffPacket.status,
      stateKey: clientWorkflowHandoffPacket.packetId,
      accepted: clientWorkflowHandoffPacket.acceptedForRuntime === true,
      providerAccepted: clientWorkflowHandoffPacket.acceptedForProviderSync === true,
      restartSafe: clientWorkflowHandoffPacket.restartSafe !== false,
      blockedBy: asList(clientWorkflowHandoffPacket.blockedBy),
      pendingBy: asList(clientWorkflowHandoffPacket.pendingBy),
      commandIds: asList(clientWorkflowHandoffPacket.commands)
        .filter((command) => command.idempotencyKey)
        .map((command) => command.idempotencyKey),
      nextAction: clientWorkflowHandoffPacket.nextAction,
    },
    {
      stage: "provider-handoff",
      status: providerHandoffEnvelope.status,
      stateKey: providerHandoffEnvelope.packetId,
      accepted: providerHandoffEnvelope.acceptedForRuntime === true,
      providerAccepted: providerHandoffEnvelope.acceptedForProviderSync === true,
      restartSafe: providerHandoffEnvelope.restartSafe === true,
      blockedBy: asList(providerHandoffEnvelope.blockedBy),
      pendingBy: asList(providerHandoffEnvelope.pendingBy),
      commandIds: asList(providerHandoffEnvelope.commands)
        .filter((command) => command.idempotencyKey)
        .map((command) => command.idempotencyKey),
      nextAction: providerHandoffEnvelope.nextAction,
    },
    {
      stage: "operator-resume",
      status: operatorResumePacket.status,
      stateKey: operatorResumePacket.packetId,
      accepted: operatorResumePacket.acceptedForRuntime === true,
      providerAccepted: operatorResumePacket.acceptedForProviderSync === true,
      restartSafe: operatorResumePacket.restartSafe === true,
      blockedBy: asList(operatorResumePacket.blockedBy),
      pendingBy: asList(operatorResumePacket.pendingBy),
      commandIds: asList(operatorResumePacket.commands)
        .filter((command) => command.idempotencyKey)
        .map((command) => command.idempotencyKey),
      nextAction: operatorResumePacket.nextAction,
    },
    {
      stage: "release-ledger",
      status: releaseEvidenceLedger.status,
      stateKey: releaseEvidenceLedger.ledgerId,
      accepted: releaseEvidenceLedger.releaseReady === true,
      providerAccepted: releaseEvidenceLedger.releaseReady === true,
      restartSafe: releaseEvidenceLedger.restartSafe === true,
      blockedBy: asList(releaseEvidenceLedger.blockedBy),
      pendingBy: asList(releaseEvidenceLedger.pendingBy),
      commandIds: asList(releaseEvidenceLedger.commands)
        .filter((command) => command.idempotencyKey)
        .map((command) => command.idempotencyKey),
      nextAction: releaseEvidenceLedger.nextAction,
    },
    {
      stage: "syscall-dispatch-gate",
      status: syscallDispatchGate.status,
      stateKey: syscallDispatchGate.gateId,
      accepted: syscallDispatchGate.acceptedForSyscallDispatch === true,
      providerAccepted: syscallDispatchGate.acceptedForSyscallDispatch === true,
      restartSafe: syscallDispatchGate.restartSafe === true,
      blockedBy: asList(syscallDispatchGate.blockedBy),
      pendingBy: asList(syscallDispatchGate.pendingBy),
      commandIds: asList(syscallDispatchGate.commands)
        .filter((command) => command.idempotencyKey)
        .map((command) => command.idempotencyKey),
      nextAction: syscallDispatchGate.nextAction,
    },
    {
      stage: "analytics-export",
      status: analyticsExportBundle.status,
      stateKey: analyticsExportBundle.bundleId,
      accepted: analyticsExportBundle.exportReady === true,
      providerAccepted: analyticsExportBundle.exportReady === true,
      restartSafe: analyticsExportBundle.restartSafe !== false,
      blockedBy: asList(analyticsExportBundle.blockedBy),
      pendingBy: asList(analyticsExportBundle.pendingBy),
      commandIds: asList(analyticsExportBundle.commands)
        .filter((command) => command.idempotencyKey)
        .map((command) => command.idempotencyKey),
      nextAction: analyticsExportBundle.nextAction,
    },
    {
      stage: "operator-action",
      status: operatorActionEnvelope.status,
      stateKey: operatorActionEnvelope.envelopeId,
      accepted: operatorActionEnvelope.releaseReady === true,
      providerAccepted: operatorActionEnvelope.releaseReady === true,
      restartSafe: operatorActionEnvelope.restartSafe === true,
      blockedBy: asList(operatorActionEnvelope.blockedBy),
      pendingBy: asList(operatorActionEnvelope.pendingBy),
      commandIds: asList(operatorActionEnvelope.commandQueue)
        .filter((command) => command.idempotencyKey)
        .map((command) => command.idempotencyKey),
      nextAction: operatorActionEnvelope.nextAction,
    },
  ].map((row, index) => ({
    rowId: `memory-restart-row:${stableKey([
      contract.id,
      row.stage,
      row.status,
      row.stateKey,
      index,
    ])}`,
    index,
    ...row,
    blockedBy: [...new Set(row.blockedBy)].sort(),
    pendingBy: [...new Set(row.pendingBy)].sort(),
    commandIds: [...new Set(row.commandIds)].sort(),
  }));
  const blockedBy = rows.flatMap((row) => row.blockedBy.map((blocker) => `${row.stage}:${blocker}`)).sort();
  const pendingBy = rows.flatMap((row) => row.pendingBy.map((pending) => `${row.stage}:${pending}`)).sort();
  const unsafeRows = rows.filter((row) => row.restartSafe === false).map((row) => row.stage).sort();
  const providerRows = rows.filter((row) => row.stage.includes("provider")
    || row.stage === "operator-resume"
    || row.stage === "release-ledger"
    || row.stage === "operator-action");
  const acceptedForRuntime = blockedBy.length === 0
    && rows.every((row) => row.accepted || row.stage === "analytics-export");
  const acceptedForProviderSync = acceptedForRuntime
    && providerRows.every((row) => row.providerAccepted === true)
    && syscallDispatchGate.acceptedForSyscallDispatch === true;
  const restartSafe = blockedBy.length === 0
    && unsafeRows.length === 0
    && rows.every((row) => row.stateKey);
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : acceptedForProviderSync
        ? "provider-sync-ready"
        : acceptedForRuntime
          ? "runtime-ready"
          : "waiting";
  const resumeToken = `memory-restart-resume:${stableKey([
    clientRuntimeAdoptionState.continuationToken,
    rows.map((row) => [row.stage, row.status, row.stateKey]),
    status,
  ])}`;
  const nextAction = blockedBy.length
    ? rows.find((row) => row.blockedBy.length)?.nextAction || "repair-memory-restart-ledger"
    : pendingBy.length
      ? rows.find((row) => row.pendingBy.length)?.nextAction || "continue-memory-restart-ledger"
      : acceptedForProviderSync
        ? "resume-memory-provider-sync"
        : acceptedForRuntime
          ? "resume-memory-runtime"
          : "hold-memory-restart-ledger";

  return {
    format: "aios.mailchimp.memory.restartStatusLedger.v1",
    ledgerId: `memory-restart-ledger:${stableKey([
      contract.id,
      clientRuntimeAdoptionState.stateKey,
      status,
      rows.map((row) => row.rowId),
    ])}`,
    status,
    acceptedForRuntime,
    acceptedForProviderSync,
    restartSafe,
    resumeToken,
    statusChannel: acceptedForProviderSync
      ? "memory.restart.mailchimp.provider-sync"
      : "memory.restart.mailchimp.runtime",
    blockedBy,
    pendingBy,
    unsafeRows,
    counters: {
      rows: rows.length,
      acceptedRows: rows.filter((row) => row.accepted).length,
      providerAcceptedRows: rows.filter((row) => row.providerAccepted).length,
      restartSafeRows: rows.filter((row) => row.restartSafe !== false).length,
      blockedRows: rows.filter((row) => row.blockedBy.length).length,
      pendingRows: rows.filter((row) => row.pendingBy.length).length,
      mounts: mounts.length,
    },
    rows,
    persistedState: {
      ledgerId: `memory-restart-ledger-state:${stableKey([clientRuntimeAdoptionState.stateKey, status])}`,
      stateKey: clientRuntimeAdoptionState.stateKey,
      continuationToken: clientRuntimeAdoptionState.continuationToken,
      resumeToken,
      providerHandoffPacketId: providerHandoffEnvelope.packetId,
      operatorResumePacketId: operatorResumePacket.packetId,
      releaseEvidenceLedgerId: releaseEvidenceLedger.ledgerId,
      syscallDispatchGateId: syscallDispatchGate.gateId,
      status,
      restartSafe,
      nextAction,
    },
    commands: [
      {
        command: "persist-memory-restart-ledger",
        enabled: true,
        idempotencyKey: `memory-restart-ledger:${stableKey([clientRuntimeAdoptionState.stateKey, status])}`,
      },
      {
        command: "resume-memory-runtime",
        enabled: acceptedForRuntime && restartSafe,
        resumeToken,
        idempotencyKey: `memory-runtime-resume:${resumeToken}`,
      },
      {
        command: "resume-memory-provider-sync",
        enabled: acceptedForProviderSync && restartSafe,
        resumeToken,
        idempotencyKey: `memory-provider-resume:${providerHandoffEnvelope.packetId}`,
      },
    ],
    nextAction,
  };
}

function buildMemoryReleaseRiskBudget(
  contract,
  mounts,
  operationalHealthState,
  downstreamStatusPacket,
  providerHandoffEnvelope,
  operatorResumePacket,
  releaseEvidenceLedger,
  syscallDispatchGate,
  providerAssertionDigest,
  analyticsExportBundle,
  restartStatusLedger,
) {
  const releaseRows = [
    {
      gate: "operational-health",
      packetId: operationalHealthState.healthId,
      status: operationalHealthState.status,
      accepted: operationalHealthState.status === "healthy",
      restartSafe: operationalHealthState.status !== "failed",
      retryable: operationalHealthState.retryable === true,
      blockedBy: asList(operationalHealthState.actionableErrors)
        .filter((error) => error.severity === "error" || error.code?.includes("unavailable"))
        .map((error) => `health:${error.code}`),
      pendingBy: operationalHealthState.retryable ? ["health:retry-scheduled"] : [],
      nextAction: operationalHealthState.nextAction,
    },
    {
      gate: "downstream-status",
      packetId: downstreamStatusPacket.packetId,
      status: downstreamStatusPacket.status,
      accepted: downstreamStatusPacket.acceptedForProviderSync === true,
      restartSafe: downstreamStatusPacket.restartSafe !== false,
      retryable: downstreamStatusPacket.retryable === true,
      blockedBy: asList(downstreamStatusPacket.blockedBy),
      pendingBy: asList(downstreamStatusPacket.pendingBy),
      nextAction: downstreamStatusPacket.nextAction,
    },
    {
      gate: "provider-handoff",
      packetId: providerHandoffEnvelope.packetId,
      status: providerHandoffEnvelope.status,
      accepted: providerHandoffEnvelope.acceptedForProviderSync === true,
      restartSafe: providerHandoffEnvelope.restartSafe !== false,
      retryable: false,
      blockedBy: asList(providerHandoffEnvelope.blockedBy),
      pendingBy: asList(providerHandoffEnvelope.pendingBy),
      nextAction: providerHandoffEnvelope.nextAction,
    },
    {
      gate: "operator-resume",
      packetId: operatorResumePacket.packetId,
      status: operatorResumePacket.status,
      accepted: operatorResumePacket.acceptedForProviderSync === true,
      restartSafe: operatorResumePacket.restartSafe !== false,
      retryable: false,
      blockedBy: asList(operatorResumePacket.blockedBy),
      pendingBy: asList(operatorResumePacket.pendingBy),
      nextAction: operatorResumePacket.nextAction,
    },
    {
      gate: "release-evidence",
      packetId: releaseEvidenceLedger.ledgerId,
      status: releaseEvidenceLedger.status,
      accepted: releaseEvidenceLedger.releaseReady === true,
      restartSafe: releaseEvidenceLedger.restartSafe !== false,
      retryable: false,
      blockedBy: asList(releaseEvidenceLedger.blockedBy),
      pendingBy: asList(releaseEvidenceLedger.pendingBy),
      nextAction: releaseEvidenceLedger.nextAction,
    },
    {
      gate: "syscall-dispatch",
      packetId: syscallDispatchGate.gateId,
      status: syscallDispatchGate.status,
      accepted: syscallDispatchGate.acceptedForSyscallDispatch === true,
      restartSafe: syscallDispatchGate.restartSafe !== false,
      retryable: syscallDispatchGate.retryable === true,
      blockedBy: asList(syscallDispatchGate.blockedBy),
      pendingBy: asList(syscallDispatchGate.pendingBy),
      nextAction: syscallDispatchGate.nextAction,
    },
    {
      gate: "provider-assertions",
      packetId: providerAssertionDigest.digestId,
      status: providerAssertionDigest.status,
      accepted: providerAssertionDigest.acceptedForSyscallDispatch === true,
      restartSafe: providerAssertionDigest.restartSafe !== false,
      retryable: false,
      blockedBy: asList(providerAssertionDigest.blockedBy),
      pendingBy: asList(providerAssertionDigest.pendingBy),
      nextAction: providerAssertionDigest.nextAction,
    },
    {
      gate: "analytics-export",
      packetId: analyticsExportBundle.bundleId,
      status: analyticsExportBundle.status,
      accepted: analyticsExportBundle.exportReady === true,
      restartSafe: analyticsExportBundle.restartSafe !== false,
      retryable: false,
      blockedBy: asList(analyticsExportBundle.blockedBy),
      pendingBy: asList(analyticsExportBundle.pendingBy),
      nextAction: analyticsExportBundle.nextAction,
    },
    {
      gate: "restart-ledger",
      packetId: restartStatusLedger.ledgerId,
      status: restartStatusLedger.status,
      accepted: restartStatusLedger.acceptedForProviderSync === true,
      restartSafe: restartStatusLedger.restartSafe === true,
      retryable: false,
      blockedBy: asList(restartStatusLedger.blockedBy),
      pendingBy: asList(restartStatusLedger.pendingBy),
      nextAction: restartStatusLedger.nextAction,
    },
  ].map((row) => ({
    ...row,
    riskScore: (row.accepted ? 0 : 3)
      + (row.restartSafe ? 0 : 2)
      + row.blockedBy.length
      + (row.pendingBy.length ? 1 : 0)
      + (row.retryable ? 1 : 0),
  }));
  const blockedBy = releaseRows.flatMap((row) => row.blockedBy.map((blocker) => `${row.gate}:${blocker}`)).sort();
  const pendingBy = releaseRows.flatMap((row) => row.pendingBy.map((pending) => `${row.gate}:${pending}`)).sort();
  const unsafeRows = releaseRows.filter((row) => row.restartSafe === false).map((row) => row.gate).sort();
  const retryRows = releaseRows.filter((row) => row.retryable).map((row) => row.gate).sort();
  const totalRiskScore = releaseRows.reduce((total, row) => total + row.riskScore, 0);
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && unsafeRows.length === 0
    && releaseRows.every((row) => row.accepted);
  const nextRisk = releaseRows
    .filter((row) => row.riskScore > 0)
    .sort((left, right) => right.riskScore - left.riskScore || left.gate.localeCompare(right.gate))[0];

  return {
    format: "aios.mailchimp.memory.releaseRiskBudget.v1",
    budgetId: `memory-release-risk:${stableKey([
      contract.id,
      releaseRows.map((row) => [row.gate, row.status, row.riskScore]),
      totalRiskScore,
    ])}`,
    provider: "mailchimp",
    status: blockedBy.length
      ? "blocked"
      : pendingBy.length || retryRows.length
        ? "watching"
        : releaseReady
          ? "release-ready"
          : "waiting",
    releaseReady,
    acceptedForSyscallDispatch: releaseReady && syscallDispatchGate.acceptedForSyscallDispatch === true,
    restartSafe: unsafeRows.length === 0 && restartStatusLedger.restartSafe === true,
    totalRiskScore,
    counters: {
      mounts: mounts.length,
      gates: releaseRows.length,
      acceptedGates: releaseRows.filter((row) => row.accepted).length,
      blockedGates: releaseRows.filter((row) => row.blockedBy.length).length,
      pendingGates: releaseRows.filter((row) => row.pendingBy.length).length,
      unsafeGates: unsafeRows.length,
      retryableGates: retryRows.length,
    },
    blockedBy,
    pendingBy,
    unsafeRows,
    retryRows,
    releaseRows,
    commands: [
      {
        command: "persist-memory-release-risk-budget",
        enabled: true,
        idempotencyKey: `memory-release-risk:${stableKey([contract.id, totalRiskScore])}`,
      },
      {
        command: "release-memory-risk-budget",
        enabled: releaseReady,
        idempotencyKey: `memory-release-ready:${restartStatusLedger.ledgerId}`,
      },
      {
        command: "schedule-memory-risk-retry",
        enabled: retryRows.length > 0 && operationalHealthState.retryable === true,
        delaySeconds: operationalHealthState.nextDelaySeconds,
        idempotencyKey: `memory-release-risk-retry:${stableKey([
          operationalHealthState.healthId,
          operationalHealthState.attempts + 1,
        ])}`,
      },
    ],
    nextAction: blockedBy.length
      ? nextRisk?.nextAction || "repair-memory-release-risk"
      : retryRows.length
        ? "schedule-memory-risk-retry"
        : pendingBy.length
          ? nextRisk?.nextAction || "wait-for-memory-release-risk"
          : releaseReady
            ? "release-memory-risk-budget"
            : nextRisk?.nextAction || "hold-memory-release-risk",
  };
}

function buildMemoryAdapterResumeReceipt(
  contract,
  mounts,
  providerContinuationContract,
  clientRuntimeAdoptionState,
  operationalHealthState,
  restartStatusLedger,
  releaseRiskBudget,
  operatorReleasePacket,
  dispatchReleaseLedger,
) {
  const providerSyncMounts = new Set(providerContinuationContract.externalHandoffState.syncMounts);
  const selectedMounts = mounts.filter((mount) => providerSyncMounts.has(mount.mount));
  const statusRows = [
    {
      source: "client-runtime",
      packetId: clientRuntimeAdoptionState.adoptionId,
      status: clientRuntimeAdoptionState.status,
      acceptedForAdapterResume: clientRuntimeAdoptionState.acceptedForProviderSync === true,
      restartSafe: clientRuntimeAdoptionState.hydrated === true,
      blockedBy: asList(clientRuntimeAdoptionState.blockedBy)
        .concat(asList(clientRuntimeAdoptionState.missingClientState).map((key) => `client-state:${key}`)),
      pendingBy: [],
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      source: "operational-health",
      packetId: operationalHealthState.healthId,
      status: operationalHealthState.status,
      acceptedForAdapterResume: operationalHealthState.status === "healthy",
      restartSafe: operationalHealthState.status !== "failed",
      blockedBy: asList(operationalHealthState.actionableErrors)
        .filter((error) => error.severity === "error" || error.code?.includes("unavailable"))
        .map((error) => `health:${error.code}`),
      pendingBy: operationalHealthState.retryable ? ["health:retry-scheduled"] : [],
      nextAction: operationalHealthState.nextAction,
    },
    {
      source: "restart-ledger",
      packetId: restartStatusLedger.ledgerId,
      status: restartStatusLedger.status,
      acceptedForAdapterResume: restartStatusLedger.acceptedForProviderSync === true,
      restartSafe: restartStatusLedger.restartSafe === true,
      blockedBy: asList(restartStatusLedger.blockedBy),
      pendingBy: asList(restartStatusLedger.pendingBy),
      nextAction: restartStatusLedger.nextAction,
    },
    {
      source: "release-risk",
      packetId: releaseRiskBudget.budgetId,
      status: releaseRiskBudget.status,
      acceptedForAdapterResume: releaseRiskBudget.acceptedForSyscallDispatch === true,
      restartSafe: releaseRiskBudget.restartSafe === true,
      blockedBy: asList(releaseRiskBudget.blockedBy),
      pendingBy: asList(releaseRiskBudget.pendingBy),
      nextAction: releaseRiskBudget.nextAction,
    },
    {
      source: "operator-release",
      packetId: operatorReleasePacket.packetId,
      status: operatorReleasePacket.status,
      acceptedForAdapterResume: operatorReleasePacket.acceptedForSyscallDispatch === true
        && operatorReleasePacket.acceptedForProviderSync === true,
      restartSafe: operatorReleasePacket.restartSafe === true,
      blockedBy: asList(operatorReleasePacket.blockedBy),
      pendingBy: asList(operatorReleasePacket.pendingBy),
      nextAction: operatorReleasePacket.nextAction,
    },
    {
      source: "dispatch-release",
      packetId: dispatchReleaseLedger.ledgerId,
      status: dispatchReleaseLedger.status,
      acceptedForAdapterResume: dispatchReleaseLedger.acceptedForSyscallDispatch === true,
      restartSafe: dispatchReleaseLedger.restartSafe === true,
      blockedBy: asList(dispatchReleaseLedger.blockedBy),
      pendingBy: asList(dispatchReleaseLedger.pendingBy),
      nextAction: dispatchReleaseLedger.nextAction,
    },
  ].map((row, index) => ({
    rowId: `memory-adapter-resume-row:${stableKey([
      contract.id,
      row.source,
      row.packetId,
      row.status,
      index,
    ])}`,
    index,
    ...row,
    blockedBy: [...new Set(row.blockedBy)].sort(),
    pendingBy: [...new Set(row.pendingBy)].sort(),
  }));
  const blockedBy = statusRows
    .flatMap((row) => row.blockedBy.map((blocker) => `${row.source}:${blocker}`))
    .sort();
  const pendingBy = statusRows
    .flatMap((row) => row.pendingBy.map((pending) => `${row.source}:${pending}`))
    .sort();
  const unsafeRows = statusRows.filter((row) => row.restartSafe === false).map((row) => row.source).sort();
  const acceptedForAdapterResume = selectedMounts.length > 0
    && blockedBy.length === 0
    && pendingBy.length === 0
    && unsafeRows.length === 0
    && statusRows.every((row) => row.acceptedForAdapterResume === true);
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : acceptedForAdapterResume
        ? "adapter-resume-ready"
        : selectedMounts.length
          ? "waiting"
          : "not-required";
  const receiptId = `memory-adapter-resume:${stableKey([
    contract.id,
    providerContinuationContract.continuationId,
    dispatchReleaseLedger.ledgerId,
    status,
  ])}`;
  const resumeToken = `memory-adapter-resume-token:${stableKey([
    clientRuntimeAdoptionState.continuationToken,
    receiptId,
    status,
  ])}`;
  const nextAction = blockedBy.length
    ? statusRows.find((row) => row.blockedBy.length)?.nextAction || "repair-memory-adapter-resume"
    : pendingBy.length
      ? statusRows.find((row) => row.pendingBy.length)?.nextAction || "wait-for-memory-adapter-resume"
      : acceptedForAdapterResume
        ? "release-memory-adapter-resume"
        : selectedMounts.length
          ? "hold-memory-adapter-resume"
          : "continue-local-runtime";

  return {
    format: "aios.mailchimp.memory.adapterResumeReceipt.v1",
    receiptId,
    provider: "mailchimp",
    status,
    acceptedForAdapterResume,
    acceptedForProviderSync: acceptedForAdapterResume,
    acceptedForSyscallDispatch: acceptedForAdapterResume,
    restartSafe: unsafeRows.length === 0 && statusRows.every((row) => row.restartSafe !== false),
    retryable: operationalHealthState.retryable === true,
    nextDelaySeconds: operationalHealthState.retryable ? operationalHealthState.nextDelaySeconds : null,
    continuationId: providerContinuationContract.continuationId,
    dispatchReleaseLedgerId: dispatchReleaseLedger.ledgerId,
    resumeToken,
    stateKey: clientRuntimeAdoptionState.stateKey,
    statusChannel: acceptedForAdapterResume
      ? "memory.adapter-resume.mailchimp.ready"
      : "memory.adapter-resume.mailchimp",
    selectedMounts: selectedMounts.map((mount) => mount.mount).sort(),
    blockedBy,
    pendingBy,
    unsafeRows,
    statusRows,
    mountRows: selectedMounts.map((mount) => ({
      mount: mount.mount,
      path: mount.path,
      status: mount.status,
      selectedForProviderSync: true,
      recoveryCursor: mount.handoff.recoveryCursor,
      restartSafe: restartStatusLedger.restartSafe === true && dispatchReleaseLedger.restartSafe === true,
      nextAction: acceptedForAdapterResume ? "resume-memory-provider-sync" : nextAction,
    })),
    commands: [
      {
        command: "persist-memory-adapter-resume-receipt",
        enabled: true,
        idempotencyKey: `memory-adapter-resume:${receiptId}`,
      },
      {
        command: "release-memory-adapter-resume",
        enabled: acceptedForAdapterResume,
        resumeToken,
        idempotencyKey: `memory-adapter-resume-release:${dispatchReleaseLedger.ledgerId}`,
      },
      {
        command: "schedule-memory-adapter-resume-retry",
        enabled: operationalHealthState.retryable === true && acceptedForAdapterResume === false,
        delaySeconds: operationalHealthState.nextDelaySeconds,
        idempotencyKey: `memory-adapter-resume-retry:${stableKey([
          operationalHealthState.healthId,
          operationalHealthState.attempts + 1,
        ])}`,
      },
    ],
    payloadShape: {
      receiptId: "string",
      status: "string",
      acceptedForAdapterResume: "boolean",
      resumeToken: "string",
      statusRows: "array",
      mountRows: "array",
      commands: "array",
    },
    nextAction,
  };
}

function buildMemoryReplayStatusReceipt(
  contract,
  clientRuntimeAdoptionState,
  restartStatusLedger,
  runtimeDispatchReleaseReceipt,
  operationalTriagePacket,
  operatorCommandReceipt,
) {
  const replayRows = [
    {
      gate: "client-runtime-state",
      status: clientRuntimeAdoptionState.hydrated ? "hydrated" : "needs-client-state",
      accepted: clientRuntimeAdoptionState.hydrated === true,
      restartSafe: clientRuntimeAdoptionState.hydrated === true,
      stateKey: clientRuntimeAdoptionState.stateKey,
      blockedBy: asList(clientRuntimeAdoptionState.missingClientState).map((key) => `client-state:${key}`),
      pendingBy: [],
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      gate: "restart-ledger",
      status: restartStatusLedger.status || "unknown",
      accepted: restartStatusLedger.restartSafe === true,
      restartSafe: restartStatusLedger.restartSafe === true,
      stateKey: restartStatusLedger.ledgerId || null,
      blockedBy: asList(restartStatusLedger.blockedBy),
      pendingBy: asList(restartStatusLedger.pendingBy),
      nextAction: restartStatusLedger.nextAction || "review-memory-restart-ledger",
    },
    {
      gate: "runtime-dispatch-release",
      status: runtimeDispatchReleaseReceipt.status,
      accepted: runtimeDispatchReleaseReceipt.acceptedForSyscallDispatch === true,
      restartSafe: runtimeDispatchReleaseReceipt.restartSafe !== false,
      stateKey: runtimeDispatchReleaseReceipt.receiptId,
      blockedBy: asList(runtimeDispatchReleaseReceipt.blockedBy),
      pendingBy: asList(runtimeDispatchReleaseReceipt.pendingBy),
      nextAction: runtimeDispatchReleaseReceipt.nextAction,
    },
    {
      gate: "operational-triage",
      status: operationalTriagePacket.status,
      accepted: operationalTriagePacket.status === "handoff-ready",
      restartSafe: operationalTriagePacket.retryable !== true || operationalTriagePacket.nextDelaySeconds != null,
      stateKey: operationalTriagePacket.packetId,
      blockedBy: asList(operationalTriagePacket.blockedBy),
      pendingBy: asList(operationalTriagePacket.pendingBy),
      nextAction: operationalTriagePacket.nextAction,
    },
  ];
  const blockedBy = replayRows
    .flatMap((row) => row.blockedBy.map((blocker) => `${row.gate}:${blocker}`))
    .sort();
  const pendingBy = replayRows
    .flatMap((row) => row.pendingBy.map((pending) => `${row.gate}:${pending}`))
    .sort();
  const replayReady = blockedBy.length === 0
    && pendingBy.length === 0
    && replayRows.every((row) => row.accepted && row.restartSafe !== false);
  const receiptId = `memory-replay-status:${stableKey([
    contract.id,
    clientRuntimeAdoptionState.stateKey,
    restartStatusLedger.ledgerId,
    runtimeDispatchReleaseReceipt.receiptId,
    operationalTriagePacket.packetId,
    replayRows.map((row) => [row.gate, row.status]),
  ])}`;

  return {
    format: "aios.mailchimp.memory.replayStatusReceipt.v1",
    receiptId,
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : replayReady ? "replay-ready" : "waiting",
    replayReady,
    acceptedForRuntimeReplay: replayReady,
    acceptedForProviderReplay: replayReady && runtimeDispatchReleaseReceipt.acceptedForProviderSync === true,
    restartSafe: replayRows.every((row) => row.restartSafe !== false),
    stateKey: clientRuntimeAdoptionState.stateKey,
    continuationToken: clientRuntimeAdoptionState.continuationToken,
    blockedBy,
    pendingBy,
    replayRows,
    commands: [
      {
        command: "persist-memory-replay-status-receipt",
        enabled: true,
        idempotencyKey: `memory-replay-status:${receiptId}`,
        statusChannel: "memory.replay.mailchimp",
      },
      {
        command: "resume-memory-runtime-from-replay",
        enabled: replayReady,
        idempotencyKey: `memory-replay-resume:${stableKey([
          receiptId,
          clientRuntimeAdoptionState.continuationToken,
        ])}`,
      },
      {
        command: "retry-memory-operational-triage",
        enabled: operationalTriagePacket.retryable === true,
        delaySeconds: operationalTriagePacket.nextDelaySeconds,
        idempotencyKey: `memory-triage-retry:${operationalTriagePacket.packetId}`,
      },
    ],
    commandReceipt: {
      command: operatorCommandReceipt.command || "memory-operator-command",
      receiptId: operatorCommandReceipt.receiptId || null,
      accepted: operatorCommandReceipt.accepted === true || operatorCommandReceipt.releaseReady === true,
      restartSafe: operatorCommandReceipt.restartSafe !== false,
      status: operatorCommandReceipt.status || "unknown",
    },
    nextAction: blockedBy.length
      ? replayRows.find((row) => row.blockedBy.length)?.nextAction || "repair-memory-replay-status"
      : pendingBy.length
        ? replayRows.find((row) => row.pendingBy.length)?.nextAction || "wait-memory-replay-status"
      : replayReady
        ? "resume-memory-runtime-from-replay"
        : "persist-memory-replay-status-receipt",
  };
}

function buildMemorySyscallBoundaryReceipt(
  contract,
  mounts,
  tenantBoundaryState,
  boundaryLeasePacket,
  providerSyncReleaseReceipt,
  runtimeDispatchReleaseReceipt,
  replayStatusReceipt,
  operatorCommandReceipt,
) {
  const leaseRowsByMount = new Map(asList(boundaryLeasePacket.leaseRows).map((row) => [row.mount, row]));
  const providerRowsByMount = new Map(asList(providerSyncReleaseReceipt.mountRows).map((row) => [row.mount, row]));
  const commandRows = asList(operatorCommandReceipt.commandRows);
  const commandReleaseReady = operatorCommandReceipt.acceptedForSyscallDispatch === true
    && operatorCommandReceipt.restartSafe !== false
    && asList(operatorCommandReceipt.blockedBy).length === 0;
  const receiptRows = mounts.map((mount) => {
    const scoped = tenantBoundaryState.scopedMounts.find((row) => row.mount === mount.mount) || {};
    const lease = leaseRowsByMount.get(mount.mount) || {};
    const provider = providerRowsByMount.get(mount.mount) || {};
    const providerSyncRequested = lease.providerSyncRequested === true
      || provider.selectedForProviderSync === true
      || mount.providerSyncRequired === true;
    const rowBlockedBy = [
      ...asList(scoped.blockedBy).map((blocker) => `tenant:${blocker}`),
      ...asList(lease.blockedBy).map((blocker) => `lease:${blocker}`),
      ...asList(provider.blockedBy).map((blocker) => `provider-sync:${blocker}`),
      ...(lease.restartSafe === false ? ["lease:restart-unsafe"] : []),
      ...(provider.restartSafe === false ? ["provider-sync:restart-unsafe"] : []),
      ...(providerSyncRequested && provider.acceptedForProviderSync === false
        ? ["provider-sync:not-accepted"]
        : []),
    ].sort();
    const rowPendingBy = [
      ...asList(lease.pendingBy).map((pending) => `lease:${pending}`),
      ...asList(provider.pendingBy).map((pending) => `provider-sync:${pending}`),
      ...(providerSyncRequested
        && rowBlockedBy.length === 0
        && provider.acceptedForSyscallDispatch === false
        ? ["provider-sync:awaiting-syscall-dispatch-release"]
        : []),
    ].sort();
    return {
      mount: mount.mount,
      tenantId: scoped.tenantId || mount.tenantId || tenantBoundaryState.tenantId,
      workspaceId: scoped.workspaceId || mount.workspaceId || tenantBoundaryState.workspaceId,
      providerSyncRequested,
      acceptedForProviderSync: !providerSyncRequested
        || (provider.acceptedForProviderSync !== false
          && lease.acceptedForProviderSync !== false
          && rowBlockedBy.length === 0),
      acceptedForSyscallDispatch: rowBlockedBy.length === 0
        && rowPendingBy.length === 0
        && lease.releaseReady !== false
        && provider.acceptedForSyscallDispatch !== false,
      restartSafe: lease.restartSafe !== false && provider.restartSafe !== false,
      blockedBy: rowBlockedBy,
      pendingBy: rowPendingBy,
      nextAction: rowBlockedBy.length
        ? "repair-memory-syscall-boundary"
        : rowPendingBy.length
          ? "wait-memory-syscall-boundary"
          : "release-memory-syscall-boundary",
    };
  });
  const blockedBy = [
    ...asList(boundaryLeasePacket.blockedBy).map((blocker) => `boundary-lease:${blocker}`),
    ...asList(providerSyncReleaseReceipt.blockedBy).map((blocker) => `provider-sync:${blocker}`),
    ...asList(runtimeDispatchReleaseReceipt.blockedBy).map((blocker) => `runtime-dispatch:${blocker}`),
    ...asList(replayStatusReceipt.blockedBy).map((blocker) => `replay:${blocker}`),
    ...asList(operatorCommandReceipt.blockedBy).map((blocker) => `operator-command:${blocker}`),
    ...receiptRows.flatMap((row) => row.blockedBy.map((blocker) => `${row.mount}:${blocker}`)),
  ].sort();
  const pendingBy = [
    ...asList(boundaryLeasePacket.pendingBy).map((pending) => `boundary-lease:${pending}`),
    ...asList(providerSyncReleaseReceipt.pendingBy).map((pending) => `provider-sync:${pending}`),
    ...asList(runtimeDispatchReleaseReceipt.pendingBy).map((pending) => `runtime-dispatch:${pending}`),
    ...asList(replayStatusReceipt.pendingBy).map((pending) => `replay:${pending}`),
    ...asList(operatorCommandReceipt.pendingBy).map((pending) => `operator-command:${pending}`),
    ...receiptRows.flatMap((row) => row.pendingBy.map((pending) => `${row.mount}:${pending}`)),
  ].sort();
  const acceptedForProviderSync = blockedBy.length === 0
    && receiptRows.every((row) => row.acceptedForProviderSync !== false)
    && boundaryLeasePacket.acceptedForProviderSync === true
    && providerSyncReleaseReceipt.acceptedForProviderSync === true;
  const acceptedForSyscallDispatch = acceptedForProviderSync
    && pendingBy.length === 0
    && receiptRows.every((row) => row.acceptedForSyscallDispatch === true)
    && runtimeDispatchReleaseReceipt.acceptedForSyscallDispatch === true
    && replayStatusReceipt.acceptedForProviderReplay !== false
    && commandReleaseReady;
  const restartSafe = boundaryLeasePacket.restartSafe !== false
    && providerSyncReleaseReceipt.restartSafe !== false
    && runtimeDispatchReleaseReceipt.restartSafe !== false
    && replayStatusReceipt.restartSafe !== false
    && operatorCommandReceipt.restartSafe !== false
    && receiptRows.every((row) => row.restartSafe !== false);
  const receiptId = `memory-syscall-boundary:${stableKey([
    contract.id,
    tenantBoundaryState.auditId,
    boundaryLeasePacket.packetId,
    providerSyncReleaseReceipt.receiptId,
    runtimeDispatchReleaseReceipt.receiptId,
    receiptRows.map((row) => [row.mount, row.acceptedForSyscallDispatch, row.restartSafe]),
  ])}`;

  return {
    format: "aios.mailchimp.memory.syscallBoundaryReceipt.v1",
    receiptId,
    tenantAuditId: tenantBoundaryState.auditId,
    boundaryLeasePacketId: boundaryLeasePacket.packetId,
    providerSyncReleaseReceiptId: providerSyncReleaseReceipt.receiptId,
    runtimeDispatchReleaseReceiptId: runtimeDispatchReleaseReceipt.receiptId,
    replayStatusReceiptId: replayStatusReceipt.receiptId,
    operatorCommandReceiptId: operatorCommandReceipt.receiptId,
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : acceptedForSyscallDispatch ? "released" : "held",
    releaseReady: acceptedForSyscallDispatch,
    acceptedForProviderSync,
    acceptedForSyscallDispatch,
    restartSafe,
    blockedBy,
    pendingBy,
    receiptRows,
    commandSummary: {
      total: commandRows.length,
      enabled: commandRows.filter((row) => row.enabled === true).length,
      idempotent: commandRows.filter((row) => row.idempotencyKey).length,
      delayed: commandRows.filter((row) => row.delaySeconds != null).length,
    },
    commands: [
      {
        command: "persist-memory-syscall-boundary-receipt",
        enabled: true,
        idempotencyKey: `memory-syscall-boundary:${receiptId}`,
      },
      {
        command: "release-memory-syscall-dispatch",
        enabled: acceptedForSyscallDispatch,
        idempotencyKey: `memory-syscall-dispatch:${stableKey([receiptId, operatorCommandReceipt.receiptId])}`,
      },
      {
        command: "hold-memory-syscall-dispatch",
        enabled: !acceptedForSyscallDispatch,
        reasons: blockedBy.length ? blockedBy : pendingBy,
      },
    ],
    nextAction: blockedBy.length
      ? "repair-memory-syscall-boundary"
      : pendingBy.length
        ? "wait-memory-syscall-boundary"
        : acceptedForSyscallDispatch
          ? "release-memory-syscall-dispatch"
          : "hold-memory-syscall-dispatch",
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
  const boundaryLeasePacket = buildMemoryBoundaryLeasePacket(
    contract,
    mounts,
    lifecycleControls,
    tenantBoundaryState,
    source,
    options,
  );
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
  const operationalErrorRunbook = buildMemoryOperationalErrorRunbook(
    contract,
    mounts,
    lifecycleControls,
    tenantBoundaryState,
    providerContinuationContract,
    operationalHealthState,
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
  const workflowControlPacket = buildMemoryWorkflowControlPacket(
    contract,
    previewAcceptancePackage,
    clientRuntimeAdoptionState,
    downstreamStatusPacket,
    controlPlaneState,
  );
  const clientWorkflowHandoffPacket = buildMemoryClientWorkflowHandoffPacket(
    contract,
    mounts,
    previewAcceptancePackage,
    clientRuntimeAdoptionState,
    downstreamStatusPacket,
    controlPlaneState,
    workflowControlPacket,
    tenantBoundaryState,
  );
  const providerHandoffEnvelope = buildMemoryProviderHandoffEnvelope(
    contract,
    mounts,
    providerContinuationContract,
    previewAcceptancePackage,
    clientRuntimeAdoptionState,
    operationalHealthState,
    downstreamStatusPacket,
    controlPlaneState,
    workflowControlPacket,
    tenantBoundaryState,
  );
  const operatorResumePacket = buildMemoryOperatorResumePacket(
    contract,
    previewAcceptancePackage,
    clientRuntimeAdoptionState,
    operationalHealthState,
    downstreamStatusPacket,
    controlPlaneState,
    workflowControlPacket,
    providerHandoffEnvelope,
    memoryExportManifest,
  );
  const releaseEvidenceLedger = buildMemoryReleaseEvidenceLedger(
    contract,
    mounts,
    analytics,
    clientRuntimeAdoptionState,
    operationalHealthState,
    downstreamStatusPacket,
    controlPlaneState,
    workflowControlPacket,
    providerHandoffEnvelope,
    operatorResumePacket,
    memoryExportManifest,
  );
  const syscallDispatchGate = buildMemorySyscallDispatchGate(
    operationalHealthState,
    downstreamStatusPacket,
    controlPlaneState,
    workflowControlPacket,
    clientWorkflowHandoffPacket,
    boundaryLeasePacket,
    providerHandoffEnvelope,
    operatorResumePacket,
    releaseEvidenceLedger,
    clientRuntimeAdoptionState,
    lifecycleControls,
  );
  const providerAssertionDigest = buildMemoryProviderAssertionDigest(
    contract,
    mounts,
    tenantBoundaryState,
    boundaryLeasePacket,
    providerHandoffEnvelope,
    operatorResumePacket,
    releaseEvidenceLedger,
    syscallDispatchGate,
  );
  const analyticsExportBundle = buildMemoryAnalyticsExportBundle(
    contract,
    analytics,
    historySnapshots,
    exportSummary,
    timelineState,
    lifecycleCommandReport,
    memoryExportManifest,
    downstreamStatusPacket,
    operatorReportDigest,
    clientWorkflowHandoffPacket,
    providerHandoffEnvelope,
    operatorResumePacket,
    releaseEvidenceLedger,
    syscallDispatchGate,
    tenantBoundaryState,
  );
  const operatorActionEnvelope = buildMemoryOperatorActionEnvelope(
    contract,
    lifecycleControls,
    previewAcceptancePackage,
    clientRuntimeAdoptionState,
    operationalHealthState,
    controlPlaneState,
    workflowControlPacket,
    providerHandoffEnvelope,
    operatorResumePacket,
    releaseEvidenceLedger,
    syscallDispatchGate,
    analyticsExportBundle,
  );
  const restartStatusLedger = buildMemoryRestartStatusLedger(
    contract,
    mounts,
    clientRuntimeAdoptionState,
    operationalHealthState,
    downstreamStatusPacket,
    controlPlaneState,
    workflowControlPacket,
    clientWorkflowHandoffPacket,
    providerHandoffEnvelope,
    operatorResumePacket,
    releaseEvidenceLedger,
    syscallDispatchGate,
    analyticsExportBundle,
    operatorActionEnvelope,
  );
  const releaseRiskBudget = buildMemoryReleaseRiskBudget(
    contract,
    mounts,
    operationalHealthState,
    downstreamStatusPacket,
    providerHandoffEnvelope,
    operatorResumePacket,
    releaseEvidenceLedger,
    syscallDispatchGate,
    providerAssertionDigest,
    analyticsExportBundle,
    restartStatusLedger,
  );
  const operatorReleasePacket = buildMemoryOperatorReleasePacket(
    contract,
    controlPlaneState,
    clientWorkflowHandoffPacket,
    boundaryLeasePacket,
    providerHandoffEnvelope,
    operatorResumePacket,
    releaseEvidenceLedger,
    syscallDispatchGate,
    providerAssertionDigest,
    releaseRiskBudget,
    restartStatusLedger,
  );
  const providerSyncReleaseReceipt = buildMemoryProviderSyncReleaseReceipt(
    contract,
    providerContinuationContract,
    previewAcceptancePackage,
    clientRuntimeAdoptionState,
    boundaryLeasePacket,
    providerHandoffEnvelope,
    providerAssertionDigest,
    syscallDispatchGate,
    operatorReleasePacket,
  );
  const routeAcceptanceReceipt = buildMemoryRouteAcceptanceReceipt(
    contract,
    previewAcceptancePackage,
    clientRuntimeAdoptionState,
    downstreamStatusPacket,
    controlPlaneState,
    workflowControlPacket,
    clientWorkflowHandoffPacket,
    boundaryLeasePacket,
    providerHandoffEnvelope,
    operatorResumePacket,
    providerSyncReleaseReceipt,
    syscallDispatchGate,
    operatorReleasePacket,
  );
  const dispatchReleaseLedger = buildMemoryDispatchReleaseLedger(
    contract,
    mounts,
    clientRuntimeAdoptionState,
    providerContinuationContract,
    providerSyncReleaseReceipt,
    routeAcceptanceReceipt,
    operatorReleasePacket,
    syscallDispatchGate,
    releaseRiskBudget,
  );
  const audienceSyncWatermark = buildMemoryAudienceSyncWatermark(
    contract,
    providerContinuationContract,
    providerSyncReleaseReceipt,
    dispatchReleaseLedger,
    clientRuntimeAdoptionState,
    source,
    options,
  );
  const audienceContinuityReceipt = buildMemoryAudienceContinuityReceipt(
    contract,
    audienceSyncWatermark,
    providerSyncReleaseReceipt,
    dispatchReleaseLedger,
    clientRuntimeAdoptionState,
    source,
    options,
  );
  const adapterResumeReceipt = buildMemoryAdapterResumeReceipt(
    contract,
    mounts,
    providerContinuationContract,
    clientRuntimeAdoptionState,
    operationalHealthState,
    restartStatusLedger,
    releaseRiskBudget,
    operatorReleasePacket,
    dispatchReleaseLedger,
  );
  const operatorCommandReceipt = buildMemoryOperatorCommandReceipt(
    contract,
    lifecycleControls,
    controlPlaneState,
    routeAcceptanceReceipt,
    dispatchReleaseLedger,
    adapterResumeReceipt,
    operatorReleasePacket,
  );
  const claimEvidenceManifest = buildMemoryClaimEvidenceManifest(
    contract,
    mounts,
    analyticsExportBundle,
    operatorReleasePacket,
    dispatchReleaseLedger,
    adapterResumeReceipt,
  );
  const claimRuntimeAdoptionReceipt = buildMemoryClaimRuntimeAdoptionReceipt(
    contract,
    analyticsExportBundle,
    claimEvidenceManifest,
    clientWorkflowHandoffPacket,
    operatorCommandReceipt,
  );
  analyticsExportBundle.claimRuntimeAnalyticsDigest = buildMemoryClaimRuntimeAnalyticsDigest(
    contract,
    analytics,
    historySnapshots,
    analyticsExportBundle,
    claimEvidenceManifest,
    claimRuntimeAdoptionReceipt,
  );
  const operationalTriagePacket = buildMemoryOperationalTriagePacket(
    contract,
    mounts,
    lifecycleControls,
    operationalHealthState,
    downstreamStatusPacket,
    controlPlaneState,
    providerHandoffEnvelope,
    adapterResumeReceipt,
    claimRuntimeAdoptionReceipt,
  );
  const runtimeDispatchReleaseReceipt = buildMemoryRuntimeDispatchReleaseReceipt(
    contract,
    clientRuntimeAdoptionState,
    clientWorkflowHandoffPacket,
    boundaryLeasePacket,
    providerSyncReleaseReceipt,
    audienceContinuityReceipt,
    operatorReleasePacket,
    dispatchReleaseLedger,
    claimRuntimeAdoptionReceipt,
    operatorCommandReceipt,
    adapterResumeReceipt,
    operationalTriagePacket,
  );
  const replayStatusReceipt = buildMemoryReplayStatusReceipt(
    contract,
    clientRuntimeAdoptionState,
    restartStatusLedger,
    runtimeDispatchReleaseReceipt,
    operationalTriagePacket,
    operatorCommandReceipt,
  );
  const syscallBoundaryReceipt = buildMemorySyscallBoundaryReceipt(
    contract,
    mounts,
    tenantBoundaryState,
    boundaryLeasePacket,
    providerSyncReleaseReceipt,
    runtimeDispatchReleaseReceipt,
    replayStatusReceipt,
    operatorCommandReceipt,
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
      boundaryLeasePacket,
      downstreamStatusPacket,
      controlPlaneState,
      workflowControlPacket,
      clientWorkflowHandoffPacket,
      providerHandoffEnvelope,
      operatorResumePacket,
      releaseEvidenceLedger,
      syscallDispatchGate,
      providerAssertionDigest,
      providerSyncReleaseReceipt,
      analyticsExportBundle,
      operatorActionEnvelope,
      restartStatusLedger,
      releaseRiskBudget,
      operatorReleasePacket,
      routeAcceptanceReceipt,
      dispatchReleaseLedger,
      audienceSyncWatermark,
      audienceContinuityReceipt,
      adapterResumeReceipt,
      operatorCommandReceipt,
      claimEvidenceManifest,
      claimRuntimeAdoptionReceipt,
      claimRuntimeAnalyticsDigest: analyticsExportBundle.claimRuntimeAnalyticsDigest,
      operationalTriagePacket,
      runtimeDispatchReleaseReceipt,
      replayStatusReceipt,
      syscallBoundaryReceipt,
    },
    adapterHandoff: {
      accepted: acceptedForAdapterSync
        && lifecycleControls.syncMounts.length > 0
        && clientRuntimeAdoptionState.acceptedForProviderSync
        && boundaryLeasePacket.acceptedForProviderSync
        && operatorReleasePacket.acceptedForProviderSync
        && providerSyncReleaseReceipt.acceptedForProviderSync
        && dispatchReleaseLedger.acceptedForProviderSync
        && audienceSyncWatermark.acceptedForProviderSync
        && audienceContinuityReceipt.acceptedForProviderSync
        && runtimeDispatchReleaseReceipt.acceptedForProviderSync
        && operationalHealthState.status === "healthy",
      providerService: contract.providerServiceContract?.providerService || "mailchimp-marketing-api",
      syncMounts: lifecycleControls.syncMounts,
      stagedWritebacks: lifecycleControls.stagedWritebacks,
      providerContinuationId: providerContinuationContract.continuationId,
      tenantAuditId: tenantBoundaryState.auditId,
      healthId: operationalHealthState.healthId,
      downstreamStatusPacketId: downstreamStatusPacket.packetId,
      controlPlaneId: controlPlaneState.controlPlaneId,
      providerHandoffPacketId: providerHandoffEnvelope.packetId,
      boundaryLeasePacketId: boundaryLeasePacket.packetId,
      releaseEvidenceLedgerId: releaseEvidenceLedger.ledgerId,
      providerAssertionDigestId: providerAssertionDigest.digestId,
      providerSyncReleaseReceiptId: providerSyncReleaseReceipt.receiptId,
      operatorReleasePacketId: operatorReleasePacket.packetId,
      dispatchReleaseLedgerId: dispatchReleaseLedger.ledgerId,
      audienceSyncWatermarkId: audienceSyncWatermark.watermarkId,
      audienceContinuityReceiptId: audienceContinuityReceipt.receiptId,
      adapterResumeReceiptId: adapterResumeReceipt.receiptId,
      operatorCommandReceiptId: operatorCommandReceipt.receiptId,
      claimRuntimeAdoptionReceiptId: claimRuntimeAdoptionReceipt.receiptId,
      runtimeDispatchReleaseReceiptId: runtimeDispatchReleaseReceipt.receiptId,
      replayStatusReceiptId: replayStatusReceipt.receiptId,
      syscallBoundaryReceiptId: syscallBoundaryReceipt.receiptId,
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
        : operatorReleasePacket.acceptedForProviderSync
          ? "prepare-provider-sync"
        : operatorReleasePacket.nextAction === "release-memory-operator-syscall-dispatch"
          ? "release-memory-operator-syscall-dispatch"
          : "continue-local-runtime",
    },
    recovery: {
      restartSafe: acceptedForTenantRuntime && clientRuntimeAdoptionState.hydrated,
      rollbackPlan,
      resumeCursors: mounts.map((mount) => mount.handoff.recoveryCursor).filter(Boolean).sort(),
      persistedStateKey: clientRuntimeAdoptionState.stateKey,
      continuationToken: clientRuntimeAdoptionState.continuationToken,
      tenantAudit: tenantBoundaryState,
      boundaryLeasePacket,
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
      operationalErrorRunbook,
      downstreamStatusPacket,
      controlPlaneState,
      workflowControlPacket,
      clientWorkflowHandoffPacket,
      providerHandoffEnvelope,
      operatorResumePacket,
      releaseEvidenceLedger,
      syscallDispatchGate,
      providerAssertionDigest,
      providerSyncReleaseReceipt,
      analyticsExportBundle,
      claimEvidenceManifest,
      operatorActionEnvelope,
      restartStatusLedger,
      releaseRiskBudget,
      operatorReleasePacket,
      routeAcceptanceReceipt,
      dispatchReleaseLedger,
      audienceSyncWatermark,
      audienceContinuityReceipt,
      adapterResumeReceipt,
      operatorCommandReceipt,
      claimRuntimeAdoptionReceipt,
      claimRuntimeAnalyticsDigest: analyticsExportBundle.claimRuntimeAnalyticsDigest,
      operationalTriagePacket,
      replayStatusReceipt,
      runtimeDispatchReleaseReceipt,
      syscallBoundaryReceipt,
      releaseEvidenceCommands: releaseEvidenceLedger.commands,
      providerSyncReleaseCommands: providerSyncReleaseReceipt.commands,
      dispatchReleaseCommands: dispatchReleaseLedger.commands,
      audienceSyncWatermarkCommands: audienceSyncWatermark.commands,
      audienceContinuityCommands: audienceContinuityReceipt.commands,
      adapterResumeCommands: adapterResumeReceipt.commands,
      operatorCommandReceiptCommands: operatorCommandReceipt.commands,
      syscallBoundaryCommands: syscallBoundaryReceipt.commands,
      claimEvidenceCommands: claimEvidenceManifest.commands,
      claimRuntimeAdoptionCommands: claimRuntimeAdoptionReceipt.commands,
      analyticsExportCommands: analyticsExportBundle.commands,
      operatorActionCommands: operatorActionEnvelope.commandQueue,
      restartLedgerCommands: restartStatusLedger.commands,
      releaseRiskCommands: releaseRiskBudget.commands,
      retryPlan: operationalHealthState.retryPolicy,
      nextAction: acceptedForTenantRuntime
        ? operationalHealthState.status === "healthy"
          ? releaseRiskBudget.nextAction
          : operationalHealthState.nextAction
        : "hold-runtime-handoff",
    },
    analytics,
    historySnapshots,
    exportSummary,
    timelineState,
    lifecycleControls,
    tenantBoundaryState,
    boundaryLeasePacket,
    providerContinuationContract,
    previewAcceptancePackage,
    previewState: previewAcceptancePackage.preview,
    acceptanceState: previewAcceptancePackage.acceptance,
    readinessSummary: previewAcceptancePackage.readiness,
    clientRuntimeAdoptionState,
    operationalHealthState,
    operationalErrorRunbook,
    lifecycleCommandReport,
    memoryExportManifest,
    downstreamStatusPacket,
    controlPlaneState,
    workflowControlPacket,
    clientWorkflowHandoffPacket,
    providerHandoffEnvelope,
    operatorResumePacket,
    releaseEvidenceLedger,
    syscallDispatchGate,
    providerAssertionDigest,
    providerSyncReleaseReceipt,
    analyticsExportBundle,
    operatorActionEnvelope,
    restartStatusLedger,
    releaseRiskBudget,
    operatorReleasePacket,
    dispatchReleaseLedger,
    audienceSyncWatermark,
    audienceContinuityReceipt,
    adapterResumeReceipt,
    operatorCommandReceipt,
    claimEvidenceManifest,
    claimRuntimeAdoptionReceipt,
    claimRuntimeAnalyticsDigest: analyticsExportBundle.claimRuntimeAnalyticsDigest,
    operationalTriagePacket,
    replayStatusReceipt,
    runtimeDispatchReleaseReceipt,
    syscallBoundaryReceipt,
    nextSteps: [
      ...syscallBoundaryReceipt.blockedBy.map((blocker) => ({
        action: syscallBoundaryReceipt.nextAction,
        subject: blocker,
        reason: "Memory syscall boundary receipt is blocking syscall dispatch release",
      })),
      ...syscallBoundaryReceipt.pendingBy.map((pending) => ({
        action: syscallBoundaryReceipt.nextAction,
        subject: pending,
        reason: "Memory syscall boundary receipt is waiting before syscall dispatch release",
      })),
      ...runtimeDispatchReleaseReceipt.blockedBy.map((blocker) => ({
        action: runtimeDispatchReleaseReceipt.nextAction,
        subject: blocker,
        reason: "Memory runtime dispatch release receipt is blocking syscall handoff",
      })),
      ...runtimeDispatchReleaseReceipt.pendingBy.map((pending) => ({
        action: runtimeDispatchReleaseReceipt.nextAction,
        subject: pending,
        reason: "Memory runtime dispatch release receipt is waiting before syscall handoff",
      })),
      ...claimRuntimeAdoptionReceipt.blockedBy.map((blocker) => ({
        action: claimRuntimeAdoptionReceipt.nextAction,
        subject: blocker,
        reason: "Memory claim runtime adoption receipt is blocking downstream claim workflow handoff",
      })),
      ...claimRuntimeAdoptionReceipt.pendingBy.map((pending) => ({
        action: claimRuntimeAdoptionReceipt.nextAction,
        subject: pending,
        reason: "Memory claim runtime adoption receipt is waiting before downstream claim workflow handoff",
      })),
      ...claimEvidenceManifest.blockedBy.map((blocker) => ({
        action: claimEvidenceManifest.nextAction,
        subject: blocker,
        reason: "Memory claim evidence manifest is blocking downstream claim acceptance",
      })),
      ...claimEvidenceManifest.pendingBy.map((pending) => ({
        action: claimEvidenceManifest.nextAction,
        subject: pending,
        reason: "Memory claim evidence manifest is waiting before downstream claim acceptance",
      })),
      ...adapterResumeReceipt.blockedBy.map((blocker) => ({
        action: adapterResumeReceipt.nextAction,
        subject: blocker,
        reason: "Memory adapter resume receipt is blocking restart-safe adapter recovery",
      })),
      ...adapterResumeReceipt.pendingBy.map((pending) => ({
        action: adapterResumeReceipt.nextAction,
        subject: pending,
        reason: "Memory adapter resume receipt is waiting before adapter recovery release",
      })),
      ...operatorCommandReceipt.blockedBy.map((blocker) => ({
        action: operatorCommandReceipt.nextAction,
        subject: blocker,
        reason: "Memory operator command receipt is blocking syscall command release",
      })),
      ...operatorCommandReceipt.pendingBy.map((pending) => ({
        action: operatorCommandReceipt.nextAction,
        subject: pending,
        reason: "Memory operator command receipt is waiting before syscall command release",
      })),
      ...dispatchReleaseLedger.blockedBy.map((blocker) => ({
        action: dispatchReleaseLedger.nextAction,
        subject: blocker,
        reason: "Memory dispatch release ledger is blocking syscall handoff",
      })),
      ...dispatchReleaseLedger.pendingBy.map((pending) => ({
        action: dispatchReleaseLedger.nextAction,
        subject: pending,
        reason: "Memory dispatch release ledger is waiting for a restart-safe release gate",
      })),
      ...providerSyncReleaseReceipt.blockedBy.map((blocker) => ({
        action: providerSyncReleaseReceipt.nextAction,
        subject: blocker,
        reason: "Memory provider sync release receipt is blocking syscall dispatch release",
      })),
      ...providerSyncReleaseReceipt.pendingBy.map((pending) => ({
        action: providerSyncReleaseReceipt.nextAction,
        subject: pending,
        reason: "Memory provider sync release receipt is waiting on a provider handoff gate",
      })),
      ...audienceSyncWatermark.blockedBy.map((blocker) => ({
        action: audienceSyncWatermark.nextAction,
        subject: blocker,
        reason: "Mailchimp audience sync watermark is blocking syscall dispatch release",
      })),
      ...audienceSyncWatermark.pendingBy.map((pending) => ({
        action: audienceSyncWatermark.nextAction,
        subject: pending,
        reason: "Mailchimp audience sync watermark is waiting on provider sync release metadata",
      })),
      ...audienceContinuityReceipt.blockedBy.map((blocker) => ({
        action: audienceContinuityReceipt.nextAction,
        subject: blocker,
        reason: "Mailchimp audience continuity receipt is blocking syscall dispatch release",
      })),
      ...audienceContinuityReceipt.pendingBy.map((pending) => ({
        action: audienceContinuityReceipt.nextAction,
        subject: pending,
        reason: "Mailchimp audience continuity receipt is waiting for stable audience, segment, or cursor metadata",
      })),
      ...operatorReleasePacket.blockedBy.map((blocker) => ({
        action: operatorReleasePacket.nextAction,
        subject: blocker,
        reason: "Memory operator release packet is blocking syscall dispatch release",
      })),
      ...operatorReleasePacket.pendingBy.map((pending) => ({
        action: operatorReleasePacket.nextAction,
        subject: pending,
        reason: "Memory operator release packet is waiting on a release gate",
      })),
      ...releaseRiskBudget.blockedBy.map((blocker) => ({
        action: releaseRiskBudget.nextAction,
        subject: blocker,
        reason: "Memory release risk budget has a blocking release condition",
      })),
      ...releaseRiskBudget.pendingBy.map((pending) => ({
        action: releaseRiskBudget.nextAction,
        subject: pending,
        reason: "Memory release risk budget is waiting on a release gate",
      })),
      ...restartStatusLedger.blockedBy.map((blocker) => ({
        action: restartStatusLedger.nextAction,
        subject: blocker,
        reason: "Memory restart status ledger has a blocking persisted-state condition",
      })),
      ...restartStatusLedger.pendingBy.map((pending) => ({
        action: restartStatusLedger.nextAction,
        subject: pending,
        reason: "Memory restart status ledger is waiting for a restart-safe status receipt",
      })),
      ...syscallDispatchGate.blockedBy.map((blocker) => ({
        action: syscallDispatchGate.nextAction,
        subject: blocker,
        reason: "Memory syscall dispatch gate has a blocking provider-sync condition",
      })),
      ...syscallDispatchGate.pendingBy.map((pending) => ({
        action: syscallDispatchGate.nextAction,
        subject: pending,
        reason: "Memory syscall dispatch gate is waiting before syscall dispatch release",
      })),
      ...releaseEvidenceLedger.blockedBy.map((blocker) => ({
        action: releaseEvidenceLedger.nextAction,
        subject: blocker,
        reason: "Memory release evidence ledger has a blocking gate",
      })),
      ...releaseEvidenceLedger.pendingBy.map((pending) => ({
        action: releaseEvidenceLedger.nextAction,
        subject: pending,
        reason: "Memory release evidence ledger has pending release work",
      })),
      ...operatorResumePacket.blockedBy.map((blocker) => ({
        action: operatorResumePacket.nextAction,
        subject: blocker,
        reason: "Memory operator resume packet is blocking provider handoff",
      })),
      ...operatorResumePacket.pendingBy.map((pending) => ({
        action: operatorResumePacket.nextAction,
        subject: pending,
        reason: "Memory operator resume packet has pending release work",
      })),
      ...previewAcceptancePackage.nextSteps,
    ],
    nextActionState: {
      action: operationalHealthState.status === "healthy"
        ? clientRuntimeAdoptionState.nextAction
        : operationalHealthState.nextAction,
      command: operationalHealthState.commands.find((command) => command.enabled)?.command
        || providerSyncReleaseReceipt.commands.find((command) => command.enabled)?.command
        || (clientRuntimeAdoptionState.acceptedForProviderSync
        ? "handoff-memory-provider-sync"
        : clientRuntimeAdoptionState.routeCommands.find((command) => command.enabled)?.command
        || lifecycleControls.commands.find((command) => command.enabled)?.command
        || "hold-memory-workflow"),
      blockedBy: [
        ...summary.blockingCodes,
        ...providerContinuationContract.externalHandoffState.blockedBy,
        ...providerSyncReleaseReceipt.blockedBy,
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
      workflowControlPacketId: workflowControlPacket.packetId,
      clientWorkflowHandoffPacketId: clientWorkflowHandoffPacket.packetId,
      providerHandoffPacketId: providerHandoffEnvelope.packetId,
      operatorResumePacketId: operatorResumePacket.packetId,
      syscallDispatchGateId: syscallDispatchGate.gateId,
      providerAssertionDigestId: providerAssertionDigest.digestId,
      providerSyncReleaseReceiptId: providerSyncReleaseReceipt.receiptId,
      analyticsExportBundleId: analyticsExportBundle.bundleId,
      releaseRiskBudgetId: releaseRiskBudget.budgetId,
      operatorReleasePacketId: operatorReleasePacket.packetId,
      routeAcceptanceReceiptId: routeAcceptanceReceipt.receiptId,
      dispatchReleaseLedgerId: dispatchReleaseLedger.ledgerId,
      audienceSyncWatermarkId: audienceSyncWatermark.watermarkId,
      audienceContinuityReceiptId: audienceContinuityReceipt.receiptId,
      adapterResumeReceiptId: adapterResumeReceipt.receiptId,
      operatorCommandReceiptId: operatorCommandReceipt.receiptId,
      operationalTriagePacketId: operationalTriagePacket.packetId,
      syscallBoundaryReceiptId: syscallBoundaryReceipt.receiptId,
      exportBlockedBy: [
        ...summary.blockingCodes,
        ...memoryExportManifest.blockedBy,
        ...analyticsExportBundle.blockedBy,
        ...releaseRiskBudget.blockedBy,
        ...operatorReleasePacket.blockedBy,
        ...providerSyncReleaseReceipt.blockedBy,
        ...dispatchReleaseLedger.blockedBy,
        ...audienceSyncWatermark.blockedBy,
        ...audienceContinuityReceipt.blockedBy,
        ...adapterResumeReceipt.blockedBy,
        ...operatorCommandReceipt.blockedBy,
        ...claimRuntimeAdoptionReceipt.blockedBy,
        ...syscallBoundaryReceipt.blockedBy,
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
      workflowControlStatus: workflowControlPacket.status,
      clientWorkflowHandoffStatus: clientWorkflowHandoffPacket.status,
      providerHandoffStatus: providerHandoffEnvelope.status,
      operatorResumeStatus: operatorResumePacket.status,
      syscallDispatchGateStatus: syscallDispatchGate.status,
      providerAssertionStatus: providerAssertionDigest.status,
      providerSyncReleaseStatus: providerSyncReleaseReceipt.status,
      analyticsExportStatus: analyticsExportBundle.status,
      releaseRiskStatus: releaseRiskBudget.status,
      operatorReleaseStatus: operatorReleasePacket.status,
      routeAcceptanceStatus: routeAcceptanceReceipt.status,
      dispatchReleaseStatus: dispatchReleaseLedger.status,
      audienceSyncWatermarkStatus: audienceSyncWatermark.status,
      audienceContinuityStatus: audienceContinuityReceipt.status,
      operationalTriageStatus: operationalTriagePacket.status,
      adapterResumeStatus: adapterResumeReceipt.status,
      operatorCommandReceiptStatus: operatorCommandReceipt.status,
      claimRuntimeAdoptionStatus: claimRuntimeAdoptionReceipt.status,
      nextAction: acceptedForTenantRuntime && memoryExportManifest.exportReady
        ? operationalHealthState.status === "healthy"
          ? adapterResumeReceipt.nextAction
          : operationalHealthState.nextAction
        : tenantBoundaryState.status === "blocked"
          ? tenantBoundaryState.nextAction
          : "resolve-memory-analysis-errors",
    },
    operatorReportDigest,
    analyticsExportBundle,
    routeAcceptanceReceipt,
    audienceSyncWatermark,
    audienceContinuityReceipt,
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
  if (analysis?.adapterHandoff?.accepted
    && analysis?.audienceContinuityReceipt?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-sync-without-audience-continuity" });
  }
  if (analysis?.audienceContinuityReceipt?.acceptedForSyscallDispatch
    && analysis?.audienceContinuityReceipt?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "memory.analysis.audience-continuity-accepted-without-restart-safe" });
  }
  if (analysis?.audienceContinuityReceipt?.receiptId
    && analysis?.runtimeContract?.audienceContinuityReceipt?.receiptId !== analysis.audienceContinuityReceipt.receiptId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.audience-continuity-runtime-id.inconsistent" });
  }
  if (analysis?.audienceContinuityReceipt?.blockedBy?.length
    && analysis?.adapterHandoff?.accepted) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-sync-with-audience-continuity-blockers" });
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
  if (!analysis?.clientWorkflowHandoffPacket?.packetId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.client-workflow-handoff.missing" });
  }
  if (analysis?.clientWorkflowHandoffPacket?.releaseReady
    && analysis?.clientWorkflowHandoffPacket?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.client-workflow-release-without-provider-sync" });
  }
  if (analysis?.clientWorkflowHandoffPacket?.restartSafe
    && analysis?.clientWorkflowHandoffPacket?.gates?.some((gate) => gate.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.client-workflow-restart-gate.invalid" });
  }
  if (analysis?.clientWorkflowHandoffPacket?.downstreamPacketId !== analysis?.downstreamStatusPacket?.packetId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.client-workflow-downstream-id.inconsistent" });
  }
  if (!analysis?.clientWorkflowHandoffPacket?.releaseReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.client-workflow-release-receipt.missing" });
  }
  if (analysis?.clientWorkflowHandoffPacket?.releaseReceipt?.acceptedForProviderSync
    && analysis?.clientWorkflowHandoffPacket?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.client-workflow-receipt-without-provider-release" });
  }
  if (analysis?.clientWorkflowHandoffPacket?.releaseReceipt?.releaseReady
    && analysis?.clientWorkflowHandoffPacket?.releaseReceipt?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.client-workflow-receipt-ready-with-blockers" });
  }
  if (analysis?.clientWorkflowHandoffPacket?.releaseReceipt?.restartSafe
    && analysis?.clientWorkflowHandoffPacket?.releaseReceipt?.gateReceipts?.some((gate) => gate.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.client-workflow-receipt-restart-safe-with-unsafe-gate" });
  }
  if (analysis?.clientWorkflowHandoffPacket?.releaseReceipt?.packetId !== analysis?.clientWorkflowHandoffPacket?.packetId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.client-workflow-receipt-packet.inconsistent" });
  }
  if (!analysis?.routeAcceptanceReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.route-acceptance-receipt.missing" });
  }
  if (analysis?.routeAcceptanceReceipt?.acceptedForSyscallDispatch
    && analysis?.operatorReleasePacket?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.route-acceptance-without-operator-release" });
  }
  if (analysis?.routeAcceptanceReceipt?.acceptedForProviderSync
    && analysis?.providerSyncReleaseReceipt?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.route-provider-sync-without-release-receipt" });
  }
  if (analysis?.routeAcceptanceReceipt?.restartSafe
    && analysis?.routeAcceptanceReceipt?.receiptRows?.some((row) => row.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.route-acceptance-restart-safe-with-unsafe-row" });
  }
  if (analysis?.routeAcceptanceReceipt?.status === "syscall-dispatch-ready"
    && analysis?.routeAcceptanceReceipt?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.route-acceptance-ready-with-blockers" });
  }
  if (!analysis?.routeAcceptanceReceipt?.commands?.some((command) => command.command === "persist-memory-route-acceptance-receipt")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.route-acceptance-persist-command.missing" });
  }
  if (!analysis?.clientWorkflowHandoffPacket?.commands?.some((command) => command.command === "persist-memory-client-workflow-handoff")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.client-workflow-persist-command.missing" });
  }
  if (!analysis?.analyticsExportBundle?.packetRows?.some((row) => row.packet === "client-workflow-handoff")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.analytics-client-workflow-row.missing" });
  }
  if (!analysis?.analyticsExportBundle?.claimRuntimeAdoptionReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.claim-adoption-receipt.missing" });
  }
  if (analysis?.analyticsExportBundle?.claimRuntimeAdoptionReceipt?.acceptedForClaimProviderSync
    && analysis?.clientWorkflowHandoffPacket?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-adoption-provider-sync-without-client-workflow" });
  }
  if (analysis?.analyticsExportBundle?.claimRuntimeAdoptionReceipt?.restartSafe
    && analysis?.clientWorkflowHandoffPacket?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-adoption-restart-safe-with-unsafe-workflow" });
  }
  if (analysis?.analyticsExportBundle?.claimRuntimeAdoptionReceipt?.sourcePacketId
    !== analysis?.clientWorkflowHandoffPacket?.packetId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.claim-adoption-source-packet.inconsistent" });
  }
  if (!analysis?.runtimeDispatchReleaseReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.runtime-dispatch-release.missing" });
  }
  if (analysis?.runtimeDispatchReleaseReceipt?.acceptedForSyscallDispatch
    && analysis?.runtimeDispatchReleaseReceipt?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.runtime-dispatch-release-ready-with-blockers" });
  }
  if (analysis?.runtimeDispatchReleaseReceipt?.acceptedForSyscallDispatch
    && analysis?.runtimeDispatchReleaseReceipt?.pendingBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.runtime-dispatch-release-ready-with-pending" });
  }
  if (analysis?.runtimeDispatchReleaseReceipt?.acceptedForProviderSync
    && analysis?.dispatchReleaseLedger?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.runtime-dispatch-release-without-ledger" });
  }
  if (analysis?.runtimeDispatchReleaseReceipt?.acceptedForSyscallDispatch
    && analysis?.operatorCommandReceipt?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.runtime-dispatch-release-without-command-receipt" });
  }
  if (analysis?.runtimeContract?.runtimeDispatchReleaseReceipt?.receiptId
    !== analysis?.runtimeDispatchReleaseReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.runtime-dispatch-release-runtime-id.inconsistent" });
  }
  if (!analysis?.runtimeDispatchReleaseReceipt?.commands?.some((command) => (
    command.command === "persist-memory-runtime-dispatch-release"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.runtime-dispatch-release-persist-command.missing" });
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
  if (!analysis?.boundaryLeasePacket?.packetId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.boundary-lease.missing" });
  }
  if (analysis?.boundaryLeasePacket?.releaseReady
    && analysis?.boundaryLeasePacket?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.boundary-lease-ready-with-blockers" });
  }
  if (analysis?.boundaryLeasePacket?.acceptedForProviderSync
    && analysis?.tenantBoundaryState?.canSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.boundary-lease-provider-sync-without-role" });
  }
  if (analysis?.boundaryLeasePacket?.restartSafe
    && analysis?.boundaryLeasePacket?.leaseRows?.some((row) => row.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.boundary-lease-restart-safe-with-unsafe-row" });
  }
  if (analysis?.adapterHandoff?.accepted
    && analysis?.boundaryLeasePacket?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-handoff-without-boundary-lease" });
  }
  if (analysis?.previewState?.rows?.length !== analysis?.mounts?.length) {
    diagnostics.push({ level: "warning", code: "memory.analysis.preview.rows-mismatch" });
  }
  if (!analysis?.providerHandoffEnvelope?.packetId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.provider-handoff-envelope.missing" });
  }
  if (analysis?.providerHandoffEnvelope?.acceptedForProviderSync
    && analysis?.workflowControlPacket?.releaseReady !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-handoff-without-workflow-release" });
  }
  if (analysis?.providerHandoffEnvelope?.releaseReady
    && analysis?.providerHandoffEnvelope?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-handoff-ready-with-blockers" });
  }
  if (analysis?.providerHandoffEnvelope?.restartSafe
    && analysis?.providerHandoffEnvelope?.gates?.some((gate) => gate.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-handoff-restart-safe-with-unsafe-gate" });
  }
  if (analysis?.providerHandoffEnvelope?.mountContracts?.length !== analysis?.mounts?.length) {
    diagnostics.push({ level: "warning", code: "memory.analysis.provider-handoff-mounts-mismatch" });
  }
  if (!analysis?.providerHandoffEnvelope?.providerServiceContract?.contractId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.provider-service-contract.missing" });
  }
  if (analysis?.providerHandoffEnvelope?.acceptedForSyscallDispatch
    && analysis?.providerHandoffEnvelope?.providerServiceContract?.externalHandoffState?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-service-dispatch-release.inconsistent" });
  }
  if (analysis?.providerHandoffEnvelope?.providerServiceContract?.missingCapabilities?.length
    && analysis?.providerHandoffEnvelope?.acceptedForProviderSync) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-service-accepted-with-missing-capability" });
  }
  if (analysis?.providerHandoffEnvelope?.serviceBindingRows?.length !== analysis?.mounts?.length) {
    diagnostics.push({ level: "warning", code: "memory.analysis.provider-service-bindings-mismatch" });
  }
  if (analysis?.providerHandoffEnvelope?.serviceBindingRows?.some((row) => row.status === "blocked" && !row.blockedBy?.length)) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-service-binding-blocked-without-reason" });
  }
  if (!analysis?.providerHandoffEnvelope?.commands?.some((command) => (
    command.command === "persist-memory-provider-service-contract"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.provider-service-contract-persist-command.missing" });
  }
  if (!analysis?.operatorResumePacket?.packetId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operator-resume.missing" });
  }
  if (analysis?.operatorResumePacket?.acceptedForProviderSync
    && analysis?.providerHandoffEnvelope?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-resume-without-provider-handoff" });
  }
  if (analysis?.operatorResumePacket?.releaseReady
    && analysis?.operatorResumePacket?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-resume-ready-with-blockers" });
  }
  if (analysis?.operatorResumePacket?.restartSafe
    && analysis?.operatorResumePacket?.gates?.some((gate) => gate.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-resume-restart-safe-with-unsafe-gate" });
  }
  if (analysis?.operatorResumePacket?.providerHandoffPacketId !== analysis?.providerHandoffEnvelope?.packetId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operator-resume-provider-handoff.inconsistent" });
  }
  if (!analysis?.operatorResumePacket?.commands?.some((command) => command.command === "persist-memory-operator-resume")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operator-resume-persist-command.missing" });
  }
  if (!analysis?.releaseEvidenceLedger?.ledgerId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.release-ledger.missing" });
  }
  if (analysis?.releaseEvidenceLedger?.releaseReady
    && analysis?.releaseEvidenceLedger?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.release-ledger-ready-with-blockers" });
  }
  if (analysis?.releaseEvidenceLedger?.releaseReady
    && analysis?.operatorResumePacket?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.release-ledger-without-operator-resume" });
  }
  if (analysis?.releaseEvidenceLedger?.restartSafe
    && analysis?.releaseEvidenceLedger?.releaseGates?.some((gate) => gate.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.release-ledger-restart-safe-with-unsafe-gate" });
  }
  if (!analysis?.releaseEvidenceLedger?.commands?.some((command) => command.command === "persist-memory-release-ledger")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.release-ledger-persist-command.missing" });
  }
  if (!analysis?.syscallDispatchGate?.gateId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.syscall-dispatch-gate.missing" });
  }
  if (analysis?.syscallDispatchGate?.acceptedForSyscallDispatch
    && analysis?.syscallDispatchGate?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.syscall-dispatch-gate-ready-with-blockers" });
  }
  if (analysis?.syscallDispatchGate?.acceptedForSyscallDispatch
    && analysis?.releaseEvidenceLedger?.releaseReady !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.syscall-dispatch-gate-without-release-ledger" });
  }
  if (analysis?.syscallDispatchGate?.retryable
    && analysis?.syscallDispatchGate?.nextDelaySeconds == null) {
    diagnostics.push({ level: "error", code: "memory.analysis.syscall-dispatch-gate-retry-without-delay" });
  }
  if (!analysis?.syscallDispatchGate?.commands?.some((command) => command.command === "persist-memory-syscall-dispatch-gate")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.syscall-dispatch-gate-persist-command.missing" });
  }
  if (!analysis?.providerAssertionDigest?.digestId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.provider-assertion-digest.missing" });
  }
  if (analysis?.providerAssertionDigest?.acceptedForSyscallDispatch
    && analysis?.providerAssertionDigest?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-assertions-ready-with-blockers" });
  }
  if (analysis?.providerAssertionDigest?.acceptedForSyscallDispatch
    && analysis?.syscallDispatchGate?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-assertions-without-syscall-gate" });
  }
  if (analysis?.providerAssertionDigest?.restartSafe
    && analysis?.providerAssertionDigest?.assertionRows?.some((row) => row.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-assertions-safe-with-unsafe-row" });
  }
  if (analysis?.providerAssertionDigest?.assertionRows?.length !== analysis?.mounts?.length) {
    diagnostics.push({ level: "warning", code: "memory.analysis.provider-assertion-rows-mismatch" });
  }
  if (!analysis?.providerAssertionDigest?.commands?.some((command) => (
    command.command === "persist-memory-provider-assertion-digest"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.provider-assertion-persist-command.missing" });
  }
  if (!analysis?.analyticsExportBundle?.bundleId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.analytics-export-bundle.missing" });
  }
  if (analysis?.analyticsExportBundle?.exportReady
    && analysis?.analyticsExportBundle?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.analytics-export-ready-with-blockers" });
  }
  if (analysis?.analyticsExportBundle?.packetRows?.length < 6) {
    diagnostics.push({ level: "warning", code: "memory.analysis.analytics-export-packets.incomplete" });
  }
  if (analysis?.analyticsExportBundle?.exportRows?.length !== analysis?.mounts?.length) {
    diagnostics.push({ level: "warning", code: "memory.analysis.analytics-export-rows-mismatch" });
  }
  if (analysis?.reportingState?.analyticsExportBundleId !== analysis?.analyticsExportBundle?.bundleId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.reporting-analytics-export.inconsistent" });
  }
  if (!analysis?.analyticsExportBundle?.commands?.some((command) => (
    command.command === "persist-memory-analytics-export-bundle"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.analytics-export-persist-command.missing" });
  }
  if (!analysis?.operatorActionEnvelope?.envelopeId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operator-action-envelope.missing" });
  }
  if (analysis?.operatorActionEnvelope?.releaseReady
    && analysis?.operatorActionEnvelope?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-action-ready-with-blockers" });
  }
  if (analysis?.operatorActionEnvelope?.releaseReady
    && analysis?.operatorActionEnvelope?.restartSafe !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-action-ready-without-restart-safe" });
  }
  if (analysis?.operatorActionEnvelope?.commandQueue?.some((command) => command.enabled && !command.command)) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-action-command.invalid" });
  }
  if (!analysis?.restartStatusLedger?.ledgerId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.restart-ledger.missing" });
  }
  if (analysis?.restartStatusLedger?.restartSafe
    && analysis?.restartStatusLedger?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.restart-ledger-safe-with-blockers" });
  }
  if (analysis?.restartStatusLedger?.acceptedForProviderSync
    && analysis?.providerHandoffEnvelope?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.restart-ledger-provider-sync-without-handoff" });
  }
  if (analysis?.restartStatusLedger?.acceptedForProviderSync
    && analysis?.operatorResumePacket?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.restart-ledger-provider-sync-without-resume" });
  }
  if (analysis?.restartStatusLedger?.restartSafe
    && analysis?.restartStatusLedger?.rows?.some((row) => row.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.restart-ledger-safe-with-unsafe-row" });
  }
  if (!analysis?.restartStatusLedger?.commands?.some((command) => command.command === "persist-memory-restart-ledger")) {
    diagnostics.push({ level: "warning", code: "memory.analysis.restart-ledger-persist-command.missing" });
  }
  if (!analysis?.releaseRiskBudget?.budgetId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.release-risk-budget.missing" });
  }
  if (analysis?.releaseRiskBudget?.releaseReady
    && analysis?.releaseRiskBudget?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.release-risk-ready-with-blockers" });
  }
  if (analysis?.releaseRiskBudget?.acceptedForSyscallDispatch
    && analysis?.syscallDispatchGate?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.release-risk-without-syscall-gate" });
  }
  if (analysis?.releaseRiskBudget?.restartSafe
    && analysis?.restartStatusLedger?.restartSafe !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.release-risk-safe-without-restart-ledger" });
  }
  if (analysis?.releaseRiskBudget?.releaseRows?.length < 8) {
    diagnostics.push({ level: "warning", code: "memory.analysis.release-risk-rows.incomplete" });
  }
  if (!analysis?.releaseRiskBudget?.commands?.some((command) => (
    command.command === "persist-memory-release-risk-budget"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.release-risk-persist-command.missing" });
  }
  if (!analysis?.operatorReleasePacket?.packetId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operator-release.missing" });
  }
  if (analysis?.operatorReleasePacket?.releaseReady
    && analysis?.operatorReleasePacket?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-release-ready-with-blockers" });
  }
  if (analysis?.operatorReleasePacket?.acceptedForSyscallDispatch
    && analysis?.providerAssertionDigest?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-release-without-provider-assertions" });
  }
  if (analysis?.operatorReleasePacket?.acceptedForSyscallDispatch
    && analysis?.releaseRiskBudget?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-release-without-risk-budget" });
  }
  if (analysis?.operatorReleasePacket?.restartSafe
    && analysis?.operatorReleasePacket?.gateRows?.some((row) => row.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-release-safe-with-unsafe-gate" });
  }
  if (!analysis?.operatorReleasePacket?.commands?.some((command) => (
    command.command === "persist-memory-operator-release"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operator-release-persist-command.missing" });
  }
  if (analysis?.adapterHandoff?.accepted
    && analysis?.operatorReleasePacket?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-handoff-without-operator-release" });
  }
  if (!analysis?.dispatchReleaseLedger?.ledgerId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.dispatch-release-ledger.missing" });
  }
  if (analysis?.dispatchReleaseLedger?.acceptedForSyscallDispatch
    && analysis?.dispatchReleaseLedger?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.dispatch-release-ready-with-blockers" });
  }
  if (analysis?.dispatchReleaseLedger?.acceptedForSyscallDispatch
    && analysis?.routeAcceptanceReceipt?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.dispatch-release-without-route-acceptance" });
  }
  if (analysis?.dispatchReleaseLedger?.restartSafe
    && analysis?.dispatchReleaseLedger?.sourceRows?.some((row) => row.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.dispatch-release-safe-with-unsafe-source" });
  }
  if (!analysis?.dispatchReleaseLedger?.commands?.some((command) => (
    command.command === "persist-memory-dispatch-release-ledger"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.dispatch-release-persist-command.missing" });
  }
  if (!analysis?.audienceSyncWatermark?.watermarkId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.audience-sync-watermark.missing" });
  }
  if (analysis?.audienceSyncWatermark?.acceptedForSyscallDispatch
    && analysis?.audienceSyncWatermark?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.audience-watermark-ready-with-blockers" });
  }
  if (analysis?.audienceSyncWatermark?.acceptedForSyscallDispatch
    && analysis?.audienceSyncWatermark?.restartSafe !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.audience-watermark-ready-without-restart-safe" });
  }
  if (analysis?.audienceSyncWatermark?.acceptedForSyscallDispatch
    && analysis?.dispatchReleaseLedger?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.audience-watermark-without-dispatch-release" });
  }
  if (analysis?.adapterHandoff?.accepted
    && analysis?.audienceSyncWatermark?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-handoff-without-audience-watermark" });
  }
  if (!analysis?.audienceSyncWatermark?.commands?.some((command) => (
    command.command === "persist-memory-audience-sync-watermark"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.audience-watermark-persist-command.missing" });
  }
  if (!analysis?.adapterResumeReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.adapter-resume-receipt.missing" });
  }
  if (analysis?.adapterResumeReceipt?.acceptedForAdapterResume
    && analysis?.adapterResumeReceipt?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-resume-ready-with-blockers" });
  }
  if (analysis?.adapterResumeReceipt?.acceptedForAdapterResume
    && analysis?.adapterResumeReceipt?.restartSafe !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-resume-ready-without-restart-safe" });
  }
  if (analysis?.adapterResumeReceipt?.acceptedForSyscallDispatch
    && analysis?.dispatchReleaseLedger?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-resume-without-dispatch-release" });
  }
  if (analysis?.adapterResumeReceipt?.retryable
    && analysis?.adapterResumeReceipt?.nextDelaySeconds == null) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-resume-retry-without-delay" });
  }
  if (!analysis?.adapterResumeReceipt?.commands?.some((command) => (
    command.command === "persist-memory-adapter-resume-receipt"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.adapter-resume-persist-command.missing" });
  }
  if (!analysis?.operatorCommandReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operator-command-receipt.missing" });
  }
  if (analysis?.operatorCommandReceipt?.acceptedForSyscallDispatch
    && analysis?.operatorCommandReceipt?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-command-ready-with-blockers" });
  }
  if (analysis?.operatorCommandReceipt?.acceptedForSyscallDispatch
    && analysis?.adapterResumeReceipt?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-command-without-adapter-resume" });
  }
  if (analysis?.operatorCommandReceipt?.restartSafe
    && analysis?.operatorCommandReceipt?.commandRows?.some((row) => row.enabled && !row.command)) {
    diagnostics.push({ level: "error", code: "memory.analysis.operator-command-row.invalid" });
  }
  if (!analysis?.operatorCommandReceipt?.commands?.some((command) => (
    command.command === "persist-memory-operator-command-receipt"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operator-command-receipt-persist-command.missing" });
  }
  if (!analysis?.claimEvidenceManifest?.manifestId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.claim-evidence-manifest.missing" });
  }
  if (analysis?.claimEvidenceManifest?.acceptedForClaimRuntime
    && analysis?.claimEvidenceManifest?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-evidence-ready-with-blockers" });
  }
  if (analysis?.claimEvidenceManifest?.acceptedForClaimRuntime
    && analysis?.claimEvidenceManifest?.restartSafe !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-evidence-ready-without-restart-safe" });
  }
  if (analysis?.claimEvidenceManifest?.acceptedForClaimRuntime
    && analysis?.analyticsExportBundle?.exportReady !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-evidence-without-analytics-export" });
  }
  if (analysis?.claimEvidenceManifest?.acceptedForClaimRuntime
    && analysis?.dispatchReleaseLedger?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-evidence-without-dispatch-release" });
  }
  if (!analysis?.claimEvidenceManifest?.commands?.some((command) => (
    command.command === "persist-memory-claim-evidence-manifest"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.claim-evidence-persist-command.missing" });
  }
  if (!analysis?.claimRuntimeAdoptionReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.claim-runtime-adoption-receipt.missing" });
  }
  if (analysis?.claimRuntimeAdoptionReceipt?.acceptedForClaimRuntime
    && analysis?.claimRuntimeAdoptionReceipt?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-runtime-adoption-ready-with-blockers" });
  }
  if (analysis?.claimRuntimeAdoptionReceipt?.acceptedForClaimProviderSync
    && analysis?.claimRuntimeAdoptionReceipt?.pendingBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-runtime-adoption-provider-sync-with-pending" });
  }
  if (analysis?.claimRuntimeAdoptionReceipt?.restartSafe
    && analysis?.claimEvidenceManifest?.restartSafe !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-runtime-adoption-safe-without-evidence" });
  }
  if (analysis?.claimRuntimeAdoptionReceipt?.acceptedForClaimRuntime
    && analysis?.claimEvidenceManifest?.acceptedForClaimRuntime !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-runtime-adoption-without-evidence-release" });
  }
  if (!analysis?.claimRuntimeAdoptionReceipt?.commands?.some((command) => (
    command.command === "persist-memory-claim-runtime-adoption-receipt"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.claim-runtime-adoption-persist-command.missing" });
  }
  if (!analysis?.claimRuntimeAnalyticsDigest?.digestId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.claim-runtime-analytics-digest.missing" });
  }
  if (analysis?.claimRuntimeAnalyticsDigest?.acceptedForClaimRuntime
    && analysis?.claimRuntimeAnalyticsDigest?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-runtime-analytics-ready-with-blockers" });
  }
  if (analysis?.claimRuntimeAnalyticsDigest?.acceptedForClaimRuntime
    && analysis?.claimRuntimeAdoptionReceipt?.acceptedForClaimRuntime !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-runtime-analytics-without-adoption" });
  }
  if (analysis?.claimRuntimeAnalyticsDigest?.restartSafe
    && analysis?.claimRuntimeAnalyticsDigest?.rows?.some((row) => row.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.claim-runtime-analytics-safe-with-unsafe-row" });
  }
  if (!analysis?.claimRuntimeAnalyticsDigest?.commands?.some((command) => (
    command.command === "persist-memory-claim-runtime-analytics-digest"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.claim-runtime-analytics-persist-command.missing" });
  }
  if (!analysis?.operationalTriagePacket?.packetId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operational-triage-packet.missing" });
  }
  if (analysis?.operationalTriagePacket?.retryable
    && analysis?.operationalTriagePacket?.nextDelaySeconds == null) {
    diagnostics.push({ level: "error", code: "memory.analysis.operational-triage-retry-without-delay" });
  }
  if (analysis?.operationalTriagePacket?.status === "handoff-ready"
    && analysis?.providerHandoffEnvelope?.acceptedForAdapter !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.operational-triage-ready-without-provider-handoff" });
  }
  if (analysis?.operationalTriagePacket?.status === "blocked"
    && !analysis?.operationalTriagePacket?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.operational-triage-blocked-without-reason" });
  }
  if (!analysis?.operationalTriagePacket?.commands?.some((command) => (
    command.command === "persist-memory-operational-triage"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operational-triage-persist-command.missing" });
  }
  if (!analysis?.operationalErrorRunbook?.runbookId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operational-runbook.missing" });
  }
  if (analysis?.operationalErrorRunbook?.status === "clear"
    && analysis?.operationalHealthState?.status !== "healthy") {
    diagnostics.push({ level: "error", code: "memory.analysis.operational-runbook-clear-with-unhealthy-state" });
  }
  if (analysis?.operationalErrorRunbook?.commands?.some((command) => (
    command.command === "schedule-memory-runbook-retries" && command.enabled
  )) && analysis?.operationalHealthState?.retryable !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.operational-runbook-retry-without-retryable-health" });
  }
  if (analysis?.operationalErrorRunbook?.degradedProviderSync
    && analysis?.adapterHandoff?.accepted) {
    diagnostics.push({ level: "error", code: "memory.analysis.adapter-accepted-with-degraded-runbook" });
  }
  if (!analysis?.operationalErrorRunbook?.commands?.some((command) => (
    command.command === "persist-memory-operational-runbook"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.operational-runbook-persist-command.missing" });
  }
  if (!analysis?.replayStatusReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.replay-status-receipt.missing" });
  }
  if (analysis?.replayStatusReceipt?.replayReady && analysis?.replayStatusReceipt?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.replay-ready-with-blockers" });
  }
  if (analysis?.replayStatusReceipt?.acceptedForProviderReplay
    && analysis?.runtimeDispatchReleaseReceipt?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.provider-replay-without-dispatch-release" });
  }
  if (analysis?.replayStatusReceipt?.restartSafe
    && analysis?.replayStatusReceipt?.replayRows?.some((row) => row.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.replay-status-safe-with-unsafe-row" });
  }
  if (!analysis?.replayStatusReceipt?.commands?.some((command) => (
    command.command === "persist-memory-replay-status-receipt"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.replay-status-persist-command.missing" });
  }
  if (!analysis?.syscallBoundaryReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "memory.analysis.syscall-boundary-receipt.missing" });
  }
  if (analysis?.syscallBoundaryReceipt?.acceptedForSyscallDispatch
    && analysis?.syscallBoundaryReceipt?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.syscall-boundary-ready-with-blockers" });
  }
  if (analysis?.syscallBoundaryReceipt?.acceptedForSyscallDispatch
    && analysis?.syscallBoundaryReceipt?.pendingBy?.length) {
    diagnostics.push({ level: "error", code: "memory.analysis.syscall-boundary-ready-with-pending" });
  }
  if (analysis?.syscallBoundaryReceipt?.acceptedForSyscallDispatch
    && analysis?.runtimeDispatchReleaseReceipt?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "memory.analysis.syscall-boundary-without-runtime-dispatch-release" });
  }
  if (analysis?.syscallBoundaryReceipt?.restartSafe
    && analysis?.syscallBoundaryReceipt?.receiptRows?.some((row) => row.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "memory.analysis.syscall-boundary-safe-with-unsafe-row" });
  }
  if (!analysis?.syscallBoundaryReceipt?.commands?.some((command) => (
    command.command === "persist-memory-syscall-boundary-receipt"
  ))) {
    diagnostics.push({ level: "warning", code: "memory.analysis.syscall-boundary-persist-command.missing" });
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
    boundaryLeasePacket: analysis.boundaryLeasePacket,
    providerHandoffEnvelope: analysis.providerHandoffEnvelope,
    providerServiceContract: analysis.providerHandoffEnvelope?.providerServiceContract,
    operatorResumePacket: analysis.operatorResumePacket,
    releaseEvidenceLedger: analysis.releaseEvidenceLedger,
    syscallDispatchGate: analysis.syscallDispatchGate,
    providerAssertionDigest: analysis.providerAssertionDigest,
    analyticsExportBundle: analysis.analyticsExportBundle,
    operatorActionEnvelope: analysis.operatorActionEnvelope,
    restartStatusLedger: analysis.restartStatusLedger,
    releaseRiskBudget: analysis.releaseRiskBudget,
    operatorReleasePacket: analysis.operatorReleasePacket,
    dispatchReleaseLedger: analysis.dispatchReleaseLedger,
    audienceSyncWatermark: analysis.audienceSyncWatermark,
    audienceContinuityReceipt: analysis.audienceContinuityReceipt,
    adapterResumeReceipt: analysis.adapterResumeReceipt,
    operatorCommandReceipt: analysis.operatorCommandReceipt,
    claimEvidenceManifest: analysis.claimEvidenceManifest,
    claimRuntimeAdoptionReceipt: analysis.claimRuntimeAdoptionReceipt,
    claimRuntimeAnalyticsDigest: analysis.claimRuntimeAnalyticsDigest,
    operationalTriagePacket: analysis.operationalTriagePacket,
    operationalErrorRunbook: analysis.operationalErrorRunbook,
    replayStatusReceipt: analysis.replayStatusReceipt,
    syscallBoundaryReceipt: analysis.syscallBoundaryReceipt,
    diagnostics: [...analysis.diagnostics, ...validation.diagnostics],
  };
}
