const DEFAULT_RUNTIME = Object.freeze({
  adapter: "mailchimp.v1",
  verifier: "truth-boundary.v1",
  memory: "ephemeral",
});

const CAPABILITY_PREFIXES = Object.freeze([
  "mailchimp:",
  "memory:",
  "verifier:",
  "audit:",
  "rollback:",
  "status:",
]);

const MAILCHIMP_READ_SCOPES = Object.freeze({
  "mailchimp:campaign.read": "campaigns:read",
  "mailchimp:report.read": "reports:read",
});

const ROLE_PERMISSIONS = Object.freeze({
  viewer: ["mailchimp:read", "audit:read"],
  operator: ["mailchimp:read", "audit:read", "runtime:preview"],
  maintainer: ["mailchimp:read", "audit:read", "runtime:preview", "runtime:run", "runtime:schedule"],
});

export function normalizePackageName(name) {
  if (typeof name !== "string") {
    throw new TypeError("package name must be a string");
  }

  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  if (!normalized || normalized.startsWith(".") || normalized.endsWith(".")) {
    throw new Error("package name must contain a stable identifier");
  }

  return normalized;
}

export function normalizeVersion(version = "0.0.0") {
  if (typeof version !== "string") {
    throw new TypeError("package version must be a string");
  }

  const normalized = version.trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(normalized)) {
    throw new Error(`invalid semantic version: ${version}`);
  }

  return normalized;
}

export function normalizeCapability(capability) {
  if (typeof capability !== "string") {
    throw new TypeError("capability must be a string");
  }

  const normalized = capability.trim().toLowerCase();
  if (!CAPABILITY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(`unsupported capability namespace: ${capability}`);
  }

  const suffix = normalized.split(":").slice(1).join(":");
  if (!suffix || suffix.includes("..") || /\s/.test(suffix)) {
    throw new Error(`invalid capability suffix: ${capability}`);
  }

  return normalized;
}

export function createPackageManifest(input = {}) {
  const name = normalizePackageName(input.name ?? "mailchimp-campaign");
  const version = normalizeVersion(input.version ?? "0.1.0");
  const description = String(input.description ?? "Mailchimp campaign runtime package").trim();
  const capabilities = uniqueSorted([
    ...(input.capabilities ?? []),
    "mailchimp:campaign.read",
    "audit:truth-boundary.write",
    "audit:export.package",
    "verifier:evidence.record",
    "rollback:snapshot.create",
    "status:timeline.write",
  ].map(normalizeCapability));

  return deepFreeze({
    kind: "aios.package",
    apiVersion: "aios.language/v1",
    name,
    version,
    description,
    runtime: {
      adapter: String(input.runtime?.adapter ?? DEFAULT_RUNTIME.adapter),
      verifier: String(input.runtime?.verifier ?? DEFAULT_RUNTIME.verifier),
      memory: String(input.runtime?.memory ?? DEFAULT_RUNTIME.memory),
    },
    tenantBoundary: normalizeTenantBoundary(input.tenantBoundary ?? input.tenant ?? {}, name),
    exports: normalizeExports(input.exports),
    capabilities,
    verifierContracts: buildVerifierContracts(capabilities),
  });
}

export function buildKernelJobDescriptor(manifest, sourceAst, options = {}) {
  assertPackageManifest(manifest);
  if (!sourceAst || sourceAst.kind !== "aios.ast") {
    throw new Error("sourceAst must be produced by parsePackageSource");
  }

  const jobId = stableId([
    manifest.name,
    manifest.version,
    sourceAst.name,
    JSON.stringify(sourceAst.steps),
  ]);
  const requestedCapabilities = uniqueSorted([
    ...manifest.capabilities,
    ...sourceAst.capabilities,
    ...(options.capabilities ?? []),
  ].map(normalizeCapability));

  return deepFreeze({
    kind: "aios.kernel.job",
    apiVersion: "aios.kernel/v1",
    id: `job_${jobId}`,
    package: {
      name: manifest.name,
      version: manifest.version,
    },
    runtimeAdapter: manifest.runtime.adapter,
    memory: {
      mode: options.memoryMode ?? manifest.runtime.memory,
      namespace: buildTenantMemoryNamespace(manifest.tenantBoundary, manifest.name, sourceAst.name),
      writePolicy: "local-only",
    },
    tenancy: buildJobTenancyContract(manifest.tenantBoundary, options.workspaceId),
    capabilities: requestedCapabilities,
    verifier: {
      contract: manifest.runtime.verifier,
      requiredEvidence: buildRequiredEvidence(sourceAst),
      truthBoundary: {
        externalWrites: "forbidden",
        externalReads: requestedCapabilities.filter((capability) => capability.startsWith("mailchimp:")),
        tenantIsolation: manifest.tenantBoundary.isolationMode,
        workspaceId: manifest.tenantBoundary.workspaceId,
        reportedBy: "packages/aios-language/stdlib/audit.mjs",
      },
    },
    recovery: {
      rollback: sourceAst.recovery.rollback,
      statusTransitions: ["queued", "running", "verifying", "completed", "rolled_back", "failed"],
      retry: {
        attempts: sourceAst.recovery.retryAttempts,
        backoff: "deterministic-linear",
      },
    },
    plan: sourceAst.steps.map((step, index) => ({
      id: `step_${index + 1}_${step.op}`,
      op: step.op,
      input: step.input,
      output: step.output,
      verifierHints: step.verifierHints,
    })),
  });
}

export function parsePackageSource(source, options = {}) {
  if (typeof source !== "string") {
    throw new TypeError("source must be a string");
  }

  const lines = source.split(/\r?\n/);
  const ast = {
    kind: "aios.ast",
    name: normalizePackageName(options.name ?? "mailchimp-campaign-flow"),
    capabilities: [],
    recovery: {
      rollback: "snapshot",
      retryAttempts: 0,
    },
    steps: [],
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const [keyword, ...rest] = line.split(/\s+/);
    const body = rest.join(" ").trim();
    if (keyword === "use") {
      ast.capabilities.push(normalizeCapability(body));
    } else if (keyword === "recover") {
      ast.recovery = parseRecovery(body);
    } else if (keyword === "step") {
      ast.steps.push(parseStep(body, ast.steps.length));
    } else {
      throw new Error(`unknown package source directive: ${keyword}`);
    }
  }

  if (ast.steps.length === 0) {
    throw new Error("package source must contain at least one step");
  }

  return deepFreeze({
    ...ast,
    capabilities: uniqueSorted(ast.capabilities),
  });
}

export function compilePackageSource(source, manifestInput = {}, options = {}) {
  const manifest = createPackageManifest(manifestInput);
  const ast = parsePackageSource(source, { name: options.name ?? manifest.name });
  const job = buildKernelJobDescriptor(manifest, ast, options);

  return deepFreeze({
    manifest,
    ast,
    job,
    lifecycle: buildPackageLifecycleState(manifest, job, options.lifecycle ?? {}),
  });
}

export function buildProviderServiceContract(compiledProgram, options = {}) {
  if (!compiledProgram || typeof compiledProgram !== "object") {
    throw new Error("compiledProgram must be produced by compilePackageSource");
  }

  const { manifest, job, lifecycle } = compiledProgram;
  assertPackageManifest(manifest);
  if (!job || job.kind !== "aios.kernel.job") {
    throw new Error("compiledProgram.job must be produced by buildKernelJobDescriptor");
  }
  if (!lifecycle || lifecycle.kind !== "aios.package.lifecycle") {
    throw new Error("compiledProgram.lifecycle must be produced by buildPackageLifecycleState");
  }

  const provider = normalizeProviderService(options.provider ?? {});
  const requestedCapabilities = job.capabilities.filter((capability) => (
    capability.startsWith(`${provider.name}:`)
  ));
  const negotiated = negotiateProviderCapabilities(provider, requestedCapabilities, options);
  const sync = buildProviderSyncState(manifest, job, lifecycle, provider, negotiated, options);
  const handoffState = buildProviderHandoffState(lifecycle, negotiated, sync, options);

  return deepFreeze({
    kind: "aios.package.provider-service-contract",
    apiVersion: "aios.integration/v1",
    package: {
      name: manifest.name,
      version: manifest.version,
    },
    jobId: job.id,
    provider: {
      name: provider.name,
      adapter: provider.adapter,
      service: provider.service,
      mode: provider.mode,
    },
    tenantBoundary: {
      tenantId: job.tenancy.tenantId,
      workspaceId: job.tenancy.workspaceId,
      role: job.tenancy.role,
      auditChannel: job.tenancy.auditChannel,
      isolationMode: job.tenancy.isolationMode,
    },
    negotiation: negotiated,
    sync,
    handoffState,
    clientState: {
      badge: deriveProviderBadge(handoffState),
      visibleStatus: deriveVisibleProviderStatus(lifecycle, handoffState),
      primaryAction: handoffState.nextAction,
      disabledReason: handoffState.ready ? null : handoffState.reason,
    },
  });
}

export function buildProviderSyncManifest(compiledProgram, options = {}) {
  if (!compiledProgram || typeof compiledProgram !== "object") {
    throw new Error("compiledProgram must be produced by compilePackageSource");
  }

  const { manifest, job, lifecycle } = compiledProgram;
  assertPackageManifest(manifest);
  if (!job || job.kind !== "aios.kernel.job") {
    throw new Error("compiledProgram.job must be produced by buildKernelJobDescriptor");
  }
  if (!lifecycle || lifecycle.kind !== "aios.package.lifecycle") {
    throw new Error("compiledProgram.lifecycle must be produced by buildPackageLifecycleState");
  }

  const providerContract = options.providerContract
    ?? buildProviderServiceContract(compiledProgram, options.providerOptions ?? options);
  const observed = normalizeProviderSyncObservation(options.observation ?? options.syncObservation ?? {});
  const persistence = buildProviderSyncPersistence(job, providerContract, observed, options);
  const status = deriveProviderSyncManifestStatus(providerContract, observed, persistence);
  const blockedReasons = deriveProviderSyncManifestBlockers(providerContract, observed, persistence, status);
  const ready = status === "ready" && blockedReasons.length === 0;
  const command = buildProviderSyncManifestCommand(job, providerContract, persistence, ready, blockedReasons, options);
  const manifestId = `provider_sync_${stableId([
    manifest.name,
    manifest.version,
    job.id,
    providerContract.provider.name,
    providerContract.sync.checkpoint,
    persistence.stateKey,
    observed.status,
    command.id,
  ])}`;

  return deepFreeze({
    kind: "aios.package.provider-sync-manifest",
    apiVersion: "aios.integration/v1",
    manifestId,
    package: {
      name: manifest.name,
      version: manifest.version,
    },
    jobId: job.id,
    status,
    ready,
    nextAction: ready ? command.command : deriveProviderSyncManifestNextAction(blockedReasons, observed),
    disabledReason: ready ? null : blockedReasons[0] ?? null,
    provider: {
      name: providerContract.provider.name,
      adapter: providerContract.provider.adapter,
      service: providerContract.provider.service,
      mode: providerContract.provider.mode,
      checkpoint: providerContract.sync.checkpoint,
      cursor: providerContract.sync.cursor,
      scopes: providerContract.negotiation.providerScopes,
      deniedCapabilities: providerContract.negotiation.deniedCapabilities,
    },
    sync: {
      direction: providerContract.sync.direction,
      source: providerContract.sync.source,
      destination: providerContract.sync.destination,
      providerResource: providerContract.sync.providerResource,
      localNamespace: providerContract.sync.localNamespace,
      memoryWritePolicy: providerContract.sync.memoryWritePolicy,
      externalHandoff: providerContract.sync.externalHandoff,
      observedStatus: observed.status,
      observedCheckpoint: observed.checkpoint,
      checkpointMatched: observed.checkpointMatched,
    },
    persistence,
    command,
    validation: {
      valid: ready,
      blockedReasons,
      checked: {
        providerNegotiationSatisfied: providerContract.negotiation.satisfied,
        providerHandoffReady: providerContract.handoffState.ready,
        localOnlyMemory: providerContract.sync.memoryWritePolicy === "local-only",
        noExternalHandoff: providerContract.sync.externalHandoff === "none",
        checkpointMatched: observed.checkpointMatched,
        persistenceRestartSafe: persistence.restartSafe,
      },
    },
    clientState: {
      badge: ready
        ? "sync-ready"
        : status === "checkpoint-mismatch"
          ? "sync-refresh-required"
          : "sync-blocked",
      visibleStatus: ready ? "ready" : status,
      primaryAction: ready ? command.command : deriveProviderSyncManifestNextAction(blockedReasons, observed),
      disabledReason: ready ? null : blockedReasons[0] ?? null,
      restartSafe: ready && persistence.restartSafe,
    },
    truthBoundary: {
      externalWrites: false,
      localOnly: true,
      verifierRequiredBeforeAdapter: true,
      evidenceSubject: `provider-sync-manifest:${manifestId}`,
    },
  });
}

