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
  const recoveryPlan = compileMemoryRecoveryPlan(options.jobId || "unbound-job", { mounts });
  const health = compileMemoryHealthContract({ mounts, diagnostics }, options);

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
