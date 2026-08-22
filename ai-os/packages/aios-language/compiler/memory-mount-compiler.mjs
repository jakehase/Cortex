const DEFAULT_RETENTION_HOURS = 24;

const MAILCHIMP_MEMORY_MOUNTS = {
  campaignDraft: {
    path: "memory://mailchimp/campaign-draft",
    sensitivity: "workspace",
    retentionHours: DEFAULT_RETENTION_HOURS,
    providerResource: "campaigns",
    syncDirection: "pull-push",
    requiredCapability: "campaign.update"
  },
  audienceSnapshot: {
    path: "memory://mailchimp/audience-snapshot",
    sensitivity: "contact-metadata",
    retentionHours: 6,
    providerResource: "lists",
    syncDirection: "pull",
    requiredCapability: "audience.read"
  },
  verifierEvidence: {
    path: "memory://mailchimp/verifier-evidence",
    sensitivity: "derived-evidence",
    retentionHours: 72,
    providerResource: "local-verifier",
    syncDirection: "local-only",
    requiredCapability: null
  },
  rollbackJournal: {
    path: "memory://mailchimp/rollback-journal",
    sensitivity: "operational",
    retentionHours: 168,
    providerResource: "local-rollback",
    syncDirection: "local-only",
    requiredCapability: null
  }
};

const SUPPORTED_SYNC_DIRECTIONS = new Set(["pull", "pull-push", "append-only", "local-only"]);
const SUPPORTED_MOUNT_SCHEDULES = new Set(["compile", "preflight", "runtime", "manual"]);

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function compileProviderSyncContract(name, spec, mountRequest, mode, options, diagnostics) {
  const syncDirection = mountRequest.syncDirection || spec.syncDirection;
  if (!SUPPORTED_SYNC_DIRECTIONS.has(syncDirection)) {
    diagnostics.push({
      level: "error",
      code: "memory.sync.direction.unsupported",
      message: `Unsupported Mailchimp memory sync direction: ${syncDirection}`,
      mount: name
    });
  }

  const externalHandoff = syncDirection === "local-only"
    ? "not-required"
    : mode === "readonly"
      ? "read-through-provider-adapter"
      : "stage-local-before-provider-write";

  const negotiatedCapabilities = [
    spec.requiredCapability,
    ...(toArray(mountRequest.requiredCapabilities || mountRequest.capabilities))
  ].filter(Boolean);

  if (mode === "readonly" && syncDirection === "pull-push") {
    diagnostics.push({
      level: "warning",
      code: "memory.sync.readonlyWriteSuppressed",
      message: `${name} uses pull-push provider sync but readonly mode suppresses provider writeback.`,
      mount: name
    });
  }

  return {
    providerService: "mailchimp-marketing-api",
    providerResource: mountRequest.providerResource || spec.providerResource,
    syncDirection,
    externalHandoff,
    negotiatedCapabilities,
    syncMetadata: {
      cursorPath: `memory://mailchimp/sync-cursors/${name}`,
      lastSyncedAt: mountRequest.lastSyncedAt || null,
      conflictPolicy: mountRequest.conflictPolicy || (mode === "readonly" ? "remote-wins" : "local-draft-wins"),
      localOnly: options.localOnly !== false
    }
  };
}

function compileMountPreview(mount, diagnostics) {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.mount === mount.name && diagnostic.level === "error");
  const warningDiagnostics = diagnostics.filter((diagnostic) => diagnostic.mount === mount.name && diagnostic.level === "warning");
  const acceptsExternalHandoff = mount.providerContract.externalHandoff === "not-required"
    || mount.mode === "readonly"
    || mount.providerContract.syncMetadata.localOnly;

  return {
    mount: mount.name,
    label: mount.name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`),
    path: mount.path,
    mode: mount.mode,
    sensitivity: mount.sensitivity,
    retentionHours: mount.retentionHours,
    providerResource: mount.providerContract.providerResource,
    syncDirection: mount.providerContract.syncDirection,
    externalHandoff: mount.providerContract.externalHandoff,
    userVisibleState: blockingDiagnostics.length
      ? "blocked"
      : warningDiagnostics.length
        ? "needs-review"
        : "ready",
    acceptance: {
      acceptedForRuntime: blockingDiagnostics.length === 0,
      acceptsExternalHandoff,
      requiredCapability: mount.providerContract.negotiatedCapabilities[0] || null,
      conflictPolicy: mount.providerContract.syncMetadata.conflictPolicy,
      nextStep: blockingDiagnostics.length
        ? "fix-memory-mount"
        : warningDiagnostics.length
          ? "review-memory-warning"
          : mount.providerContract.syncDirection === "local-only"
            ? "keep-local"
            : "sync-through-provider-adapter"
    }
  };
}

function compileMemoryPreviewAcceptance(mounts, diagnostics, options) {
  const previewMounts = mounts.map((mount) => compileMountPreview(mount, diagnostics));
  const requiredCapabilities = Array.from(new Set(
    mounts.flatMap((mount) => mount.providerContract.negotiatedCapabilities)
  )).sort();
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const warningDiagnostics = diagnostics.filter((diagnostic) => diagnostic.level === "warning");
  const providerSyncMounts = previewMounts.filter((mount) => mount.syncDirection !== "local-only");
  const writebackSuppressed = diagnostics.some((diagnostic) => diagnostic.code === "memory.sync.readonlyWriteSuppressed");

  return {
    title: "Mailchimp memory readiness",
    mounts: previewMounts,
    readiness: {
      status: blockingDiagnostics.length
        ? "blocked"
        : warningDiagnostics.length
          ? "ready-with-warnings"
          : "ready",
      acceptedForRuntime: blockingDiagnostics.length === 0,
      acceptedForProviderSync: blockingDiagnostics.length === 0 && providerSyncMounts.length > 0,
      nextStep: blockingDiagnostics.length
        ? "resolve-memory-errors"
        : writebackSuppressed
          ? "confirm-readonly-sync-suppression"
          : providerSyncMounts.length
            ? "prepare-provider-sync"
            : "continue-local-runtime"
    },
    validationSummary: {
      totalMounts: mounts.length,
      providerSyncMounts: providerSyncMounts.length,
      localOnlyMounts: previewMounts.filter((mount) => mount.syncDirection === "local-only").length,
      blockingIssues: blockingDiagnostics.length,
      warningIssues: warningDiagnostics.length,
      requiredCapabilities
    },
    acceptanceCriteria: [
      {
        id: "mailchimp.memory.required-mounts-present",
        required: true,
        passed: mounts.length > 0 && blockingDiagnostics.length === 0,
        userVisible: true,
        nextStep: mounts.length > 0 ? "no-action" : "select-memory-mounts"
      },
      {
        id: "mailchimp.memory.provider-sync-local-boundary",
        required: true,
        passed: mounts.every((mount) => mount.localOnly === (options.localOnly !== false)),
        userVisible: true,
        nextStep: "keep-provider-writes-staged"
      },
      {
        id: "mailchimp.memory.writeback-policy-reviewed",
        required: false,
        passed: !writebackSuppressed,
        userVisible: true,
        nextStep: writebackSuppressed ? "review-readonly-writeback-suppression" : "no-action"
      }
    ]
  };
}

function compileMountRecoveryStep(mount) {
  const providerContract = mount.providerContract || {};
  const syncDirection = providerContract.syncDirection || "local-only";
  const writesProviderState = syncDirection === "pull-push" && mount.mode !== "readonly";
  const isAppendOnly = mount.mode === "append" || syncDirection === "append-only";
  const canRestoreLocal = mount.mode !== "readonly";

  return {
    mount: mount.name,
    path: mount.path,
    mode: mount.mode,
    providerResource: providerContract.providerResource,
    syncDirection,
    failureStatus: syncDirection === "local-only"
      ? "local-memory-recovery"
      : writesProviderState
        ? "provider-sync-needs-reconciliation"
        : "provider-read-cache-retryable",
    snapshotPolicy: {
      beforeRuntimeRequired: canRestoreLocal,
      checkpointPath: `memory://mailchimp/recovery-checkpoints/${mount.name}`,
      retentionHours: mount.retentionHours,
      includeProviderCursor: syncDirection !== "local-only"
    },
    rollbackPolicy: {
      canRestoreLocal,
      canRollbackProviderState: false,
      journalRequired: mount.name !== "rollbackJournal",
      nextAction: writesProviderState
        ? "restore-local-snapshot-and-mark-provider-review"
        : isAppendOnly
          ? "append-recovery-event"
          : syncDirection === "local-only"
            ? "restore-local-snapshot"
            : "discard-stale-cache-and-resync"
    },
    syncRecovery: {
      conflictPolicy: providerContract.syncMetadata?.conflictPolicy || "local-draft-wins",
      cursorPath: providerContract.syncMetadata?.cursorPath || null,
      externalHandoff: providerContract.externalHandoff || "not-required",
      retryProviderSync: syncDirection !== "local-only" && !writesProviderState,
      suppressProviderWriteback: mount.mode === "readonly" && syncDirection === "pull-push"
    }
  };
}