export function buildPackageReadinessPreview(compiledProgram, options = {}) {
  if (!compiledProgram || typeof compiledProgram !== "object") {
    throw new Error("compiledProgram must be produced by compilePackageSource");
  }
  const { manifest, job, lifecycle } = compiledProgram;
  assertPackageManifest(manifest);
  if (!job || job.kind !== "aios.kernel.job") {
    throw new Error("compiledProgram.job must be produced by buildKernelJobDescriptor");
  }
  if (!lifecycle || lifecycle.kind !== "aios.package.lifecycle") {
    throw new Error("compiledProgram.lifecycle must be produced by buildPackageLifecycleState");
  }

  const providerContract = options.providerContract
    ?? buildProviderServiceContract(compiledProgram, options.providerOptions ?? options);
  const acceptance = normalizePreviewAcceptance(options.acceptance ?? options);
  const validationSummary = buildReadinessValidationSummary(lifecycle, providerContract, acceptance);
  const readiness = buildPackageReadinessState(lifecycle, providerContract, validationSummary, acceptance);
  const previewId = stableId([
    manifest.name,
    manifest.version,
    job.id,
    providerContract.sync.checkpoint,
    readiness.status,
    acceptance.acceptedAt ?? "pending",
  ]);

  return deepFreeze({
    kind: "aios.package.readiness-preview",
    apiVersion: "aios.language/v1",
    previewId: `preview_${previewId}`,
    package: {
      name: manifest.name,
      version: manifest.version,
    },
    jobId: job.id,
    runtime: {
      adapter: job.runtimeAdapter,
      memoryNamespace: job.memory.namespace,
      memoryWritePolicy: job.memory.writePolicy,
      truthBoundaryReporter: job.verifier.truthBoundary.reportedBy,
      tenantIsolation: job.tenancy.isolationMode,
    },
    readiness,
    validationSummary,
    acceptance: {
      accepted: acceptance.accepted && validationSummary.valid,
      acceptedBy: acceptance.accepted && validationSummary.valid ? acceptance.acceptedBy : null,
      acceptedAt: acceptance.accepted && validationSummary.valid ? acceptance.acceptedAt : null,
      required: readiness.acceptanceRequired,
      blockedReasons: acceptance.accepted && validationSummary.valid
        ? []
        : validationSummary.blockedReasons,
    },
    controls: buildReadinessControls(lifecycle, readiness, validationSummary),
    provider: {
      name: providerContract.provider.name,
      mode: providerContract.provider.mode,
      badge: providerContract.clientState.badge,
      visibleStatus: providerContract.clientState.visibleStatus,
      primaryAction: providerContract.clientState.primaryAction,
    },
    tenantBoundary: {
      tenantId: providerContract.tenantBoundary.tenantId,
      workspaceId: providerContract.tenantBoundary.workspaceId,
      role: providerContract.tenantBoundary.role,
      auditChannel: providerContract.tenantBoundary.auditChannel,
      isolationMode: providerContract.tenantBoundary.isolationMode,
    },
    nextSteps: buildReadinessNextSteps(readiness, validationSummary, providerContract),
  });
}

export function buildPackageLifecycleState(manifest, jobDescriptor, settings = {}) {
  assertPackageManifest(manifest);
  if (!jobDescriptor || jobDescriptor.kind !== "aios.kernel.job") {
    throw new Error("jobDescriptor must be produced by buildKernelJobDescriptor");
  }

  const normalizedSettings = normalizeLifecycleSettings(settings);
  const controls = buildLifecycleControls(normalizedSettings);
  const validation = validateLifecycle(manifest, jobDescriptor, normalizedSettings);
  const commandQueue = buildLifecycleCommands(jobDescriptor, normalizedSettings, validation);

  return deepFreeze({
    kind: "aios.package.lifecycle",
    apiVersion: "aios.language/v1",
    package: {
      name: manifest.name,
      version: manifest.version,
    },
    jobId: jobDescriptor.id,
    tenantBoundary: jobDescriptor.tenancy,
    enabled: normalizedSettings.enabled,
    schedule: normalizedSettings.schedule,
    controls,
    validation,
    commandQueue,
    nextAction: deriveLifecycleNextAction(normalizedSettings, validation, commandQueue),
  });
}

export function buildPackageControlSurface(compiledProgram, options = {}) {
  if (!compiledProgram || typeof compiledProgram !== "object") {
    throw new Error("compiledProgram must be produced by compilePackageSource");
  }
  const { manifest, job, lifecycle } = compiledProgram;
  assertPackageManifest(manifest);
  if (!job || job.kind !== "aios.kernel.job") {
    throw new Error("compiledProgram.job must be produced by buildKernelJobDescriptor");
  }
  if (!lifecycle || lifecycle.kind !== "aios.package.lifecycle") {
    throw new Error("compiledProgram.lifecycle must be produced by buildPackageLifecycleState");
  }

  const providerContract = options.providerContract
    ?? buildProviderServiceContract(compiledProgram, options.providerOptions ?? options);
  const readinessPreview = options.readinessPreview
    ?? buildPackageReadinessPreview(compiledProgram, {
      ...options,
      providerContract,
      acceptance: options.acceptance ?? options,
    });
  const settings = lifecycle.validation.checkedSettings;
  const controlGroups = buildLifecycleControlGroups(lifecycle, providerContract, readinessPreview);
  const blockedReasons = uniqueSorted([
    ...lifecycle.validation.errors,
    ...readinessPreview.validationSummary.blockedReasons,
    ...providerContract.handoffState.blockedReasons,
  ]);

  return deepFreeze({
    kind: "aios.package.control-surface",
    apiVersion: "aios.language/v1",
    package: {
      name: manifest.name,
      version: manifest.version,
    },
    jobId: job.id,
    enabled: lifecycle.enabled,
    status: deriveControlSurfaceStatus(lifecycle, readinessPreview, providerContract),
    nextAction: deriveControlSurfaceNextAction(lifecycle, readinessPreview, providerContract),
    settings: {
      enabled: settings.enabled,
      dryRun: settings.dryRun,
      requireApproval: settings.requireApproval,
      approvalTicket: lifecycle.controls.approve.allowed ? null : "present-or-not-required",
      maxRuntimeSteps: settings.maxRuntimeSteps,
      schedule: {
        mode: settings.scheduleMode,
        intervalMinutes: lifecycle.schedule.intervalMinutes,
        startsAt: lifecycle.schedule.startsAt,
      },
      export: {
        mode: settings.exportMode,
        redaction: settings.exportRedaction,
        localOnly: true,
      },
      tenant: {
        tenantId: settings.tenantId,
        workspaceId: settings.workspaceId,
        boundarySatisfied: settings.tenantBoundarySatisfied,
      },
    },
    provider: {
      name: providerContract.provider.name,
      mode: providerContract.provider.mode,
      scopes: providerContract.negotiation.providerScopes,
      checkpoint: providerContract.sync.checkpoint,
      handoffReady: providerContract.handoffState.ready,
      nextAction: providerContract.handoffState.nextAction,
    },
    controls: controlGroups,
    validation: {
      valid: lifecycle.validation.valid && readinessPreview.validationSummary.valid,
      errors: uniqueSorted([
        ...lifecycle.validation.errors,
        ...readinessPreview.validationSummary.errors,
      ]),
      warnings: uniqueSorted([
        ...lifecycle.validation.warnings,
        ...readinessPreview.validationSummary.warnings,
      ]),
      blockedReasons,
    },
    clientState: {
      primaryCommand: selectPrimaryControlCommand(controlGroups),
      disabledReason: blockedReasons[0] ?? null,
      acceptanceRequired: readinessPreview.readiness.acceptanceRequired,
      accepted: readinessPreview.acceptance.accepted,
      scheduleBadge: deriveScheduleBadge(lifecycle),
      exportBadge: lifecycle.controls.exportPackage.allowed ? "available" : "disabled",
    },
  });
}

export function buildPackageSchedulerControlHandoff(compiledProgram, options = {}) {
  if (!compiledProgram || typeof compiledProgram !== "object") {
    throw new Error("compiledProgram must be produced by compilePackageSource");
  }
  const { manifest, job, lifecycle } = compiledProgram;
  assertPackageManifest(manifest);
  if (!job || job.kind !== "aios.kernel.job") {
    throw new Error("compiledProgram.job must be produced by buildKernelJobDescriptor");
  }
  if (!lifecycle || lifecycle.kind !== "aios.package.lifecycle") {
    throw new Error("compiledProgram.lifecycle must be produced by buildPackageLifecycleState");
  }

  const providerContract = options.providerContract
    ?? buildProviderServiceContract(compiledProgram, options.providerOptions ?? options);
  const readinessPreview = options.readinessPreview
    ?? buildPackageReadinessPreview(compiledProgram, {
      ...options,
      providerContract,
      acceptance: options.acceptance ?? options,
    });
  const controlSurface = options.controlSurface
    ?? buildPackageControlSurface(compiledProgram, {
      ...options,
      providerContract,
      readinessPreview,
      acceptance: options.acceptance ?? options,
    });
  const settings = lifecycle.validation.checkedSettings;
  const scheduleWindow = buildSchedulerControlWindow(lifecycle, options.schedulerWindow ?? options.scheduleWindow ?? {});
  const approval = normalizeSchedulerControlApproval(readinessPreview, options.acceptance ?? options);
  const blockedReasons = uniqueSorted([
    ...controlSurface.validation.blockedReasons,
    ...(controlSurface.status === "disabled" ? ["package control surface is disabled"] : []),
    ...(settings.scheduleMode === "disabled" ? ["package schedule is disabled"] : []),
    ...(approval.required && !approval.accepted ? ["operator preview acceptance is pending"] : []),
    ...(scheduleWindow.ready ? [] : scheduleWindow.blockedReasons),
  ]);
  const ready = blockedReasons.length === 0
    && controlSurface.validation.valid
    && lifecycle.enabled
    && settings.scheduleMode !== "disabled";
  const command = buildSchedulerControlCommand(
    job,
    lifecycle,
    controlSurface,
    readinessPreview,
    approval,
    scheduleWindow,
    ready,
    blockedReasons,
  );
  const handoffId = `pkg_sched_${stableId([
    manifest.name,
    manifest.version,
    job.id,
    controlSurface.status,
    controlSurface.nextAction,
    settings.scheduleMode,
    scheduleWindow.startsAt,
    approval.acceptedAt ?? "pending",
    blockedReasons.join("|"),
  ])}`;

  return deepFreeze({
    kind: "aios.package.scheduler-control-handoff",
    apiVersion: "aios.language/v1",
    handoffId,
    package: {
      name: manifest.name,
      version: manifest.version,
    },
    jobId: job.id,
    tenantBoundary: {
      tenantId: job.tenancy.tenantId,
      workspaceId: job.tenancy.workspaceId,
      isolationMode: job.tenancy.isolationMode,
      boundarySatisfied: job.tenancy.boundarySatisfied,
    },
    status: ready
      ? "ready"
      : !lifecycle.enabled
        ? "disabled"
        : settings.scheduleMode === "disabled"
          ? "paused"
          : approval.required && !approval.accepted
            ? "awaiting-approval"
            : "blocked",
    ready,
    maySchedule: ready && command.ready,
    nextAction: ready ? command.command : deriveSchedulerControlNextAction(controlSurface, approval, scheduleWindow),
    disabledReason: ready ? null : blockedReasons[0] ?? controlSurface.clientState.disabledReason,
    settings: {
      enabled: settings.enabled,
      dryRun: settings.dryRun,
      requireApproval: settings.requireApproval,
      maxRuntimeSteps: settings.maxRuntimeSteps,
      scheduleMode: settings.scheduleMode,
      exportMode: settings.exportMode,
      exportRedaction: settings.exportRedaction,
      localOnlyExport: true,
    },
    schedule: scheduleWindow,
    approval,
    command,
    controls: {
      enableAllowed: lifecycle.controls.enable.allowed,
      disableAllowed: lifecycle.controls.disable.allowed,
      runNowAllowed: lifecycle.controls.runNow.allowed,
      rescheduleAllowed: lifecycle.controls.reschedule.allowed,
      exportAllowed: lifecycle.controls.exportPackage.allowed,
      primaryCommand: controlSurface.clientState.primaryCommand,
    },
    validation: {
      valid: ready,
      blockedReasons,
      warnings: controlSurface.validation.warnings,
      checked: {
        lifecycleValid: lifecycle.validation.valid,
        controlSurfaceStatus: controlSurface.status,
        readinessStatus: readinessPreview.readiness.status,
        providerReady: providerContract.handoffState.ready,
        workspaceId: job.tenancy.workspaceId,
      },
    },
    truthBoundary: {
      externalWrites: false,
      localOnly: true,
      verifierRequiredBeforeAdapter: true,
      evidenceSubject: `package-scheduler-control:${handoffId}`,
    },
  });
}

export function buildPackageRuntimeAdoptionSnapshot(compiledProgram, options = {}) {
  if (!compiledProgram || typeof compiledProgram !== "object") {
    throw new Error("compiledProgram must be produced by compilePackageSource");
  }
  const { manifest, job, lifecycle } = compiledProgram;
  assertPackageManifest(manifest);
  if (!job || job.kind !== "aios.kernel.job") {
    throw new Error("compiledProgram.job must be produced by buildKernelJobDescriptor");
  }
  if (!lifecycle || lifecycle.kind !== "aios.package.lifecycle") {
    throw new Error("compiledProgram.lifecycle must be produced by buildPackageLifecycleState");
  }

  const providerContract = options.providerContract
    ?? buildProviderServiceContract(compiledProgram, options.providerOptions ?? options);
  const readinessPreview = options.readinessPreview
    ?? buildPackageReadinessPreview(compiledProgram, {
      ...options,
      providerContract,
      acceptance: options.acceptance ?? options,
    });
  const controlSurface = options.controlSurface
    ?? buildPackageControlSurface(compiledProgram, {
      ...options,
      providerContract,
      readinessPreview,
      acceptance: options.acceptance ?? options,
    });
  const runtimeState = normalizeRuntimeAdoptionState(options.runtimeState ?? options);
  const externalHandoff = normalizeRuntimeExternalHandoff(options.externalHandoff ?? options);
  const schedulerClientHandoff = normalizeSchedulerClientRuntimeContract(
    options.schedulerClientHandoff ??
      options.clientRuntimeHandoff ??
      options.schedulerJob ??
      options.mailchimpSchedulerJob ??
      {}
  );
  const blockedReasons = buildRuntimeAdoptionBlockedReasons(
    lifecycle,
    providerContract,
    readinessPreview,
    controlSurface,
    runtimeState,
    externalHandoff,
    schedulerClientHandoff,
  );
  const ready = blockedReasons.length === 0;
  const adoptionKey = `adopt_${stableId([
    manifest.name,
    manifest.version,
    job.id,
    providerContract.sync.checkpoint,
    readinessPreview.previewId,
    runtimeState.persisted.key,
    runtimeState.client.status,
    externalHandoff.status,
    schedulerClientHandoff.adoptionKey,
    schedulerClientHandoff.status,
    schedulerClientHandoff.restartLedger.status,
    schedulerClientHandoff.restartLedger.commandId,
  ])}`;
  const commands = buildRuntimeAdoptionCommands(
    job,
    lifecycle,
    providerContract,
    readinessPreview,
    controlSurface,
    runtimeState,
    externalHandoff,
    ready,
    blockedReasons,
    adoptionKey,
  );

  return deepFreeze({
    kind: "aios.package.runtime-adoption-snapshot",
    apiVersion: "aios.language/v1",
    adoptionKey,
    package: {
      name: manifest.name,
      version: manifest.version,
    },
    jobId: job.id,
    ready,
    status: ready
      ? "runtime-adoption-ready"
      : blockedReasons.some((reason) => reason.includes("client"))
        ? "client-runtime-state-required"
        : blockedReasons.some((reason) => reason.includes("persisted"))
          ? "persisted-state-required"
          : "runtime-adoption-blocked",
    nextAction: commands.find((command) => command.state === "ready")?.command
      ?? commands[0]?.command
      ?? "package.settings.fix",
    handoff: {
      providerCheckpoint: providerContract.sync.checkpoint,
      providerResource: providerContract.sync.providerResource,
      externalStatus: externalHandoff.status,
      externalReference: externalHandoff.reference,
      externalNextAction: externalHandoff.nextAction,
      runtimeCommand: providerContract.handoffState.runtimeCommand,
      localNamespace: providerContract.sync.localNamespace,
      schedulerClientRuntime: {
        adoptionKey: schedulerClientHandoff.adoptionKey,
        status: schedulerClientHandoff.status,
        ready: schedulerClientHandoff.ready,
        restartSafe: schedulerClientHandoff.restartSafe,
        primaryAction: schedulerClientHandoff.primaryAction,
        restartLedgerStatus: schedulerClientHandoff.restartLedger.status,
        restartLedgerReady: schedulerClientHandoff.restartLedger.ready,
        restartLedgerCommandId: schedulerClientHandoff.restartLedger.commandId,
        idempotentReplay: schedulerClientHandoff.restartLedger.idempotentReplay,
      },
    },
    runtimeState,
    clientState: {
      visibleStatus: ready
        ? "ready"
        : schedulerClientHandoff.status !== "unknown"
          ? schedulerClientHandoff.status
          : readinessPreview.provider.visibleStatus,
      badge: ready
        ? "adoption-ready"
        : schedulerClientHandoff.ready === false && schedulerClientHandoff.status !== "unknown"
          ? "scheduler-client-state-required"
          : providerContract.clientState.badge,
      primaryAction: commands.find((command) => command.state === "ready")?.command
        ?? schedulerClientHandoff.primaryAction
        ?? readinessPreview.provider.primaryAction,
      disabledReason: ready ? null : blockedReasons[0] ?? null,
      restartSafe: ready && runtimeState.persisted.restartSafe && schedulerClientHandoff.restartSafe !== false,
    },
    commands,
    validation: {
      valid: ready,
      blockedReasons,
      checked: {
        lifecycleValid: lifecycle.validation.valid,
        readinessReady: readinessPreview.readiness.ready,
        providerReady: providerContract.handoffState.ready,
        controlSurfaceStatus: controlSurface.status,
        persistedStateReady: runtimeState.persisted.ready,
        clientRuntimeReady: runtimeState.client.ready,
        externalHandoffReady: externalHandoff.ready,
        schedulerClientRuntimeReady: schedulerClientHandoff.ready,
        schedulerClientRuntimeRestartSafe: schedulerClientHandoff.restartSafe,
        schedulerRestartLedgerReady: schedulerClientHandoff.restartLedger.ready,
        schedulerRestartLedgerStatus: schedulerClientHandoff.restartLedger.status,
      },
    },
  });
}

export function buildPackageOperationalReport(compiledProgram, options = {}) {
  if (!compiledProgram || typeof compiledProgram !== "object") {
    throw new Error("compiledProgram must be produced by compilePackageSource");
  }
  const { manifest, job, lifecycle } = compiledProgram;
  assertPackageManifest(manifest);
  if (!job || job.kind !== "aios.kernel.job") {
    throw new Error("compiledProgram.job must be produced by buildKernelJobDescriptor");
  }
  if (!lifecycle || lifecycle.kind !== "aios.package.lifecycle") {
    throw new Error("compiledProgram.lifecycle must be produced by buildPackageLifecycleState");
  }

  const providerContract = options.providerContract
    ?? buildProviderServiceContract(compiledProgram, options.providerOptions ?? options);
  const readinessPreview = options.readinessPreview
    ?? buildPackageReadinessPreview(compiledProgram, {
      ...options,
      providerContract,
      acceptance: options.acceptance ?? options,
    });
  const controlSurface = options.controlSurface
    ?? buildPackageControlSurface(compiledProgram, {
      ...options,
      providerContract,
      readinessPreview,
      acceptance: options.acceptance ?? options,
    });
  const adoptionSnapshot = options.adoptionSnapshot
    ?? buildPackageRuntimeAdoptionSnapshot(compiledProgram, {
      ...options,
      providerContract,
      readinessPreview,
      controlSurface,
      acceptance: options.acceptance ?? options,
    });
  const schedulerAnalytics = normalizePackageSchedulerAnalyticsExport(
    options.schedulerAnalyticsExportControl ??
      options.schedulerAnalytics?.exportControl ??
      options.schedulerAnalytics ??
      options.schedulerJob?.analyticsExportControl ??
      {}
  );
  const history = normalizePackageReportHistory(options.history);
  const blockedReasons = uniqueSorted([
    ...lifecycle.validation.errors,
    ...readinessPreview.validationSummary.blockedReasons,
    ...controlSurface.validation.blockedReasons,
    ...providerContract.handoffState.blockedReasons,
    ...adoptionSnapshot.validation.blockedReasons,
    ...schedulerAnalytics.blockedReasons,
  ]);
  const reportReady = blockedReasons.length === 0
    && readinessPreview.readiness.ready
    && controlSurface.validation.valid
    && adoptionSnapshot.ready;
  const currentSnapshot = {
    at: String(options.generatedAt ?? "logical:package-report"),
    packageName: manifest.name,
    version: manifest.version,
    jobId: job.id,
    status: reportReady ? "ready" : adoptionSnapshot.status,
    ready: reportReady,
    lifecycleEnabled: lifecycle.enabled,
    providerReady: providerContract.handoffState.ready,
    previewReady: readinessPreview.readiness.ready,
    controlStatus: controlSurface.status,
    adoptionReady: adoptionSnapshot.ready,
    blockedCount: blockedReasons.length,
    blockedReasons,
    commandCount: lifecycle.commandQueue.length,
    readyCommands: lifecycle.commandQueue.filter((command) => command.ready).length,
    capabilityCount: job.capabilities.length,
    deniedCapabilities: providerContract.negotiation.deniedCapabilities.length,
    schedulerRestartLedgerStatus: adoptionSnapshot.handoff.schedulerClientRuntime.restartLedgerStatus,
    schedulerRestartLedgerReady: adoptionSnapshot.handoff.schedulerClientRuntime.restartLedgerReady,
    schedulerRestartReplay: adoptionSnapshot.handoff.schedulerClientRuntime.idempotentReplay,
    schedulerAnalyticsStatus: schedulerAnalytics.status,
    schedulerAnalyticsReady: schedulerAnalytics.ready,
    schedulerAnalyticsCommandId: schedulerAnalytics.commandId,
  };
  const snapshots = [...history, currentSnapshot].slice(-12);
  const previous = snapshots[snapshots.length - 2] ?? null;
  const trend = !previous
    ? "new"
    : previous.ready === currentSnapshot.ready
      ? "unchanged"
      : currentSnapshot.ready
        ? "recovered"
        : "regressed";
  const timeline = buildPackageOperationalTimeline(
    lifecycle,
    providerContract,
    readinessPreview,
    controlSurface,
    adoptionSnapshot,
    currentSnapshot,
  );
  const actionCards = buildPackageOperationalActionCards(
    providerContract,
    readinessPreview,
    controlSurface,
    adoptionSnapshot,
    blockedReasons,
  );
  const exportId = `package-report_${stableId([
    manifest.name,
    manifest.version,
    job.id,
    currentSnapshot.status,
    blockedReasons.join("|"),
    snapshots.length,
  ])}`;

  return deepFreeze({
    kind: "aios.package.operational-report",
    apiVersion: "aios.language/v1",
    exportId,
    package: {
      name: manifest.name,
      version: manifest.version,
    },
    jobId: job.id,
    ready: reportReady,
    status: currentSnapshot.status,
    nextAction: reportReady
      ? adoptionSnapshot.nextAction
      : actionCards.find((card) => card.status === "blocked")?.command
        ?? controlSurface.nextAction,
    counters: {
      snapshots: snapshots.length,
      readySnapshots: snapshots.filter((snapshot) => snapshot.ready).length,
      blockedSnapshots: snapshots.filter((snapshot) => !snapshot.ready).length,
      commandCount: currentSnapshot.commandCount,
      readyCommands: currentSnapshot.readyCommands,
      capabilityCount: currentSnapshot.capabilityCount,
      deniedCapabilities: currentSnapshot.deniedCapabilities,
      blockedReasons: currentSnapshot.blockedCount,
      schedulerRestartLedgerReady: snapshots.filter((snapshot) => snapshot.schedulerRestartLedgerReady).length,
      schedulerRestartReplay: snapshots.filter((snapshot) => snapshot.schedulerRestartReplay).length,
      schedulerAnalyticsReady: snapshots.filter((snapshot) => snapshot.schedulerAnalyticsReady).length,
      statusCounts: countPackageReportBy(snapshots, "status"),
      controlStatusCounts: countPackageReportBy(snapshots, "controlStatus"),
      schedulerRestartLedgerStatusCounts: countPackageReportBy(snapshots, "schedulerRestartLedgerStatus"),
      schedulerAnalyticsStatusCounts: countPackageReportBy(snapshots, "schedulerAnalyticsStatus"),
    },
    history: snapshots,
    timelineReport: {
      trend,
      latestStatus: currentSnapshot.status,
      currentAction: controlSurface.nextAction,
      exportReady: reportReady,
      latestBlockedReasons: uniqueSorted(snapshots.flatMap((snapshot) => snapshot.blockedReasons)),
      timeline,
    },
    actionCards,
    schedulerAnalytics: {
      status: schedulerAnalytics.status,
      ready: schedulerAnalytics.ready,
      commandId: schedulerAnalytics.commandId,
      nextAction: schedulerAnalytics.nextAction,
      counters: schedulerAnalytics.counters,
      warnings: schedulerAnalytics.warnings,
      blockedReasons: schedulerAnalytics.blockedReasons,
      clientState: {
        badge: schedulerAnalytics.ready
          ? "analytics-export-ready"
          : schedulerAnalytics.provided
            ? "analytics-export-blocked"
            : "analytics-export-not-provided",
        primaryAction: schedulerAnalytics.nextAction,
        disabledReason: schedulerAnalytics.ready ? null : schedulerAnalytics.blockedReasons[0] ?? null,
      },
    },
    exportSummary: {
      exportId,
      format: String(options.exportFormat ?? "json.operational-summary"),
      ready: reportReady,
      headline: reportReady
        ? "package runtime handoff is ready"
        : `package runtime handoff requires review: ${blockedReasons[0] ?? "unknown blocker"}`,
      adoptionKey: adoptionSnapshot.adoptionKey,
      providerCheckpoint: providerContract.sync.checkpoint,
      memoryNamespace: job.memory.namespace,
      schedulerRestartLedgerStatus: currentSnapshot.schedulerRestartLedgerStatus,
      schedulerRestartReplay: currentSnapshot.schedulerRestartReplay,
      schedulerAnalyticsStatus: schedulerAnalytics.status,
      schedulerAnalyticsCommandId: schedulerAnalytics.commandId,
      disabledReason: reportReady ? null : blockedReasons[0] ?? controlSurface.clientState.disabledReason,
    },
  });
}