function compileMountHealthState(mount, diagnostics, options = {}) {
  const providerContract = mount.providerContract || {};
  const syncDirection = providerContract.syncDirection || "local-only";
  const mountDiagnostics = diagnostics.filter((diagnostic) => diagnostic.mount === mount.name);
  const errors = mountDiagnostics.filter((diagnostic) => diagnostic.level === "error");
  const warnings = mountDiagnostics.filter((diagnostic) => diagnostic.level === "warning");
  const providerSync = syncDirection !== "local-only";
  const writebackSuppressed = mount.mode === "readonly" && syncDirection === "pull-push";
  const retryBaseSeconds = Number.isInteger(Number(options.memoryRetryBaseSeconds))
    ? Number(options.memoryRetryBaseSeconds)
    : providerSync ? 5 : 1;
  const maxAttempts = Number.isInteger(Number(options.maxMemoryRetryAttempts))
    ? Number(options.maxMemoryRetryAttempts)
    : providerSync ? 4 : 2;

  return {
    mount: mount.name,
    path: mount.path,
    healthStatus: errors.length
      ? "unhealthy"
      : warnings.length || writebackSuppressed
        ? "degraded"
        : "healthy",
    failureState: errors.length
      ? "mount-contract-invalid"
      : writebackSuppressed
        ? "provider-writeback-suppressed"
        : warnings.length
          ? "operator-review-warning"
          : "none",
    degradedMode: errors.length
      ? "block-runtime-handoff"
      : providerSync
        ? "serve-local-cache-and-stage-provider-sync"
        : "local-runtime-memory-only",
    retryPolicy: {
      retryable: errors.length === 0,
      providerSync,
      maxAttempts,
      backoffBaseSeconds: retryBaseSeconds,
      backoffScheduleSeconds: Array.from({ length: maxAttempts }, (_, index) => retryBaseSeconds * (2 ** index)),
      stopWhen: providerSync ? "provider-sync-acknowledged" : "local-memory-mounted"
    },
    actionableErrors: mountDiagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      nextAction: diagnostic.level === "error" ? "fix-memory-mount" : "review-memory-warning"
    })),
    persistedState: {
      stateKey: `memory.mounts.${mount.name}`,
      requiredFields: {
        mount: "string",
        healthStatus: "healthy|degraded|unhealthy",
        lastMountedAt: "optional-iso8601",
        lastSyncedAt: "optional-iso8601",
        attemptCount: "integer",
        lastErrorCode: "optional-string",
        providerCursor: providerSync ? "optional-string" : "null"
      },
      restartAction: errors.length
        ? "block-until-contract-fixed"
        : providerSync
          ? "rehydrate-cursor-and-resume-sync"
          : "rehydrate-local-mount"
    }
  };
}