function parseRecovery(body) {
  const tokens = new Map(body.split(/\s+/).filter(Boolean).map((token) => {
    const [key, value = "true"] = token.split("=");
    return [key, value];
  }));

  const retryAttempts = Number(tokens.get("retry") ?? 0);
  if (!Number.isInteger(retryAttempts) || retryAttempts < 0 || retryAttempts > 5) {
    throw new Error("recover retry must be an integer from 0 to 5");
  }

  const rollback = tokens.get("rollback") ?? "snapshot";
  if (!["snapshot", "status-only", "none"].includes(rollback)) {
    throw new Error(`unsupported rollback policy: ${rollback}`);
  }

  return {
    rollback,
    retryAttempts,
  };
}

function normalizeRuntimeAdoptionState(input = {}) {
  const persisted = input.persistedState && typeof input.persistedState === "object"
    ? input.persistedState
    : input.persistedRuntimeState && typeof input.persistedRuntimeState === "object"
      ? input.persistedRuntimeState
      : {};
  const client = input.clientState && typeof input.clientState === "object"
    ? input.clientState
    : input.clientRuntimeState && typeof input.clientRuntimeState === "object"
      ? input.clientRuntimeState
      : {};
  const restart = persisted.restart && typeof persisted.restart === "object" ? persisted.restart : {};
  const runtime = client.runtime && typeof client.runtime === "object" ? client.runtime : {};
  const persistedReady = Boolean(persisted.ready ?? restart.enabled ?? false);
  const clientReady = Boolean(client.ready ?? runtime.enabled ?? false);

  return {
    persisted: {
      key: String(persisted.stateKey ?? persisted.journalKey ?? persisted.persistedStateKey ?? "pending"),
      status: String(persisted.status ?? "pending"),
      ready: persistedReady,
      restartSafe: Boolean(
        persistedReady
          && (restart.token || runtime.persistedRestartToken || persisted.restartSafe === true),
      ),
      restartCommand: restart.command ? String(restart.command) : null,
      restartToken: restart.token ? String(restart.token) : null,
      idempotencyKey: restart.idempotencyKey ? String(restart.idempotencyKey) : null,
    },
    client: {
      status: String(client.statusBadge ?? client.status ?? "pending"),
      ready: clientReady,
      command: runtime.command ? String(runtime.command) : null,
      idempotencyKey: runtime.idempotencyKey ? String(runtime.idempotencyKey) : null,
      disabledReason: client.disabledReason ? String(client.disabledReason) : null,
      blockedReasons: uniqueSorted(client.summary?.blockedReasons ?? client.blockedReasons ?? []),
    },
  };
}

function normalizeRuntimeExternalHandoff(input = {}) {
  const status = String(input.status ?? input.externalStatus ?? "local-only").trim().toLowerCase();
  const blockedReasons = uniqueSorted(input.blockedReasons ?? input.externalBlockedReasons ?? []);
  const ready = Boolean(input.ready ?? blockedReasons.length === 0);

  return {
    status,
    ready,
    reference: input.reference || input.externalReference
      ? String(input.reference ?? input.externalReference)
      : null,
    nextAction: String(input.nextAction ?? input.externalNextAction ?? (ready ? "runtime.adopt" : "runtime.handoff.review")),
    blockedReasons,
  };
}

function buildRuntimeAdoptionBlockedReasons(
  lifecycle,
  providerContract,
  readinessPreview,
  controlSurface,
  runtimeState,
  externalHandoff,
  schedulerClientHandoff,
) {
  return uniqueSorted([
    ...(lifecycle.validation.valid ? [] : lifecycle.validation.errors),
    ...(readinessPreview.readiness.ready ? [] : readinessPreview.validationSummary.blockedReasons),
    ...(providerContract.handoffState.ready ? [] : providerContract.handoffState.blockedReasons),
    ...(controlSurface.validation.valid ? [] : controlSurface.validation.blockedReasons),
    ...(runtimeState.persisted.ready ? [] : ["persisted runtime state is not ready"]),
    ...(runtimeState.persisted.restartSafe ? [] : ["persisted runtime state is not restart-safe"]),
    ...(runtimeState.client.ready ? [] : ["client runtime state is not ready"]),
    ...runtimeState.client.blockedReasons,
    ...(externalHandoff.ready ? [] : externalHandoff.blockedReasons),
    ...deriveSchedulerClientRuntimeBlockedReasons(schedulerClientHandoff),
  ]);
}

function buildRuntimeAdoptionCommands(
  jobDescriptor,
  lifecycle,
  providerContract,
  readinessPreview,
  controlSurface,
  runtimeState,
  externalHandoff,
  ready,
  blockedReasons,
  adoptionKey,
) {
  if (!ready) {
    return blockedReasons.map((reason, index) => ({
      command: reason.includes("persisted")
        ? "runtime.persisted-state.rebuild"
        : reason.includes("client")
          ? "runtime.client-state.bind"
          : controlSurface.nextAction,
      label: "Resolve runtime adoption blocker",
      reason,
      state: "blocked",
      idempotencyKey: `${jobDescriptor.id}:runtime-adoption:blocker:${index + 1}:${stableId([adoptionKey, reason])}`,
    }));
  }

  const runtimeCommand = runtimeState.client.command
    ?? runtimeState.persisted.restartCommand
    ?? providerContract.handoffState.runtimeCommand
    ?? readinessPreview.readiness.nextAction;

  return [
    {
      command: "runtime.adoption.record",
      label: "Record runtime adoption",
      reason: "persisted state, client state, and provider handoff are aligned",
      state: "ready",
      idempotencyKey: `${jobDescriptor.id}:runtime-adoption:record:${adoptionKey}`,
      writes: [runtimeState.persisted.key],
    },
    {
      command: runtimeCommand,
      label: "Continue runtime handoff",
      reason: lifecycle.schedule.mode === "interval"
        ? "scheduled package handoff can continue from restart-safe state"
        : "manual package handoff can continue from restart-safe state",
      state: "ready",
      idempotencyKey: runtimeState.client.idempotencyKey
        ?? runtimeState.persisted.idempotencyKey
        ?? `${jobDescriptor.id}:runtime-adoption:run:${adoptionKey}`,
      externalHandoff: {
        status: externalHandoff.status,
        reference: externalHandoff.reference,
        nextAction: externalHandoff.nextAction,
      },
    },
  ];
}

function normalizeSchedulerClientRuntimeContract(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      status: "unknown",
      ready: true,
      restartSafe: true,
      adoptionKey: "none",
      primaryAction: null,
      disabledReason: null,
      missingBindings: [],
      blockers: [],
      restartLedger: normalizeSchedulerRestartLedger()
    };
  }

  const handoff = input.clientRuntimeHandoff && typeof input.clientRuntimeHandoff === "object"
    ? input.clientRuntimeHandoff
    : input;
  const restartLedger = normalizeSchedulerRestartLedger(input.restartLedger ?? handoff.restartLedger);
  const clientState = handoff.clientState && typeof handoff.clientState === "object" ? handoff.clientState : {};
  const visible = handoff.visible && typeof handoff.visible === "object" ? handoff.visible : {};
  const blockers = Array.isArray(handoff.blockers) ? handoff.blockers : [];
  const missingBindings = uniqueSorted(clientState.missingBindings ?? handoff.missingBindings ?? []);
  const status = String(handoff.status ?? visible.status ?? "unknown").trim().toLowerCase();
  const hasContract = Boolean(handoff.handoffVersion || handoff.adoptionKey || status !== "unknown");

  if (!hasContract) {
    return {
      status: "unknown",
      ready: true,
      restartSafe: true,
      adoptionKey: "none",
      primaryAction: null,
      disabledReason: null,
      missingBindings: [],
      blockers: [],
      restartLedger
    };
  }

  return {
    status,
    ready: handoff.ready === true && status === "ready",
    restartSafe: handoff.restartSafe === true && (restartLedger.restartSafe !== false || restartLedger.idempotentReplay),
    adoptionKey: String(handoff.adoptionKey ?? "pending"),
    primaryAction: visible.primaryAction ? String(visible.primaryAction) : null,
    disabledReason: visible.disabledReason ? String(visible.disabledReason) : null,
    missingBindings,
    blockers: blockers.map((blocker) => ({
      code: String(blocker.code ?? "scheduler_client_runtime_blocked"),
      action: String(blocker.action ?? "runtime.client-state.bind")
    })),
    restartLedger,
  };
}

function normalizeSchedulerRestartLedger(ledger = {}) {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    return {
      status: "unknown",
      ready: true,
      restartSafe: true,
      idempotentReplay: false,
      commandId: null,
      commandStatus: "unknown",
      blockers: []
    };
  }

  const command = ledger.command && typeof ledger.command === "object" ? ledger.command : {};
  const blockers = uniqueSorted([
    ...(Array.isArray(ledger.blockers) ? ledger.blockers : []),
    ...(Array.isArray(ledger.recovery) ? ledger.recovery.map((entry) => entry.action ?? entry.code) : [])
  ].filter(Boolean));
  const status = String(ledger.status ?? command.status ?? "unknown").trim().toLowerCase();
  const known = status !== "unknown" || Boolean(ledger.ledgerVersion || command.id);

  if (!known) {
    return {
      status: "unknown",
      ready: true,
      restartSafe: true,
      idempotentReplay: false,
      commandId: null,
      commandStatus: "unknown",
      blockers: []
    };
  }

  return {
    status,
    ready: ["ready_to_resume", "already_completed"].includes(status) && blockers.length === 0,
    restartSafe: ledger.restartSafe === true,
    idempotentReplay: ledger.idempotentReplay === true,
    commandId: command.id ? String(command.id) : null,
    commandStatus: String(command.status ?? status),
    blockers,
  };
}

function deriveSchedulerClientRuntimeBlockedReasons(contract) {
  if (!contract || contract.status === "unknown") {
    return [];
  }
  return uniqueSorted([
    ...(contract.ready ? [] : ["scheduler client runtime handoff is not ready"]),
    ...(contract.restartSafe ? [] : ["scheduler client runtime handoff is not restart-safe"]),
    ...(contract.restartLedger.ready ? [] : ["scheduler restart ledger is not ready"]),
    ...(contract.restartLedger.restartSafe || contract.restartLedger.idempotentReplay
      ? []
      : ["scheduler restart ledger is not restart-safe"]),
    ...contract.missingBindings.map((field) => `scheduler client runtime missing ${field}`),
    ...contract.blockers.map((blocker) => blocker.action || blocker.code),
    ...contract.restartLedger.blockers.map((reason) => `scheduler restart ledger ${reason}`),
  ]);
}

function normalizePackageReportHistory(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.map((snapshot, index) => ({
    at: String(snapshot.at ?? `history:${index}`),
    packageName: String(snapshot.packageName ?? snapshot.name ?? "unknown"),
    version: String(snapshot.version ?? "0.0.0"),
    jobId: String(snapshot.jobId ?? "unknown"),
    status: String(snapshot.status ?? "unknown"),
    ready: Boolean(snapshot.ready),
    lifecycleEnabled: Boolean(snapshot.lifecycleEnabled),
    providerReady: Boolean(snapshot.providerReady),
    previewReady: Boolean(snapshot.previewReady),
    controlStatus: String(snapshot.controlStatus ?? "unknown"),
    adoptionReady: Boolean(snapshot.adoptionReady),
    blockedCount: Number(snapshot.blockedCount ?? 0),
    blockedReasons: uniqueSorted(snapshot.blockedReasons ?? []),
    commandCount: Number(snapshot.commandCount ?? 0),
    readyCommands: Number(snapshot.readyCommands ?? 0),
    capabilityCount: Number(snapshot.capabilityCount ?? 0),
    deniedCapabilities: Number(snapshot.deniedCapabilities ?? 0),
    schedulerRestartLedgerStatus: String(snapshot.schedulerRestartLedgerStatus ?? "unknown"),
    schedulerRestartLedgerReady: Boolean(snapshot.schedulerRestartLedgerReady),
    schedulerRestartReplay: Boolean(snapshot.schedulerRestartReplay),
    schedulerAnalyticsStatus: String(snapshot.schedulerAnalyticsStatus ?? "not_provided"),
    schedulerAnalyticsReady: Boolean(snapshot.schedulerAnalyticsReady),
    schedulerAnalyticsCommandId: snapshot.schedulerAnalyticsCommandId
      ? String(snapshot.schedulerAnalyticsCommandId)
      : null,
  }));
}

function normalizePackageSchedulerAnalyticsExport(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      provided: false,
      status: "not_provided",
      ready: true,
      commandId: null,
      nextAction: "scheduler.analytics.export.attach",
      counters: {
        snapshots: 0,
        blockers: 0,
        warnings: 0,
      },
      blockedReasons: [],
      warnings: [],
    };
  }

  const readiness = input.readiness && typeof input.readiness === "object" ? input.readiness : {};
  const command = input.command && typeof input.command === "object" ? input.command : {};
  const counters = input.counters && typeof input.counters === "object" ? input.counters : {};
  const policy = input.policy && typeof input.policy === "object" ? input.policy : {};
  const provided = Boolean(input.controlVersion || input.status || command.id);
  if (!provided) {
    return {
      provided: false,
      status: "not_provided",
      ready: true,
      commandId: null,
      nextAction: "scheduler.analytics.export.attach",
      counters: {
        snapshots: 0,
        blockers: 0,
        warnings: 0,
      },
      blockedReasons: [],
      warnings: [],
    };
  }

  const status = String(input.status ?? readiness.status ?? "blocked").trim().toLowerCase();
  const blockedReasons = uniqueSorted([
    ...(Array.isArray(readiness.blockedReasons) ? readiness.blockedReasons : []),
    ...(status === "blocked" && command.reason ? [command.reason] : []),
    ...(policy.localOnly === false ? ["scheduler analytics export is not local-only"] : []),
    ...(policy.requireVerifier === false ? ["scheduler analytics export does not require verifier"] : []),
    ...(command.externalWrites === true ? ["scheduler analytics export command would write externally"] : []),
  ]);
  const ready = Boolean(input.ready ?? readiness.ready) && blockedReasons.length === 0;

  return {
    provided: true,
    status,
    ready,
    commandId: command.id ? String(command.id) : null,
    nextAction: ready
      ? "verifier.verify-scheduler-analytics-export"
      : String(readiness.nextAction ?? command.command ?? "scheduler.analytics.repair"),
    counters: {
      snapshots: Number(counters.snapshots ?? 0),
      blockedSnapshots: Number(counters.blockedSnapshots ?? 0),
      degradedSnapshots: Number(counters.degradedSnapshots ?? 0),
      exportedSnapshots: Number(counters.exportedSnapshots ?? 0),
      pendingArtifactCommands: Number(counters.pendingArtifactCommands ?? 0),
      deniedCapabilities: Number(counters.deniedCapabilities ?? 0),
      packageControlBlockers: Number(counters.packageControlBlockers ?? 0),
      blockers: Number(counters.blockers ?? blockedReasons.length),
      warnings: Number(counters.warnings ?? 0),
    },
    blockedReasons,
    warnings: uniqueSorted(readiness.warnings ?? []),
  };
}

function buildPackageOperationalTimeline(
  lifecycle,
  providerContract,
  readinessPreview,
  controlSurface,
  adoptionSnapshot,
  currentSnapshot,
) {
  return [
    {
      index: 0,
      phase: "lifecycle",
      status: lifecycle.validation.valid && lifecycle.enabled ? "ready" : "blocked",
      action: lifecycle.nextAction,
      blockedReasons: lifecycle.validation.errors,
      restartSafe: lifecycle.validation.valid,
    },
    {
      index: 1,
      phase: "provider",
      status: providerContract.handoffState.ready ? "ready" : "blocked",
      action: providerContract.handoffState.nextAction,
      blockedReasons: providerContract.handoffState.blockedReasons,
      restartSafe: providerContract.sync.externalHandoff === "none",
    },
    {
      index: 2,
      phase: "preview",
      status: readinessPreview.readiness.status,
      action: readinessPreview.readiness.nextAction,
      blockedReasons: readinessPreview.validationSummary.blockedReasons,
      restartSafe: readinessPreview.runtime.memoryWritePolicy === "local-only",
    },
    {
      index: 3,
      phase: "controls",
      status: controlSurface.status,
      action: controlSurface.nextAction,
      blockedReasons: controlSurface.validation.blockedReasons,
      restartSafe: controlSurface.settings.export.localOnly,
    },
    {
      index: 4,
      phase: "runtime-adoption",
      status: adoptionSnapshot.status,
      action: adoptionSnapshot.nextAction,
      blockedReasons: adoptionSnapshot.validation.blockedReasons,
      restartSafe: adoptionSnapshot.clientState.restartSafe,
    },
    {
      index: 5,
      phase: "export",
      status: currentSnapshot.ready ? "ready" : "blocked",
      action: currentSnapshot.ready ? "audit.export.package" : controlSurface.nextAction,
      blockedReasons: currentSnapshot.blockedReasons,
      restartSafe: currentSnapshot.ready,
    },
  ];
}

function buildPackageOperationalActionCards(
  providerContract,
  readinessPreview,
  controlSurface,
  adoptionSnapshot,
  blockedReasons,
) {
  if (blockedReasons.length === 0) {
    return [{
      key: "handoff",
      label: "Runtime handoff",
      status: "ready",
      command: adoptionSnapshot.nextAction,
      reason: "provider, preview, controls, and runtime adoption are aligned",
    }];
  }

  return blockedReasons.slice(0, 8).map((reason, index) => ({
    key: `blocker:${index + 1}`,
    label: reason.includes("approval")
      ? "Approval"
      : reason.includes("provider") || reason.includes("capability")
        ? "Provider"
        : reason.includes("runtime") || reason.includes("client") || reason.includes("persisted")
          ? "Runtime adoption"
          : "Package settings",
    status: "blocked",
    command: reason.includes("approval")
      ? "package.approval.request"
      : reason.includes("provider") || reason.includes("capability")
        ? providerContract.handoffState.nextAction
        : reason.includes("runtime") || reason.includes("client") || reason.includes("persisted")
          ? adoptionSnapshot.nextAction
          : readinessPreview.readiness.nextAction ?? controlSurface.nextAction,
    reason,
  }));
}

function countPackageReportBy(values, key) {
  return values.reduce((counts, value) => {
    const name = String(value[key] ?? "unknown");
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
}

function normalizeTenantBoundary(boundary, packageName) {
  if (!boundary || typeof boundary !== "object" || Array.isArray(boundary)) {
    throw new Error("tenant boundary must be an object");
  }

  const tenantId = normalizeBoundaryToken(boundary.tenantId ?? "tenant-default", "tenantId");
  const workspaceId = normalizeBoundaryToken(boundary.workspaceId ?? "workspace-default", "workspaceId");
  const role = String(boundary.role ?? "operator").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role)) {
    throw new Error(`unsupported tenant role: ${role}`);
  }

  const explicitPermissions = Array.isArray(boundary.permissions)
    ? boundary.permissions.map((permission) => normalizePermission(permission))
    : ROLE_PERMISSIONS[role];
  const permissions = uniqueSorted([
    "audit:read",
    ...explicitPermissions,
  ]);
  const allowedWorkspaces = uniqueSorted([
    workspaceId,
    ...(boundary.allowedWorkspaces ?? []),
  ].map((workspace) => normalizeBoundaryToken(workspace, "allowedWorkspaces")));
  const isolationMode = String(boundary.isolationMode ?? "tenant-workspace").trim().toLowerCase();
  if (!["tenant", "tenant-workspace"].includes(isolationMode)) {
    throw new Error(`unsupported tenant isolation mode: ${isolationMode}`);
  }

  return {
    tenantId,
    workspaceId,
    role,
    permissions,
    allowedWorkspaces,
    isolationMode,
    auditChannel: String(boundary.auditChannel ?? `${tenantId}:${workspaceId}:${packageName}`).trim(),
  };
}

function buildTenantMemoryNamespace(boundary, packageName, sourceName) {
  const parts = boundary.isolationMode === "tenant"
    ? ["tenant", boundary.tenantId, packageName, sourceName]
    : ["tenant", boundary.tenantId, "workspace", boundary.workspaceId, packageName, sourceName];
  return parts.map((part) => normalizeBoundaryToken(part, "memory namespace")).join("/");
}

function buildJobTenancyContract(boundary, requestedWorkspaceId) {
  const workspaceId = requestedWorkspaceId
    ? normalizeBoundaryToken(requestedWorkspaceId, "workspaceId")
    : boundary.workspaceId;
  const violations = [];
  if (!boundary.allowedWorkspaces.includes(workspaceId)) {
    violations.push(`workspace ${workspaceId} is outside tenant boundary`);
  }

  return {
    tenantId: boundary.tenantId,
    workspaceId,
    homeWorkspaceId: boundary.workspaceId,
    allowedWorkspaces: boundary.allowedWorkspaces,
    role: boundary.role,
    permissions: boundary.permissions,
    isolationMode: boundary.isolationMode,
    auditChannel: boundary.auditChannel,
    boundarySatisfied: violations.length === 0,
    violations,
  };
}

function normalizeBoundaryToken(value, label) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{1,79}$/.test(normalized)) {
    throw new Error(`${label} must be a stable tenant/workspace token`);
  }
  return normalized;
}

function normalizePermission(permission) {
  const normalized = String(permission ?? "").trim().toLowerCase();
  if (!/^[a-z]+:[a-z.-]+$/.test(normalized)) {
    throw new Error(`invalid tenant permission: ${permission}`);
  }
  return normalized;
}

function hasTenantPermission(jobDescriptor, permission) {
  return jobDescriptor.tenancy.permissions.includes(permission);
}

function parseStep(body, index) {
  const match = body.match(/^([a-z][a-z0-9.-]*)(?:\s+(.+))?$/i);
  if (!match) {
    throw new Error(`invalid step at index ${index}`);
  }

  const [, op, rest = ""] = match;
  const fields = parseFields(rest);
  const input = fields.input ?? fields.from ?? "runtime";
  const output = fields.output ?? fields.to ?? `${op}-result`;

  return {
    op,
    input,
    output,
    verifierHints: Object.fromEntries(
      Object.entries(fields).filter(([key]) => key.startsWith("verify.")),
    ),
  };
}