function stableMemorySnapshotId(seed) {
  const text = JSON.stringify(seed, Object.keys(seed).sort());
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `memory_snapshot_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function compileMemoryProviderHandoffAdoption(memoryContract = {}, options = {}) {
  const mounts = memoryContract.mounts || [];
  const diagnostics = memoryContract.diagnostics || [];
  const providerContract = memoryContract.providerServiceContract || {};
  const capabilityContract = options.capabilityContract || memoryContract.capabilityContract || {};
  const capabilityManifest = options.capabilityProviderHandoffManifest
    || capabilityContract.providerHandoffManifest
    || null;
  const capabilitySettings = options.capabilityRuntimeSettingsAdoption
    || capabilityContract.runtimeSettingsAdoption
    || null;
  const settingsByAction = new Map(
    (capabilitySettings?.settings || []).map((setting) => [setting.action, setting])
  );
  const availableActions = new Set([
    ...(options.availableCapabilities || []),
    ...(options.availableCapabilityActions || []),
    ...((capabilityContract.capabilities || []).map((capability) => capability.action)),
    ...((capabilityManifest?.operations || []).map((operation) => operation.action))
  ].filter(Boolean));
  const hasCapabilityContext = availableActions.size > 0 || Boolean(capabilityManifest);
  const providerMounts = mounts.filter((mount) => mount.providerContract?.syncDirection !== "local-only");
  const mountAdoptions = mounts.map((mount, index) => {
    const mountProvider = mount.providerContract || {};
    const requiredCapabilities = mountProvider.negotiatedCapabilities || [];
    const missingCapabilities = hasCapabilityContext
      ? requiredCapabilities.filter((capability) => !availableActions.has(capability))
      : [];
    const matchingOperations = capabilityManifest
      ? (capabilityManifest.operations || []).filter((operation) => requiredCapabilities.includes(operation.action))
      : [];
    const heldOperations = matchingOperations.filter((operation) => (
      operation.handoffStatus !== "ready-for-provider-adapter"
    ));
    const heldSettings = requiredCapabilities
      .map((capability) => settingsByAction.get(capability))
      .filter((setting) => setting && setting.adoptionStatus !== "adopted-for-runtime");
    const providerSync = mountProvider.syncDirection !== "local-only";
    const writeback = mountProvider.syncDirection === "pull-push" && mount.mode !== "readonly";
    const readyForSync = providerSync
      && missingCapabilities.length === 0
      && heldOperations.length === 0
      && heldSettings.length === 0
      && diagnostics.every((diagnostic) => diagnostic.mount !== mount.name || diagnostic.level !== "error");

    return {
      order: index + 1,
      mount: mount.name,
      path: mount.path,
      providerResource: mountProvider.providerResource || null,
      syncDirection: mountProvider.syncDirection || "local-only",
      externalHandoff: mountProvider.externalHandoff || "not-required",
      requiredCapabilities,
      missingCapabilities,
      matchedCommandIds: matchingOperations.map((operation) => operation.commandId).filter(Boolean),
      heldCommandIds: heldOperations.map((operation) => operation.commandId).filter(Boolean),
      heldRuntimeSettings: heldSettings.map((setting) => ({
        action: setting.action,
        commandId: setting.commandId,
        status: setting.adoptionStatus,
        nextAction: setting.nextAction
      })),
      writeback,
      readyForProviderSync: readyForSync,
      status: !providerSync
        ? "local-only"
        : missingCapabilities.length
          ? "missing-capability"
        : heldOperations.length
          ? "capability-handoff-held"
          : heldSettings.length
            ? "capability-settings-held"
            : readyForSync
              ? "provider-sync-ready"
              : "provider-sync-blocked",
      nextAction: !providerSync
        ? "hydrate-local-memory"
        : missingCapabilities.length
          ? "add-required-mailchimp-capability"
          : heldOperations.length
            ? heldOperations[0].nextAction || "resolve-capability-provider-handoff"
            : heldSettings.length
              ? heldSettings[0].nextAction || "accept-capability-runtime-settings"
            : readyForSync
              ? "handoff-memory-sync-to-provider-adapter"
              : "resolve-memory-diagnostics"
    };
  });
  const blocked = mountAdoptions.filter((mount) => (
    mount.status === "missing-capability"
    || mount.status === "capability-handoff-held"
    || mount.status === "capability-settings-held"
    || mount.status === "provider-sync-blocked"
  ));
  const providerSyncReady = mountAdoptions.filter((mount) => mount.readyForProviderSync);
  const missingCapabilities = Array.from(new Set(
    mountAdoptions.flatMap((mount) => mount.missingCapabilities)
  )).sort();
  const heldCommandIds = Array.from(new Set(
    mountAdoptions.flatMap((mount) => mount.heldCommandIds)
  )).sort();
  const heldRuntimeSettings = mountAdoptions.flatMap((mount) => mount.heldRuntimeSettings || []);
  const heldRuntimeSettingActions = Array.from(new Set(
    heldRuntimeSettings.map((setting) => setting.action)
  )).sort();
  const snapshotId = stableMemorySnapshotId({
    mounts: mountAdoptions.map((mount) => mount.mount),
    missingCapabilities,
    heldCommandIds,
    heldRuntimeSettingActions,
    capabilityManifestStatus: capabilityManifest?.status || "not-provided"
  });

  return {
    kind: "aios.memoryProviderHandoffAdoption",
    provider: "mailchimp",
    snapshotId,
    status: blocked.length
      ? "blocked"
      : providerSyncReady.length
        ? "provider-sync-ready"
        : "local-only",
    providerService: providerContract.providerService || capabilityManifest?.providerService || "mailchimp-marketing-api",
    capabilityManifestStatus: capabilityManifest?.status || "not-provided",
    acceptedForProviderSync: blocked.length === 0 && providerMounts.length > 0,
    mountAdoptions,
    adapterHandoff: {
      syncQueue: providerSyncReady.map((mount) => ({
        mount: mount.mount,
        providerResource: mount.providerResource,
        syncDirection: mount.syncDirection,
        commandIds: mount.matchedCommandIds,
        cursorPath: mounts.find((item) => item.name === mount.mount)?.providerContract?.syncMetadata?.cursorPath || null
      })),
      blockedMounts: blocked.map((mount) => mount.mount),
      heldCommandIds,
      heldRuntimeSettingActions,
      missingCapabilities,
      missingCapabilityPolicy: hasCapabilityContext
        ? "block-provider-sync-until-capability-compiled"
        : "defer-capability-validation-to-job-handoff",
      runtimeSettingsPolicy: heldRuntimeSettingActions.length
        ? "block-provider-sync-until-runtime-settings-adopted"
        : "runtime-settings-aligned",
      providerWritePolicy: providerSyncReady.some((mount) => mount.writeback)
        ? "stage-local-draft-before-provider-write"
        : "read-through-provider-or-local-only"
    },
    nextActions: blocked.map((mount) => ({
      mount: mount.mount,
      nextAction: mount.nextAction,
      required: true,
      missingCapabilities: mount.missingCapabilities,
      heldCommandIds: mount.heldCommandIds,
      heldRuntimeSettings: mount.heldRuntimeSettings || []
    })),
    counters: {
      mounts: mountAdoptions.length,
      providerSyncMounts: providerMounts.length,
      readyProviderSyncMounts: providerSyncReady.length,
      blockedMounts: blocked.length,
      missingCapabilities: missingCapabilities.length,
      heldCommandIds: heldCommandIds.length,
      heldRuntimeSettings: heldRuntimeSettingActions.length
    },
    truthBoundary: {
      source: "memory-mount-compiler",
      capabilityContextCallerSupplied: hasCapabilityContext,
      externalProviderStateVerified: false,
      deterministic: true
    }
  };
}

export function compileMemoryIntegrationExport(memoryContract = {}, options = {}) {
  const mounts = memoryContract.mounts || [];
  const diagnostics = memoryContract.diagnostics || [];
  const providerContract = memoryContract.providerServiceContract || {
    providerService: "mailchimp-marketing-api",
    syncRequired: mounts.some((mount) => mount.providerContract?.syncDirection !== "local-only"),
    capabilityNegotiation: Array.from(new Set(
      mounts.flatMap((mount) => mount.providerContract?.negotiatedCapabilities || [])
    )).sort(),
    handoffStates: mounts.reduce((states, mount) => {
      const handoff = mount.providerContract?.externalHandoff || "not-required";
      states[handoff] = (states[handoff] || 0) + 1;
      return states;
    }, {}),
    externalWritesAllowed: false
  };
  const health = memoryContract.health || compileMemoryHealthContract(memoryContract, options);
  const lifecycleControls = memoryContract.lifecycleControls
    || compileMemoryLifecycleControls(memoryContract, options);
  const resumePlan = memoryContract.operationalResumePlan
    || compileMemoryOperationalResumePlan({ ...memoryContract, health }, options);
  const previewAcceptance = memoryContract.previewAcceptance
    || compileMemoryPreviewAcceptance(mounts, diagnostics, options);
  const providerHandoffAdoption = memoryContract.providerHandoffAdoption
    || compileMemoryProviderHandoffAdoption(memoryContract, options);
  const providerMounts = mounts.filter((mount) => mount.providerContract?.syncDirection !== "local-only");
  const writebackMounts = providerMounts.filter((mount) => (
    mount.providerContract?.syncDirection === "pull-push" && mount.mode !== "readonly"
  ));
  const readonlySuppressedMounts = providerMounts.filter((mount) => (
    mount.providerContract?.syncDirection === "pull-push" && mount.mode === "readonly"
  ));
  const localOnlyMounts = mounts.filter((mount) => mount.providerContract?.syncDirection === "local-only");
  const lifecycleBlockingControls = (lifecycleControls.controls || []).filter((control) => control.blocksRuntime);
  const manualControls = (lifecycleControls.controls || []).filter((control) => control.requiresManualControl);
  const healthBlocked = health.healthStatus === "unhealthy";
  const exportReady = previewAcceptance.readiness?.acceptedForRuntime !== false
    && !healthBlocked
    && lifecycleBlockingControls.length === 0;
  const providerSyncReady = exportReady
    && providerMounts.length > 0
    && manualControls.length === 0
    && resumePlan.status !== "blocked"
    && providerHandoffAdoption.status !== "blocked";
  const snapshotId = stableMemorySnapshotId({
    mounts: mounts.map((mount) => mount.name),
    healthStatus: health.healthStatus,
    lifecycleStatus: lifecycleControls.status,
    resumeStatus: resumePlan.status,
    providerSync: providerMounts.map((mount) => mount.name)
  });
  const mountExports = mounts.map((mount, index) => {
    const provider = mount.providerContract || {};
    const healthState = (health.mounts || []).find((item) => item.mount === mount.name) || {};
    const lifecycle = (lifecycleControls.controls || []).find((item) => item.mount === mount.name) || {};
    const resume = (resumePlan.mounts || []).find((item) => item.mount === mount.name) || {};
    const providerSync = provider.syncDirection !== "local-only";
    const handoffState = provider.externalHandoff || "not-required";
    const blocksRuntime = lifecycle.blocksRuntime === true || healthState.healthStatus === "unhealthy";

    return {
      order: index + 1,
      mount: mount.name,
      path: mount.path,
      mode: mount.mode,
      sensitivity: mount.sensitivity,
      retentionHours: mount.retentionHours,
      providerResource: provider.providerResource || null,
      syncDirection: provider.syncDirection || "local-only",
      handoffState,
      providerSync,
      requiredCapabilities: provider.negotiatedCapabilities || [],
      cursorPath: provider.syncMetadata?.cursorPath || null,
      conflictPolicy: provider.syncMetadata?.conflictPolicy || "local-only",
      healthStatus: healthState.healthStatus || "unknown",
      lifecycleStatus: lifecycle.enabled === false ? "disabled" : lifecycle.schedule || "preflight",
      resumeAction: resume.restartAction || healthState.persistedState?.restartAction || "rehydrate-local-mount",
      exportReady: !blocksRuntime,
      blocksRuntime,
      nextAction: blocksRuntime
        ? lifecycle.nextAction || "fix-memory-mount"
        : providerSync
          ? "handoff-provider-sync-cursor"
          : "hydrate-local-memory"
    };
  });
  const timeline = [
    {
      order: 1,
      snapshotId,
      event: "mailchimp.memory.mounts.compiled",
      status: diagnostics.some((diagnostic) => diagnostic.level === "error") ? "compiled-with-errors" : "compiled",
      nextAction: mounts.length ? "evaluate-memory-readiness" : "select-memory-mounts",
      counters: {
        mounts: mounts.length,
        diagnostics: diagnostics.length,
        providerSyncMounts: providerMounts.length
      }
    },
    {
      order: 2,
      snapshotId,
      event: "mailchimp.memory.lifecycle.evaluated",
      status: lifecycleControls.status || "not-compiled",
      nextAction: lifecycleControls.nextActions?.[0]?.nextAction || "continue-memory-handoff",
      counters: {
        controls: lifecycleControls.counters?.mounts || 0,
        manualControls: manualControls.length,
        blockingControls: lifecycleBlockingControls.length
      }
    },
    {
      order: 3,
      snapshotId,
      event: "mailchimp.memory.provider_sync.prepared",
      status: providerSyncReady ? "provider-sync-ready" : exportReady ? "local-runtime-ready" : "blocked",
      nextAction: providerSyncReady
        ? "handoff-provider-sync-contract"
        : exportReady
          ? "hydrate-local-memory"
          : "resolve-memory-handoff-blockers",
      counters: {
        providerSyncMounts: providerMounts.length,
        writebackMounts: writebackMounts.length,
        readonlySuppressedMounts: readonlySuppressedMounts.length
      }
    }
  ];

  return {
    kind: "aios.memoryIntegrationExport",
    provider: "mailchimp",
    snapshotId,
    exportFormat: "aios.mailchimp.memory.integration.v1",
    status: exportReady
      ? providerSyncReady ? "provider-sync-ready" : "runtime-ready"
      : "blocked",
    exportSummary: {
      acceptedForRuntime: exportReady,
      acceptedForProviderSync: providerSyncReady,
      providerService: providerContract.providerService || "mailchimp-marketing-api",
      blockedMounts: mountExports.filter((mount) => mount.blocksRuntime).map((mount) => mount.mount),
      providerSyncMounts: providerMounts.map((mount) => mount.name),
      localOnlyMounts: localOnlyMounts.map((mount) => mount.name),
      requiredCapabilities: Array.from(new Set(providerContract.capabilityNegotiation || [])).sort(),
      nextActions: mountExports
        .filter((mount) => !mount.exportReady || mount.providerSync)
        .map((mount) => ({
          mount: mount.mount,
          nextAction: mount.nextAction,
          required: !mount.exportReady,
          syncDirection: mount.syncDirection
        })),
      capabilityHandoffNextActions: providerHandoffAdoption.nextActions || []
    },
    providerHandoff: {
      providerService: providerContract.providerService || "mailchimp-marketing-api",
      syncRequired: providerContract.syncRequired === true,
      externalWritesAllowed: providerContract.externalWritesAllowed === true,
      handoffStates: providerContract.handoffStates || {},
      cursorHandoff: resumePlan.providerCursorHandoff || [],
      missingCursorPolicy: "resync-from-provider-read-boundary",
      writebackPolicy: writebackMounts.length
        ? "stage-local-draft-and-require-provider-review-on-failure"
        : "read-through-or-local-only",
      capabilityAdoptionStatus: providerHandoffAdoption.status,
      capabilityMissingPolicy: providerHandoffAdoption.adapterHandoff?.missingCapabilityPolicy || "defer-capability-validation-to-job-handoff"
    },
    providerHandoffAdoption,
    capabilityNegotiation: mountExports
      .filter((mount) => mount.requiredCapabilities.length)
      .map((mount) => ({
        mount: mount.mount,
        requiredCapabilities: mount.requiredCapabilities,
        providerResource: mount.providerResource,
        syncDirection: mount.syncDirection,
        nextAction: mount.exportReady ? "verify-capability-present" : mount.nextAction
      })),
    mountExports,
    timeline,
    persistedStateContract: {
      namespace: "memory.integration",
      snapshotKey: `memory.integration.${snapshotId}`,
      statusKey: "memory.integration.currentStatus",
      requiredStateKeys: [
        ...(health.persistedStateContract?.requiredStateKeys || []),
        ...(lifecycleControls.persistedStateContract?.requiredStateKeys || []),
        ...(resumePlan.persistedStateContract?.requiredStateKeys || [])
      ],
      adoptionEvent: "mailchimp.memory.integration.adopted",
      statusEvent: "mailchimp.memory.integration.status",
      missingStatePolicy: exportReady
        ? "rebuild-memory-integration-from-compiled-mounts"
        : "block-until-memory-integration-ready"
    },
    counters: {
      mounts: mounts.length,
      providerSyncMounts: providerMounts.length,
      localOnlyMounts: localOnlyMounts.length,
      writebackMounts: writebackMounts.length,
      readonlySuppressedMounts: readonlySuppressedMounts.length,
      blockedMounts: mountExports.filter((mount) => mount.blocksRuntime).length,
      capabilityBlockedMounts: providerHandoffAdoption.counters?.blockedMounts || 0,
      capabilityMissingCount: providerHandoffAdoption.counters?.missingCapabilities || 0,
      requiredCapabilities: Array.from(new Set(providerContract.capabilityNegotiation || [])).length,
      timelineEvents: timeline.length
    },
    truthBoundary: {
      source: "memory-mount-compiler",
      externalProviderStateVerified: false,
      providerFactsCallerSupplied: true,
      deterministic: true
    }
  };
}

export function compileMemoryHealthContract(memoryContract = {}, options = {}) {
  const mounts = memoryContract.mounts || [];
  const diagnostics = memoryContract.diagnostics || [];
  const mountHealth = mounts.map((mount) => compileMountHealthState(mount, diagnostics, options));
  const unhealthy = mountHealth.filter((mount) => mount.healthStatus === "unhealthy");
  const degraded = mountHealth.filter((mount) => mount.healthStatus === "degraded");
  const providerSync = mountHealth.filter((mount) => mount.retryPolicy.providerSync);

  return {
    kind: "aios.memoryHealthContract",
    provider: "mailchimp",
    healthStatus: unhealthy.length
      ? "unhealthy"
      : degraded.length
        ? "degraded"
        : "healthy",
    runtimeMode: unhealthy.length
      ? "blocked-before-runtime"
      : degraded.length
        ? "degraded-local-cache-runtime"
        : "runtime-ready",
    retryable: unhealthy.length === 0,
    mounts: mountHealth,
    counters: {
      mounts: mountHealth.length,
      providerSyncMounts: providerSync.length,
      degradedMounts: degraded.length,
      unhealthyMounts: unhealthy.length,
      actionableErrors: mountHealth.reduce((count, mount) => count + mount.actionableErrors.length, 0)
    },
    persistedStateContract: {
      namespace: "memory.mounts",
      requiredStateKeys: mountHealth.map((mount) => mount.persistedState.stateKey),
      missingStatePolicy: unhealthy.length ? "block-invalid-mounts" : "rebuild-mount-health-from-compiled-contract",
      adoptionEvent: "mailchimp.memory.health.adopted",
      statusEvent: "mailchimp.memory.health.status"
    },
    actionableErrors: mountHealth.flatMap((mount) => mount.actionableErrors.map((error) => ({
      ...error,
      mount: mount.mount
    }))),
    truthBoundary: {
      source: "compiled-memory-mounts",
      externalProviderStateVerified: false,
      deterministic: true
    }
  };
}

function normalizePersistedMountState(mountHealth, persistedState = {}) {
  const persisted = persistedState?.[mountHealth.persistedState.stateKey]
    || persistedState?.[mountHealth.mount]
    || null;
  const storedStatus = persisted?.healthStatus || "missing";
  const lastErrorCode = persisted?.lastErrorCode || null;
  const attemptCount = Number.isInteger(Number(persisted?.attemptCount))
    ? Number(persisted.attemptCount)
    : 0;
  const providerCursor = persisted?.providerCursor || null;
  const providerSync = mountHealth.retryPolicy.providerSync === true;
  const maxAttempts = mountHealth.retryPolicy.maxAttempts;
  const exhausted = attemptCount >= maxAttempts && storedStatus !== "healthy";

  return {
    mount: mountHealth.mount,
    stateKey: mountHealth.persistedState.stateKey,
    storedStatus,
    expectedStatus: mountHealth.healthStatus,
    providerSync,
    providerCursor,
    attemptCount,
    lastErrorCode,
    restartAction: mountHealth.healthStatus === "unhealthy"
      ? "block-until-memory-contract-fixed"
      : storedStatus === "missing"
        ? mountHealth.persistedState.restartAction
        : exhausted
          ? "enter-degraded-mode-and-surface-actionable-error"
          : providerSync
            ? "resume-provider-sync-from-cursor"
            : "rehydrate-local-memory-mount",
    canResumeAutomatically: mountHealth.healthStatus !== "unhealthy" && !exhausted,
    degradedMode: exhausted ? "retry-budget-exhausted-local-cache-only" : mountHealth.degradedMode,
    nextRetryAfterSeconds: exhausted
      ? null
      : mountHealth.retryPolicy.backoffScheduleSeconds[
        Math.min(attemptCount, mountHealth.retryPolicy.backoffScheduleSeconds.length - 1)
      ] || null,
    actionableError: exhausted
      ? {
        code: lastErrorCode || "memory.retry.exhausted",
        message: `${mountHealth.mount} exhausted its memory resume retry budget.`,
        nextAction: "review-memory-mount-before-runtime"
      }
      : null
  };
}

export function compileMemoryOperationalResumePlan(memoryContract = {}, options = {}) {
  const health = memoryContract.health || compileMemoryHealthContract(memoryContract, options);
  const persistedMountState = options.persistedMountState || {};
  const mounts = (health.mounts || []).map((mountHealth) => (
    normalizePersistedMountState(mountHealth, persistedMountState)
  ));
  const blocked = mounts.filter((mount) => mount.restartAction === "block-until-memory-contract-fixed");
  const degraded = mounts.filter((mount) => mount.degradedMode !== "local-runtime-memory-only" && !mount.canResumeAutomatically);
  const providerSync = mounts.filter((mount) => mount.providerSync);
  const nextRetryAfterSeconds = mounts
    .map((mount) => mount.nextRetryAfterSeconds)
    .filter((value) => value != null)
    .sort((left, right) => left - right)[0] || null;

  return {
    kind: "aios.memoryOperationalResumePlan",
    provider: "mailchimp",
    status: blocked.length
      ? "blocked"
      : degraded.length
        ? "degraded"
        : mounts.some((mount) => mount.storedStatus === "missing")
          ? "state-reconstructed"
          : "ready",
    runtimeMode: blocked.length
      ? "blocked-before-runtime"
      : degraded.length
        ? "local-cache-runtime-with-operator-review"
        : "runtime-ready",
    mounts,
    resumeOrder: [
      ...mounts.filter((mount) => !mount.providerSync).map((mount) => mount.mount),
      ...providerSync.map((mount) => mount.mount)
    ],
    providerCursorHandoff: providerSync.map((mount) => ({
      mount: mount.mount,
      stateKey: mount.stateKey,
      providerCursor: mount.providerCursor,
      missingCursorPolicy: "resync-from-provider-read-boundary"
    })),
    retryHandoff: {
      retryable: blocked.length === 0,
      nextRetryAfterSeconds,
      retryBudgetExhaustedMounts: mounts
        .filter((mount) => mount.actionableError?.code === "memory.retry.exhausted")
        .map((mount) => mount.mount)
    },
    persistedStateContract: {
      namespace: health.persistedStateContract?.namespace || "memory.mounts",
      requiredStateKeys: health.persistedStateContract?.requiredStateKeys || [],
      adoptionEvent: "mailchimp.memory.resume.adopted",
      statusEvent: "mailchimp.memory.resume.status",
      missingStatePolicy: blocked.length
        ? "block-invalid-mounts"
        : "rebuild-mount-state-and-resume"
    },
    actionableErrors: [
      ...(health.actionableErrors || []),
      ...mounts.map((mount) => mount.actionableError).filter(Boolean)
    ],
    counters: {
      mounts: mounts.length,
      providerSyncMounts: providerSync.length,
      blockedMounts: blocked.length,
      degradedMounts: degraded.length,
      missingStateMounts: mounts.filter((mount) => mount.storedStatus === "missing").length
    },
    truthBoundary: {
      source: "memory-mount-compiler",
      persistedStateTrustedAsCallerSupplied: true,
      externalProviderStateVerified: false,
      deterministic: true
    }
  };
}

export function compileMemoryLifecycleControls(memoryContract = {}, options = {}) {
  const mounts = memoryContract.mounts || [];
  const diagnostics = [...(memoryContract.diagnostics || [])];
  const controlSource = options.memoryControls || {};
  const defaultEnabled = controlSource.enabled !== false;
  const defaultSchedule = controlSource.schedule || "preflight";
  const mountOverrides = controlSource.mounts || {};
  const controls = mounts.map((mount) => {
    const override = mountOverrides[mount.name] || {};
    const enabled = override.enabled ?? mount.enabled ?? defaultEnabled;
    const schedule = override.schedule || mount.schedule || defaultSchedule;
    const providerSync = mount.providerContract?.syncDirection !== "local-only";
    const writeback = mount.providerContract?.syncDirection === "pull-push" && mount.mode !== "readonly";
    const manualRequired = providerSync && (schedule === "manual" || writeback);

    if (!SUPPORTED_MOUNT_SCHEDULES.has(schedule)) {
      diagnostics.push({
        level: "error",
        code: "memory.lifecycle.schedule.unsupported",
        message: `Unsupported memory lifecycle schedule: ${schedule}`,
        mount: mount.name,
        nextAction: "select-supported-memory-schedule"
      });
    }

    if (enabled === false && providerSync) {
      diagnostics.push({
        level: "warning",
        code: "memory.lifecycle.provider_sync.disabled",
        message: `${mount.name} provider sync is disabled by lifecycle controls.`,
        mount: mount.name,
        nextAction: "enable-memory-sync-or-confirm-local-cache"
      });
    }

    return {
      mount: mount.name,
      path: mount.path,
      enabled,
      schedule,
      mode: mount.mode,
      providerSync,
      writeback,
      canEnable: true,
      canDisable: mount.name !== "rollbackJournal",
      blocksRuntime: enabled === false && mount.name !== "rollbackJournal",
      requiresManualControl: manualRequired,
      nextAction: enabled === false
        ? "enable-memory-mount"
        : !SUPPORTED_MOUNT_SCHEDULES.has(schedule)
          ? "select-supported-memory-schedule"
          : manualRequired
            ? "confirm-provider-sync-before-runtime"
            : providerSync
              ? "prepare-provider-sync"
              : "mount-local-memory",
      settings: {
        allowedSchedules: Array.from(SUPPORTED_MOUNT_SCHEDULES),
        requestedSchedule: override.schedule || mount.schedule || null,
        requestedEnabled: override.enabled ?? mount.enabled ?? null,
        retentionHours: mount.retentionHours,
        conflictPolicy: mount.providerContract?.syncMetadata?.conflictPolicy || "local-only"
      }
    };
  });
  const blockingControls = controls.filter((control) => control.blocksRuntime);
  const manualControls = controls.filter((control) => control.requiresManualControl);
  const scheduleErrors = diagnostics.filter((diagnostic) => diagnostic.code === "memory.lifecycle.schedule.unsupported");

  return {
    kind: "aios.memoryLifecycleControls",
    provider: "mailchimp",
    status: scheduleErrors.length
      ? "invalid"
      : blockingControls.length
        ? "disabled-mounts-block-runtime"
        : manualControls.length
          ? "manual-action-required"
          : "ready",
    controls,
    settings: {
      defaultEnabled,
      defaultSchedule,
      allowedSchedules: Array.from(SUPPORTED_MOUNT_SCHEDULES),
      localOnly: options.localOnly !== false
    },
    nextActions: controls
      .filter((control) => control.nextAction !== "mount-local-memory" && control.nextAction !== "prepare-provider-sync")
      .map((control) => ({
        mount: control.mount,
        nextAction: control.nextAction,
        required: control.blocksRuntime || control.requiresManualControl,
        schedule: control.schedule
      })),
    diagnostics,
    counters: {
      mounts: controls.length,
      enabledMounts: controls.filter((control) => control.enabled).length,
      disabledMounts: controls.filter((control) => !control.enabled).length,
      providerSyncMounts: controls.filter((control) => control.providerSync).length,
      manualControls: manualControls.length,
      blockingControls: blockingControls.length,
      diagnostics: diagnostics.length
    },
    persistedStateContract: {
      namespace: "memory.lifecycle",
      requiredStateKeys: controls.map((control) => `memory.lifecycle.${control.mount}`),
      adoptionEvent: "mailchimp.memory.lifecycle.adopted",
      statusEvent: "mailchimp.memory.lifecycle.status",
      missingStatePolicy: "rebuild-memory-lifecycle-controls-from-compiled-contract"
    },
    truthBoundary: {
      source: "memory-mount-compiler",
      externalProviderStateVerified: false,
      deterministic: true
    }
  };
}

export function compileMemoryAdapterSyncReadiness(memoryContract = {}, options = {}) {
  const mounts = memoryContract.mounts || [];
  const integrationExport = memoryContract.integrationExport || compileMemoryIntegrationExport(memoryContract, options);
  const providerHandoffAdoption = memoryContract.providerHandoffAdoption
    || integrationExport.providerHandoffAdoption
    || compileMemoryProviderHandoffAdoption(memoryContract, options);
  const lifecycleControls = memoryContract.lifecycleControls
    || compileMemoryLifecycleControls(memoryContract, options);
  const resumePlan = memoryContract.operationalResumePlan
    || compileMemoryOperationalResumePlan(memoryContract, options);
  const health = memoryContract.health || compileMemoryHealthContract(memoryContract, options);
  const providerMounts = mounts.filter((mount) => mount.providerContract?.syncDirection !== "local-only");
  const syncQueue = providerHandoffAdoption.adapterHandoff?.syncQueue || [];
  const blockedMounts = Array.from(new Set([
    ...(integrationExport.exportSummary?.blockedMounts || []),
    ...(providerHandoffAdoption.adapterHandoff?.blockedMounts || []),
    ...(lifecycleControls.controls || [])
      .filter((control) => control.blocksRuntime)
      .map((control) => control.mount),
    ...(health.mounts || [])
      .filter((mount) => mount.healthStatus === "unhealthy")
      .map((mount) => mount.mount)
  ])).sort();
  const manualMounts = (lifecycleControls.controls || [])
    .filter((control) => control.requiresManualControl)
    .map((control) => control.mount)
    .sort();
  const degradedMounts = (health.mounts || [])
    .filter((mount) => mount.healthStatus === "degraded")
    .map((mount) => mount.mount)
    .sort();
  const exhaustedRetryMounts = resumePlan.retryHandoff?.retryBudgetExhaustedMounts || [];
  const missingCapabilities = providerHandoffAdoption.adapterHandoff?.missingCapabilities || [];
  const heldCommandIds = providerHandoffAdoption.adapterHandoff?.heldCommandIds || [];
  const heldRuntimeSettingActions = providerHandoffAdoption.adapterHandoff?.heldRuntimeSettingActions || [];
  const status = blockedMounts.length || resumePlan.status === "blocked"
    ? "blocked"
    : missingCapabilities.length || heldCommandIds.length || heldRuntimeSettingActions.length
      ? "capability-handoff-required"
      : manualMounts.length || exhaustedRetryMounts.length
        ? "operator-action-required"
        : syncQueue.length
          ? "provider-sync-ready"
          : "local-runtime-ready";

  return {
    kind: "aios.memoryAdapterSyncReadiness",
    provider: "mailchimp",
    snapshotId: stableMemorySnapshotId({
      integrationSnapshotId: integrationExport.snapshotId,
      providerHandoffSnapshotId: providerHandoffAdoption.snapshotId,
      lifecycleStatus: lifecycleControls.status,
      resumeStatus: resumePlan.status,
      status
    }),
    status,
    acceptedForRuntimeAdapter: status !== "blocked",
    acceptedForProviderSync: status === "provider-sync-ready",
    syncQueue: syncQueue.map((item) => ({
      mount: item.mount,
      providerResource: item.providerResource,
      syncDirection: item.syncDirection,
      commandIds: item.commandIds || [],
      cursorPath: item.cursorPath,
      resumeStateKey: (resumePlan.providerCursorHandoff || [])
        .find((cursor) => cursor.mount === item.mount)?.stateKey || null
    })),
    runtimeMemory: {
      localOnlyMounts: integrationExport.exportSummary?.localOnlyMounts || [],
      providerSyncMounts: providerMounts.map((mount) => mount.name),
      degradedMounts,
      blockedMounts,
      missingCursorPolicy: integrationExport.providerHandoff?.missingCursorPolicy
        || "resync-from-provider-read-boundary",
      writebackPolicy: integrationExport.providerHandoff?.writebackPolicy
        || "read-through-or-local-only"
    },
    adapterControls: {
      lifecycleStatus: lifecycleControls.status,
      resumeStatus: resumePlan.status,
      healthStatus: health.healthStatus,
      canResumeAutomatically: resumePlan.retryHandoff?.retryable === true && blockedMounts.length === 0,
      nextRetryAfterSeconds: resumePlan.retryHandoff?.nextRetryAfterSeconds || null,
      retryBudgetExhaustedMounts: exhaustedRetryMounts,
      manualMounts
    },
    blockers: blockedMounts.map((mount) => ({
      source: "memory",
      mount,
      nextAction: (lifecycleControls.nextActions || []).find((item) => item.mount === mount)?.nextAction
        || "resolve-memory-handoff-blocker",
      required: true
    })),
    operatorActions: [
      ...manualMounts.map((mount) => ({
        source: "memory-lifecycle",
        mount,
        nextAction: "confirm-provider-sync-before-runtime",
        required: true
      })),
      ...missingCapabilities.map((capability) => ({
        source: "memory-capability",
        mount: null,
        capability,
        nextAction: "add-required-mailchimp-capability",
        required: true
      })),
      ...heldCommandIds.map((commandId) => ({
        source: "memory-capability-command",
        mount: null,
        commandId,
        nextAction: "resolve-capability-provider-handoff",
        required: true
      })),
      ...heldRuntimeSettingActions.map((action) => ({
        source: "memory-capability-runtime-settings",
        mount: null,
        action,
        nextAction: "accept-capability-runtime-settings",
        required: true
      })),
      ...exhaustedRetryMounts.map((mount) => ({
        source: "memory-retry-budget",
        mount,
        nextAction: "review-memory-mount-before-runtime",
        required: true
      }))
    ],
    counters: {
      mounts: mounts.length,
      providerSyncMounts: providerMounts.length,
      syncQueueItems: syncQueue.length,
      blockedMounts: blockedMounts.length,
      manualMounts: manualMounts.length,
      degradedMounts: degradedMounts.length,
      missingCapabilities: missingCapabilities.length,
      heldCommandIds: heldCommandIds.length,
      heldRuntimeSettings: heldRuntimeSettingActions.length,
      exhaustedRetryMounts: exhaustedRetryMounts.length
    },
    truthBoundary: {
      source: "memory-mount-compiler",
      externalProviderStateVerified: false,
      persistedStateTrustedAsCallerSupplied: true,
      deterministic: true
    }
  };
}

export function compileMemoryProviderSyncReviewPacket(memoryContract = {}, options = {}) {
  const mounts = memoryContract.mounts || [];
  const integrationExport = memoryContract.integrationExport
    || compileMemoryIntegrationExport(memoryContract, options);
  const adapterReadiness = memoryContract.adapterSyncReadiness
    || compileMemoryAdapterSyncReadiness({
      ...memoryContract,
      integrationExport
    }, options);
  const providerHandoff = memoryContract.providerHandoffAdoption
    || integrationExport.providerHandoffAdoption
    || compileMemoryProviderHandoffAdoption(memoryContract, options);
  const lifecycleControls = memoryContract.lifecycleControls
    || compileMemoryLifecycleControls(memoryContract, options);
  const health = memoryContract.health || compileMemoryHealthContract(memoryContract, options);
  const controlsByMount = new Map((lifecycleControls.controls || []).map((control) => [control.mount, control]));
  const healthByMount = new Map((health.mounts || []).map((mount) => [mount.mount, mount]));
  const adoptionByMount = new Map((providerHandoff.mountAdoptions || []).map((mount) => [mount.mount, mount]));
  const syncQueueByMount = new Map((adapterReadiness.syncQueue || []).map((item) => [item.mount, item]));
  const providerRows = mounts.map((mount, index) => {
    const provider = mount.providerContract || {};
    const lifecycle = controlsByMount.get(mount.name) || {};
    const healthState = healthByMount.get(mount.name) || {};
    const adoption = adoptionByMount.get(mount.name) || {};
    const queueItem = syncQueueByMount.get(mount.name) || null;
    const providerSync = provider.syncDirection !== "local-only";
    const readyForSync = providerSync
      && adapterReadiness.acceptedForProviderSync === true
      && adoption.readyForProviderSync === true
      && Boolean(queueItem);
    const blocked = adapterReadiness.blockers?.some((blocker) => blocker.mount === mount.name)
      || healthState.healthStatus === "unhealthy"
      || lifecycle.blocksRuntime === true
      || adoption.status === "missing-capability"
      || adoption.status === "capability-handoff-held"
      || adoption.status === "capability-settings-held";

    return {
      order: index + 1,
      mount: mount.name,
      path: mount.path,
      providerResource: provider.providerResource || null,
      syncDirection: provider.syncDirection || "local-only",
      providerSync,
      readyForProviderSync: readyForSync,
      status: !providerSync
        ? "local-only"
        : blocked
          ? "blocked"
          : readyForSync
            ? "sync-ready"
            : lifecycle.requiresManualControl
              ? "operator-action-required"
              : "compiled",
      mode: mount.mode,
      sensitivity: mount.sensitivity,
      retentionHours: mount.retentionHours,
      cursorPath: provider.syncMetadata?.cursorPath || queueItem?.cursorPath || null,
      resumeStateKey: queueItem?.resumeStateKey || healthState.persistedState?.stateKey || null,
      conflictPolicy: provider.syncMetadata?.conflictPolicy || "local-only",
      requiredCapabilities: provider.negotiatedCapabilities || [],
      missingCapabilities: adoption.missingCapabilities || [],
      heldCommandIds: adoption.heldCommandIds || [],
      heldRuntimeSettings: adoption.heldRuntimeSettings || [],
      healthStatus: healthState.healthStatus || "unknown",
      lifecycleStatus: lifecycle.enabled === false ? "disabled" : lifecycle.schedule || "preflight",
      externalHandoff: provider.externalHandoff || "not-required",
      nextAction: !providerSync
        ? "hydrate-local-memory"
        : blocked
          ? adoption.nextAction || lifecycle.nextAction || "resolve-memory-provider-sync"
          : readyForSync
            ? "handoff-memory-sync-to-provider-adapter"
            : lifecycle.nextAction || "prepare-provider-sync"
    };
  });
  const blockedRows = providerRows.filter((row) => row.status === "blocked");
  const syncReadyRows = providerRows.filter((row) => row.readyForProviderSync);
  const operatorRows = providerRows.filter((row) => row.status === "operator-action-required");

  return {
    kind: "aios.memoryProviderSyncReviewPacket",
    provider: "mailchimp",
    snapshotId: stableMemorySnapshotId({
      integrationSnapshotId: integrationExport.snapshotId,
      adapterSnapshotId: adapterReadiness.snapshotId,
      statuses: providerRows.map((row) => row.status),
      blocked: blockedRows.map((row) => row.mount)
    }),
    status: blockedRows.length
      ? "blocked"
      : operatorRows.length
        ? "operator-action-required"
        : syncReadyRows.length
          ? "provider-sync-ready"
          : "local-runtime-ready",
    providerService: integrationExport.providerHandoff?.providerService || "mailchimp-marketing-api",
    providerRows,
    exportSummary: {
      acceptedForRuntime: adapterReadiness.acceptedForRuntimeAdapter === true,
      acceptedForProviderSync: adapterReadiness.acceptedForProviderSync === true && blockedRows.length === 0,
      syncQueue: adapterReadiness.syncQueue || [],
      blockedMounts: blockedRows.map((row) => row.mount),
      localOnlyMounts: providerRows.filter((row) => !row.providerSync).map((row) => row.mount),
      providerSyncMounts: providerRows.filter((row) => row.providerSync).map((row) => row.mount),
      requiredCapabilities: Array.from(new Set(providerRows.flatMap((row) => row.requiredCapabilities))).sort(),
      missingCapabilities: Array.from(new Set(providerRows.flatMap((row) => row.missingCapabilities))).sort(),
      heldCommandIds: Array.from(new Set(providerRows.flatMap((row) => row.heldCommandIds))).sort(),
      heldRuntimeSettingActions: Array.from(new Set(
        providerRows.flatMap((row) => (row.heldRuntimeSettings || []).map((setting) => setting.action))
      )).sort(),
      nextActions: providerRows
        .filter((row) => row.status !== "local-only" && row.status !== "sync-ready")
        .map((row) => ({
          mount: row.mount,
          nextAction: row.nextAction,
          required: row.status === "blocked" || row.status === "operator-action-required",
          syncDirection: row.syncDirection
        }))
    },
    counters: {
      mounts: providerRows.length,
      providerSyncMounts: providerRows.filter((row) => row.providerSync).length,
      syncReadyMounts: syncReadyRows.length,
      blockedMounts: blockedRows.length,
      operatorActionMounts: operatorRows.length,
      missingCapabilities: Array.from(new Set(providerRows.flatMap((row) => row.missingCapabilities))).length,
      heldCommandIds: Array.from(new Set(providerRows.flatMap((row) => row.heldCommandIds))).length,
      heldRuntimeSettings: Array.from(new Set(
        providerRows.flatMap((row) => (row.heldRuntimeSettings || []).map((setting) => setting.action))
      )).length
    },
    persistedStateContract: {
      namespace: "memory.provider_sync_review",
      snapshotKey: "memory.provider_sync_review.currentSnapshot",
      statusKey: "memory.provider_sync_review.currentStatus",
      requiredStateKeys: Array.from(new Set([
        ...(integrationExport.persistedStateContract?.requiredStateKeys || []),
        ...(adapterReadiness.syncQueue || []).map((item) => item.resumeStateKey)
      ].filter(Boolean))).sort(),
      adoptionEvent: "mailchimp.memory.provider_sync_review.adopted",
      statusEvent: "mailchimp.memory.provider_sync_review.status",
      missingStatePolicy: blockedRows.length
        ? "block-provider-sync-review-until-memory-ready"
        : "rebuild-provider-sync-review-from-memory-contract"
    },
    truthBoundary: {
      source: "memory-mount-compiler",
      externalProviderStateVerified: false,
      deterministic: true
    }
  };
}

export function compileMemoryProviderSyncPayload(memoryContract = {}, options = {}) {
  const mounts = memoryContract.mounts || [];
  const integrationExport = memoryContract.integrationExport
    || compileMemoryIntegrationExport(memoryContract, options);
  const adapterReadiness = memoryContract.adapterSyncReadiness
    || compileMemoryAdapterSyncReadiness({
      ...memoryContract,
      integrationExport
    }, options);
  const reviewPacket = memoryContract.providerSyncReviewPacket
    || compileMemoryProviderSyncReviewPacket({
      ...memoryContract,
      integrationExport,
      adapterSyncReadiness: adapterReadiness
    }, options);
  const resumePlan = memoryContract.operationalResumePlan
    || compileMemoryOperationalResumePlan(memoryContract, options);
  const health = memoryContract.health || compileMemoryHealthContract(memoryContract, options);
  const rowsByMount = new Map((reviewPacket.providerRows || []).map((row) => [row.mount, row]));
  const resumeByMount = new Map((resumePlan.mounts || []).map((mount) => [mount.mount, mount]));
  const healthByMount = new Map((health.mounts || []).map((mount) => [mount.mount, mount]));
  const syncQueueByMount = new Map((adapterReadiness.syncQueue || []).map((item) => [item.mount, item]));
  const payloadMounts = mounts.map((mount, index) => {
    const provider = mount.providerContract || {};
    const row = rowsByMount.get(mount.name) || {};
    const resume = resumeByMount.get(mount.name) || {};
    const healthState = healthByMount.get(mount.name) || {};
    const queueItem = syncQueueByMount.get(mount.name) || {};
    const providerSync = provider.syncDirection !== "local-only";
    const writeback = provider.syncDirection === "pull-push" && mount.mode !== "readonly";
    const blocked = row.status === "blocked" || healthState.healthStatus === "unhealthy";

    return {
      order: index + 1,
      mount: mount.name,
      path: mount.path,
      mode: mount.mode,
      providerResource: provider.providerResource || null,
      providerSync,
      syncDirection: provider.syncDirection || "local-only",
      payloadStatus: !providerSync
        ? "local-only"
        : blocked
          ? "blocked"
          : row.readyForProviderSync || Boolean(queueItem.mount)
            ? "ready-for-sync"
            : row.status || "compiled",
      cursor: {
        cursorPath: provider.syncMetadata?.cursorPath || row.cursorPath || queueItem.cursorPath || null,
        resumeStateKey: queueItem.resumeStateKey || row.resumeStateKey || resume.stateKey || healthState.persistedState?.stateKey || null,
        providerCursor: resume.providerCursor || null,
        missingCursorPolicy: adapterReadiness.runtimeMemory?.missingCursorPolicy || "resync-from-provider-read-boundary"
      },
      conflictPolicy: provider.syncMetadata?.conflictPolicy || row.conflictPolicy || "local-only",
      writebackPolicy: writeback
        ? "stage-local-draft-before-provider-write"
        : providerSync
          ? "read-through-provider-cache"
          : "local-runtime-only",
      capabilityDependencies: {
        requiredCapabilities: provider.negotiatedCapabilities || row.requiredCapabilities || [],
        matchedCommandIds: queueItem.commandIds || [],
        missingCapabilities: row.missingCapabilities || [],
        heldCommandIds: row.heldCommandIds || []
      },
      restartSemantics: {
        restartAction: resume.restartAction || healthState.persistedState?.restartAction || "rehydrate-local-mount",
        canResumeAutomatically: resume.canResumeAutomatically !== false && !blocked,
        nextRetryAfterSeconds: resume.nextRetryAfterSeconds || null,
        degradedMode: resume.degradedMode || healthState.degradedMode || "local-runtime-memory-only"
      },
      nextAction: !providerSync
        ? "hydrate-local-memory"
        : blocked
          ? row.nextAction || "resolve-memory-provider-sync"
          : row.readyForProviderSync || Boolean(queueItem.mount)
            ? "dispatch-memory-sync"
            : row.nextAction || "prepare-provider-sync"
    };
  });
  const syncReady = payloadMounts.filter((mount) => mount.payloadStatus === "ready-for-sync");
  const blocked = payloadMounts.filter((mount) => mount.payloadStatus === "blocked");
  const operatorAction = payloadMounts.filter((mount) => (
    mount.providerSync && !["ready-for-sync", "blocked"].includes(mount.payloadStatus)
  ));
  const snapshotId = stableMemorySnapshotId({
    integrationSnapshotId: integrationExport.snapshotId,
    adapterSnapshotId: adapterReadiness.snapshotId,
    statuses: payloadMounts.map((mount) => `${mount.mount}:${mount.payloadStatus}`)
  });

  return {
    kind: "aios.memoryProviderSyncPayload",
    provider: "mailchimp",
    snapshotId,
    status: blocked.length
      ? "blocked"
      : operatorAction.length
        ? "operator-action-required"
        : syncReady.length
          ? "ready-to-sync"
          : "local-only",
    acceptedForRuntimeAdapter: blocked.length === 0,
    acceptedForProviderSync: blocked.length === 0 && syncReady.length > 0,
    providerService: reviewPacket.providerService || integrationExport.providerHandoff?.providerService || "mailchimp-marketing-api",
    mounts: payloadMounts,
    syncDispatch: {
      queue: syncReady.map((mount) => ({
        mount: mount.mount,
        providerResource: mount.providerResource,
        syncDirection: mount.syncDirection,
        cursorPath: mount.cursor.cursorPath,
        resumeStateKey: mount.cursor.resumeStateKey,
        commandIds: mount.capabilityDependencies.matchedCommandIds
      })),
      blockedMounts: blocked.map((mount) => mount.mount),
      operatorActionMounts: operatorAction.map((mount) => mount.mount),
      writebackPolicy: integrationExport.providerHandoff?.writebackPolicy || "read-through-or-local-only"
    },
    persistedStateContract: {
      namespace: "memory.provider_sync_payload",
      snapshotKey: `memory.provider_sync_payload.${snapshotId}`,
      statusKey: "memory.provider_sync_payload.currentStatus",
      requiredStateKeys: Array.from(new Set([
        ...(reviewPacket.persistedStateContract?.requiredStateKeys || []),
        ...payloadMounts.map((mount) => mount.cursor.resumeStateKey)
      ].filter(Boolean))).sort(),
      adoptionEvent: "mailchimp.memory.provider_sync_payload.adopted",
      statusEvent: "mailchimp.memory.provider_sync_payload.status",
      missingStatePolicy: blocked.length
        ? "block-sync-dispatch-until-memory-payload-restored"
        : "rebuild-sync-payload-from-memory-contract"
    },
    nextActions: [...blocked, ...operatorAction].map((mount) => ({
      mount: mount.mount,
      nextAction: mount.nextAction,
      required: mount.payloadStatus === "blocked",
      syncDirection: mount.syncDirection
    })),
    counters: {
      mounts: payloadMounts.length,
      syncReadyMounts: syncReady.length,
      blockedMounts: blocked.length,
      operatorActionMounts: operatorAction.length,
      providerSyncMounts: payloadMounts.filter((mount) => mount.providerSync).length,
      requiredStateKeys: Array.from(new Set(payloadMounts.map((mount) => mount.cursor.resumeStateKey).filter(Boolean))).length
    },
    truthBoundary: {
      source: "memory-mount-compiler",
      externalProviderStateVerified: false,
      persistedStateTrustedAsCallerSupplied: true,
      deterministic: true
    }
  };
}

export function compileMemoryRecoveryPlan(jobId, memoryContract = {}) {
  const mounts = memoryContract.mounts || [];
  const recoverySteps = mounts.map(compileMountRecoveryStep);
  const providerReconciliation = recoverySteps.filter((step) => (
    step.failureStatus === "provider-sync-needs-reconciliation"
    || step.syncRecovery.suppressProviderWriteback
  ));
  const localSnapshots = recoverySteps.filter((step) => step.snapshotPolicy.beforeRuntimeRequired);
  const rollbackJournal = mounts.find((mount) => mount.name === "rollbackJournal");

  return {
    kind: "aios.memoryRecoveryPlan",
    provider: "mailchimp",
    jobId,
    statusAfterFailure: providerReconciliation.length
      ? "memory-reconciliation-required"
      : localSnapshots.length
        ? "local-memory-restore-available"
        : "memory-recovery-observe-only",
    journal: {
      required: recoverySteps.some((step) => step.rollbackPolicy.journalRequired),
      path: rollbackJournal?.path || MAILCHIMP_MEMORY_MOUNTS.rollbackJournal.path,
      appendOnly: true,
      events: [
        "runtime.handoff.started",
        "provider.operation.failed",
        "memory.rollback.started",
        "memory.rollback.completed"
      ]
    },
    checkpoints: localSnapshots.map((step) => ({
      mount: step.mount,
      checkpointPath: step.snapshotPolicy.checkpointPath,
      retentionHours: step.snapshotPolicy.retentionHours,
      includeProviderCursor: step.snapshotPolicy.includeProviderCursor
    })),
    providerReconciliation: providerReconciliation.map((step) => ({
      mount: step.mount,
      providerResource: step.providerResource,
      conflictPolicy: step.syncRecovery.conflictPolicy,
      nextAction: step.rollbackPolicy.nextAction
    })),
    mounts: recoverySteps,
    adapterRecoveryStatus: {
      onLocalWriteFailure: localSnapshots.length ? "restore-last-checkpoint" : "surface-memory-failure",
      onProviderSyncFailure: providerReconciliation.length ? "pause-provider-writeback" : "retry-read-sync",
      onRollbackJournalMissing: rollbackJournal ? "not-applicable" : "create-local-rollback-journal"
    },
    truthBoundary: {
      source: "compiled-memory-mounts",
      externalProviderStateMutable: false,
      deterministic: true
    }
  };
}

export function parseMemoryMountSource(source = {}) {
  if (typeof source === "string") {
    return source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, mode = "readwrite"] = line.split(/\s*:\s*/, 2);
        return { name, mode };
      });
  }

  if (Array.isArray(source)) {
    return source.map((entry) => (typeof entry === "string" ? { name: entry, mode: "readwrite" } : entry));
  }

  return toArray(source.mounts || source.memory).map((entry) => (
    typeof entry === "string" ? { name: entry, mode: "readwrite" } : entry
  ));
}

export function compileMailchimpMemoryMounts(source = {}, options = {}) {
  const requested = parseMemoryMountSource(source);
  const diagnostics = [];
  const mounts = [];
  const requestedNames = requested.length ? requested : [
    { name: "campaignDraft", mode: "readwrite" },
    { name: "audienceSnapshot", mode: "readonly" },
    { name: "verifierEvidence", mode: "append" },
    { name: "rollbackJournal", mode: "append" }
  ];

  for (const mountRequest of requestedNames) {
    const spec = MAILCHIMP_MEMORY_MOUNTS[mountRequest.name];
    if (!spec) {
      diagnostics.push({
        level: "error",
        code: "memory.mount.unsupported",
        message: `Unsupported Mailchimp memory mount: ${mountRequest.name}`,
        mount: mountRequest.name
      });
      continue;
    }

    const mode = mountRequest.mode || "readwrite";
    if (!["readonly", "readwrite", "append"].includes(mode)) {
      diagnostics.push({
        level: "error",
        code: "memory.mount.mode.unsupported",
        message: `Unsupported memory mount mode: ${mode}`,
        mount: mountRequest.name
      });
      continue;
    }

    mounts.push({
      id: `mailchimp.${mountRequest.name}`,
      provider: "mailchimp",
      name: mountRequest.name,
      path: spec.path,
      mode,
      sensitivity: spec.sensitivity,
      retentionHours: mountRequest.retentionHours || spec.retentionHours,
      localOnly: options.localOnly !== false,
      externalWritesAllowed: false,
      providerContract: compileProviderSyncContract(
        mountRequest.name,
        spec,
        mountRequest,
        mode,
        options,
        diagnostics
      )
    });
  }

  const providerContracts = mounts.map((mount) => mount.providerContract);
  const handoffStates = providerContracts.reduce((state, contract) => {
    state[contract.externalHandoff] = (state[contract.externalHandoff] || 0) + 1;
    return state;
  }, {});
  const previewAcceptance = compileMemoryPreviewAcceptance(mounts, diagnostics, options);
  const lifecycleControls = compileMemoryLifecycleControls({ mounts, diagnostics }, options);
  diagnostics.push(...lifecycleControls.diagnostics.filter((diagnostic) => !diagnostics.includes(diagnostic)));
  const recoveryPlan = compileMemoryRecoveryPlan(options.jobId || "unbound-job", { mounts });
  const health = compileMemoryHealthContract({ mounts, diagnostics }, options);
  const operationalResumePlan = compileMemoryOperationalResumePlan({ mounts, diagnostics, health }, options);
  const providerServiceContract = {
    providerService: "mailchimp-marketing-api",
    syncRequired: providerContracts.some((contract) => contract.syncDirection !== "local-only"),
    capabilityNegotiation: Array.from(new Set(providerContracts.flatMap((contract) => contract.negotiatedCapabilities))),
    handoffStates,
    externalWritesAllowed: false
  };
  const providerHandoffAdoption = compileMemoryProviderHandoffAdoption({
    mounts,
    providerServiceContract,
    previewAcceptance,
    recoveryPlan,
    health,
    operationalResumePlan,
    lifecycleControls,
    diagnostics
  }, options);
  const integrationExport = compileMemoryIntegrationExport({
    mounts,
    providerServiceContract,
    previewAcceptance,
    recoveryPlan,
    health,
    operationalResumePlan,
    lifecycleControls,
    providerHandoffAdoption,
    diagnostics
  }, options);
  const adapterSyncReadiness = compileMemoryAdapterSyncReadiness({
    mounts,
    providerServiceContract,
    previewAcceptance,
    recoveryPlan,
    health,
    operationalResumePlan,
    lifecycleControls,
    providerHandoffAdoption,
    integrationExport,
    diagnostics
  }, options);
  const providerSyncReviewPacket = compileMemoryProviderSyncReviewPacket({
    mounts,
    providerServiceContract,
    previewAcceptance,
    recoveryPlan,
    health,
    operationalResumePlan,
    lifecycleControls,
    providerHandoffAdoption,
    integrationExport,
    adapterSyncReadiness,
    diagnostics
  }, options);
  const providerSyncPayload = compileMemoryProviderSyncPayload({
    mounts,
    providerServiceContract,
    previewAcceptance,
    recoveryPlan,
    health,
    operationalResumePlan,
    lifecycleControls,
    providerHandoffAdoption,
    integrationExport,
    adapterSyncReadiness,
    providerSyncReviewPacket,
    diagnostics
  }, options);

  return {
    kind: "aios.memoryContract",
    provider: "mailchimp",
    mounts,
    providerServiceContract: {
      providerService: "mailchimp-marketing-api",
      syncRequired: providerContracts.some((contract) => contract.syncDirection !== "local-only"),
      capabilityNegotiation: Array.from(new Set(providerContracts.flatMap((contract) => contract.negotiatedCapabilities))),
      handoffStates,
      externalWritesAllowed: false
    },
    previewAcceptance,
    recoveryPlan,
    health,
    operationalResumePlan,
    lifecycleControls,
    providerHandoffAdoption,
    integrationExport,
    adapterSyncReadiness,
    providerSyncReviewPacket,
    providerSyncPayload,
    diagnostics,
    truthBoundary: {
      source: "declared-request",
      verifiedBy: "memory-mount-compiler",
      persistence: "local-runtime-memory",
      externalWritesAllowed: false
    }
  };
}

export function compileRollbackMemoryPlan(jobId, memoryContract) {
  const mounts = memoryContract?.mounts || [];
  const journal = mounts.find((mount) => mount.name === "rollbackJournal");
  const syncReconciliation = mounts
    .filter((mount) => mount.providerContract?.syncDirection !== "local-only")
    .map((mount) => ({
      mount: mount.name,
      providerResource: mount.providerContract.providerResource,
      conflictPolicy: mount.providerContract.syncMetadata.conflictPolicy,
      rollbackAction: mount.mode === "readonly" ? "discard-local-cache" : "restore-local-draft-and-flag-provider-review"
    }));

  return {
    jobId,
    journalPath: journal?.path || MAILCHIMP_MEMORY_MOUNTS.rollbackJournal.path,
    strategy: "append-only-checkpoint",
    checkpoints: [
      "before-mailchimp-read",
      "before-campaign-mutation",
      "after-verifier-approval"
    ],
    canRollbackExternalWrite: false,
    syncReconciliation,
    rollbackSemantics: "restore local draft state and mark external Mailchimp mutation for operator review"
  };
}