function parseFields(text) {
  if (!text) {
    return {};
  }

  return Object.fromEntries(text.split(/\s+/).map((pair) => {
    const [key, ...valueParts] = pair.split("=");
    const value = valueParts.join("=");
    if (!key || !value) {
      throw new Error(`invalid key=value field: ${pair}`);
    }
    return [key, value];
  }));
}

function normalizeExports(exportsInput = {}) {
  const entries = Object.entries(exportsInput);
  if (entries.length === 0) {
    return {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      schedulerPreflight: "./stdlib/scheduler.mjs#createMailchimpSchedulerPreflight",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      auditExportPackage: "./stdlib/audit.mjs#createAuditExportPackage",
      auditPreflightEvidence: "./stdlib/audit.mjs#createSchedulerPreflightAuditEvidence",
      process: "./stdlib/processes.mjs#createProcessEnvelope",
      operatorConsole: "./stdlib/operator-console.mjs#buildOperatorConsoleModel",
    };
  }

  return Object.fromEntries(entries.map(([key, value]) => [String(key), String(value)]));
}

function normalizeLifecycleSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("lifecycle settings must be an object");
  }

  return {
    enabled: Boolean(settings.enabled ?? true),
    dryRun: Boolean(settings.dryRun ?? true),
    requireApproval: Boolean(settings.requireApproval ?? true),
    schedule: normalizeSchedule(settings.schedule ?? {}),
    exportPolicy: normalizeLifecycleExportPolicy(settings.exportPolicy ?? settings.export ?? {}),
    maxRuntimeSteps: normalizeIntegerSetting(
      settings.maxRuntimeSteps ?? 25,
      "maxRuntimeSteps",
      1,
      100,
    ),
    approvalTicket: normalizeOptionalToken(settings.approvalTicket),
  };
}

function normalizeLifecycleExportPolicy(exportPolicy) {
  if (!exportPolicy || typeof exportPolicy !== "object" || Array.isArray(exportPolicy)) {
    throw new Error("lifecycle export policy must be an object");
  }

  const mode = String(exportPolicy.mode ?? "operator-download").trim().toLowerCase();
  if (!["operator-download", "local-archive", "status-handoff", "disabled"].includes(mode)) {
    throw new Error(`unsupported lifecycle export mode: ${mode}`);
  }
  const redaction = String(exportPolicy.redaction ?? "receipt-subjects").trim().toLowerCase();
  if (!["receipt-subjects", "counts-only"].includes(redaction)) {
    throw new Error(`unsupported lifecycle export redaction: ${redaction}`);
  }

  return {
    mode,
    redaction,
    autoPackage: Boolean(exportPolicy.autoPackage ?? false),
    requireCompletedAudit: exportPolicy.requireCompletedAudit !== false,
  };
}

function normalizeSchedule(schedule) {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    throw new Error("lifecycle schedule must be an object");
  }

  const mode = String(schedule.mode ?? "manual").trim().toLowerCase();
  if (!["manual", "disabled", "interval"].includes(mode)) {
    throw new Error(`unsupported lifecycle schedule mode: ${mode}`);
  }

  const intervalMinutes = mode === "interval"
    ? normalizeIntegerSetting(schedule.intervalMinutes ?? 60, "intervalMinutes", 5, 1440)
    : null;

  return {
    mode,
    intervalMinutes,
    startsAt: schedule.startsAt ? normalizeClock(schedule.startsAt) : "logical:0",
  };
}

function buildLifecycleControls(settings) {
  const disabledReason = settings.enabled
    ? null
    : "package disabled by lifecycle settings";
  const schedulePaused = settings.schedule.mode === "disabled";

  return {
    enable: {
      allowed: !settings.enabled,
      command: "package.enable",
    },
    disable: {
      allowed: settings.enabled,
      command: "package.disable",
    },
    runNow: {
      allowed: settings.enabled && !schedulePaused,
      command: "package.run",
      dryRun: settings.dryRun,
      disabledReason,
    },
    approve: {
      allowed: settings.requireApproval && !settings.approvalTicket,
      command: "package.approve",
    },
    reschedule: {
      allowed: settings.enabled,
      command: "package.schedule.update",
      currentMode: settings.schedule.mode,
    },
    exportPackage: {
      allowed: settings.enabled && settings.exportPolicy.mode !== "disabled",
      command: "audit.export.package",
      destination: settings.exportPolicy.mode,
      redaction: settings.exportPolicy.redaction,
      disabledReason: settings.exportPolicy.mode === "disabled"
        ? "audit export packaging is disabled"
        : disabledReason,
    },
  };
}

function validateLifecycle(manifest, jobDescriptor, settings) {
  const errors = [];
  const warnings = [];

  if (!jobDescriptor.capabilities.includes("status:timeline.write")) {
    warnings.push("status timeline writes are recommended for lifecycle observability");
  }
  if (jobDescriptor.plan.length > settings.maxRuntimeSteps) {
    errors.push(`job plan has ${jobDescriptor.plan.length} step(s), above maxRuntimeSteps`);
  }
  if (settings.schedule.mode === "interval" && settings.requireApproval && !settings.approvalTicket) {
    warnings.push("interval schedule will queue approval before execution");
  }
  if (!manifest.capabilities.includes("audit:truth-boundary.write")) {
    errors.push("audit truth-boundary capability is required");
  }
  if (settings.exportPolicy.mode !== "disabled" && !jobDescriptor.capabilities.includes("audit:export.package")) {
    errors.push("audit export package capability is required when export packaging is enabled");
  }
  if (settings.exportPolicy.mode === "status-handoff" && settings.exportPolicy.redaction !== "counts-only") {
    warnings.push("status handoff exports should use counts-only redaction for compact console updates");
  }
  if (jobDescriptor.memory.writePolicy !== "local-only") {
    errors.push("lifecycle only supports local-only memory writes");
  }
  if (!jobDescriptor.tenancy.boundarySatisfied) {
    errors.push(...jobDescriptor.tenancy.violations);
  }
  if (settings.schedule.mode === "interval" && !hasTenantPermission(jobDescriptor, "runtime:schedule")) {
    errors.push("tenant role lacks runtime:schedule permission");
  }
  if (!settings.dryRun && !hasTenantPermission(jobDescriptor, "runtime:run")) {
    errors.push("tenant role lacks runtime:run permission");
  }
  if (settings.dryRun && !hasTenantPermission(jobDescriptor, "runtime:preview")) {
    errors.push("tenant role lacks runtime:preview permission");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checkedCapabilities: jobDescriptor.capabilities,
    checkedSettings: {
      enabled: settings.enabled,
      dryRun: settings.dryRun,
      requireApproval: settings.requireApproval,
      maxRuntimeSteps: settings.maxRuntimeSteps,
      scheduleMode: settings.schedule.mode,
      exportMode: settings.exportPolicy.mode,
      exportRedaction: settings.exportPolicy.redaction,
      tenantId: jobDescriptor.tenancy.tenantId,
      workspaceId: jobDescriptor.tenancy.workspaceId,
      tenantBoundarySatisfied: jobDescriptor.tenancy.boundarySatisfied,
    },
  };
}

function buildLifecycleCommands(jobDescriptor, settings, validation) {
  const commands = [];

  if (!settings.enabled) {
    commands.push({
      command: "package.enable",
      reason: "package is disabled",
      ready: true,
    });
    return commands;
  }

  if (!validation.valid) {
    commands.push({
      command: "package.settings.fix",
      reason: validation.errors.join("; "),
      ready: false,
    });
    return commands;
  }

  if (settings.requireApproval && !settings.approvalTicket) {
    commands.push({
      command: "package.approval.request",
      reason: "approval required before Mailchimp handoff",
      ready: true,
    });
  }

  commands.push({
    command: settings.dryRun ? "package.preview" : "package.run",
    reason: settings.dryRun ? "dry run lifecycle preview" : "execute lifecycle job",
    ready: (!settings.requireApproval || Boolean(settings.approvalTicket))
      && hasTenantPermission(jobDescriptor, settings.dryRun ? "runtime:preview" : "runtime:run"),
    jobId: jobDescriptor.id,
    workspaceId: jobDescriptor.tenancy.workspaceId,
  });

  if (settings.schedule.mode === "interval") {
    commands.push({
      command: "package.schedule.next",
      reason: `interval ${settings.schedule.intervalMinutes} minute(s)`,
      ready: hasTenantPermission(jobDescriptor, "runtime:schedule"),
      startsAt: settings.schedule.startsAt,
      workspaceId: jobDescriptor.tenancy.workspaceId,
    });
  }

  if (settings.exportPolicy.mode !== "disabled") {
    commands.push({
      command: "audit.export.package",
      reason: `package verified audit summary for ${settings.exportPolicy.mode}`,
      ready: validation.valid
        && (!settings.requireApproval || Boolean(settings.approvalTicket))
        && hasTenantPermission(jobDescriptor, "audit:read"),
      destination: settings.exportPolicy.mode,
      redaction: settings.exportPolicy.redaction,
      autoPackage: settings.exportPolicy.autoPackage,
      requireCompletedAudit: settings.exportPolicy.requireCompletedAudit,
      workspaceId: jobDescriptor.tenancy.workspaceId,
    });
  }

  return commands;
}

function deriveLifecycleNextAction(settings, validation, commandQueue) {
  if (!settings.enabled) {
    return "enable-package";
  }
  if (!validation.valid) {
    return "fix-settings";
  }
  const readyCommand = commandQueue.find((command) => command.ready);
  return readyCommand?.command ?? "wait";
}

function buildLifecycleControlGroups(lifecycle, providerContract, readinessPreview) {
  const commandByName = new Map(lifecycle.commandQueue.map((command) => [command.command, command]));
  const validationBlocker = lifecycle.validation.errors.join("; ") || null;
  const previewBlocker = readinessPreview.validationSummary.errors.join("; ") || null;

  return {
    package: [
      materializeControl("package.enable", lifecycle.controls.enable.allowed, {
        label: "Enable package",
        reason: lifecycle.enabled ? "package is already enabled" : "package can be enabled for preview",
      }),
      materializeControl("package.disable", lifecycle.controls.disable.allowed, {
        label: "Disable package",
        reason: lifecycle.enabled ? "pause runtime handoffs for this package" : "package is already disabled",
      }),
      materializeControl("package.settings.fix", !lifecycle.validation.valid, {
        label: "Fix settings",
        reason: validationBlocker ?? "settings are valid",
        blocker: lifecycle.validation.valid ? "settings are valid" : null,
      }),
    ],
    preview: [
      materializeControl("package.preview", Boolean(commandByName.get("package.preview")?.ready), {
        label: "Open preview",
        reason: commandByName.get("package.preview")?.reason ?? previewBlocker ?? "preview is unavailable",
        blocker: commandByName.get("package.preview")?.ready ? null : previewBlocker,
        selected: readinessPreview.readiness.nextAction === "package.preview",
      }),
      materializeControl("package.preview.accept", readinessPreview.controls.acceptPreview.allowed, {
        label: "Accept preview",
        reason: readinessPreview.acceptance.accepted
          ? "preview already accepted"
          : readinessPreview.readiness.reason,
        blocker: readinessPreview.controls.acceptPreview.disabledReason,
        selected: readinessPreview.readiness.nextAction === "package.preview.accept",
      }),
      materializeControl(providerContract.handoffState.runtimeCommand ?? "process.start", readinessPreview.readiness.ready, {
        label: "Run local handoff",
        reason: providerContract.handoffState.reason,
        blocker: readinessPreview.readiness.ready ? null : readinessPreview.readiness.reason,
        selected: readinessPreview.readiness.ready,
      }),
    ],
    schedule: [
      materializeControl("package.schedule.update", lifecycle.controls.reschedule.allowed, {
        label: "Update schedule",
        reason: `current schedule mode: ${lifecycle.schedule.mode}`,
        metadata: {
          mode: lifecycle.schedule.mode,
          intervalMinutes: lifecycle.schedule.intervalMinutes,
          startsAt: lifecycle.schedule.startsAt,
        },
      }),
      materializeControl("package.schedule.next", Boolean(commandByName.get("package.schedule.next")?.ready), {
        label: "Queue next run",
        reason: commandByName.get("package.schedule.next")?.reason ?? "interval schedule is not active",
        blocker: commandByName.get("package.schedule.next")?.ready ? null : "runtime scheduling is unavailable",
        selected: readinessPreview.readiness.nextAction === "package.schedule.next",
      }),
    ],
    audit: [
      materializeControl("audit.export.package", readinessPreview.controls.exportPackage.allowed, {
        label: "Package audit export",
        reason: commandByName.get("audit.export.package")?.reason ?? readinessPreview.readiness.reason,
        blocker: readinessPreview.controls.exportPackage.disabledReason,
        metadata: {
          destination: readinessPreview.controls.exportPackage.destination,
          redaction: readinessPreview.controls.exportPackage.redaction,
          localOnly: true,
        },
      }),
    ],
  };
}

function materializeControl(command, allowed, details = {}) {
  return {
    command,
    allowed: Boolean(allowed),
    ready: Boolean(allowed),
    label: String(details.label ?? command),
    reason: String(details.reason ?? command),
    disabledReason: allowed ? null : String(details.blocker ?? details.reason ?? "control is unavailable"),
    selected: Boolean(details.selected ?? false),
    metadata: details.metadata ?? {},
  };
}

function deriveControlSurfaceStatus(lifecycle, readinessPreview, providerContract) {
  if (!lifecycle.enabled) {
    return "disabled";
  }
  if (!lifecycle.validation.valid || !readinessPreview.validationSummary.valid) {
    return "settings-blocked";
  }
  if (!readinessPreview.acceptance.accepted && readinessPreview.readiness.acceptanceRequired) {
    return "awaiting-acceptance";
  }
  if (!providerContract.handoffState.ready) {
    return "provider-blocked";
  }
  return lifecycle.schedule.mode === "interval" ? "scheduled-ready" : "ready";
}

function deriveControlSurfaceNextAction(lifecycle, readinessPreview, providerContract) {
  if (!lifecycle.enabled) {
    return "package.enable";
  }
  if (!lifecycle.validation.valid || !readinessPreview.validationSummary.valid) {
    return "package.settings.fix";
  }
  if (!readinessPreview.acceptance.accepted && readinessPreview.readiness.acceptanceRequired) {
    return "package.preview.accept";
  }
  if (providerContract.handoffState.ready) {
    return providerContract.handoffState.runtimeCommand ?? readinessPreview.readiness.nextAction;
  }
  return providerContract.handoffState.nextAction;
}

function buildSchedulerControlWindow(lifecycle, input = {}) {
  const schedule = lifecycle.schedule ?? {};
  const requestedMode = String(input.mode ?? schedule.mode ?? "manual").trim().toLowerCase();
  const mode = ["manual", "interval", "disabled"].includes(requestedMode) ? requestedMode : "manual";
  const startsAt = input.startsAt || schedule.startsAt
    ? normalizeClock(input.startsAt ?? schedule.startsAt)
    : "logical:0";
  const intervalMinutes = mode === "interval"
    ? normalizeIntegerSetting(
        input.intervalMinutes ?? schedule.intervalMinutes ?? 60,
        "schedulerControl.intervalMinutes",
        5,
        1440,
      )
    : null;
  const blockedReasons = [];

  if (mode === "disabled") {
    blockedReasons.push("package schedule is disabled");
  }
  if (mode === "interval" && lifecycle.controls.reschedule.allowed !== true) {
    blockedReasons.push("package schedule cannot be updated for interval handoff");
  }
  if (input.windowClosed === true) {
    blockedReasons.push("scheduler control window is closed");
  }

  return {
    mode,
    startsAt,
    intervalMinutes,
    ready: blockedReasons.length === 0,
    blockedReasons,
    nextRunToken: stableId([
      lifecycle.jobId,
      mode,
      startsAt,
      intervalMinutes ?? "manual",
    ]),
  };
}

function normalizeSchedulerControlApproval(readinessPreview, input = {}) {
  const accepted = Boolean(
    readinessPreview.acceptance.accepted ||
      input.accepted ||
      input.previewAccepted,
  );
  const required = Boolean(readinessPreview.acceptance.required ?? input.required ?? true);
  return {
    required,
    accepted,
    acceptedBy: accepted
      ? String(readinessPreview.acceptance.acceptedBy ?? input.acceptedBy ?? "operator")
      : null,
    acceptedAt: accepted
      ? normalizeClock(readinessPreview.acceptance.acceptedAt ?? input.acceptedAt ?? "logical:0")
      : null,
    command: required && !accepted ? "package.preview.accept" : null,
  };
}

function buildSchedulerControlCommand(
  jobDescriptor,
  lifecycle,
  controlSurface,
  readinessPreview,
  approval,
  scheduleWindow,
  ready,
  blockedReasons,
) {
  const runnable = lifecycle.commandQueue.find((command) => (
    command.command === "package.run" ||
      command.command === "package.preview" ||
      command.command === "package.schedule.next"
  ));
  const command = ready
    ? scheduleWindow.mode === "interval"
      ? "package.schedule.next"
      : runnable?.command ?? readinessPreview.readiness.nextAction
    : deriveSchedulerControlNextAction(controlSurface, approval, scheduleWindow);
  const commandId = `pkg_sched_cmd_${stableId([
    jobDescriptor.id,
    command,
    scheduleWindow.nextRunToken,
    ready ? "ready" : blockedReasons.join("|"),
  ])}`;

  return {
    id: commandId,
    command,
    ready,
    reason: ready
      ? "package lifecycle controls permit scheduler handoff"
      : blockedReasons[0] ?? controlSurface.clientState.disabledReason ?? "package controls are blocked",
    idempotencyKey: commandId,
    jobId: jobDescriptor.id,
    workspaceId: jobDescriptor.tenancy.workspaceId,
    scheduleMode: scheduleWindow.mode,
    dryRun: lifecycle.validation.checkedSettings.dryRun,
    externalWrites: false,
    requiresVerifier: true,
  };
}

function deriveSchedulerControlNextAction(controlSurface, approval, scheduleWindow) {
  if (scheduleWindow.ready === false) {
    return scheduleWindow.mode === "disabled"
      ? "package.schedule.update"
      : "package.scheduler-window.reopen";
  }
  if (approval?.required && !approval.accepted) {
    return approval.command ?? "package.preview.accept";
  }
  return controlSurface.nextAction ?? "package.settings.fix";
}

function selectPrimaryControlCommand(controlGroups) {
  const controls = Object.values(controlGroups).flat();
  return controls.find((control) => control.selected && control.ready)?.command
    ?? controls.find((control) => control.ready)?.command
    ?? "package.settings.fix";
}

function deriveScheduleBadge(lifecycle) {
  if (!lifecycle.enabled) {
    return "disabled";
  }
  if (lifecycle.schedule.mode === "interval") {
    return lifecycle.controls.reschedule.allowed ? "scheduled" : "schedule-blocked";
  }
  return lifecycle.schedule.mode;
}

function normalizeProviderService(provider) {
  const name = String(provider.name ?? "mailchimp").trim().toLowerCase();
  if (name !== "mailchimp") {
    throw new Error(`unsupported provider service: ${provider.name}`);
  }

  const mode = String(provider.mode ?? "read-only").trim().toLowerCase();
  if (!["read-only", "sandbox-read"].includes(mode)) {
    throw new Error(`unsupported Mailchimp provider mode: ${mode}`);
  }

  return {
    name,
    adapter: String(provider.adapter ?? DEFAULT_RUNTIME.adapter),
    service: String(provider.service ?? "marketing-campaigns"),
    mode,
  };
}

function negotiateProviderCapabilities(provider, requestedCapabilities, options) {
  const supported = uniqueSorted(options.supportedCapabilities ?? Object.keys(MAILCHIMP_READ_SCOPES));
  const denied = requestedCapabilities
    .filter((capability) => !supported.includes(capability))
    .map((capability) => ({
      capability,
      reason: "provider capability is not declared as supported",
    }));
  const granted = requestedCapabilities.filter((capability) => supported.includes(capability));
  const scopes = uniqueSorted(granted.map((capability) => MAILCHIMP_READ_SCOPES[capability]));
  const readOnly = provider.mode === "read-only" || provider.mode === "sandbox-read";

  return {
    requestedCapabilities: uniqueSorted(requestedCapabilities),
    grantedCapabilities: uniqueSorted(granted),
    deniedCapabilities: denied,
    providerScopes: scopes,
    capabilityMode: readOnly ? "read-only" : "write-capable",
    externalWritePolicy: readOnly ? "forbidden" : "blocked-by-contract",
    satisfied: denied.length === 0 && requestedCapabilities.length === granted.length,
  };
}

function buildProviderSyncState(manifest, jobDescriptor, lifecycle, provider, negotiated, options) {
  const cursor = normalizeOptionalToken(options.syncCursor) ?? stableId([
    manifest.name,
    manifest.version,
    jobDescriptor.id,
    negotiated.grantedCapabilities.join(","),
  ]);
  const checkpoint = normalizeOptionalToken(options.checkpoint) ?? `provider_${cursor}`;
  const direction = String(options.direction ?? "provider-to-local").trim().toLowerCase();
  if (!["provider-to-local", "provider-metadata-only"].includes(direction)) {
    throw new Error(`unsupported provider sync direction: ${direction}`);
  }

  return {
    direction,
    providerResource: String(options.providerResource ?? "campaign"),
    localNamespace: jobDescriptor.memory.namespace,
    memoryWritePolicy: jobDescriptor.memory.writePolicy,
    externalHandoff: "none",
    cursor,
    checkpoint,
    tenantId: jobDescriptor.tenancy.tenantId,
    workspaceId: jobDescriptor.tenancy.workspaceId,
    auditChannel: jobDescriptor.tenancy.auditChannel,
    scheduleMode: lifecycle.schedule.mode,
    adapter: provider.adapter,
  };
}

function buildProviderHandoffState(lifecycle, negotiated, sync, options) {
  const externalApproval = normalizeOptionalToken(options.externalApproval);
  const approvalCommand = lifecycle.commandQueue.find((command) => (
    command.command === "package.approval.request"
  ));
  const runnableCommand = lifecycle.commandQueue.find((command) => (
    command.command === "package.preview" || command.command === "package.run"
  ));
  const blockedReasons = [];

  if (!lifecycle.enabled) {
    blockedReasons.push("package lifecycle is disabled");
  }
  if (!lifecycle.validation.valid) {
    blockedReasons.push(...lifecycle.validation.errors);
  }
  if (!negotiated.satisfied) {
    blockedReasons.push(...negotiated.deniedCapabilities.map((entry) => entry.reason));
  }
  if (approvalCommand && !externalApproval) {
    blockedReasons.push("operator approval is required before provider handoff");
  }
  if (sync.memoryWritePolicy !== "local-only") {
    blockedReasons.push("provider sync requires local-only memory write policy");
  }
  if (!lifecycle.tenantBoundary.boundarySatisfied) {
    blockedReasons.push(...lifecycle.tenantBoundary.violations);
  }
  if (!lifecycle.tenantBoundary.permissions.includes("mailchimp:read")) {
    blockedReasons.push("tenant role lacks mailchimp:read permission");
  }

  const approvalPending = Boolean(approvalCommand && !externalApproval);
  const ready = blockedReasons.length === 0 && Boolean(runnableCommand);

  return {
    ready,
    reason: ready
      ? "provider contract is ready for local runtime handoff"
      : blockedReasons.join("; "),
    blockedReasons: uniqueSorted(blockedReasons),
    approval: {
      required: Boolean(approvalCommand),
      ticket: externalApproval,
      command: approvalCommand?.command ?? null,
    },
    nextAction: deriveProviderNextAction(
      lifecycle,
      negotiated,
      ready,
      approvalPending,
      runnableCommand,
    ),
    runtimeCommand: ready ? runnableCommand.command : null,
    handoffToken: ready
      ? stableId([sync.checkpoint, lifecycle.jobId, runnableCommand.command])
      : null,
  };
}

function normalizeProviderSyncObservation(observation = {}) {
  const status = String(observation.status ?? "not-observed").trim().toLowerCase();
  if (!["not-observed", "observed", "checkpoint-mismatch", "stale", "blocked"].includes(status)) {
    throw new Error(`unsupported provider sync observation status: ${status}`);
  }

  return {
    status,
    checkpoint: normalizeOptionalToken(observation.checkpoint ?? observation.providerCheckpoint),
    cursor: normalizeOptionalToken(observation.cursor ?? observation.syncCursor),
    observedAt: observation.observedAt ? normalizeClock(observation.observedAt) : null,
    externalWritesObserved: Number.isFinite(observation.externalWritesObserved)
      ? observation.externalWritesObserved
      : 0,
    blockedReasons: uniqueSorted(observation.blockedReasons ?? []),
    checkpointMatched: observation.checkpointMatched === true,
  };
}

function buildProviderSyncPersistence(jobDescriptor, providerContract, observed, options) {
  const stateKey = normalizeOptionalToken(options.stateKey ?? options.providerSyncStateKey)
    ?? `${jobDescriptor.memory.namespace}:provider-sync:${providerContract.sync.checkpoint}`;
  const restartToken = normalizeOptionalToken(options.restartToken ?? options.providerSyncRestartToken)
    ?? `resume_${stableId([stateKey, providerContract.sync.checkpoint, observed.status])}`;
  const checksum = normalizeOptionalToken(options.checksum ?? options.providerSyncChecksum)
    ?? stableId([
      jobDescriptor.id,
      providerContract.sync.checkpoint,
      providerContract.negotiation.grantedCapabilities.join(","),
      stateKey,
    ]);

  return {
    stateKey,
    restartToken,
    checksum,
    namespace: jobDescriptor.memory.namespace,
    localOnly: true,
    writePolicy: jobDescriptor.memory.writePolicy,
    restartSafe: Boolean(stateKey && restartToken && checksum && jobDescriptor.memory.writePolicy === "local-only"),
    previousCheckpoint: normalizeOptionalToken(options.previousCheckpoint),
    replayToken: normalizeOptionalToken(options.replayToken)
      ?? `replay_${stableId([stateKey, restartToken, checksum])}`,
  };
}

function deriveProviderSyncManifestStatus(providerContract, observed, persistence) {
  if (!providerContract.negotiation.satisfied || !providerContract.handoffState.ready) {
    return "blocked";
  }
  if (observed.externalWritesObserved > 0 || observed.status === "blocked") {
    return "blocked";
  }
  if (observed.status === "checkpoint-mismatch") {
    return "checkpoint-mismatch";
  }
  if (observed.status === "stale" || !observed.checkpointMatched) {
    return "stale";
  }
  if (!persistence.restartSafe) {
    return "persistence-required";
  }
  return "ready";
}

function deriveProviderSyncManifestBlockers(providerContract, observed, persistence, status) {
  return uniqueSorted([
    ...(providerContract.negotiation.satisfied ? [] : providerContract.negotiation.deniedCapabilities.map((entry) => entry.reason)),
    ...(providerContract.handoffState.ready ? [] : providerContract.handoffState.blockedReasons),
    ...(providerContract.sync.memoryWritePolicy === "local-only" ? [] : ["provider sync persistence must be local-only"]),
    ...(providerContract.sync.externalHandoff === "none" ? [] : ["provider sync cannot require external handoff before verifier"]),
    ...(observed.externalWritesObserved > 0 ? ["provider sync observation includes external writes"] : []),
    ...(observed.status === "checkpoint-mismatch" ? ["provider sync checkpoint must be refreshed"] : []),
    ...(observed.status === "stale" ? ["provider sync observation is stale"] : []),
    ...(observed.checkpointMatched ? [] : ["provider sync checkpoint has not been observed"]),
    ...(persistence.restartSafe ? [] : ["provider sync persistence is not restart-safe"]),
    ...observed.blockedReasons,
    ...(status === "persistence-required" ? ["provider sync persistence is required"] : []),
  ]);
}

function buildProviderSyncManifestCommand(jobDescriptor, providerContract, persistence, ready, blockedReasons, options) {
  const command = ready
    ? "provider.sync.record"
    : deriveProviderSyncManifestNextAction(blockedReasons, {});
  const id = `${jobDescriptor.id}:provider-sync:${stableId([
    providerContract.sync.checkpoint,
    persistence.stateKey,
    command,
  ])}`;

  return {
    id,
    command,
    ready,
    idempotencyKey: id,
    reason: ready
      ? "provider sync checkpoint, local persistence, and capability negotiation are aligned"
      : blockedReasons[0] ?? "provider sync state is not ready",
    requiresVerifier: true,
    externalWrites: false,
    writes: ready ? [persistence.stateKey] : [],
  };
}

function deriveProviderSyncManifestNextAction(blockedReasons, observed) {
  const reasons = Array.isArray(blockedReasons) ? blockedReasons : [];
  if (reasons.some((reason) => reason.includes("checkpoint")) || observed.status === "checkpoint-mismatch") {
    return "provider.sync.refresh";
  }
  if (reasons.some((reason) => reason.includes("persistence"))) {
    return "provider.sync.persist";
  }
  if (reasons.some((reason) => reason.includes("approval"))) {
    return "package.approval.request";
  }
  return "provider.sync.review";
}

function deriveProviderNextAction(lifecycle, negotiated, ready, approvalPending, runnableCommand) {
  if (!lifecycle.enabled) {
    return "package.enable";
  }
  if (!lifecycle.validation.valid) {
    return "package.settings.fix";
  }
  if (!negotiated.satisfied) {
    return "provider.capabilities.review";
  }
  if (approvalPending) {
    return "package.approval.request";
  }
  if (ready && runnableCommand) {
    return runnableCommand.command;
  }
  return "provider.wait";
}

function deriveProviderBadge(handoffState) {
  if (handoffState.ready) {
    return "ready";
  }
  if (handoffState.nextAction === "package.approval.request") {
    return "approval-required";
  }
  if (handoffState.nextAction === "provider.capabilities.review") {
    return "capability-review";
  }
  return "blocked";
}

function deriveVisibleProviderStatus(lifecycle, handoffState) {
  if (!lifecycle.enabled) {
    return "disabled";
  }
  if (handoffState.ready) {
    return lifecycle.schedule.mode === "interval" ? "scheduled" : "ready";
  }
  return "needs-attention";
}

function normalizePreviewAcceptance(input = {}) {
  const accepted = Boolean(input.accepted ?? false);
  return {
    accepted,
    required: input.required !== false,
    acceptedBy: accepted ? String(input.acceptedBy ?? "operator") : null,
    acceptedAt: accepted ? normalizeClock(input.acceptedAt ?? "logical:0") : null,
  };
}

function buildReadinessValidationSummary(lifecycle, providerContract, acceptance) {
  const errors = [];
  const warnings = [];

  if (!lifecycle.validation.valid) {
    errors.push(...lifecycle.validation.errors);
  }
  if (!lifecycle.enabled) {
    errors.push("package lifecycle is disabled");
  }
  if (!providerContract.negotiation.satisfied) {
    errors.push(...providerContract.negotiation.deniedCapabilities.map((entry) => (
      `${entry.capability}: ${entry.reason}`
    )));
  }
  if (!providerContract.handoffState.ready) {
    errors.push(...providerContract.handoffState.blockedReasons);
  }
  if (!lifecycle.tenantBoundary.boundarySatisfied) {
    errors.push(...lifecycle.tenantBoundary.violations);
  }
  if (providerContract.tenantBoundary.workspaceId !== lifecycle.tenantBoundary.workspaceId) {
    errors.push("provider workspace does not match lifecycle tenant boundary");
  }
  if (providerContract.sync.externalHandoff !== "none") {
    errors.push("provider handoff must remain local until verifier approval");
  }
  if (lifecycle.validation.warnings.length > 0) {
    warnings.push(...lifecycle.validation.warnings);
  }
  if (lifecycle.schedule.mode === "interval" && !acceptance.accepted) {
    warnings.push("scheduled previews require acceptance before runtime handoff");
  }

  return {
    valid: errors.length === 0,
    errors: uniqueSorted(errors),
    warnings: uniqueSorted(warnings),
    blockedReasons: uniqueSorted([
      ...errors,
      ...(acceptance.accepted ? [] : ["operator preview acceptance is pending"]),
    ]),
    checked: {
      lifecycleEnabled: lifecycle.enabled,
      lifecycleValidation: lifecycle.validation.valid,
      scheduleMode: lifecycle.schedule.mode,
      providerReady: providerContract.handoffState.ready,
      providerNegotiation: providerContract.negotiation.satisfied,
      localOnlyMemory: providerContract.sync.externalHandoff === "none",
      tenantBoundarySatisfied: lifecycle.tenantBoundary.boundarySatisfied,
      workspaceId: lifecycle.tenantBoundary.workspaceId,
    },
  };
}

function buildPackageReadinessState(lifecycle, providerContract, validationSummary, acceptance) {
  const acceptanceRequired = acceptance.required
    || lifecycle.commandQueue.some((command) => (
      command.command === "package.approval.request"
    ))
    || lifecycle.schedule.mode === "interval";
  const accepted = !acceptanceRequired || acceptance.accepted;
  const ready = validationSummary.valid && accepted && providerContract.handoffState.ready;

  return {
    ready,
    status: ready
      ? "ready"
      : !lifecycle.enabled
        ? "disabled"
        : validationSummary.valid && !accepted
          ? "awaiting-acceptance"
          : "blocked",
    acceptanceRequired,
    nextAction: ready
      ? providerContract.handoffState.runtimeCommand ?? "package.preview"
      : validationSummary.valid
        ? "package.preview.accept"
        : providerContract.handoffState.nextAction,
    reason: ready
      ? "package preview accepted and provider handoff is local-only"
      : validationSummary.blockedReasons.join("; "),
  };
}

function buildReadinessControls(lifecycle, readiness, validationSummary) {
  return {
    enable: lifecycle.controls.enable,
    disable: lifecycle.controls.disable,
    reschedule: lifecycle.controls.reschedule,
    acceptPreview: {
      allowed: validationSummary.valid && !readiness.ready,
      command: "package.preview.accept",
      disabledReason: validationSummary.valid ? null : validationSummary.errors.join("; "),
    },
    openPreview: {
      allowed: validationSummary.valid,
      command: "package.preview",
      disabledReason: validationSummary.valid ? null : validationSummary.errors.join("; "),
    },
    runHandoff: {
      allowed: readiness.ready,
      command: readiness.nextAction,
      disabledReason: readiness.ready ? null : readiness.reason,
    },
    exportPackage: {
      allowed: readiness.ready && lifecycle.controls.exportPackage.allowed,
      command: lifecycle.controls.exportPackage.command,
      destination: lifecycle.controls.exportPackage.destination,
      redaction: lifecycle.controls.exportPackage.redaction,
      disabledReason: readiness.ready
        ? lifecycle.controls.exportPackage.disabledReason
        : readiness.reason,
    },
  };
}

function buildReadinessNextSteps(readiness, validationSummary, providerContract) {
  if (!validationSummary.valid) {
    return validationSummary.errors.map((reason) => ({
      action: providerContract.handoffState.nextAction,
      label: "Resolve package readiness blocker",
      reason,
    }));
  }
  if (!readiness.ready) {
    return [{
      action: "package.preview.accept",
      label: "Accept preview",
      reason: readiness.reason,
    }];
  }
  return [{
    action: readiness.nextAction,
    label: "Continue local runtime handoff",
    reason: "preview acceptance and provider contract are ready",
  }, {
    action: "audit.export.package",
    label: "Prepare audit export package",
    reason: "verified Mailchimp reads can be packaged after evidence is complete",
  }];
}

function normalizeIntegerSetting(value, label, min, max) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return normalized;
}

function normalizeOptionalToken(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  if (!/^[a-z0-9._:-]+$/i.test(normalized)) {
    throw new Error("approvalTicket must be a stable token");
  }
  return normalized;
}

function normalizeClock(value) {
  const normalized = String(value);
  if (!/^(logical:\d+|\d{4}-\d{2}-\d{2}T)/.test(normalized)) {
    throw new Error(`unsupported clock value: ${value}`);
  }
  return normalized;
}

function buildVerifierContracts(capabilities) {
  return [
    {
      capability: "scheduler:preflight",
      evidence: "runtime-local-receipt",
      contract: "aios.mailchimp.scheduler-preflight.v1",
      requiredBefore: "adapter-handoff",
      recovery: "scheduler.preflight.repair",
    },
    ...capabilities.map((capability) => ({
      capability,
      evidence: capability.startsWith("mailchimp:")
        ? "mailchimp-read-receipt"
        : "runtime-local-receipt",
    })),
  ];
}

function buildRequiredEvidence(ast) {
  return uniqueSorted(ast.steps.flatMap((step) => [
    `${step.id ?? step.op}:input`,
    `${step.id ?? step.op}:output`,
    ...Object.keys(step.verifierHints),
  ]));
}

function assertPackageManifest(manifest) {
  if (!manifest || manifest.kind !== "aios.package") {
    throw new Error("manifest must be produced by createPackageManifest");
  }
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function stableId(parts) {
  const text = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
