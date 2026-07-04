import {
  MAILCHIMP_SYSCALLS,
  createMailchimpSyscallManifest,
} from "../stdlib/syscalls.mjs";

export const MAILCHIMP_SYSCALL_ANALYSIS_VERSION = "aios.semantic.syscall-analysis.v1";

function stableId(prefix, parts) {
  const input = JSON.stringify(parts);
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return `${prefix}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function defaultBoundary(source = {}) {
  const capabilities = asArray(source.capabilities || [
    "provider.mailchimp.audience.read",
    "memory.local.artifact.write",
    "verifier.mailchimp.contract.check",
  ]);
  const status = source.status || "ready";
  return {
    kind: "aios.workspace.boundary_binding",
    boundaryId: source.boundaryId || stableId("mailchimp-boundary", [status, capabilities]),
    status,
    providerJob: {
      provider: "mailchimp",
      product: "Mailchimp",
      jobId: source.jobId || stableId("mailchimp-job", [status, capabilities]),
      capabilities,
      commitMode: source.commitMode || "dry-run",
      adapterHandoff: {
        provider: "mailchimp",
        audience: {
          audienceId: source.audienceId || null,
          segmentId: source.segmentId || null,
        },
      },
      lifecycleState: {
        nextAction: source.nextAction || "operator.review",
        controls: {
          previewAllowed: true,
          commitAllowed: source.commitMode === "adapter-mediated",
          acceptanceRequired: source.commitMode === "adapter-mediated",
        },
      },
    },
    truthBoundary: source.truthBoundary || { source: "semantic-syscall-analysis" },
    analyticsExport: source.analyticsExport || null,
    operatorControlState: source.operatorControlState || null,
    continuationPacket: source.continuationPacket || null,
    recovery: source.recovery || null,
    issues: asArray(source.issues),
  };
}

function normalizeBoundary(source) {
  if (source?.kind === "aios.workspace.boundary_binding") return source;
  return defaultBoundary(source);
}

function classifySyscall(syscall, manifest) {
  const negotiation = syscall.requires?.length
    ? {
      requested: syscall.requires,
      missing: syscall.requires.filter((capability) => !manifest.capabilities.includes(capability)),
    }
    : { requested: [], missing: [] };
  const blockedByStatus = !syscall.allowedWhen.includes(manifest.status);
  const blockedByCapability = negotiation.missing.length > 0;
  const externalWrite = syscall.sideEffects.includes("external-provider-write");
  return {
    name: syscall.name,
    id: syscall.id,
    status: blockedByStatus || blockedByCapability ? "blocked" : externalWrite ? "approval-gated" : "ready",
    allowedWhen: syscall.allowedWhen,
    requiredCapabilities: syscall.requires,
    sideEffects: syscall.sideEffects,
    negotiation,
    recovery: {
      retrySafe: !externalWrite,
      requiresApproval: externalWrite,
      nextAction: blockedByStatus
        ? "wait-for-boundary-ready"
        : blockedByCapability
          ? "refresh-provider-capabilities"
          : externalWrite
            ? "collect-operator-approval"
            : "dispatch-syscall",
    },
  };
}

function normalizeLifecycleSettings(boundary, options) {
  const source = options.lifecycleSettings || boundary.operatorControlState?.settings || {};
  const requestedInterval = Number(source.scheduleEverySeconds ?? source.scheduleIntervalSeconds ?? 0);
  const scheduleEverySeconds = Number.isFinite(requestedInterval) && requestedInterval > 0
    ? Math.max(30, Math.floor(requestedInterval))
    : null;
  const mode = source.mode || boundary.providerJob?.commitMode || "dry-run";
  const externalWritesEnabled = source.externalWritesEnabled === true
    || boundary.operatorControlState?.externalWritesEnabled === true
    || options.operatorApproved === true;
  return {
    mode,
    enabled: source.enabled !== false && boundary.status !== "disabled",
    scheduleEverySeconds,
    pauseAfterDispatch: source.pauseAfterDispatch !== false,
    externalWritesEnabled,
    requireApprovalForExternalWrite: source.requireApprovalForExternalWrite !== false,
    maxDispatchesPerTick: Math.max(1, Math.floor(Number(source.maxDispatchesPerTick || 1))),
  };
}

function validateLifecycleSettings(settings) {
  const diagnostics = [];
  if (!["dry-run", "adapter-mediated", "read-only"].includes(settings.mode)) {
    diagnostics.push({
      level: "error",
      code: "syscall.lifecycle.mode.invalid",
      mode: settings.mode,
    });
  }
  if (settings.externalWritesEnabled && settings.mode !== "adapter-mediated") {
    diagnostics.push({
      level: "error",
      code: "syscall.lifecycle.external-writes.require-adapter-mediated",
    });
  }
  if (settings.scheduleEverySeconds != null && settings.scheduleEverySeconds < 30) {
    diagnostics.push({
      level: "warning",
      code: "syscall.lifecycle.schedule.too-frequent",
      minimumSeconds: 30,
    });
  }
  if (!Number.isInteger(settings.maxDispatchesPerTick) || settings.maxDispatchesPerTick < 1) {
    diagnostics.push({ level: "error", code: "syscall.lifecycle.max-dispatches.invalid" });
  }
  return diagnostics;
}

function buildLifecycleControls(syscalls, settings, blocked, approvalGated, allowedExternalWrites, settingDiagnostics) {
  const blockedBySettings = settingDiagnostics.some((diagnostic) => diagnostic.level === "error");
  const dispatchable = syscalls.filter((syscall) => syscall.status === "ready");
  const externalWriteReady = allowedExternalWrites.length > 0;
  const canDispatch = settings.enabled && !blocked.length && !blockedBySettings;
  const canCommitExternalWrite = canDispatch
    && externalWriteReady
    && settings.externalWritesEnabled
    && settings.mode === "adapter-mediated";
  const commands = [
    {
      command: settings.enabled ? "disable-syscall-dispatch" : "enable-syscall-dispatch",
      enabled: true,
      reason: settings.enabled ? "pause dispatch controls" : "resume dispatch controls",
    },
    {
      command: "preview-syscall-plan",
      enabled: !blockedBySettings,
      reason: blockedBySettings ? "repair lifecycle settings first" : "preview is available",
    },
    {
      command: "dispatch-ready-syscalls",
      enabled: canDispatch && dispatchable.length > 0,
      reason: canDispatch ? "ready syscalls are dispatchable" : "dispatch is blocked",
      syscalls: dispatchable.slice(0, settings.maxDispatchesPerTick).map((syscall) => syscall.name),
    },
    {
      command: "commit-adapter-batch",
      enabled: canCommitExternalWrite,
      reason: canCommitExternalWrite
        ? "operator-approved adapter-mediated external write"
        : "external write approval or adapter-mediated mode required",
      syscalls: allowedExternalWrites.map((syscall) => syscall.name),
    },
  ];
  return {
    settings,
    diagnostics: settingDiagnostics,
    enabled: settings.enabled && !blockedBySettings,
    dispatchPaused: !settings.enabled,
    approvalRequired: approvalGated.length > allowedExternalWrites.length,
    canDispatch,
    canCommitExternalWrite,
    commands,
    nextAction: blockedBySettings
      ? "repair-syscall-lifecycle-settings"
      : !settings.enabled
        ? "enable-syscall-dispatch"
        : blocked.length
          ? blocked[0].recovery.nextAction
          : approvalGated.length && allowedExternalWrites.length === 0
            ? "collect-operator-approval"
            : "dispatch-ready-syscalls",
  };
}

function buildSchedulingState(boundary, settings, lifecycleControls) {
  const scheduleId = stableId("mailchimp-syscall-schedule", [
    boundary.boundaryId,
    settings.scheduleEverySeconds,
    lifecycleControls.nextAction,
  ]);
  return {
    scheduleId,
    enabled: settings.enabled && settings.scheduleEverySeconds != null && lifecycleControls.canDispatch,
    intervalSeconds: settings.scheduleEverySeconds,
    maxDispatchesPerTick: settings.maxDispatchesPerTick,
    pauseAfterDispatch: settings.pauseAfterDispatch,
    nextTickAction: lifecycleControls.canDispatch
      ? "dispatch-ready-syscalls"
      : lifecycleControls.nextAction,
    statusChannel: "syscall.schedule.mailchimp",
  };
}

function inferProviderServiceContract(boundary, manifest, syscalls) {
  const source = boundary.providerServiceContract || boundary.providerJob?.providerServiceContract || {};
  const requestedCapabilities = [
    ...manifest.capabilities,
    ...syscalls.flatMap((syscall) => syscall.requiredCapabilities),
    ...asArray(source.requestedCapabilities),
  ];
  const offeredCapabilities = asArray(
    source.offeredCapabilities
      || boundary.providerJob?.offeredCapabilities
      || manifest.capabilities,
  );
  const requiredCapabilities = [...new Set(requestedCapabilities)].sort();
  const missingCapabilities = requiredCapabilities
    .filter((capability) => !offeredCapabilities.includes(capability))
    .sort();
  return {
    providerService: source.providerService || boundary.providerJob?.provider || "mailchimp",
    serviceId: source.serviceId || stableId("mailchimp-syscall-service", [
      boundary.boundaryId,
      requiredCapabilities,
      offeredCapabilities,
    ]),
    version: source.version || "runtime-negotiated",
    requestedCapabilities: requiredCapabilities,
    offeredCapabilities: [...new Set(offeredCapabilities)].sort(),
    negotiatedCapabilities: requiredCapabilities.filter((capability) => offeredCapabilities.includes(capability)).sort(),
    missingCapabilities,
    status: missingCapabilities.length ? "capability-mismatch" : "negotiated",
  };
}

function buildDispatchBatchState(boundary, syscalls, providerServiceContract, lifecycleControls, schedulingState) {
  const dispatchable = syscalls.filter((syscall) => syscall.status === "ready");
  const approvalGated = syscalls.filter((syscall) => syscall.status === "approval-gated");
  const blocked = syscalls.filter((syscall) => syscall.status === "blocked");
  const settings = lifecycleControls.settings;
  const selected = dispatchable.slice(0, settings.maxDispatchesPerTick);
  const missingCapabilityBlockers = providerServiceContract.missingCapabilities
    .map((capability) => `capability:${capability}`);
  const syscallBlockers = blocked.map((syscall) => `syscall:${syscall.name}`);
  const batchAccepted = lifecycleControls.canDispatch
    && providerServiceContract.status === "negotiated"
    && selected.length > 0;
  const externalWriteHeld = approvalGated.length > 0 && !lifecycleControls.canCommitExternalWrite;
  return {
    batchId: stableId("mailchimp-syscall-batch", [
      boundary.boundaryId,
      selected.map((syscall) => syscall.name),
      lifecycleControls.nextAction,
      providerServiceContract.serviceId,
    ]),
    status: batchAccepted
      ? externalWriteHeld
        ? "ready-with-held-external-write"
        : "ready"
      : missingCapabilityBlockers.length
        ? "provider-negotiation-required"
        : "blocked",
    providerService: providerServiceContract.providerService,
    selectedSyscalls: selected.map((syscall) => ({
      name: syscall.name,
      id: syscall.id,
      retrySafe: syscall.recovery.retrySafe,
      sideEffects: syscall.sideEffects,
    })),
    heldExternalWrites: approvalGated
      .filter((syscall) => !lifecycleControls.canCommitExternalWrite)
      .map((syscall) => syscall.name),
    blockedBy: [...missingCapabilityBlockers, ...syscallBlockers].sort(),
    schedule: {
      enabled: schedulingState.enabled && batchAccepted,
      scheduleId: schedulingState.scheduleId,
      intervalSeconds: schedulingState.intervalSeconds,
      nextTickAction: schedulingState.nextTickAction,
    },
    statusChannel: schedulingState.enabled ? schedulingState.statusChannel : "syscall.dispatch.mailchimp",
    nextAction: missingCapabilityBlockers.length
      ? "refresh-provider-service-capabilities"
      : !lifecycleControls.enabled
        ? lifecycleControls.nextAction
        : externalWriteHeld
          ? "collect-operator-approval"
          : batchAccepted
            ? "handoff-syscall-batch-to-adapter"
            : lifecycleControls.nextAction,
  };
}

function buildExternalHandoffState(boundary, providerServiceContract, dispatchBatchState, lifecycleControls) {
  const providerJob = boundary.providerJob || {};
  const audience = providerJob.adapterHandoff?.audience || {};
  const accepted = dispatchBatchState.status === "ready"
    || dispatchBatchState.status === "ready-with-held-external-write";
  return {
    handoffId: stableId("mailchimp-syscall-handoff", [
      dispatchBatchState.batchId,
      providerServiceContract.serviceId,
      audience.audienceId,
      audience.segmentId,
    ]),
    acceptedForAdapter: accepted && providerServiceContract.status === "negotiated",
    providerService: providerServiceContract.providerService,
    providerJobId: providerJob.jobId || null,
    audienceId: audience.audienceId || null,
    segmentId: audience.segmentId || null,
    commitMode: providerJob.commitMode || lifecycleControls.settings.mode,
    syncMetadata: {
      serviceId: providerServiceContract.serviceId,
      negotiatedCapabilities: providerServiceContract.negotiatedCapabilities,
      missingCapabilities: providerServiceContract.missingCapabilities,
      batchId: dispatchBatchState.batchId,
      statusChannel: dispatchBatchState.statusChannel,
    },
    externalWrite: {
      accepted: lifecycleControls.canCommitExternalWrite,
      heldSyscalls: dispatchBatchState.heldExternalWrites,
      requiresApproval: dispatchBatchState.heldExternalWrites.length > 0,
    },
    nextAction: providerServiceContract.status !== "negotiated"
      ? "refresh-provider-service-capabilities"
      : dispatchBatchState.nextAction,
  };
}

function buildRoutePreviewAcceptanceState(boundary, syscalls, dispatchBatchState, externalHandoffState, lifecycleControls) {
  const providerJob = boundary.providerJob || {};
  const operatorControlState = boundary.operatorControlState || {};
  const acceptedSyscalls = new Set(dispatchBatchState.selectedSyscalls.map((syscall) => syscall.name));
  const blockedBy = [
    ...dispatchBatchState.blockedBy,
    ...lifecycleControls.diagnostics
      .filter((diagnostic) => diagnostic.level === "error")
      .map((diagnostic) => diagnostic.code),
  ].sort();
  const externalWriteAccepted = externalHandoffState.externalWrite.accepted;
  const runtimeAccepted = externalHandoffState.acceptedForAdapter
    && blockedBy.length === 0
    && lifecycleControls.enabled;
  const acceptanceRequired = dispatchBatchState.heldExternalWrites.length > 0
    || providerJob.commitMode === "adapter-mediated";
  const previewRows = syscalls.map((syscall) => ({
    name: syscall.name,
    id: syscall.id,
    displayState: syscall.status === "ready"
      ? acceptedSyscalls.has(syscall.name)
        ? "selected"
        : "available"
      : syscall.status === "approval-gated"
        ? "requires-approval"
        : "blocked",
    sideEffects: syscall.sideEffects,
    requiredCapabilities: syscall.requiredCapabilities,
    retrySafe: syscall.recovery.retrySafe,
    nextAction: syscall.status === "blocked"
      ? syscall.recovery.nextAction
      : syscall.status === "approval-gated" && !externalWriteAccepted
        ? "collect-operator-approval"
        : "dispatch-syscall",
  }));
  const failedChecks = [
    ...(blockedBy.length ? ["dispatch-blockers-clear"] : []),
    ...(!lifecycleControls.enabled ? ["lifecycle-enabled"] : []),
    ...(externalHandoffState.syncMetadata.missingCapabilities.length ? ["provider-capabilities-negotiated"] : []),
  ];
  const pendingChecks = [
    ...(acceptanceRequired && !externalWriteAccepted ? ["external-write-accepted"] : []),
  ];

  return {
    preview: {
      previewId: stableId("mailchimp-syscall-preview", [
        boundary.boundaryId,
        dispatchBatchState.batchId,
        previewRows.map((row) => [row.name, row.displayState]),
      ]),
      title: "Mailchimp syscall dispatch preview",
      status: failedChecks.length
        ? "blocked"
        : pendingChecks.length
          ? "needs-acceptance"
          : "ready",
      rows: previewRows,
      counters: {
        syscalls: previewRows.length,
        selected: dispatchBatchState.selectedSyscalls.length,
        approvalGated: previewRows.filter((row) => row.displayState === "requires-approval").length,
        blocked: previewRows.filter((row) => row.displayState === "blocked").length,
      },
    },
    acceptance: {
      acceptanceId: stableId("mailchimp-syscall-acceptance", [
        dispatchBatchState.batchId,
        operatorControlState.acceptedBy,
        externalWriteAccepted,
      ]),
      required: acceptanceRequired,
      acceptedForRuntime: runtimeAccepted && (!acceptanceRequired || externalWriteAccepted),
      acceptedForExternalWrite: externalWriteAccepted,
      acceptedBy: operatorControlState.acceptedBy || null,
      acceptedAt: operatorControlState.acceptedAt || null,
      blockedBy,
      nextAction: blockedBy.length
        ? "repair-syscall-dispatch-preview"
        : acceptanceRequired && !externalWriteAccepted
          ? "collect-operator-approval"
          : "handoff-syscall-batch-to-adapter",
    },
    readiness: {
      status: failedChecks.length
        ? "blocked"
        : pendingChecks.length
          ? "pending-acceptance"
          : "ready",
      checks: [
        {
          check: "dispatch-blockers-clear",
          status: blockedBy.length ? "fail" : "pass",
          details: blockedBy,
        },
        {
          check: "provider-capabilities-negotiated",
          status: externalHandoffState.syncMetadata.missingCapabilities.length ? "fail" : "pass",
          details: externalHandoffState.syncMetadata.missingCapabilities,
        },
        {
          check: "external-write-accepted",
          status: acceptanceRequired && !externalWriteAccepted ? "pending" : "pass",
          details: dispatchBatchState.heldExternalWrites,
        },
      ],
      failedChecks,
      pendingChecks,
      nextAction: failedChecks.length
        ? "repair-syscall-dispatch-preview"
        : pendingChecks.length
          ? "collect-operator-approval"
          : "handoff-syscall-batch-to-adapter",
    },
    nextSteps: [
      ...blockedBy.map((blocker) => ({
        action: "repair-syscall-dispatch-preview",
        subject: blocker,
        reason: "Dispatch preview has a blocking syscall or lifecycle condition",
      })),
      ...(pendingChecks.length ? [{
        action: "collect-operator-approval",
        subject: "external-write",
        reason: "Adapter-mediated Mailchimp writes require operator acceptance",
      }] : []),
      ...(!failedChecks.length && !pendingChecks.length ? [{
        action: "handoff-syscall-batch-to-adapter",
        subject: dispatchBatchState.batchId,
        reason: "Selected syscalls are ready for adapter dispatch",
      }] : []),
    ],
  };
}

function normalizeUpstreamMemoryPackage(boundary, options) {
  const source = options.memoryPreviewPackage
    || boundary.memoryPreviewPackage
    || boundary.providerJob?.memoryPreviewPackage
    || boundary.continuationPacket?.memoryPreviewPackage
    || null;
  const workflowSource = options.memoryClientWorkflowHandoffPacket
    || options.memoryWorkflowHandoffPacket
    || boundary.memoryClientWorkflowHandoffPacket
    || boundary.memoryWorkflowHandoffPacket
    || boundary.providerJob?.memoryClientWorkflowHandoffPacket
    || boundary.providerJob?.memoryWorkflowHandoffPacket
    || boundary.continuationPacket?.memoryClientWorkflowHandoffPacket
    || boundary.continuationPacket?.memoryWorkflowHandoffPacket
    || source?.clientWorkflowHandoffPacket
    || source?.runtimeContract?.clientWorkflowHandoffPacket
    || source?.recovery?.clientWorkflowHandoffPacket
    || null;
  const resumeSource = options.memoryOperatorResumePacket
    || boundary.memoryOperatorResumePacket
    || boundary.providerJob?.memoryOperatorResumePacket
    || boundary.continuationPacket?.memoryOperatorResumePacket
    || source?.operatorResumePacket
    || source?.runtimeContract?.operatorResumePacket
    || source?.recovery?.operatorResumePacket
    || null;
  const claimRuntimeReceiptSource = options.memoryClaimRuntimeAdoptionReceipt
    || options.memoryClaimAdoptionReceipt
    || boundary.memoryClaimRuntimeAdoptionReceipt
    || boundary.memoryClaimAdoptionReceipt
    || boundary.providerJob?.memoryClaimRuntimeAdoptionReceipt
    || boundary.continuationPacket?.memoryClaimRuntimeAdoptionReceipt
    || source?.claimRuntimeAdoptionReceipt
    || source?.runtimeContract?.claimRuntimeAdoptionReceipt
    || source?.recovery?.claimRuntimeAdoptionReceipt
    || source?.analyticsExportBundle?.claimRuntimeAdoptionReceipt
    || source?.runtimeContract?.analyticsExportBundle?.claimRuntimeAdoptionReceipt
    || source?.recovery?.analyticsExportBundle?.claimRuntimeAdoptionReceipt
    || null;
  const runtimeDispatchReleaseSource = options.memoryRuntimeDispatchReleaseReceipt
    || options.memoryDispatchReleaseReceipt
    || boundary.memoryRuntimeDispatchReleaseReceipt
    || boundary.providerJob?.memoryRuntimeDispatchReleaseReceipt
    || boundary.continuationPacket?.memoryRuntimeDispatchReleaseReceipt
    || source?.runtimeDispatchReleaseReceipt
    || source?.runtimeContract?.runtimeDispatchReleaseReceipt
    || source?.recovery?.runtimeDispatchReleaseReceipt
    || null;
  const replayStatusSource = options.memoryReplayStatusReceipt
    || boundary.memoryReplayStatusReceipt
    || boundary.providerJob?.memoryReplayStatusReceipt
    || boundary.continuationPacket?.memoryReplayStatusReceipt
    || source?.replayStatusReceipt
    || source?.runtimeContract?.replayStatusReceipt
    || source?.recovery?.replayStatusReceipt
    || null;
  const syscallBoundaryReceiptSource = options.memorySyscallBoundaryReceipt
    || options.memorySyscallBoundary
    || boundary.memorySyscallBoundaryReceipt
    || boundary.providerJob?.memorySyscallBoundaryReceipt
    || boundary.continuationPacket?.memorySyscallBoundaryReceipt
    || source?.syscallBoundaryReceipt
    || source?.runtimeContract?.syscallBoundaryReceipt
    || source?.recovery?.syscallBoundaryReceipt
    || null;
  const workflowPresent = Boolean(workflowSource?.format === "aios.mailchimp.memory.clientWorkflowHandoff.v1"
    || workflowSource?.packetId);
  const workflowReceiptSource = workflowSource?.releaseReceipt || workflowSource?.acceptanceReceipt || {};
  const workflowReceiptBlockedBy = asArray(workflowReceiptSource.blockedBy)
    .map((blocker) => `memory-workflow-receipt:${blocker}`);
  const workflowReceiptPendingBy = asArray(workflowReceiptSource.pendingBy)
    .map((pending) => `memory-workflow-receipt:${pending}`);
  const workflowBlockedBy = [
    ...asArray(workflowSource?.blockedBy).map((blocker) => `memory-workflow:${blocker}`),
    ...workflowReceiptBlockedBy,
  ].sort();
  const workflowPendingBy = [
    ...asArray(workflowSource?.pendingBy).map((pending) => `memory-workflow:${pending}`),
    ...workflowReceiptPendingBy,
  ].sort();
  const workflowReceiptAccepted = !workflowPresent
    || Object.keys(workflowReceiptSource).length === 0
    || (workflowReceiptSource.acceptedForProviderSync === true
      && workflowReceiptSource.releaseReady === true
      && workflowReceiptSource.restartSafe !== false
      && workflowReceiptBlockedBy.length === 0);
  const workflowAcceptedForProviderSync = !workflowPresent
    || (workflowSource.acceptedForProviderSync === true
      && workflowSource.releaseReady !== false
      && workflowSource.restartSafe !== false
      && workflowReceiptAccepted
      && workflowBlockedBy.length === 0);
  const workflowRestartSafe = !workflowPresent
    || (workflowSource.restartSafe !== false && workflowReceiptSource.restartSafe !== false);
  const workflowState = {
    present: workflowPresent,
    packetId: workflowSource?.packetId || null,
    status: workflowSource?.status || (workflowPresent ? "provided" : "not-provided"),
    releaseReady: workflowSource?.releaseReady === true,
    acceptedForRuntime: workflowSource?.acceptedForRuntime !== false,
    acceptedForProviderSync: workflowAcceptedForProviderSync,
    restartSafe: workflowRestartSafe,
    statusChannel: workflowSource?.statusChannel || null,
    blockedBy: workflowBlockedBy,
    pendingBy: workflowPendingBy,
    releaseReceipt: {
      present: Boolean(workflowReceiptSource.receiptId || workflowReceiptSource.packetId),
      receiptId: workflowReceiptSource.receiptId || null,
      status: workflowReceiptSource.status || workflowSource?.status || (workflowPresent ? "provided" : "not-provided"),
      acceptedForRuntime: workflowReceiptSource.acceptedForRuntime !== false,
      acceptedForProviderSync: workflowReceiptAccepted,
      releaseReady: workflowReceiptSource.releaseReady === true,
      restartSafe: workflowReceiptSource.restartSafe !== false,
      stateKey: workflowReceiptSource.stateKey || workflowSource?.stateKey || null,
      continuationToken: workflowReceiptSource.continuationToken || workflowSource?.continuationToken || null,
      tenantAuditId: workflowReceiptSource.tenantAuditId || workflowSource?.tenantAuditId || null,
      blockedBy: workflowReceiptBlockedBy.sort(),
      pendingBy: workflowReceiptPendingBy.sort(),
      gateReceipts: asArray(workflowReceiptSource.gateReceipts).map((gate) => ({
        gate: gate.gate || "unknown",
        packetId: gate.packetId || null,
        status: gate.status || "unknown",
        accepted: gate.accepted === true,
        restartSafe: gate.restartSafe !== false,
        blockedBy: asArray(gate.blockedBy),
        pendingBy: asArray(gate.pendingBy),
        nextAction: gate.nextAction || workflowReceiptSource.nextAction || workflowSource?.nextAction || null,
      })),
      commandReceipt: workflowReceiptSource.commandReceipt
        ? {
          command: workflowReceiptSource.commandReceipt.command || null,
          enabled: workflowReceiptSource.commandReceipt.enabled === true,
          idempotencyKey: workflowReceiptSource.commandReceipt.idempotencyKey || null,
          statusChannel: workflowReceiptSource.commandReceipt.statusChannel || null,
        }
        : null,
      nextAction: workflowReceiptSource.nextAction || workflowSource?.nextAction || "review-memory-client-workflow-handoff",
    },
    commands: asArray(workflowSource?.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: workflowSource?.nextAction || "review-memory-client-workflow-handoff",
  };
  const claimRuntimeReceiptPresent = Boolean(
    claimRuntimeReceiptSource?.format === "aios.mailchimp.memory.claimRuntimeAdoptionReceipt.v1"
      || claimRuntimeReceiptSource?.receiptId,
  );
  const claimRuntimeReceiptBlockedBy = [
    ...asArray(claimRuntimeReceiptSource?.blockedBy).map((blocker) => `memory-claim-runtime:${blocker}`),
    ...(claimRuntimeReceiptSource?.restartSafe === false ? ["memory-claim-runtime:restart-unsafe"] : []),
    ...(claimRuntimeReceiptPresent && claimRuntimeReceiptSource?.acceptedForClaimRuntime === false
      ? ["memory-claim-runtime:not-accepted"]
      : []),
  ].sort();
  const claimRuntimeReceiptPendingBy = [
    ...asArray(claimRuntimeReceiptSource?.pendingBy).map((pending) => `memory-claim-runtime:${pending}`),
    ...(claimRuntimeReceiptPresent
      && claimRuntimeReceiptSource?.acceptedForClaimProviderSync !== true
      && claimRuntimeReceiptBlockedBy.length === 0
      ? ["memory-claim-runtime:awaiting-provider-sync-release"]
      : []),
  ].sort();
  const claimRuntimeReceiptState = {
    present: claimRuntimeReceiptPresent,
    receiptId: claimRuntimeReceiptSource?.receiptId || null,
    sourcePacketId: claimRuntimeReceiptSource?.sourcePacketId || workflowState.packetId,
    status: claimRuntimeReceiptSource?.status || (claimRuntimeReceiptPresent ? "provided" : "not-provided"),
    acceptedForClaimRuntime: !claimRuntimeReceiptPresent
      || (claimRuntimeReceiptSource.acceptedForClaimRuntime === true
        && claimRuntimeReceiptBlockedBy.length === 0),
    acceptedForClaimProviderSync: !claimRuntimeReceiptPresent
      || (claimRuntimeReceiptSource.acceptedForClaimProviderSync === true
        && claimRuntimeReceiptBlockedBy.length === 0
        && claimRuntimeReceiptPendingBy.length === 0),
    acceptedForSyscallDispatch: !claimRuntimeReceiptPresent
      || (claimRuntimeReceiptSource.acceptedForClaimProviderSync === true
        && claimRuntimeReceiptBlockedBy.length === 0
        && claimRuntimeReceiptPendingBy.length === 0),
    restartSafe: !claimRuntimeReceiptPresent || claimRuntimeReceiptSource.restartSafe !== false,
    stateKey: claimRuntimeReceiptSource?.stateKey || workflowState.releaseReceipt.stateKey || null,
    continuationToken: claimRuntimeReceiptSource?.continuationToken
      || workflowState.releaseReceipt.continuationToken
      || null,
    blockedBy: claimRuntimeReceiptBlockedBy,
    pendingBy: claimRuntimeReceiptPendingBy,
    evidenceRows: asArray(claimRuntimeReceiptSource?.evidenceRows).map((row) => ({
      fact: row.fact || row.evidence || "unknown",
      status: row.status || "unknown",
      accepted: row.accepted === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || claimRuntimeReceiptSource?.nextAction || "review-memory-claim-runtime-adoption",
    })),
    commands: asArray(claimRuntimeReceiptSource?.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: claimRuntimeReceiptSource?.nextAction || "review-memory-claim-runtime-adoption",
  };
  const runtimeDispatchReleasePresent = Boolean(
    runtimeDispatchReleaseSource?.format === "aios.mailchimp.memory.runtimeDispatchReleaseReceipt.v1"
      || runtimeDispatchReleaseSource?.receiptId,
  );
  const runtimeDispatchRows = asArray(runtimeDispatchReleaseSource?.receiptRows);
  const runtimeDispatchBlockedBy = [
    ...asArray(runtimeDispatchReleaseSource?.blockedBy)
      .map((blocker) => `memory-runtime-dispatch:${blocker}`),
    ...runtimeDispatchRows
      .filter((row) => row?.blockedBy?.length || row?.restartSafe === false)
      .flatMap((row) => [
        ...asArray(row.blockedBy).map((blocker) => (
          `memory-runtime-dispatch:${row.gate || "gate"}:${blocker}`
        )),
        ...(row.restartSafe === false
          ? [`memory-runtime-dispatch:${row.gate || "gate"}:restart-unsafe`]
          : []),
      ]),
    ...(runtimeDispatchReleaseSource?.restartSafe === false ? ["memory-runtime-dispatch:restart-unsafe"] : []),
    ...(runtimeDispatchReleasePresent && runtimeDispatchReleaseSource?.acceptedForProviderSync === false
      ? ["memory-runtime-dispatch:provider-sync-not-accepted"]
      : []),
    ...(runtimeDispatchReleasePresent && runtimeDispatchReleaseSource?.acceptedForSyscallDispatch === false
      ? ["memory-runtime-dispatch:syscall-dispatch-not-accepted"]
      : []),
  ].sort();
  const runtimeDispatchPendingBy = [
    ...asArray(runtimeDispatchReleaseSource?.pendingBy)
      .map((pending) => `memory-runtime-dispatch:${pending}`),
    ...runtimeDispatchRows
      .filter((row) => row?.pendingBy?.length || row?.acceptedForSyscallDispatch === false)
      .flatMap((row) => [
        ...asArray(row.pendingBy).map((pending) => (
          `memory-runtime-dispatch:${row.gate || "gate"}:${pending}`
        )),
        ...(row.acceptedForSyscallDispatch === false && !row?.blockedBy?.length
          ? [`memory-runtime-dispatch:${row.gate || "gate"}:awaiting-release`]
          : []),
      ]),
  ].sort();
  const runtimeDispatchReleaseState = {
    present: runtimeDispatchReleasePresent,
    receiptId: runtimeDispatchReleaseSource?.receiptId || null,
    status: runtimeDispatchReleaseSource?.status || (runtimeDispatchReleasePresent ? "provided" : "not-provided"),
    releaseReady: !runtimeDispatchReleasePresent || runtimeDispatchReleaseSource.releaseReady === true,
    acceptedForRuntime: !runtimeDispatchReleasePresent
      || (runtimeDispatchReleaseSource.acceptedForRuntime === true && runtimeDispatchBlockedBy.length === 0),
    acceptedForProviderSync: !runtimeDispatchReleasePresent
      || (runtimeDispatchReleaseSource.acceptedForProviderSync === true && runtimeDispatchBlockedBy.length === 0),
    acceptedForSyscallDispatch: !runtimeDispatchReleasePresent
      || (runtimeDispatchReleaseSource.acceptedForSyscallDispatch === true
        && runtimeDispatchBlockedBy.length === 0
        && runtimeDispatchPendingBy.length === 0),
    restartSafe: !runtimeDispatchReleasePresent || runtimeDispatchReleaseSource.restartSafe !== false,
    stateKey: runtimeDispatchReleaseSource?.stateKey || claimRuntimeReceiptState.stateKey || null,
    continuationToken: runtimeDispatchReleaseSource?.continuationToken
      || claimRuntimeReceiptState.continuationToken
      || null,
    operationalTriageId: runtimeDispatchReleaseSource?.operationalTriageId || null,
    blockedBy: runtimeDispatchBlockedBy,
    pendingBy: runtimeDispatchPendingBy,
    receiptRows: runtimeDispatchRows.map((row) => ({
      gate: row.gate || "unknown",
      packetId: row.packetId || null,
      status: row.status || "unknown",
      acceptedForRuntime: row.acceptedForRuntime === true,
      acceptedForProviderSync: row.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: row.acceptedForSyscallDispatch === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || runtimeDispatchReleaseSource?.nextAction || "review-memory-runtime-dispatch-release",
    })),
    commands: asArray(runtimeDispatchReleaseSource?.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: runtimeDispatchReleaseSource?.nextAction || "review-memory-runtime-dispatch-release",
  };
  const replayStatusPresent = Boolean(
    replayStatusSource?.format === "aios.mailchimp.memory.replayStatusReceipt.v1"
      || replayStatusSource?.receiptId,
  );
  const replayStatusBlockedBy = [
    ...asArray(replayStatusSource?.blockedBy).map((blocker) => `memory-replay:${blocker}`),
    ...asArray(replayStatusSource?.replayRows)
      .filter((row) => row?.blockedBy?.length || row?.restartSafe === false)
      .flatMap((row) => [
        ...asArray(row.blockedBy).map((blocker) => `memory-replay:${row.gate || "gate"}:${blocker}`),
        ...(row.restartSafe === false ? [`memory-replay:${row.gate || "gate"}:restart-unsafe`] : []),
      ]),
    ...(replayStatusSource?.restartSafe === false ? ["memory-replay:restart-unsafe"] : []),
    ...(replayStatusPresent && replayStatusSource?.acceptedForProviderReplay === false
      ? ["memory-replay:provider-replay-not-accepted"]
      : []),
  ].sort();
  const replayStatusPendingBy = [
    ...asArray(replayStatusSource?.pendingBy).map((pending) => `memory-replay:${pending}`),
    ...asArray(replayStatusSource?.replayRows)
      .filter((row) => row?.pendingBy?.length || row?.accepted === false)
      .flatMap((row) => [
        ...asArray(row.pendingBy).map((pending) => `memory-replay:${row.gate || "gate"}:${pending}`),
        ...(row.accepted === false && !row?.blockedBy?.length
          ? [`memory-replay:${row.gate || "gate"}:awaiting-acceptance`]
          : []),
      ]),
  ].sort();
  const replayStatusState = {
    present: replayStatusPresent,
    receiptId: replayStatusSource?.receiptId || null,
    status: replayStatusSource?.status || (replayStatusPresent ? "provided" : "not-provided"),
    replayReady: !replayStatusPresent || replayStatusSource.replayReady === true,
    acceptedForRuntimeReplay: !replayStatusPresent
      || (replayStatusSource.acceptedForRuntimeReplay === true && replayStatusBlockedBy.length === 0),
    acceptedForProviderReplay: !replayStatusPresent
      || (replayStatusSource.acceptedForProviderReplay === true
        && replayStatusBlockedBy.length === 0
        && replayStatusPendingBy.length === 0),
    restartSafe: !replayStatusPresent || replayStatusSource.restartSafe !== false,
    stateKey: replayStatusSource?.stateKey || runtimeDispatchReleaseState.stateKey || null,
    continuationToken: replayStatusSource?.continuationToken
      || runtimeDispatchReleaseState.continuationToken
      || null,
    blockedBy: replayStatusBlockedBy,
    pendingBy: replayStatusPendingBy,
    replayRows: asArray(replayStatusSource?.replayRows).map((row) => ({
      gate: row.gate || "unknown",
      status: row.status || "unknown",
      accepted: row.accepted === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || replayStatusSource?.nextAction || "review-memory-replay-status",
    })),
    commands: asArray(replayStatusSource?.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: replayStatusSource?.nextAction || "review-memory-replay-status",
  };
  const controlPlane = options.memoryControlPlane
    || boundary.memoryControlPlane
    || boundary.providerJob?.memoryControlPlane
    || boundary.continuationPacket?.memoryControlPlane
    || source?.controlPlaneState
    || source?.memoryControlPlane
    || {};
  const boundaryLease = options.memoryBoundaryLeasePacket
    || options.memoryBoundaryLease
    || boundary.memoryBoundaryLeasePacket
    || boundary.memoryBoundaryLease
    || boundary.providerJob?.memoryBoundaryLeasePacket
    || boundary.continuationPacket?.memoryBoundaryLeasePacket
    || source?.boundaryLeasePacket
    || source?.runtimeContract?.boundaryLeasePacket
    || source?.recovery?.boundaryLeasePacket
    || {};
  const boundaryLeasePresent = Boolean(
    boundaryLease.format === "aios.mailchimp.memory.boundaryLease.v1"
      || boundaryLease.packetId,
  );
  const boundaryLeaseBlockedBy = [
    ...asArray(boundaryLease.blockedBy).map((blocker) => `memory-boundary:${blocker}`),
    ...asArray(boundaryLease.leaseRows)
      .filter((row) => row?.status === "blocked")
      .flatMap((row) => asArray(row.blockedBy).map((blocker) => `memory-boundary:${row.mount || "mount"}:${blocker}`)),
    ...(boundaryLease.restartSafe === false ? ["memory-boundary:restart-unsafe"] : []),
  ].sort();
  const boundaryLeasePendingBy = [
    ...asArray(boundaryLease.pendingBy).map((pending) => `memory-boundary:${pending}`),
    ...(boundaryLeasePresent && boundaryLease.releaseReady !== true && boundaryLeaseBlockedBy.length === 0
      ? ["memory-boundary:lease-held"]
      : []),
  ].sort();
  const boundaryLeaseAcceptedForProviderSync = !boundaryLeasePresent
    || (boundaryLease.acceptedForProviderSync === true
      && boundaryLease.releaseReady !== false
      && boundaryLease.restartSafe !== false
      && boundaryLeaseBlockedBy.length === 0);
  const boundaryLeaseRestartSafe = !boundaryLeasePresent || boundaryLease.restartSafe !== false;
  const boundaryLeaseState = {
    present: boundaryLeasePresent,
    packetId: boundaryLease.packetId || null,
    status: boundaryLease.status || (boundaryLeasePresent ? "provided" : "not-provided"),
    releaseReady: boundaryLease.releaseReady === true,
    acceptedForRuntime: boundaryLease.acceptedForRuntime !== false,
    acceptedForProviderSync: boundaryLeaseAcceptedForProviderSync,
    restartSafe: boundaryLeaseRestartSafe,
    tenantAuditId: boundaryLease.tenantAuditId || null,
    ttlSeconds: boundaryLease.ttlSeconds ?? null,
    blockedBy: boundaryLeaseBlockedBy,
    pendingBy: boundaryLeasePendingBy,
    commands: asArray(boundaryLease.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    leaseRows: asArray(boundaryLease.leaseRows).map((row) => ({
      mount: row.mount || null,
      status: row.status || "unknown",
      releaseReady: row.releaseReady === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asArray(row.blockedBy),
      nextAction: row.nextAction || boundaryLease.nextAction || "review-memory-boundary-lease",
    })),
    nextAction: boundaryLease.nextAction || "review-memory-boundary-lease",
  };
  const providerServiceSource = options.memoryProviderServiceContract
    || options.memoryProviderHandoffEnvelope
    || boundary.memoryProviderServiceContract
    || boundary.memoryProviderHandoffEnvelope
    || boundary.providerJob?.memoryProviderServiceContract
    || boundary.providerJob?.memoryProviderHandoffEnvelope
    || boundary.continuationPacket?.memoryProviderServiceContract
    || boundary.continuationPacket?.memoryProviderHandoffEnvelope
    || source?.providerServiceContract
    || source?.providerHandoffEnvelope?.providerServiceContract
    || source?.runtimeContract?.providerHandoffEnvelope?.providerServiceContract
    || source?.recovery?.providerHandoffEnvelope?.providerServiceContract
    || {};
  const providerServicePresent = Boolean(
    providerServiceSource.contractId
      || providerServiceSource.format === "aios.mailchimp.memory.providerServiceContract.v1"
      || providerServiceSource.externalHandoffState,
  );
  const providerServiceHandoff = providerServiceSource.externalHandoffState || {};
  const providerServiceRows = asArray(providerServiceSource.serviceBindingRows);
  const providerServiceBlockedBy = [
    ...asArray(providerServiceSource.blockedBy).map((blocker) => `memory-provider-service:${blocker}`),
    ...asArray(providerServiceSource.missingCapabilities)
      .map((capability) => `memory-provider-service:capability:${capability}`),
    ...asArray(providerServiceHandoff.blockedBy).map((blocker) => `memory-provider-service:${blocker}`),
    ...providerServiceRows
      .filter((row) => row?.status === "blocked" || row?.blockedBy?.length)
      .flatMap((row) => asArray(row.blockedBy).map((blocker) => (
        `memory-provider-service:${row.mount || "mount"}:${blocker}`
      ))),
    ...(providerServiceHandoff.restartSafe === false ? ["memory-provider-service:restart-unsafe"] : []),
  ].sort();
  const providerServicePendingBy = [
    ...asArray(providerServiceSource.pendingBy).map((pending) => `memory-provider-service:${pending}`),
    ...asArray(providerServiceHandoff.pendingBy).map((pending) => `memory-provider-service:${pending}`),
    ...(providerServicePresent
      && providerServiceHandoff.acceptedForSyscallDispatch !== true
      && providerServiceBlockedBy.length === 0
      ? ["memory-provider-service:awaiting-dispatch-release"]
      : []),
  ].sort();
  const providerServiceAcceptedForProviderSync = !providerServicePresent
    || (providerServiceHandoff.acceptedForProviderSync === true
      && providerServiceHandoff.restartSafe !== false
      && providerServiceBlockedBy.length === 0);
  const providerServiceAcceptedForSyscallDispatch = !providerServicePresent
    || (providerServiceHandoff.acceptedForSyscallDispatch === true
      && providerServiceAcceptedForProviderSync
      && providerServicePendingBy.length === 0);
  const providerServiceState = {
    present: providerServicePresent,
    contractId: providerServiceSource.contractId || null,
    providerService: providerServiceSource.providerService || "mailchimp-marketing-api",
    status: providerServiceSource.status || (providerServicePresent ? "provided" : "not-provided"),
    statusChannel: providerServiceSource.syncMetadata?.statusChannel || null,
    acceptedForProviderSync: providerServiceAcceptedForProviderSync,
    acceptedForSyscallDispatch: providerServiceAcceptedForSyscallDispatch,
    restartSafe: !providerServicePresent || providerServiceHandoff.restartSafe !== false,
    requestedCapabilities: asArray(providerServiceSource.requestedCapabilities),
    negotiatedCapabilities: asArray(providerServiceSource.negotiatedCapabilities),
    missingCapabilities: asArray(providerServiceSource.missingCapabilities),
    blockedBy: providerServiceBlockedBy,
    pendingBy: providerServicePendingBy,
    serviceBindingRows: providerServiceRows.map((row) => ({
      mount: row.mount || null,
      status: row.status || "unknown",
      selectedForProviderSync: row.selectedForProviderSync === true,
      externalHandoffRequired: row.externalHandoffRequired === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asArray(row.blockedBy),
      nextAction: row.nextAction || providerServiceHandoff.nextAction || "review-memory-provider-service-contract",
    })),
    commands: asArray(providerServiceSource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: providerServiceHandoff.nextAction
      || providerServiceSource.nextAction
      || "review-memory-provider-service-contract",
  };
  const providerAudienceSource = options.memoryProviderAudienceContract
    || boundary.memoryProviderAudienceContract
    || boundary.providerJob?.memoryProviderAudienceContract
    || boundary.continuationPacket?.memoryProviderAudienceContract
    || source?.providerAudienceContract
    || source?.providerHandoffEnvelope?.providerAudienceContract
    || source?.runtimeContract?.providerHandoffEnvelope?.providerAudienceContract
    || source?.recovery?.providerHandoffEnvelope?.providerAudienceContract
    || providerServiceSource.providerAudienceContract
    || {};
  const providerAudiencePresent = Boolean(
    providerAudienceSource.format === "aios.mailchimp.memory.providerAudienceContract.v1"
      || providerAudienceSource.contractId,
  );
  const providerAudienceRows = asArray(providerAudienceSource.bindingRows);
  const providerAudienceBlockedBy = [
    ...asArray(providerAudienceSource.blockedBy).map((blocker) => `memory-provider-audience:${blocker}`),
    ...providerAudienceRows
      .filter((row) => row?.blockedBy?.length || row?.restartSafe === false)
      .flatMap((row) => [
        ...asArray(row.blockedBy).map((blocker) => (
          `memory-provider-audience:${row.mount || "mount"}:${blocker}`
        )),
        ...(row.restartSafe === false
          ? [`memory-provider-audience:${row.mount || "mount"}:restart-unsafe`]
          : []),
      ]),
    ...(providerAudienceSource.restartSafe === false ? ["memory-provider-audience:restart-unsafe"] : []),
    ...(providerAudiencePresent && providerAudienceSource.acceptedForSyscallDispatch === true
      && providerAudienceSource.acceptedForProviderSync === false
      ? ["memory-provider-audience:dispatch-without-provider-sync"]
      : []),
  ].sort();
  const providerAudiencePendingBy = [
    ...asArray(providerAudienceSource.pendingBy).map((pending) => `memory-provider-audience:${pending}`),
    ...providerAudienceRows
      .filter((row) => row?.pendingBy?.length || row?.status === "pending")
      .flatMap((row) => asArray(row.pendingBy).map((pending) => (
        `memory-provider-audience:${row.mount || "mount"}:${pending}`
      ))),
    ...(providerAudiencePresent
      && providerAudienceSource.releaseReady !== true
      && providerAudienceBlockedBy.length === 0
      ? ["memory-provider-audience:awaiting-release"]
      : []),
  ].sort();
  const providerAudienceState = {
    present: providerAudiencePresent,
    contractId: providerAudienceSource.contractId || null,
    providerService: providerAudienceSource.providerService || "mailchimp-marketing-api",
    status: providerAudienceSource.status || (providerAudiencePresent ? "provided" : "not-provided"),
    audienceId: providerAudienceSource.audienceId || null,
    segmentId: providerAudienceSource.segmentId || null,
    tenantId: providerAudienceSource.tenantId || null,
    workspaceId: providerAudienceSource.workspaceId || null,
    releaseReady: !providerAudiencePresent || providerAudienceSource.releaseReady === true,
    acceptedForProviderSync: !providerAudiencePresent
      || (providerAudienceSource.acceptedForProviderSync === true && providerAudienceBlockedBy.length === 0),
    acceptedForSyscallDispatch: !providerAudiencePresent
      || (providerAudienceSource.acceptedForSyscallDispatch === true
        && providerAudienceBlockedBy.length === 0
        && providerAudiencePendingBy.length === 0),
    restartSafe: !providerAudiencePresent || providerAudienceSource.restartSafe !== false,
    statusChannel: providerAudienceSource.statusChannel || null,
    blockedBy: providerAudienceBlockedBy,
    pendingBy: providerAudiencePendingBy,
    bindingRows: providerAudienceRows.map((row) => ({
      mount: row.mount || null,
      status: row.status || "unknown",
      audienceId: row.audienceId || providerAudienceSource.audienceId || null,
      segmentId: row.segmentId || providerAudienceSource.segmentId || null,
      cursorPath: row.cursorPath || null,
      acceptedForProviderSync: row.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: row.acceptedForSyscallDispatch === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asArray(row.blockedBy),
      nextAction: row.nextAction || providerAudienceSource.nextAction || "review-memory-provider-audience-contract",
    })),
    commands: asArray(providerAudienceSource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: providerAudienceSource.nextAction || "review-memory-provider-audience-contract",
  };
  const providerAssertionSource = options.memoryProviderAssertionDigest
    || options.memoryProviderAssertions
    || boundary.memoryProviderAssertionDigest
    || boundary.providerJob?.memoryProviderAssertionDigest
    || boundary.continuationPacket?.memoryProviderAssertionDigest
    || source?.providerAssertionDigest
    || source?.runtimeContract?.providerAssertionDigest
    || source?.recovery?.providerAssertionDigest
    || {};
  const providerAssertionPresent = Boolean(
    providerAssertionSource.format === "aios.mailchimp.memory.providerAssertionDigest.v1"
      || providerAssertionSource.digestId,
  );
  const providerAssertionRows = asArray(providerAssertionSource.assertionRows);
  const providerAssertionBlockedBy = [
    ...asArray(providerAssertionSource.blockedBy).map((blocker) => `memory-provider-assertion:${blocker}`),
    ...providerAssertionRows
      .filter((row) => row?.status === "blocked" || row?.blockedBy?.length)
      .flatMap((row) => asArray(row.blockedBy).map((blocker) => (
        `memory-provider-assertion:${row.mount || "mount"}:${blocker}`
      ))),
    ...(providerAssertionSource.restartSafe === false ? ["memory-provider-assertion:restart-unsafe"] : []),
    ...(providerAssertionPresent
      && providerAssertionSource.acceptedForSyscallDispatch === true
      && providerAssertionSource.acceptedForProviderSync === false
      ? ["memory-provider-assertion:dispatch-without-provider-sync"]
      : []),
  ].sort();
  const providerAssertionPendingBy = [
    ...asArray(providerAssertionSource.pendingBy).map((pending) => `memory-provider-assertion:${pending}`),
    ...providerAssertionRows
      .filter((row) => row?.status === "pending" || row?.pendingBy?.length)
      .flatMap((row) => asArray(row.pendingBy).map((pending) => (
        `memory-provider-assertion:${row.mount || "mount"}:${pending}`
      ))),
    ...(providerAssertionPresent
      && providerAssertionSource.acceptedForSyscallDispatch !== true
      && providerAssertionBlockedBy.length === 0
      ? ["memory-provider-assertion:awaiting-dispatch-release"]
      : []),
  ].sort();
  const providerAssertionState = {
    present: providerAssertionPresent,
    digestId: providerAssertionSource.digestId || null,
    status: providerAssertionSource.status || (providerAssertionPresent ? "provided" : "not-provided"),
    acceptedForProviderSync: !providerAssertionPresent || providerAssertionSource.acceptedForProviderSync === true,
    acceptedForSyscallDispatch: !providerAssertionPresent
      || (providerAssertionSource.acceptedForSyscallDispatch === true
        && providerAssertionBlockedBy.length === 0
        && providerAssertionPendingBy.length === 0),
    restartSafe: !providerAssertionPresent || providerAssertionSource.restartSafe !== false,
    blockedBy: providerAssertionBlockedBy,
    pendingBy: providerAssertionPendingBy,
    counters: providerAssertionSource.counters || {
      mounts: providerAssertionRows.length,
      providerSyncMounts: providerAssertionRows.filter((row) => row?.selectedForProviderSync).length,
      verifiedRows: providerAssertionRows.filter((row) => row?.status === "verified").length,
      blockedRows: providerAssertionRows.filter((row) => row?.status === "blocked").length,
      pendingRows: providerAssertionRows.filter((row) => row?.status === "pending").length,
      missingCapabilities: providerAssertionRows.reduce((total, row) => (
        total + asArray(row?.missingCapabilities).length
      ), 0),
    },
    assertionRows: providerAssertionRows.map((row) => ({
      mount: row.mount || null,
      status: row.status || "unknown",
      selectedForProviderSync: row.selectedForProviderSync === true,
      restartSafe: row.restartSafe !== false,
      requiredCapabilities: asArray(row.requiredCapabilities),
      missingCapabilities: asArray(row.missingCapabilities),
      recoveryCursor: row.recoveryCursor || null,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || providerAssertionSource.nextAction || "review-memory-provider-assertions",
    })),
    commands: asArray(providerAssertionSource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: providerAssertionSource.nextAction || "review-memory-provider-assertions",
  };
  const providerSyncReleaseSource = options.memoryProviderSyncReleaseReceipt
    || options.memoryProviderSyncRelease
    || boundary.memoryProviderSyncReleaseReceipt
    || boundary.providerJob?.memoryProviderSyncReleaseReceipt
    || boundary.continuationPacket?.memoryProviderSyncReleaseReceipt
    || source?.providerSyncReleaseReceipt
    || source?.runtimeContract?.providerSyncReleaseReceipt
    || source?.recovery?.providerSyncReleaseReceipt
    || source?.providerHandoffEnvelope?.providerSyncReleaseReceipt
    || {};
  const providerSyncReleasePresent = Boolean(
    providerSyncReleaseSource.format === "aios.mailchimp.memory.providerSyncReleaseReceipt.v1"
      || providerSyncReleaseSource.receiptId,
  );
  const providerSyncReleaseRows = asArray(providerSyncReleaseSource.receiptRows);
  const providerSyncReleaseBlockedBy = [
    ...asArray(providerSyncReleaseSource.blockedBy)
      .map((blocker) => `memory-provider-sync-release:${blocker}`),
    ...providerSyncReleaseRows
      .filter((row) => row?.blockedBy?.length || row?.restartSafe === false)
      .flatMap((row) => [
        ...asArray(row.blockedBy).map((blocker) => (
          `memory-provider-sync-release:${row.mount || "mount"}:${blocker}`
        )),
        ...(row.restartSafe === false
          ? [`memory-provider-sync-release:${row.mount || "mount"}:restart-unsafe`]
          : []),
      ]),
    ...(providerSyncReleaseSource.restartSafe === false ? ["memory-provider-sync-release:restart-unsafe"] : []),
    ...(providerSyncReleasePresent
      && providerSyncReleaseSource.acceptedForSyscallDispatch === true
      && providerSyncReleaseSource.acceptedForProviderSync === false
      ? ["memory-provider-sync-release:dispatch-without-provider-sync"]
      : []),
  ].sort();
  const providerSyncReleasePendingBy = [
    ...asArray(providerSyncReleaseSource.pendingBy)
      .map((pending) => `memory-provider-sync-release:${pending}`),
    ...providerSyncReleaseRows
      .filter((row) => row?.pendingBy?.length || row?.status === "pending")
      .flatMap((row) => asArray(row.pendingBy).map((pending) => (
        `memory-provider-sync-release:${row.mount || "mount"}:${pending}`
      ))),
    ...(providerSyncReleasePresent
      && providerSyncReleaseSource.releaseReady !== true
      && providerSyncReleaseBlockedBy.length === 0
      ? ["memory-provider-sync-release:awaiting-release"]
      : []),
  ].sort();
  const providerSyncReleaseState = {
    present: providerSyncReleasePresent,
    receiptId: providerSyncReleaseSource.receiptId || null,
    status: providerSyncReleaseSource.status || (providerSyncReleasePresent ? "provided" : "not-provided"),
    releaseReady: !providerSyncReleasePresent || providerSyncReleaseSource.releaseReady === true,
    acceptedForProviderSync: !providerSyncReleasePresent
      || (providerSyncReleaseSource.acceptedForProviderSync === true
        && providerSyncReleaseBlockedBy.length === 0),
    acceptedForSyscallDispatch: !providerSyncReleasePresent
      || (providerSyncReleaseSource.acceptedForSyscallDispatch === true
        && providerSyncReleaseBlockedBy.length === 0
        && providerSyncReleasePendingBy.length === 0),
    restartSafe: !providerSyncReleasePresent || providerSyncReleaseSource.restartSafe !== false,
    retryable: providerSyncReleaseSource.retryable === true,
    nextDelaySeconds: providerSyncReleaseSource.nextDelaySeconds ?? null,
    statusChannel: providerSyncReleaseSource.statusChannel || null,
    blockedBy: providerSyncReleaseBlockedBy,
    pendingBy: providerSyncReleasePendingBy,
    receiptRows: providerSyncReleaseRows.map((row) => ({
      mount: row.mount || null,
      status: row.status || "unknown",
      accepted: row.accepted === true,
      restartSafe: row.restartSafe !== false,
      cursorPath: row.cursorPath || null,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || providerSyncReleaseSource.nextAction || "review-memory-provider-sync-release",
    })),
    commands: asArray(providerSyncReleaseSource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: providerSyncReleaseSource.nextAction || "review-memory-provider-sync-release",
  };
  const audienceWatermarkSource = options.memoryAudienceSyncWatermark
    || options.memoryAudienceWatermark
    || boundary.memoryAudienceSyncWatermark
    || boundary.providerJob?.memoryAudienceSyncWatermark
    || boundary.continuationPacket?.memoryAudienceSyncWatermark
    || source?.audienceSyncWatermark
    || source?.runtimeContract?.audienceSyncWatermark
    || source?.recovery?.audienceSyncWatermark
    || source?.providerHandoffEnvelope?.audienceSyncWatermark
    || {};
  const audienceWatermarkPresent = Boolean(
    audienceWatermarkSource.format === "aios.mailchimp.memory.audienceSyncWatermark.v1"
      || audienceWatermarkSource.watermarkId,
  );
  const audienceWatermarkRows = asArray(audienceWatermarkSource.rowWatermarks);
  const audienceWatermarkBlockedBy = [
    ...asArray(audienceWatermarkSource.blockedBy)
      .map((blocker) => `memory-audience-watermark:${blocker}`),
    ...audienceWatermarkRows
      .filter((row) => row?.blockedBy?.length || row?.restartSafe === false)
      .flatMap((row) => [
        ...asArray(row.blockedBy).map((blocker) => (
          `memory-audience-watermark:${row.mount || "mount"}:${blocker}`
        )),
        ...(row.restartSafe === false
          ? [`memory-audience-watermark:${row.mount || "mount"}:restart-unsafe`]
          : []),
      ]),
    ...(audienceWatermarkSource.restartSafe === false ? ["memory-audience-watermark:restart-unsafe"] : []),
    ...(audienceWatermarkPresent && !audienceWatermarkSource.audienceId
      ? ["memory-audience-watermark:audience-missing"]
      : []),
    ...(audienceWatermarkPresent
      && audienceWatermarkSource.acceptedForSyscallDispatch === true
      && audienceWatermarkSource.acceptedForProviderSync === false
      ? ["memory-audience-watermark:dispatch-without-provider-sync"]
      : []),
  ].sort();
  const audienceWatermarkPendingBy = [
    ...asArray(audienceWatermarkSource.pendingBy)
      .map((pending) => `memory-audience-watermark:${pending}`),
    ...audienceWatermarkRows
      .filter((row) => row?.pendingBy?.length || row?.status === "pending")
      .flatMap((row) => asArray(row.pendingBy).map((pending) => (
        `memory-audience-watermark:${row.mount || "mount"}:${pending}`
      ))),
    ...(audienceWatermarkPresent
      && audienceWatermarkSource.releaseReady !== true
      && audienceWatermarkBlockedBy.length === 0
      ? ["memory-audience-watermark:awaiting-release"]
      : []),
  ].sort();
  const audienceWatermarkState = {
    present: audienceWatermarkPresent,
    watermarkId: audienceWatermarkSource.watermarkId || null,
    status: audienceWatermarkSource.status || (audienceWatermarkPresent ? "provided" : "not-provided"),
    releaseReady: !audienceWatermarkPresent || audienceWatermarkSource.releaseReady === true,
    acceptedForProviderSync: !audienceWatermarkPresent
      || (audienceWatermarkSource.acceptedForProviderSync === true
        && audienceWatermarkBlockedBy.length === 0),
    acceptedForSyscallDispatch: !audienceWatermarkPresent
      || (audienceWatermarkSource.acceptedForSyscallDispatch === true
        && audienceWatermarkBlockedBy.length === 0
        && audienceWatermarkPendingBy.length === 0),
    restartSafe: !audienceWatermarkPresent || audienceWatermarkSource.restartSafe !== false,
    audienceId: audienceWatermarkSource.audienceId || null,
    segmentId: audienceWatermarkSource.segmentId || null,
    statusChannel: audienceWatermarkSource.statusChannel || null,
    cursorPaths: asArray(audienceWatermarkSource.cursorPaths),
    blockedBy: audienceWatermarkBlockedBy,
    pendingBy: audienceWatermarkPendingBy,
    rowWatermarks: audienceWatermarkRows.map((row) => ({
      mount: row.mount || null,
      status: row.status || "unknown",
      releaseReady: row.releaseReady === true,
      restartSafe: row.restartSafe !== false,
      cursorPath: row.cursorPath || null,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || audienceWatermarkSource.nextAction || "review-memory-audience-sync-watermark",
    })),
    commands: asArray(audienceWatermarkSource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: audienceWatermarkSource.nextAction || "review-memory-audience-sync-watermark",
  };
  const audienceContinuitySource = options.memoryAudienceContinuityReceipt
    || options.memoryAudienceContinuity
    || boundary.memoryAudienceContinuityReceipt
    || boundary.providerJob?.memoryAudienceContinuityReceipt
    || boundary.continuationPacket?.memoryAudienceContinuityReceipt
    || source?.audienceContinuityReceipt
    || source?.runtimeContract?.audienceContinuityReceipt
    || source?.recovery?.audienceContinuityReceipt
    || source?.providerHandoffEnvelope?.audienceContinuityReceipt
    || {};
  const audienceContinuityPresent = Boolean(
    audienceContinuitySource.format === "aios.mailchimp.memory.audienceContinuityReceipt.v1"
      || audienceContinuitySource.receiptId,
  );
  const audienceContinuityRows = asArray(audienceContinuitySource.continuityRows);
  const audienceContinuityBlockedBy = [
    ...asArray(audienceContinuitySource.blockedBy)
      .map((blocker) => `memory-audience-continuity:${blocker}`),
    ...audienceContinuityRows
      .filter((row) => row?.blockedBy?.length || row?.restartSafe === false)
      .flatMap((row) => [
        ...asArray(row.blockedBy).map((blocker) => (
          `memory-audience-continuity:${row.mount || "mount"}:${blocker}`
        )),
        ...(row.restartSafe === false
          ? [`memory-audience-continuity:${row.mount || "mount"}:restart-unsafe`]
          : []),
      ]),
    ...(audienceContinuitySource.restartSafe === false ? ["memory-audience-continuity:restart-unsafe"] : []),
    ...(audienceContinuityPresent && !audienceContinuitySource.audienceId
      ? ["memory-audience-continuity:audience-missing"]
      : []),
    ...(audienceContinuityPresent
      && audienceContinuitySource.acceptedForSyscallDispatch === true
      && audienceContinuitySource.acceptedForProviderSync === false
      ? ["memory-audience-continuity:dispatch-without-provider-sync"]
      : []),
  ].sort();
  const audienceContinuityPendingBy = [
    ...asArray(audienceContinuitySource.pendingBy)
      .map((pending) => `memory-audience-continuity:${pending}`),
    ...audienceContinuityRows
      .filter((row) => row?.pendingBy?.length || row?.status === "pending")
      .flatMap((row) => asArray(row.pendingBy).map((pending) => (
        `memory-audience-continuity:${row.mount || "mount"}:${pending}`
      ))),
    ...(audienceContinuityPresent
      && audienceContinuitySource.releaseReady !== true
      && audienceContinuityBlockedBy.length === 0
      ? ["memory-audience-continuity:awaiting-release"]
      : []),
  ].sort();
  const audienceContinuityState = {
    present: audienceContinuityPresent,
    receiptId: audienceContinuitySource.receiptId || null,
    status: audienceContinuitySource.status || (audienceContinuityPresent ? "provided" : "not-provided"),
    releaseReady: !audienceContinuityPresent || audienceContinuitySource.releaseReady === true,
    acceptedForProviderSync: !audienceContinuityPresent
      || (audienceContinuitySource.acceptedForProviderSync === true
        && audienceContinuityBlockedBy.length === 0),
    acceptedForSyscallDispatch: !audienceContinuityPresent
      || (audienceContinuitySource.acceptedForSyscallDispatch === true
        && audienceContinuityBlockedBy.length === 0
        && audienceContinuityPendingBy.length === 0),
    restartSafe: !audienceContinuityPresent || audienceContinuitySource.restartSafe !== false,
    audienceId: audienceContinuitySource.audienceId || audienceWatermarkState.audienceId || null,
    segmentId: audienceContinuitySource.segmentId || audienceWatermarkState.segmentId || null,
    watermarkId: audienceContinuitySource.watermarkId || audienceWatermarkState.watermarkId || null,
    statusChannel: audienceContinuitySource.statusChannel || null,
    cursorPaths: asArray(audienceContinuitySource.cursorPaths),
    blockedBy: audienceContinuityBlockedBy,
    pendingBy: audienceContinuityPendingBy,
    continuityRows: audienceContinuityRows.map((row) => ({
      mount: row.mount || null,
      status: row.status || "unknown",
      accepted: row.accepted === true,
      restartSafe: row.restartSafe !== false,
      cursorPath: row.cursorPath || null,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || audienceContinuitySource.nextAction || "review-memory-audience-continuity",
    })),
    commands: asArray(audienceContinuitySource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: audienceContinuitySource.nextAction || "review-memory-audience-continuity",
  };
  const releaseRiskSource = options.memoryReleaseRiskBudget
    || boundary.memoryReleaseRiskBudget
    || boundary.providerJob?.memoryReleaseRiskBudget
    || boundary.continuationPacket?.memoryReleaseRiskBudget
    || source?.releaseRiskBudget
    || source?.runtimeContract?.releaseRiskBudget
    || source?.recovery?.releaseRiskBudget
    || {};
  const releaseRiskPresent = Boolean(
    releaseRiskSource.format === "aios.mailchimp.memory.releaseRiskBudget.v1"
      || releaseRiskSource.budgetId,
  );
  const releaseRiskRows = asArray(releaseRiskSource.releaseRows);
  const releaseRiskBlockedBy = [
    ...asArray(releaseRiskSource.blockedBy).map((blocker) => `memory-release-risk:${blocker}`),
    ...releaseRiskRows
      .filter((row) => row?.blockedBy?.length)
      .flatMap((row) => asArray(row.blockedBy).map((blocker) => (
        `memory-release-risk:${row.gate || "gate"}:${blocker}`
      ))),
    ...(releaseRiskSource.restartSafe === false ? ["memory-release-risk:restart-unsafe"] : []),
    ...(releaseRiskPresent && releaseRiskSource.acceptedForSyscallDispatch === false
      ? ["memory-release-risk:syscall-dispatch-not-accepted"]
      : []),
  ].sort();
  const releaseRiskPendingBy = [
    ...asArray(releaseRiskSource.pendingBy).map((pending) => `memory-release-risk:${pending}`),
    ...releaseRiskRows
      .filter((row) => row?.pendingBy?.length || row?.retryable === true)
      .flatMap((row) => [
        ...asArray(row.pendingBy).map((pending) => `memory-release-risk:${row.gate || "gate"}:${pending}`),
        ...(row.retryable === true ? [`memory-release-risk:${row.gate || "gate"}:retryable`] : []),
      ]),
  ].sort();
  const releaseRiskState = {
    present: releaseRiskPresent,
    budgetId: releaseRiskSource.budgetId || null,
    status: releaseRiskSource.status || (releaseRiskPresent ? "provided" : "not-provided"),
    releaseReady: !releaseRiskPresent || releaseRiskSource.releaseReady === true,
    acceptedForSyscallDispatch: !releaseRiskPresent
      || (releaseRiskSource.acceptedForSyscallDispatch === true && releaseRiskBlockedBy.length === 0),
    restartSafe: !releaseRiskPresent || releaseRiskSource.restartSafe !== false,
    totalRiskScore: Number(releaseRiskSource.totalRiskScore || 0),
    counters: releaseRiskSource.counters || {
      gates: releaseRiskRows.length,
      blockedGates: releaseRiskRows.filter((row) => row?.blockedBy?.length).length,
      pendingGates: releaseRiskRows.filter((row) => row?.pendingBy?.length).length,
      unsafeGates: releaseRiskRows.filter((row) => row?.restartSafe === false).length,
      retryableGates: releaseRiskRows.filter((row) => row?.retryable === true).length,
    },
    blockedBy: releaseRiskBlockedBy,
    pendingBy: releaseRiskPendingBy,
    releaseRows: releaseRiskRows.map((row) => ({
      gate: row.gate || "unknown",
      packetId: row.packetId || null,
      status: row.status || "unknown",
      accepted: row.accepted === true,
      restartSafe: row.restartSafe !== false,
      retryable: row.retryable === true,
      riskScore: Number(row.riskScore || 0),
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || releaseRiskSource.nextAction || "review-memory-release-risk-budget",
    })),
    commands: asArray(releaseRiskSource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: releaseRiskSource.nextAction || "review-memory-release-risk-budget",
  };
  const operatorReleaseSource = options.memoryOperatorReleasePacket
    || options.memoryOperatorRelease
    || boundary.memoryOperatorReleasePacket
    || boundary.memoryOperatorRelease
    || boundary.providerJob?.memoryOperatorReleasePacket
    || boundary.providerJob?.memoryOperatorRelease
    || boundary.continuationPacket?.memoryOperatorReleasePacket
    || boundary.continuationPacket?.memoryOperatorRelease
    || source?.operatorReleasePacket
    || source?.runtimeContract?.operatorReleasePacket
    || source?.recovery?.operatorReleasePacket
    || {};
  const operatorReleasePresent = Boolean(
    operatorReleaseSource.format === "aios.mailchimp.memory.operatorRelease.v1"
      || operatorReleaseSource.packetId,
  );
  const operatorReleaseRows = asArray(operatorReleaseSource.gateRows);
  const operatorReleaseBlockedBy = [
    ...asArray(operatorReleaseSource.blockedBy).map((blocker) => `memory-operator-release:${blocker}`),
    ...operatorReleaseRows
      .filter((row) => row?.blockedBy?.length)
      .flatMap((row) => asArray(row.blockedBy).map((blocker) => (
        `memory-operator-release:${row.gate || "gate"}:${blocker}`
      ))),
    ...(operatorReleaseSource.restartSafe === false ? ["memory-operator-release:restart-unsafe"] : []),
    ...(operatorReleasePresent && operatorReleaseSource.acceptedForSyscallDispatch === false
      ? ["memory-operator-release:syscall-dispatch-not-accepted"]
      : []),
  ].sort();
  const operatorReleasePendingBy = [
    ...asArray(operatorReleaseSource.pendingBy).map((pending) => `memory-operator-release:${pending}`),
    ...operatorReleaseRows
      .filter((row) => row?.pendingBy?.length)
      .flatMap((row) => asArray(row.pendingBy).map((pending) => (
        `memory-operator-release:${row.gate || "gate"}:${pending}`
      ))),
    ...(operatorReleasePresent
      && operatorReleaseSource.releaseReady !== true
      && operatorReleaseBlockedBy.length === 0
      ? ["memory-operator-release:awaiting-release"]
      : []),
  ].sort();
  const operatorReleaseState = {
    present: operatorReleasePresent,
    packetId: operatorReleaseSource.packetId || null,
    status: operatorReleaseSource.status || (operatorReleasePresent ? "provided" : "not-provided"),
    releaseReady: !operatorReleasePresent || operatorReleaseSource.releaseReady === true,
    acceptedForProviderSync: !operatorReleasePresent
      || (operatorReleaseSource.acceptedForProviderSync === true && operatorReleaseBlockedBy.length === 0),
    acceptedForSyscallDispatch: !operatorReleasePresent
      || (operatorReleaseSource.acceptedForSyscallDispatch === true
        && operatorReleaseBlockedBy.length === 0
        && operatorReleasePendingBy.length === 0),
    restartSafe: !operatorReleasePresent || operatorReleaseSource.restartSafe !== false,
    statusChannel: operatorReleaseSource.statusChannel || null,
    blockedBy: operatorReleaseBlockedBy,
    pendingBy: operatorReleasePendingBy,
    gateRows: operatorReleaseRows.map((row) => ({
      gate: row.gate || "unknown",
      packetId: row.packetId || null,
      status: row.status || "unknown",
      accepted: row.accepted === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || operatorReleaseSource.nextAction || "review-memory-operator-release",
    })),
    commands: asArray(operatorReleaseSource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: operatorReleaseSource.nextAction || "review-memory-operator-release",
  };
  const routeReceiptSource = options.memoryRouteAcceptanceReceipt
    || options.memoryRouteReceipt
    || boundary.memoryRouteAcceptanceReceipt
    || boundary.providerJob?.memoryRouteAcceptanceReceipt
    || boundary.continuationPacket?.memoryRouteAcceptanceReceipt
    || source?.routeAcceptanceReceipt
    || source?.runtimeContract?.routeAcceptanceReceipt
    || source?.recovery?.routeAcceptanceReceipt
    || source?.clientWorkflowHandoffPacket?.routeAcceptanceReceipt
    || source?.providerHandoffEnvelope?.routeAcceptanceReceipt
    || {};
  const routeReceiptPresent = Boolean(
    routeReceiptSource.format === "aios.mailchimp.memory.routeAcceptanceReceipt.v1"
      || routeReceiptSource.receiptId,
  );
  const routeReceiptRows = asArray(routeReceiptSource.receiptRows);
  const routeReceiptBlockedBy = [
    ...asArray(routeReceiptSource.blockedBy).map((blocker) => `memory-route-receipt:${blocker}`),
    ...routeReceiptRows
      .filter((row) => row?.blockedBy?.length || row?.restartSafe === false)
      .flatMap((row) => [
        ...asArray(row.blockedBy).map((blocker) => (
          `memory-route-receipt:${row.gate || "gate"}:${blocker}`
        )),
        ...(row.restartSafe === false ? [`memory-route-receipt:${row.gate || "gate"}:restart-unsafe`] : []),
      ]),
    ...(routeReceiptSource.restartSafe === false ? ["memory-route-receipt:restart-unsafe"] : []),
    ...(routeReceiptPresent
      && routeReceiptSource.acceptedForProviderSync === true
      && routeReceiptSource.acceptedForRuntime === false
      ? ["memory-route-receipt:provider-sync-without-runtime"]
      : []),
    ...(routeReceiptPresent
      && routeReceiptSource.acceptedForSyscallDispatch === true
      && routeReceiptSource.acceptedForProviderSync === false
      ? ["memory-route-receipt:syscall-dispatch-without-provider-sync"]
      : []),
  ].sort();
  const routeReceiptPendingBy = [
    ...asArray(routeReceiptSource.pendingBy).map((pending) => `memory-route-receipt:${pending}`),
    ...routeReceiptRows
      .filter((row) => row?.pendingBy?.length)
      .flatMap((row) => asArray(row.pendingBy).map((pending) => (
        `memory-route-receipt:${row.gate || "gate"}:${pending}`
      ))),
    ...(routeReceiptPresent
      && routeReceiptSource.acceptedForSyscallDispatch !== true
      && routeReceiptBlockedBy.length === 0
      ? ["memory-route-receipt:awaiting-syscall-dispatch-release"]
      : []),
  ].sort();
  const routeReceiptState = {
    present: routeReceiptPresent,
    receiptId: routeReceiptSource.receiptId || null,
    status: routeReceiptSource.status || (routeReceiptPresent ? "provided" : "not-provided"),
    acceptedForRuntime: !routeReceiptPresent
      || (routeReceiptSource.acceptedForRuntime === true && routeReceiptBlockedBy.length === 0),
    acceptedForProviderSync: !routeReceiptPresent
      || (routeReceiptSource.acceptedForProviderSync === true && routeReceiptBlockedBy.length === 0),
    acceptedForSyscallDispatch: !routeReceiptPresent
      || (routeReceiptSource.acceptedForSyscallDispatch === true
        && routeReceiptBlockedBy.length === 0
        && routeReceiptPendingBy.length === 0),
    restartSafe: !routeReceiptPresent || routeReceiptSource.restartSafe !== false,
    statusChannel: routeReceiptSource.statusChannel || null,
    validationSummary: routeReceiptSource.validationSummary || {
      gates: routeReceiptRows.length,
      blockedGates: routeReceiptRows.filter((row) => row?.blockedBy?.length).map((row) => row.gate || "gate"),
      pendingGates: routeReceiptRows.filter((row) => row?.pendingBy?.length).map((row) => row.gate || "gate"),
      restartUnsafeGates: routeReceiptRows.filter((row) => row?.restartSafe === false).map((row) => row.gate || "gate"),
    },
    blockedBy: routeReceiptBlockedBy,
    pendingBy: routeReceiptPendingBy,
    receiptRows: routeReceiptRows.map((row) => ({
      gate: row.gate || "unknown",
      packetId: row.packetId || null,
      status: row.status || "unknown",
      acceptedForRuntime: row.acceptedForRuntime === true,
      acceptedForProviderSync: row.acceptedForProviderSync === true,
      acceptedForSyscallDispatch: row.acceptedForSyscallDispatch === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || routeReceiptSource.nextAction || "review-memory-route-acceptance",
    })),
    commands: asArray(routeReceiptSource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: routeReceiptSource.nextAction || "review-memory-route-acceptance",
  };
  const dispatchLedgerSource = options.memoryDispatchReleaseLedger
    || options.memoryDispatchLedger
    || boundary.memoryDispatchReleaseLedger
    || boundary.providerJob?.memoryDispatchReleaseLedger
    || boundary.continuationPacket?.memoryDispatchReleaseLedger
    || source?.dispatchReleaseLedger
    || source?.runtimeContract?.dispatchReleaseLedger
    || source?.recovery?.dispatchReleaseLedger
    || source?.routeAcceptanceReceipt?.dispatchReleaseLedger
    || {};
  const dispatchLedgerPresent = Boolean(
    dispatchLedgerSource.format === "aios.mailchimp.memory.dispatchReleaseLedger.v1"
      || dispatchLedgerSource.ledgerId,
  );
  const dispatchLedgerSourceRows = asArray(dispatchLedgerSource.sourceRows);
  const dispatchLedgerMountRows = asArray(dispatchLedgerSource.mountRows);
  const dispatchLedgerBlockedBy = [
    ...asArray(dispatchLedgerSource.blockedBy).map((blocker) => `memory-dispatch-ledger:${blocker}`),
    ...dispatchLedgerSourceRows
      .filter((row) => row?.blockedBy?.length || row?.restartSafe === false)
      .flatMap((row) => [
        ...asArray(row.blockedBy).map((blocker) => (
          `memory-dispatch-ledger:${row.source || "source"}:${blocker}`
        )),
        ...(row.restartSafe === false
          ? [`memory-dispatch-ledger:${row.source || "source"}:restart-unsafe`]
          : []),
      ]),
    ...dispatchLedgerMountRows
      .filter((row) => row?.restartSafe === false || row?.acceptedForSyscallDispatch === false)
      .flatMap((row) => [
        ...(row.restartSafe === false
          ? [`memory-dispatch-ledger:${row.mount || "mount"}:restart-unsafe`]
          : []),
        ...(row.acceptedForSyscallDispatch === false
          ? [`memory-dispatch-ledger:${row.mount || "mount"}:not-accepted`]
          : []),
      ]),
    ...(dispatchLedgerSource.restartSafe === false ? ["memory-dispatch-ledger:restart-unsafe"] : []),
    ...(dispatchLedgerPresent
      && dispatchLedgerSource.acceptedForSyscallDispatch === true
      && dispatchLedgerSource.acceptedForProviderSync === false
      ? ["memory-dispatch-ledger:dispatch-without-provider-sync"]
      : []),
  ].sort();
  const dispatchLedgerPendingBy = [
    ...asArray(dispatchLedgerSource.pendingBy).map((pending) => `memory-dispatch-ledger:${pending}`),
    ...dispatchLedgerSourceRows
      .filter((row) => row?.pendingBy?.length)
      .flatMap((row) => asArray(row.pendingBy).map((pending) => (
        `memory-dispatch-ledger:${row.source || "source"}:${pending}`
      ))),
    ...(dispatchLedgerPresent
      && dispatchLedgerSource.acceptedForSyscallDispatch !== true
      && dispatchLedgerBlockedBy.length === 0
      ? ["memory-dispatch-ledger:awaiting-dispatch-release"]
      : []),
  ].sort();
  const dispatchLedgerState = {
    present: dispatchLedgerPresent,
    ledgerId: dispatchLedgerSource.ledgerId || null,
    status: dispatchLedgerSource.status || (dispatchLedgerPresent ? "provided" : "not-provided"),
    acceptedForProviderSync: !dispatchLedgerPresent
      || (dispatchLedgerSource.acceptedForProviderSync === true && dispatchLedgerBlockedBy.length === 0),
    acceptedForSyscallDispatch: !dispatchLedgerPresent
      || (dispatchLedgerSource.acceptedForSyscallDispatch === true
        && dispatchLedgerBlockedBy.length === 0
        && dispatchLedgerPendingBy.length === 0),
    restartSafe: !dispatchLedgerPresent || dispatchLedgerSource.restartSafe !== false,
    statusChannel: dispatchLedgerSource.statusChannel || null,
    stateKey: dispatchLedgerSource.stateKey || dispatchLedgerSource.persistedState?.stateKey || null,
    continuationToken: dispatchLedgerSource.continuationToken || dispatchLedgerSource.persistedState?.continuationToken || null,
    blockedBy: dispatchLedgerBlockedBy,
    pendingBy: dispatchLedgerPendingBy,
    sourceRows: dispatchLedgerSourceRows.map((row) => ({
      source: row.source || "unknown",
      packetId: row.packetId || null,
      status: row.status || "unknown",
      acceptedForSyscallDispatch: row.acceptedForSyscallDispatch === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || dispatchLedgerSource.nextAction || "review-memory-dispatch-release-ledger",
    })),
    mountRows: dispatchLedgerMountRows.map((row) => ({
      mount: row.mount || null,
      status: row.status || "unknown",
      selectedForProviderSync: row.selectedForProviderSync === true,
      acceptedForSyscallDispatch: row.acceptedForSyscallDispatch === true,
      restartSafe: row.restartSafe !== false,
      recoveryCursor: row.recoveryCursor || null,
      nextAction: row.nextAction || dispatchLedgerSource.nextAction || "review-memory-dispatch-release-ledger",
    })),
    commands: asArray(dispatchLedgerSource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: dispatchLedgerSource.nextAction || "review-memory-dispatch-release-ledger",
  };
  const adapterResumeSource = options.memoryAdapterResumeReceipt
    || options.memoryAdapterResume
    || boundary.memoryAdapterResumeReceipt
    || boundary.providerJob?.memoryAdapterResumeReceipt
    || boundary.continuationPacket?.memoryAdapterResumeReceipt
    || source?.adapterResumeReceipt
    || source?.runtimeContract?.adapterResumeReceipt
    || source?.recovery?.adapterResumeReceipt
    || {};
  const adapterResumePresent = Boolean(
    adapterResumeSource.format === "aios.mailchimp.memory.adapterResumeReceipt.v1"
      || adapterResumeSource.receiptId,
  );
  const adapterResumeRows = asArray(adapterResumeSource.statusRows);
  const adapterResumeMountRows = asArray(adapterResumeSource.mountRows);
  const adapterResumeBlockedBy = [
    ...asArray(adapterResumeSource.blockedBy).map((blocker) => `memory-adapter-resume:${blocker}`),
    ...adapterResumeRows
      .filter((row) => row?.blockedBy?.length || row?.restartSafe === false)
      .flatMap((row) => [
        ...asArray(row.blockedBy).map((blocker) => (
          `memory-adapter-resume:${row.source || "source"}:${blocker}`
        )),
        ...(row.restartSafe === false
          ? [`memory-adapter-resume:${row.source || "source"}:restart-unsafe`]
          : []),
      ]),
    ...adapterResumeMountRows
      .filter((row) => row?.restartSafe === false)
      .map((row) => `memory-adapter-resume:${row.mount || "mount"}:restart-unsafe`),
    ...(adapterResumeSource.restartSafe === false ? ["memory-adapter-resume:restart-unsafe"] : []),
    ...(adapterResumePresent
      && adapterResumeSource.acceptedForSyscallDispatch === true
      && adapterResumeSource.acceptedForProviderSync === false
      ? ["memory-adapter-resume:dispatch-without-provider-sync"]
      : []),
  ].sort();
  const adapterResumePendingBy = [
    ...asArray(adapterResumeSource.pendingBy).map((pending) => `memory-adapter-resume:${pending}`),
    ...adapterResumeRows
      .filter((row) => row?.pendingBy?.length)
      .flatMap((row) => asArray(row.pendingBy).map((pending) => (
        `memory-adapter-resume:${row.source || "source"}:${pending}`
      ))),
    ...(adapterResumeSource.retryable === true ? ["memory-adapter-resume:retry-scheduled"] : []),
    ...(adapterResumePresent
      && adapterResumeSource.acceptedForAdapterResume !== true
      && adapterResumeBlockedBy.length === 0
      ? ["memory-adapter-resume:awaiting-release"]
      : []),
  ].sort();
  const adapterResumeState = {
    present: adapterResumePresent,
    receiptId: adapterResumeSource.receiptId || null,
    status: adapterResumeSource.status || (adapterResumePresent ? "provided" : "not-provided"),
    acceptedForAdapterResume: !adapterResumePresent
      || (adapterResumeSource.acceptedForAdapterResume === true
        && adapterResumeBlockedBy.length === 0
        && adapterResumePendingBy.length === 0),
    acceptedForProviderSync: !adapterResumePresent
      || (adapterResumeSource.acceptedForProviderSync === true && adapterResumeBlockedBy.length === 0),
    acceptedForSyscallDispatch: !adapterResumePresent
      || (adapterResumeSource.acceptedForSyscallDispatch === true
        && adapterResumeBlockedBy.length === 0
        && adapterResumePendingBy.length === 0),
    restartSafe: !adapterResumePresent || adapterResumeSource.restartSafe !== false,
    retryable: adapterResumeSource.retryable === true,
    nextDelaySeconds: adapterResumeSource.nextDelaySeconds ?? null,
    statusChannel: adapterResumeSource.statusChannel || null,
    resumeToken: adapterResumeSource.resumeToken || null,
    stateKey: adapterResumeSource.stateKey || null,
    blockedBy: adapterResumeBlockedBy,
    pendingBy: adapterResumePendingBy,
    statusRows: adapterResumeRows.map((row) => ({
      source: row.source || "unknown",
      packetId: row.packetId || null,
      status: row.status || "unknown",
      acceptedForAdapterResume: row.acceptedForAdapterResume === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || adapterResumeSource.nextAction || "review-memory-adapter-resume",
    })),
    mountRows: adapterResumeMountRows.map((row) => ({
      mount: row.mount || null,
      status: row.status || "unknown",
      selectedForProviderSync: row.selectedForProviderSync === true,
      restartSafe: row.restartSafe !== false,
      recoveryCursor: row.recoveryCursor || null,
      nextAction: row.nextAction || adapterResumeSource.nextAction || "review-memory-adapter-resume",
    })),
    commands: asArray(adapterResumeSource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: adapterResumeSource.nextAction || "review-memory-adapter-resume",
  };
  const operatorCommandSource = options.memoryOperatorCommandReceipt
    || options.memoryOperatorCommandRelease
    || boundary.memoryOperatorCommandReceipt
    || boundary.providerJob?.memoryOperatorCommandReceipt
    || boundary.continuationPacket?.memoryOperatorCommandReceipt
    || source?.operatorCommandReceipt
    || source?.runtimeContract?.operatorCommandReceipt
    || source?.recovery?.operatorCommandReceipt
    || {};
  const operatorCommandPresent = Boolean(
    operatorCommandSource.format === "aios.mailchimp.memory.operatorCommandReceipt.v1"
      || operatorCommandSource.receiptId,
  );
  const operatorCommandRows = asArray(operatorCommandSource.commandRows);
  const operatorCommandBlockedBy = [
    ...asArray(operatorCommandSource.blockedBy)
      .map((blocker) => `memory-operator-command:${blocker}`),
    ...operatorCommandRows
      .filter((row) => row?.blockedBy?.length || row?.restartSafe === false)
      .flatMap((row) => [
        ...asArray(row.blockedBy).map((blocker) => (
          `memory-operator-command:${row.command || "command"}:${blocker}`
        )),
        ...(row.restartSafe === false
          ? [`memory-operator-command:${row.command || "command"}:restart-unsafe`]
          : []),
      ]),
    ...(operatorCommandSource.restartSafe === false ? ["memory-operator-command:restart-unsafe"] : []),
    ...(operatorCommandPresent
      && operatorCommandSource.acceptedForSyscallDispatch === true
      && operatorCommandSource.acceptedForProviderSync === false
      ? ["memory-operator-command:dispatch-without-provider-sync"]
      : []),
  ].sort();
  const operatorCommandPendingBy = [
    ...asArray(operatorCommandSource.pendingBy)
      .map((pending) => `memory-operator-command:${pending}`),
    ...operatorCommandRows
      .filter((row) => row?.pendingBy?.length)
      .flatMap((row) => asArray(row.pendingBy).map((pending) => (
        `memory-operator-command:${row.command || "command"}:${pending}`
      ))),
    ...(operatorCommandPresent
      && operatorCommandSource.releaseReady !== true
      && operatorCommandBlockedBy.length === 0
      ? ["memory-operator-command:awaiting-release"]
      : []),
  ].sort();
  const operatorCommandState = {
    present: operatorCommandPresent,
    receiptId: operatorCommandSource.receiptId || null,
    status: operatorCommandSource.status || (operatorCommandPresent ? "provided" : "not-provided"),
    releaseReady: !operatorCommandPresent || operatorCommandSource.releaseReady === true,
    acceptedForProviderSync: !operatorCommandPresent
      || (operatorCommandSource.acceptedForProviderSync === true && operatorCommandBlockedBy.length === 0),
    acceptedForSyscallDispatch: !operatorCommandPresent
      || (operatorCommandSource.acceptedForSyscallDispatch === true
        && operatorCommandBlockedBy.length === 0
        && operatorCommandPendingBy.length === 0),
    restartSafe: !operatorCommandPresent || operatorCommandSource.restartSafe !== false,
    statusChannel: operatorCommandSource.statusChannel || null,
    blockedBy: operatorCommandBlockedBy,
    pendingBy: operatorCommandPendingBy,
    commandSummary: operatorCommandSource.commandSummary || {
      total: operatorCommandRows.length,
      enabled: operatorCommandRows.filter((row) => row?.enabled).length,
      idempotent: operatorCommandRows.filter((row) => row?.idempotencyKey).length,
      delayed: operatorCommandRows.filter((row) => row?.delaySeconds != null).length,
    },
    commandRows: operatorCommandRows.map((row) => ({
      source: row.source || "unknown",
      command: row.command || "memory-command",
      enabled: row.enabled === true,
      idempotencyKey: row.idempotencyKey || null,
      statusChannel: row.statusChannel || operatorCommandSource.statusChannel || null,
      delaySeconds: row.delaySeconds ?? null,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || operatorCommandSource.nextAction || "review-memory-operator-command-receipt",
    })),
    commands: asArray(operatorCommandSource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: operatorCommandSource.nextAction || "review-memory-operator-command-receipt",
  };
  const syscallBoundaryPresent = Boolean(
    syscallBoundaryReceiptSource?.format === "aios.mailchimp.memory.syscallBoundaryReceipt.v1"
      || syscallBoundaryReceiptSource?.receiptId,
  );
  const syscallBoundaryRows = asArray(syscallBoundaryReceiptSource?.receiptRows);
  const syscallBoundaryBlockedBy = [
    ...asArray(syscallBoundaryReceiptSource?.blockedBy)
      .map((blocker) => `memory-syscall-boundary:${blocker}`),
    ...syscallBoundaryRows
      .filter((row) => row?.blockedBy?.length || row?.restartSafe === false)
      .flatMap((row) => [
        ...asArray(row.blockedBy).map((blocker) => (
          `memory-syscall-boundary:${row.mount || "mount"}:${blocker}`
        )),
        ...(row.restartSafe === false
          ? [`memory-syscall-boundary:${row.mount || "mount"}:restart-unsafe`]
          : []),
      ]),
    ...(syscallBoundaryReceiptSource?.restartSafe === false ? ["memory-syscall-boundary:restart-unsafe"] : []),
    ...(syscallBoundaryPresent
      && syscallBoundaryReceiptSource?.acceptedForProviderSync === false
      ? ["memory-syscall-boundary:provider-sync-not-accepted"]
      : []),
    ...(syscallBoundaryPresent
      && syscallBoundaryReceiptSource?.acceptedForSyscallDispatch === true
      && syscallBoundaryReceiptSource?.acceptedForProviderSync === false
      ? ["memory-syscall-boundary:dispatch-without-provider-sync"]
      : []),
  ].sort();
  const syscallBoundaryPendingBy = [
    ...asArray(syscallBoundaryReceiptSource?.pendingBy)
      .map((pending) => `memory-syscall-boundary:${pending}`),
    ...syscallBoundaryRows
      .filter((row) => row?.pendingBy?.length || row?.acceptedForSyscallDispatch === false)
      .flatMap((row) => [
        ...asArray(row.pendingBy).map((pending) => (
          `memory-syscall-boundary:${row.mount || "mount"}:${pending}`
        )),
        ...(row.acceptedForSyscallDispatch === false && !row?.blockedBy?.length
          ? [`memory-syscall-boundary:${row.mount || "mount"}:awaiting-dispatch-release`]
          : []),
      ]),
    ...(syscallBoundaryPresent
      && syscallBoundaryReceiptSource?.releaseReady !== true
      && syscallBoundaryBlockedBy.length === 0
      ? ["memory-syscall-boundary:awaiting-release"]
      : []),
  ].sort();
  const syscallBoundaryState = {
    present: syscallBoundaryPresent,
    receiptId: syscallBoundaryReceiptSource?.receiptId || null,
    status: syscallBoundaryReceiptSource?.status || (syscallBoundaryPresent ? "provided" : "not-provided"),
    releaseReady: !syscallBoundaryPresent || syscallBoundaryReceiptSource.releaseReady === true,
    acceptedForProviderSync: !syscallBoundaryPresent
      || (syscallBoundaryReceiptSource.acceptedForProviderSync === true
        && syscallBoundaryBlockedBy.length === 0),
    acceptedForSyscallDispatch: !syscallBoundaryPresent
      || (syscallBoundaryReceiptSource.acceptedForSyscallDispatch === true
        && syscallBoundaryBlockedBy.length === 0
        && syscallBoundaryPendingBy.length === 0),
    restartSafe: !syscallBoundaryPresent || syscallBoundaryReceiptSource.restartSafe !== false,
    tenantAuditId: syscallBoundaryReceiptSource?.tenantAuditId || null,
    boundaryLeasePacketId: syscallBoundaryReceiptSource?.boundaryLeasePacketId || null,
    providerSyncReleaseReceiptId: syscallBoundaryReceiptSource?.providerSyncReleaseReceiptId || null,
    runtimeDispatchReleaseReceiptId: syscallBoundaryReceiptSource?.runtimeDispatchReleaseReceiptId || null,
    blockedBy: syscallBoundaryBlockedBy,
    pendingBy: syscallBoundaryPendingBy,
    receiptRows: syscallBoundaryRows.map((row) => ({
      mount: row.mount || null,
      status: row.status || "unknown",
      providerSyncRequested: row.providerSyncRequested === true,
      acceptedForProviderSync: row.acceptedForProviderSync !== false,
      acceptedForSyscallDispatch: row.acceptedForSyscallDispatch === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || syscallBoundaryReceiptSource?.nextAction || "review-memory-syscall-boundary",
    })),
    commands: asArray(syscallBoundaryReceiptSource?.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: syscallBoundaryReceiptSource?.nextAction || "review-memory-syscall-boundary",
  };
  if (!source) {
    const resumePresent = Boolean(resumeSource?.format === "aios.mailchimp.memory.operatorResume.v1"
      || resumeSource?.packetId);
    const resumeBlockedBy = asArray(resumeSource?.blockedBy).map((blocker) => `memory-resume:${blocker}`).sort();
    const resumePendingBy = asArray(resumeSource?.pendingBy).map((pending) => `memory-resume:${pending}`).sort();
    return {
      present: false,
      packageId: null,
      previewId: null,
      readinessStatus: "not-provided",
      healthStatus: "not-provided",
      healthId: null,
      healthStatusChannel: null,
      degradedMode: false,
      retryableHealth: false,
      nextHealthRetrySeconds: null,
      healthIncidentSummary: {
        total: 0,
        errors: 0,
        warnings: 0,
        retryable: 0,
        codes: [],
      },
      healthCommands: [],
      healthActionableErrors: [],
      operatorResume: {
        present: resumePresent,
        packetId: resumeSource?.packetId || null,
        status: resumeSource?.status || (resumePresent ? "provided" : "not-provided"),
        releaseReady: resumeSource?.releaseReady === true,
        acceptedForProviderSync: resumeSource?.acceptedForProviderSync === true,
        restartSafe: resumeSource?.restartSafe !== false,
        statusChannel: resumeSource?.statusChannel || null,
        blockedBy: resumeBlockedBy,
        pendingBy: resumePendingBy,
        commands: asArray(resumeSource?.commands).map((command) => ({
          command: command.command,
          enabled: command.enabled === true,
          idempotencyKey: command.idempotencyKey || null,
        })),
        nextAction: resumeSource?.nextAction || "continue-syscall-preview",
      },
      controlPlane: {
        present: false,
        controlPlaneId: null,
        status: "not-provided",
        statusChannel: null,
        acceptedForProviderSync: true,
        restartSafe: true,
        blockedBy: [],
        pendingBy: [],
        commands: [],
        enabledCommands: [],
        nextAction: "continue-syscall-preview",
      },
      syscallDispatchGate: {
        present: false,
        gateId: null,
        status: "not-provided",
        acceptedForSyscallDispatch: true,
        restartSafe: true,
        retryable: false,
        nextDelaySeconds: null,
        statusChannel: null,
        blockedBy: [],
        pendingBy: [],
        gateRows: [],
        actionableErrors: [],
        commands: [],
        nextAction: "continue-syscall-preview",
      },
      boundaryLease: boundaryLeaseState,
      providerService: providerServiceState,
      providerAudienceContract: providerAudienceState,
      providerAssertionDigest: providerAssertionState,
      providerSyncReleaseReceipt: providerSyncReleaseState,
      audienceSyncWatermark: audienceWatermarkState,
      audienceContinuityReceipt: audienceContinuityState,
      releaseRiskBudget: releaseRiskState,
      operatorRelease: operatorReleaseState,
      routeAcceptanceReceipt: routeReceiptState,
      dispatchReleaseLedger: dispatchLedgerState,
      adapterResumeReceipt: adapterResumeState,
      claimRuntimeAdoptionReceipt: claimRuntimeReceiptState,
      runtimeDispatchReleaseReceipt: runtimeDispatchReleaseState,
      replayStatusReceipt: replayStatusState,
      operatorCommandReceipt: operatorCommandState,
      syscallBoundaryReceipt: syscallBoundaryState,
      clientWorkflowHandoff: workflowState,
      acceptedForRuntime: workflowState.acceptedForRuntime !== false && workflowBlockedBy.length === 0,
      acceptedForProviderSync: (resumePresent
        ? resumeSource?.acceptedForProviderSync === true && resumeSource?.restartSafe !== false && resumeBlockedBy.length === 0
        : true)
        && workflowAcceptedForProviderSync
        && boundaryLeaseAcceptedForProviderSync
        && providerServiceAcceptedForProviderSync
        && providerAudienceState.acceptedForProviderSync !== false
        && providerAudienceState.acceptedForSyscallDispatch !== false
        && providerAudienceState.restartSafe !== false
        && providerAssertionState.acceptedForProviderSync !== false
        && providerSyncReleaseState.acceptedForProviderSync !== false
        && providerSyncReleaseState.acceptedForSyscallDispatch !== false
        && providerSyncReleaseState.restartSafe !== false
        && audienceWatermarkState.acceptedForProviderSync !== false
        && audienceWatermarkState.acceptedForSyscallDispatch !== false
        && audienceWatermarkState.restartSafe !== false
        && audienceContinuityState.acceptedForProviderSync !== false
        && audienceContinuityState.acceptedForSyscallDispatch !== false
        && audienceContinuityState.restartSafe !== false
        && releaseRiskState.acceptedForSyscallDispatch !== false
        && operatorReleaseState.acceptedForProviderSync !== false
        && operatorReleaseState.acceptedForSyscallDispatch !== false
        && operatorReleaseState.restartSafe !== false
        && routeReceiptState.acceptedForProviderSync !== false
        && routeReceiptState.acceptedForSyscallDispatch !== false
        && routeReceiptState.restartSafe !== false
        && dispatchLedgerState.acceptedForProviderSync !== false
        && dispatchLedgerState.acceptedForSyscallDispatch !== false
        && dispatchLedgerState.restartSafe !== false
        && adapterResumeState.acceptedForProviderSync !== false
        && adapterResumeState.acceptedForSyscallDispatch !== false
        && adapterResumeState.restartSafe !== false
        && runtimeDispatchReleaseState.acceptedForProviderSync !== false
        && runtimeDispatchReleaseState.acceptedForSyscallDispatch !== false
        && runtimeDispatchReleaseState.restartSafe !== false
        && operatorCommandState.acceptedForProviderSync !== false
        && operatorCommandState.acceptedForSyscallDispatch !== false
        && operatorCommandState.restartSafe !== false
        && syscallBoundaryState.acceptedForProviderSync !== false
        && syscallBoundaryState.acceptedForSyscallDispatch !== false
        && syscallBoundaryState.restartSafe !== false,
      blockedBy: [
        ...resumeBlockedBy,
        ...workflowBlockedBy,
        ...boundaryLeaseBlockedBy,
        ...providerServiceBlockedBy,
        ...providerAudienceBlockedBy,
        ...providerAssertionBlockedBy,
        ...providerSyncReleaseBlockedBy,
        ...audienceWatermarkBlockedBy,
        ...audienceContinuityBlockedBy,
        ...releaseRiskBlockedBy,
        ...operatorReleaseBlockedBy,
        ...routeReceiptBlockedBy,
        ...dispatchLedgerBlockedBy,
        ...adapterResumeBlockedBy,
        ...runtimeDispatchBlockedBy,
        ...operatorCommandBlockedBy,
        ...syscallBoundaryBlockedBy,
      ].sort(),
      pendingChecks: [
        ...resumePendingBy,
        ...workflowPendingBy,
        ...boundaryLeasePendingBy,
        ...providerServicePendingBy,
        ...providerAudiencePendingBy,
        ...providerAssertionPendingBy,
        ...providerSyncReleasePendingBy,
        ...audienceWatermarkPendingBy,
        ...audienceContinuityPendingBy,
        ...releaseRiskPendingBy,
        ...operatorReleasePendingBy,
        ...routeReceiptPendingBy,
        ...dispatchLedgerPendingBy,
        ...adapterResumePendingBy,
        ...runtimeDispatchPendingBy,
        ...operatorCommandPendingBy,
        ...syscallBoundaryPendingBy,
      ].sort(),
      nextAction: resumeBlockedBy.length
        ? resumeSource?.nextAction || "repair-memory-operator-resume"
        : workflowBlockedBy.length
          ? workflowState.nextAction
        : boundaryLeaseBlockedBy.length
          ? boundaryLeaseState.nextAction
        : providerServiceBlockedBy.length
          ? providerServiceState.nextAction
        : providerAudienceBlockedBy.length
          ? providerAudienceState.nextAction
        : providerAssertionBlockedBy.length
          ? providerAssertionState.nextAction
        : providerSyncReleaseBlockedBy.length
          ? providerSyncReleaseState.nextAction
        : audienceWatermarkBlockedBy.length
          ? audienceWatermarkState.nextAction
        : audienceContinuityBlockedBy.length
          ? audienceContinuityState.nextAction
        : releaseRiskBlockedBy.length
          ? releaseRiskState.nextAction
        : operatorReleaseBlockedBy.length
          ? operatorReleaseState.nextAction
        : routeReceiptBlockedBy.length
          ? routeReceiptState.nextAction
        : dispatchLedgerBlockedBy.length
          ? dispatchLedgerState.nextAction
        : adapterResumeBlockedBy.length
          ? adapterResumeState.nextAction
        : runtimeDispatchBlockedBy.length
          ? runtimeDispatchReleaseState.nextAction
        : operatorCommandBlockedBy.length
          ? operatorCommandState.nextAction
        : syscallBoundaryBlockedBy.length
          ? syscallBoundaryState.nextAction
        : resumePendingBy.length
          ? resumeSource?.nextAction || "wait-for-memory-operator-resume"
          : workflowPendingBy.length
            ? workflowState.nextAction
          : boundaryLeasePendingBy.length
            ? boundaryLeaseState.nextAction
            : providerServicePendingBy.length
              ? providerServiceState.nextAction
            : providerAudiencePendingBy.length
              ? providerAudienceState.nextAction
            : providerAssertionPendingBy.length
              ? providerAssertionState.nextAction
            : providerSyncReleasePendingBy.length
              ? providerSyncReleaseState.nextAction
            : audienceWatermarkPendingBy.length
              ? audienceWatermarkState.nextAction
            : audienceContinuityPendingBy.length
              ? audienceContinuityState.nextAction
            : releaseRiskPendingBy.length
              ? releaseRiskState.nextAction
            : operatorReleasePendingBy.length
              ? operatorReleaseState.nextAction
        : routeReceiptPendingBy.length
          ? routeReceiptState.nextAction
        : dispatchLedgerPendingBy.length
          ? dispatchLedgerState.nextAction
        : adapterResumePendingBy.length
          ? adapterResumeState.nextAction
        : runtimeDispatchPendingBy.length
          ? runtimeDispatchReleaseState.nextAction
        : operatorCommandPendingBy.length
          ? operatorCommandState.nextAction
        : syscallBoundaryPendingBy.length
          ? syscallBoundaryState.nextAction
          : "continue-syscall-preview",
    };
  }
  const readiness = source.readiness || source.readinessSummary || {};
  const acceptance = source.acceptance || source.acceptanceState || {};
  const preview = source.preview || source.previewState || {};
  const health = source.operationalHealthState
    || source.operationalHealth
    || source.recovery?.operationalHealth
    || source.health
    || {};
  const control = controlPlane || {};
  const syscallGate = source.syscallDispatchGate
    || source.runtimeContract?.syscallDispatchGate
    || source.recovery?.syscallDispatchGate
    || source.providerHandoffEnvelope?.syscallDispatchGate
    || {};
  const controlPresent = Boolean(control.controlPlaneId || control.format === "aios.mailchimp.memory.controlPlane.v1");
  const syscallGatePresent = Boolean(
    syscallGate.format === "aios.mailchimp.memory.syscallDispatchGate.v1"
      || syscallGate.gateId,
  );
  const controlBlockedBy = asArray(control.blockedBy).map((blocker) => `memory-control:${blocker}`).sort();
  const controlPendingBy = asArray(control.pendingBy).map((pending) => `memory-control:${pending}`).sort();
  const syscallGateBlockedBy = [
    ...asArray(syscallGate.blockedBy).map((blocker) => `memory-syscall-gate:${blocker}`),
    ...asArray(syscallGate.gateRows)
      .filter((row) => row?.blockedBy?.length)
      .flatMap((row) => asArray(row.blockedBy).map((blocker) => (
        `memory-syscall-gate:${row.gate || "gate"}:${blocker}`
      ))),
    ...(syscallGate.restartSafe === false ? ["memory-syscall-gate:restart-unsafe"] : []),
  ].sort();
  const syscallGatePendingBy = [
    ...asArray(syscallGate.pendingBy).map((pending) => `memory-syscall-gate:${pending}`),
    ...(syscallGate.retryable === true ? ["memory-syscall-gate:retry-scheduled"] : []),
  ].sort();
  const resumePresent = Boolean(resumeSource?.format === "aios.mailchimp.memory.operatorResume.v1"
    || resumeSource?.packetId);
  const resumeBlockedBy = asArray(resumeSource?.blockedBy).map((blocker) => `memory-resume:${blocker}`).sort();
  const resumePendingBy = asArray(resumeSource?.pendingBy).map((pending) => `memory-resume:${pending}`).sort();
  const resumeAcceptedForProviderSync = !resumePresent
    || (resumeSource.acceptedForProviderSync === true
      && resumeSource.releaseReady !== false
      && resumeSource.restartSafe !== false
      && resumeBlockedBy.length === 0);
  const resumeRestartSafe = !resumePresent || resumeSource.restartSafe !== false;
  const controlAcceptedForProviderSync = !controlPresent
    || control.persistedState?.acceptedForProviderSync === true
    || control.status === "handoff-ready"
    || control.enabledCommands?.includes?.("handoff-memory-control-plane") === true;
  const controlRestartSafe = !controlPresent
    || (control.persistedState?.restartSafe !== false && control.restartSafe !== false);
  const blockedBy = [
    ...asArray(acceptance.blockedBy),
    ...asArray(readiness.failedChecks).map((check) => `memory-check:${check}`),
    ...asArray(health.incidents)
      .filter((incident) => incident?.severity === "error")
      .map((incident) => `memory-health:${incident.code || incident.incidentId || "error"}`),
    ...controlBlockedBy,
    ...syscallGateBlockedBy,
    ...resumeBlockedBy,
    ...workflowBlockedBy,
    ...boundaryLeaseBlockedBy,
    ...providerServiceBlockedBy,
    ...providerAudienceBlockedBy,
    ...providerAssertionBlockedBy,
    ...providerSyncReleaseBlockedBy,
    ...audienceContinuityBlockedBy,
    ...releaseRiskBlockedBy,
    ...routeReceiptBlockedBy,
    ...adapterResumeBlockedBy,
    ...runtimeDispatchBlockedBy,
    ...claimRuntimeReceiptBlockedBy,
    ...syscallBoundaryBlockedBy,
  ].sort();
  const pendingChecks = [
    ...asArray(readiness.pendingChecks),
    ...asArray(health.incidents)
      .filter((incident) => incident?.severity === "warning")
      .map((incident) => `memory-health:${incident.code || incident.incidentId || "warning"}`),
    ...controlPendingBy,
    ...syscallGatePendingBy,
    ...resumePendingBy,
    ...workflowPendingBy,
    ...boundaryLeasePendingBy,
    ...providerServicePendingBy,
    ...providerAudiencePendingBy,
    ...providerAssertionPendingBy,
    ...providerSyncReleasePendingBy,
    ...audienceContinuityPendingBy,
    ...releaseRiskPendingBy,
    ...routeReceiptPendingBy,
    ...adapterResumePendingBy,
    ...runtimeDispatchPendingBy,
    ...claimRuntimeReceiptPendingBy,
    ...syscallBoundaryPendingBy,
  ].sort();
  return {
    present: true,
    packageId: source.packageId || source.id || null,
    previewId: preview.previewId || source.previewId || null,
    readinessStatus: readiness.status || source.status || "unknown",
    healthStatus: health.status || "not-provided",
    healthId: health.healthId || null,
    healthStatusChannel: health.statusChannel || null,
    degradedMode: health.degradedMode === true,
    retryableHealth: health.retryable === true,
    nextHealthRetrySeconds: health.nextDelaySeconds ?? health.retryPolicy?.nextDelaySeconds ?? null,
    healthIncidentSummary: health.incidentSummary || {
      total: asArray(health.incidents).length,
      errors: asArray(health.incidents).filter((incident) => incident?.severity === "error").length,
      warnings: asArray(health.incidents).filter((incident) => incident?.severity === "warning").length,
      retryable: asArray(health.incidents).filter((incident) => incident?.retryable).length,
      codes: [...new Set(asArray(health.incidents).map((incident) => incident?.code).filter(Boolean))].sort(),
    },
    healthCommands: asArray(health.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    healthActionableErrors: asArray(health.actionableErrors).map((error) => ({
      code: error.code,
      action: error.action,
      mount: error.mount || null,
      retryable: error.retryable === true,
    })),
    operatorResume: {
      present: resumePresent,
      packetId: resumeSource?.packetId || null,
      status: resumeSource?.status || "not-provided",
      releaseReady: resumeSource?.releaseReady === true,
      acceptedForProviderSync: resumeAcceptedForProviderSync,
      restartSafe: resumeRestartSafe,
      statusChannel: resumeSource?.statusChannel || null,
      blockedBy: resumeBlockedBy,
      pendingBy: resumePendingBy,
      commands: asArray(resumeSource?.commands).map((command) => ({
        command: command.command,
        enabled: command.enabled === true,
        idempotencyKey: command.idempotencyKey || null,
      })),
      nextAction: resumeSource?.nextAction || "review-memory-operator-resume",
    },
    controlPlane: {
      present: controlPresent,
      controlPlaneId: control.controlPlaneId || null,
      status: control.status || "not-provided",
      statusChannel: control.statusChannel || null,
      acceptedForProviderSync: controlAcceptedForProviderSync,
      restartSafe: controlRestartSafe,
      blockedBy: controlBlockedBy,
      pendingBy: controlPendingBy,
      commands: asArray(control.commands).map((command) => ({
        command: command.command,
        enabled: command.enabled === true,
        delaySeconds: command.delaySeconds ?? null,
        idempotencyKey: command.idempotencyKey || null,
      })),
      enabledCommands: asArray(control.enabledCommands),
      nextAction: control.nextAction || "review-memory-control-plane",
    },
    syscallDispatchGate: {
      present: syscallGatePresent,
      gateId: syscallGate.gateId || null,
      status: syscallGate.status || "not-provided",
      acceptedForSyscallDispatch: !syscallGatePresent
        || (syscallGate.acceptedForSyscallDispatch === true && syscallGateBlockedBy.length === 0),
      restartSafe: !syscallGatePresent || syscallGate.restartSafe !== false,
      retryable: syscallGate.retryable === true,
      nextDelaySeconds: syscallGate.nextDelaySeconds ?? null,
      statusChannel: syscallGate.statusChannel || null,
      blockedBy: syscallGateBlockedBy,
      pendingBy: syscallGatePendingBy,
      gateRows: asArray(syscallGate.gateRows).map((row) => ({
        gate: row.gate || "unknown",
        status: row.status || "unknown",
        accepted: row.accepted === true,
        restartSafe: row.restartSafe !== false,
        packetId: row.packetId || null,
        blockedBy: asArray(row.blockedBy),
        pendingBy: asArray(row.pendingBy),
        nextAction: row.nextAction || syscallGate.nextAction || "review-memory-syscall-dispatch-gate",
      })),
      actionableErrors: asArray(syscallGate.actionableErrors).map((error) => ({
        code: error.code || "memory.syscall-gate.error",
        action: error.action || syscallGate.nextAction || "review-memory-syscall-dispatch-gate",
        retryable: error.retryable === true,
        source: error.source || "memory-syscall-gate",
        reason: error.reason || null,
      })),
      commands: asArray(syscallGate.commands).map((command) => ({
        command: command.command,
        enabled: command.enabled === true,
        delaySeconds: command.delaySeconds ?? null,
        idempotencyKey: command.idempotencyKey || null,
      })),
      nextAction: syscallGate.nextAction || "review-memory-syscall-dispatch-gate",
    },
    providerService: providerServiceState,
    providerAudienceContract: providerAudienceState,
    providerAssertionDigest: providerAssertionState,
    providerSyncReleaseReceipt: providerSyncReleaseState,
    audienceSyncWatermark: audienceWatermarkState,
    audienceContinuityReceipt: audienceContinuityState,
    releaseRiskBudget: releaseRiskState,
    operatorRelease: operatorReleaseState,
    routeAcceptanceReceipt: routeReceiptState,
    dispatchReleaseLedger: dispatchLedgerState,
    adapterResumeReceipt: adapterResumeState,
    runtimeDispatchReleaseReceipt: runtimeDispatchReleaseState,
    replayStatusReceipt: replayStatusState,
    claimRuntimeAdoptionReceipt: claimRuntimeReceiptState,
    operatorCommandReceipt: operatorCommandState,
    syscallBoundaryReceipt: syscallBoundaryState,
    boundaryLease: boundaryLeaseState,
    clientWorkflowHandoff: workflowState,
    acceptedForRuntime: acceptance.acceptedForRuntime !== false && readiness.readyForRuntime !== false,
    acceptedForProviderSync: acceptance.acceptedForProviderSync !== false
      && readiness.readyForProviderSync !== false
      && controlAcceptedForProviderSync !== false
      && controlRestartSafe !== false
      && (!syscallGatePresent || syscallGate.acceptedForSyscallDispatch === true)
      && (!syscallGatePresent || syscallGate.restartSafe !== false)
      && workflowAcceptedForProviderSync !== false
      && workflowRestartSafe !== false
      && boundaryLeaseAcceptedForProviderSync !== false
      && boundaryLeaseRestartSafe !== false
      && providerServiceAcceptedForProviderSync !== false
      && providerServiceAcceptedForSyscallDispatch !== false
      && providerAudienceState.acceptedForProviderSync !== false
      && providerAudienceState.acceptedForSyscallDispatch !== false
      && providerAudienceState.restartSafe !== false
      && providerAssertionState.acceptedForProviderSync !== false
      && providerAssertionState.acceptedForSyscallDispatch !== false
      && providerAssertionState.restartSafe !== false
      && providerSyncReleaseState.acceptedForProviderSync !== false
      && providerSyncReleaseState.acceptedForSyscallDispatch !== false
      && providerSyncReleaseState.restartSafe !== false
      && audienceWatermarkState.acceptedForProviderSync !== false
      && audienceWatermarkState.acceptedForSyscallDispatch !== false
      && audienceWatermarkState.restartSafe !== false
      && audienceContinuityState.acceptedForProviderSync !== false
      && audienceContinuityState.acceptedForSyscallDispatch !== false
      && audienceContinuityState.restartSafe !== false
      && releaseRiskState.acceptedForSyscallDispatch !== false
      && releaseRiskState.restartSafe !== false
      && operatorReleaseState.acceptedForProviderSync !== false
      && operatorReleaseState.acceptedForSyscallDispatch !== false
      && operatorReleaseState.restartSafe !== false
      && resumeAcceptedForProviderSync !== false
      && resumeRestartSafe !== false
      && routeReceiptState.acceptedForProviderSync !== false
      && routeReceiptState.acceptedForSyscallDispatch !== false
      && routeReceiptState.restartSafe !== false
      && dispatchLedgerState.acceptedForProviderSync !== false
      && dispatchLedgerState.acceptedForSyscallDispatch !== false
      && dispatchLedgerState.restartSafe !== false
      && adapterResumeState.acceptedForProviderSync !== false
      && adapterResumeState.acceptedForSyscallDispatch !== false
      && adapterResumeState.restartSafe !== false
        && runtimeDispatchReleaseState.acceptedForProviderSync !== false
        && runtimeDispatchReleaseState.acceptedForSyscallDispatch !== false
        && runtimeDispatchReleaseState.restartSafe !== false
        && replayStatusState.acceptedForProviderReplay !== false
        && replayStatusState.restartSafe !== false
        && claimRuntimeReceiptState.acceptedForClaimProviderSync !== false
      && claimRuntimeReceiptState.acceptedForSyscallDispatch !== false
      && claimRuntimeReceiptState.restartSafe !== false
      && operatorCommandState.acceptedForProviderSync !== false
      && operatorCommandState.acceptedForSyscallDispatch !== false
      && operatorCommandState.restartSafe !== false
      && syscallBoundaryState.acceptedForProviderSync !== false
      && syscallBoundaryState.acceptedForSyscallDispatch !== false
      && syscallBoundaryState.restartSafe !== false,
    blockedBy: [
      ...blockedBy,
      ...operatorReleaseBlockedBy,
      ...routeReceiptBlockedBy,
      ...dispatchLedgerBlockedBy,
      ...adapterResumeBlockedBy,
      ...runtimeDispatchBlockedBy,
      ...replayStatusBlockedBy,
      ...claimRuntimeReceiptBlockedBy,
      ...operatorCommandBlockedBy,
      ...syscallBoundaryBlockedBy,
    ].sort(),
    pendingChecks: [
      ...pendingChecks,
      ...operatorReleasePendingBy,
      ...routeReceiptPendingBy,
      ...dispatchLedgerPendingBy,
      ...adapterResumePendingBy,
      ...runtimeDispatchPendingBy,
      ...replayStatusPendingBy,
      ...claimRuntimeReceiptPendingBy,
      ...operatorCommandPendingBy,
      ...syscallBoundaryPendingBy,
    ].sort(),
    nextAction: syscallGateBlockedBy.length
      ? syscallGate.nextAction || "review-memory-syscall-dispatch-gate"
      : syscallGatePendingBy.length
        ? syscallGate.nextAction || "wait-for-memory-syscall-dispatch-gate"
      : providerServiceBlockedBy.length
        ? providerServiceState.nextAction
      : providerAudienceBlockedBy.length
        ? providerAudienceState.nextAction
      : providerAssertionBlockedBy.length
        ? providerAssertionState.nextAction
      : providerSyncReleaseBlockedBy.length
        ? providerSyncReleaseState.nextAction
      : audienceContinuityBlockedBy.length
        ? audienceContinuityState.nextAction
      : releaseRiskBlockedBy.length
        ? releaseRiskState.nextAction
      : operatorReleaseBlockedBy.length
        ? operatorReleaseState.nextAction
        : routeReceiptBlockedBy.length
          ? routeReceiptState.nextAction
        : dispatchLedgerBlockedBy.length
          ? dispatchLedgerState.nextAction
        : adapterResumeBlockedBy.length
          ? adapterResumeState.nextAction
        : runtimeDispatchBlockedBy.length
          ? runtimeDispatchReleaseState.nextAction
        : replayStatusBlockedBy.length
          ? replayStatusState.nextAction
        : claimRuntimeReceiptBlockedBy.length
          ? claimRuntimeReceiptState.nextAction
        : operatorCommandBlockedBy.length
          ? operatorCommandState.nextAction
        : syscallBoundaryBlockedBy.length
          ? syscallBoundaryState.nextAction
        : providerServicePendingBy.length
          ? providerServiceState.nextAction
        : providerAudiencePendingBy.length
          ? providerAudienceState.nextAction
        : providerAssertionPendingBy.length
          ? providerAssertionState.nextAction
        : providerSyncReleasePendingBy.length
          ? providerSyncReleaseState.nextAction
        : audienceContinuityPendingBy.length
          ? audienceContinuityState.nextAction
        : releaseRiskPendingBy.length
          ? releaseRiskState.nextAction
        : operatorReleasePendingBy.length
          ? operatorReleaseState.nextAction
        : routeReceiptPendingBy.length
          ? routeReceiptState.nextAction
        : dispatchLedgerPendingBy.length
          ? dispatchLedgerState.nextAction
        : adapterResumePendingBy.length
          ? adapterResumeState.nextAction
        : runtimeDispatchPendingBy.length
          ? runtimeDispatchReleaseState.nextAction
        : claimRuntimeReceiptPendingBy.length
          ? claimRuntimeReceiptState.nextAction
        : operatorCommandPendingBy.length
          ? operatorCommandState.nextAction
        : syscallBoundaryPendingBy.length
          ? syscallBoundaryState.nextAction
        : health.nextAction
          || resumeSource?.nextAction
          || workflowSource?.nextAction
          || boundaryLease.nextAction
          || control.nextAction
          || readiness.nextAction
          || acceptance.nextAction
          || "review-memory-preview",
  };
}

function normalizeUpstreamVerifierPackage(boundary, options) {
  const source = options.verifierHandoffPackage
    || options.verifierSyscallHandoffPackage
    || boundary.verifierHandoffPackage
    || boundary.verifierSyscallHandoffPackage
    || boundary.providerJob?.verifierHandoffPackage
    || boundary.continuationPacket?.verifierHandoffPackage
    || boundary.verifierAnalysis?.syscallHandoffPackage
    || null;
  const recoveryTriageSource = options.verifierRecoveryTriageReceipt
    || boundary.verifierRecoveryTriageReceipt
    || boundary.providerJob?.verifierRecoveryTriageReceipt
    || boundary.continuationPacket?.verifierRecoveryTriageReceipt
    || boundary.verifierAnalysis?.recoveryTriageReceipt
    || source?.recoveryTriageReceipt
    || null;
  const providerJob = boundary.providerJob || {};
  const tenantPolicy = boundary.tenantPolicy || providerJob.tenantPolicy || {};
  const activeBoundary = tenantPolicy.activeBoundary || {};
  const clientRuntime = boundary.clientRuntime || providerJob.clientRuntime || {};
  const operatorControlState = boundary.operatorControlState || {};
  const expectedTenantId = activeBoundary.tenantId
    || tenantPolicy.tenantId
    || clientRuntime.tenantId
    || boundary.tenantId
    || null;
  const expectedWorkspaceId = activeBoundary.workspaceId
    || tenantPolicy.workspaceId
    || clientRuntime.workspaceId
    || boundary.workspaceId
    || null;
  const actorRole = operatorControlState.actorRole
    || clientRuntime.actorRole
    || boundary.actorRole
    || activeBoundary.actorRole
    || "operator";
  if (!source) {
    return {
      present: false,
      packageId: null,
      syncId: null,
      previewId: null,
      acceptanceId: null,
      healthId: null,
      status: "not-provided",
      healthStatus: "not-provided",
      statusChannel: null,
      acceptedForSyscallDispatch: true,
      restartSafe: true,
      retryable: false,
      nextDelaySeconds: null,
      incidentSummary: {
        total: 0,
        errors: 0,
        warnings: 0,
        retryable: 0,
        codes: [],
      },
      blockedBy: [],
      pendingBy: [],
      statusRows: [],
      commands: [],
      actionableErrors: [],
      tenantDispatchGuard: {
        present: false,
        guardId: null,
        status: "not-provided",
        tenantId: null,
        workspaceId: null,
        actorRole,
        expectedTenantId,
        expectedWorkspaceId,
        acceptedForSyscallDispatch: true,
        restartSafe: true,
        blockedBy: [],
        pendingBy: [],
        statusRows: [],
        commands: [],
        nextAction: "continue-syscall-preview",
      },
      recoveryTriageReceipt: {
        present: false,
        receiptId: null,
        status: "not-provided",
        acceptedForSyscallDispatch: true,
        restartSafe: true,
        blockedBy: [],
        pendingBy: [],
        triageRows: [],
        commands: [],
        nextAction: "continue-syscall-preview",
      },
      nextAction: "continue-syscall-preview",
    };
  }
  const recoveryTriagePresent = Boolean(
    recoveryTriageSource?.format === "aios.mailchimp.verifier.recoveryTriageReceipt.v1"
      || recoveryTriageSource?.receiptId,
  );
  const recoveryTriageBlockedBy = [
    ...asArray(recoveryTriageSource?.blockedBy).map((blocker) => `verifier-recovery:${blocker}`),
    ...asArray(recoveryTriageSource?.triageRows)
      .filter((row) => row?.blockedBy?.length || row?.restartSafe === false)
      .flatMap((row) => [
        ...asArray(row.blockedBy).map((blocker) => `verifier-recovery:${row.gate || "gate"}:${blocker}`),
        ...(row.restartSafe === false ? [`verifier-recovery:${row.gate || "gate"}:restart-unsafe`] : []),
      ]),
    ...(recoveryTriageSource?.restartSafe === false ? ["verifier-recovery:restart-unsafe"] : []),
  ].sort();
  const recoveryTriagePendingBy = [
    ...asArray(recoveryTriageSource?.pendingBy).map((pending) => `verifier-recovery:${pending}`),
    ...asArray(recoveryTriageSource?.triageRows)
      .filter((row) => row?.pendingBy?.length)
      .flatMap((row) => asArray(row.pendingBy).map((pending) => (
        `verifier-recovery:${row.gate || "gate"}:${pending}`
      ))),
  ].sort();
  const recoveryTriageReceipt = {
    present: recoveryTriagePresent,
    receiptId: recoveryTriageSource?.receiptId || null,
    status: recoveryTriageSource?.status || (recoveryTriagePresent ? "provided" : "not-provided"),
    acceptedForSyscallDispatch: !recoveryTriagePresent
      || (recoveryTriageSource.acceptedForSyscallDispatch === true
        && recoveryTriageBlockedBy.length === 0
        && recoveryTriagePendingBy.length === 0),
    restartSafe: !recoveryTriagePresent || recoveryTriageSource.restartSafe !== false,
    retryable: recoveryTriageSource?.retryable === true,
    nextDelaySeconds: recoveryTriageSource?.nextDelaySeconds ?? null,
    blockedBy: recoveryTriageBlockedBy,
    pendingBy: recoveryTriagePendingBy,
    triageRows: asArray(recoveryTriageSource?.triageRows).map((row) => ({
      gate: row.gate || "unknown",
      status: row.status || "unknown",
      accepted: row.accepted === true,
      restartSafe: row.restartSafe !== false,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || recoveryTriageSource?.nextAction || "review-verifier-recovery-triage",
    })),
    commands: asArray(recoveryTriageSource?.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: recoveryTriageSource?.nextAction || "review-verifier-recovery-triage",
  };
  const tenantGuardSource = source.tenantDispatchGuard || source.dispatchGuard || {};
  const tenantGuardPresent = Boolean(
    tenantGuardSource.format === "aios.mailchimp.verifier.tenantDispatchGuard.v1"
      || tenantGuardSource.guardId,
  );
  const tenantGuardTenantId = tenantGuardSource.tenantId || null;
  const tenantGuardWorkspaceId = tenantGuardSource.workspaceId || null;
  const tenantGuardActorRole = tenantGuardSource.actorRole || actorRole;
  const tenantGuardBlockedBy = [
    ...asArray(tenantGuardSource.blockedBy).map((blocker) => `verifier-tenant:${blocker}`),
    ...(tenantGuardPresent
      && expectedTenantId
      && tenantGuardTenantId
      && tenantGuardTenantId !== expectedTenantId
      ? [`verifier-tenant:tenant:${tenantGuardTenantId}:outside-syscall-boundary`]
      : []),
    ...(tenantGuardPresent
      && expectedWorkspaceId
      && tenantGuardWorkspaceId
      && tenantGuardWorkspaceId !== expectedWorkspaceId
      ? [`verifier-tenant:workspace:${tenantGuardWorkspaceId}:outside-syscall-boundary`]
      : []),
    ...(tenantGuardPresent && tenantGuardSource.restartSafe === false
      ? ["verifier-tenant:restart-unsafe"]
      : []),
    ...(tenantGuardPresent && tenantGuardSource.acceptedForSyscallDispatch === false
      ? ["verifier-tenant:dispatch-not-accepted"]
      : []),
  ].sort();
  const tenantGuardPendingBy = [
    ...asArray(tenantGuardSource.pendingBy).map((pending) => `verifier-tenant:${pending}`),
    ...(tenantGuardPresent
      && tenantGuardSource.status === "pending"
      && tenantGuardBlockedBy.length === 0
      ? ["verifier-tenant:awaiting-release"]
      : []),
  ].sort();
  const tenantDispatchGuard = {
    present: tenantGuardPresent,
    guardId: tenantGuardSource.guardId || null,
    status: tenantGuardSource.status || (tenantGuardPresent ? "provided" : "not-provided"),
    tenantId: tenantGuardTenantId,
    workspaceId: tenantGuardWorkspaceId,
    actorRole: tenantGuardActorRole,
    expectedTenantId,
    expectedWorkspaceId,
    acceptedForSyscallDispatch: !tenantGuardPresent
      || (tenantGuardSource.acceptedForSyscallDispatch === true
        && tenantGuardBlockedBy.length === 0
        && tenantGuardPendingBy.length === 0),
    restartSafe: !tenantGuardPresent || tenantGuardSource.restartSafe !== false,
    blockedBy: tenantGuardBlockedBy,
    pendingBy: tenantGuardPendingBy,
    statusRows: asArray(tenantGuardSource.statusRows).map((row) => ({
      key: row.key || "unknown",
      status: row.status || "unknown",
      accepted: row.accepted === true,
      restartSafe: row.restartSafe !== false,
      statusPath: row.statusPath || null,
      blockedBy: asArray(row.blockedBy),
      pendingBy: asArray(row.pendingBy),
      nextAction: row.nextAction || tenantGuardSource.nextAction || "review-verifier-tenant-dispatch-guard",
    })),
    commands: asArray(tenantGuardSource.commands).map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      idempotencyKey: command.idempotencyKey || null,
    })),
    nextAction: tenantGuardSource.nextAction || "review-verifier-tenant-dispatch-guard",
  };
  const statusRows = asArray(source.statusRows);
  const commands = asArray(source.commands);
  const healthRow = statusRows.find((row) => row?.key === "provider-health") || {};
  const restartUnsafeRows = statusRows
    .filter((row) => row?.restartSafe === false)
    .map((row) => `restart:${row.key || "unknown"}:unsafe`);
  const blockedBy = [
    ...asArray(source.blockedBy),
    ...statusRows.flatMap((row) => asArray(row?.blockedBy)),
    ...(source.restartSafe === false ? ["restart:package:unsafe"] : []),
    ...restartUnsafeRows,
    ...tenantGuardBlockedBy,
    ...recoveryTriageBlockedBy,
  ].sort();
  const pendingBy = [
    ...asArray(source.pendingBy),
    ...statusRows.flatMap((row) => asArray(row?.pendingBy)),
    ...tenantGuardPendingBy,
    ...recoveryTriagePendingBy,
  ].sort();
  const actionableErrors = [
    ...blockedBy.map((blocker) => ({
      code: blocker.startsWith("health:") ? blocker.slice("health:".length) : "verifier.syscall-handoff.blocked",
      action: blocker.startsWith("client-state:")
        ? "hydrate-verifier-client-state"
        : blocker.startsWith("health:")
          ? source.nextAction || healthRow.nextAction || "schedule-verifier-syscall-health-retry"
          : source.nextAction || "repair-verifier-syscall-handoff",
      retryable: source.retryable === true && !blocker.includes("retry-exhausted"),
      source: "verifier",
    })),
    ...pendingBy.map((pending) => ({
      code: pending.startsWith("health:") ? pending.slice("health:".length) : "verifier.syscall-handoff.pending",
      action: source.nextAction || "wait-for-verifier-syscall-handoff",
      retryable: source.retryable === true,
      source: "verifier",
    })),
  ];
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : source.acceptedForSyscallDispatch === true
        ? "dispatch-ready"
        : source.status || "waiting";

  return {
    present: true,
    packageId: source.packageId || null,
    syncId: source.syncId || null,
    previewId: source.previewId || null,
    acceptanceId: source.acceptanceId || null,
    healthId: source.healthId || healthRow.healthId || null,
    status,
    healthStatus: healthRow.status || source.healthStatus || source.status || "unknown",
    statusChannel: source.statusChannel || healthRow.statusPath || null,
    acceptedForSyscallDispatch: source.acceptedForSyscallDispatch === true
      && blockedBy.length === 0
      && tenantDispatchGuard.acceptedForSyscallDispatch === true
      && recoveryTriageReceipt.acceptedForSyscallDispatch === true,
    restartSafe: source.restartSafe !== false
      && statusRows.every((row) => row?.restartSafe !== false)
      && tenantDispatchGuard.restartSafe !== false
      && recoveryTriageReceipt.restartSafe !== false,
    retryable: source.retryable === true || recoveryTriageReceipt.retryable === true,
    nextDelaySeconds: source.nextDelaySeconds ?? recoveryTriageReceipt.nextDelaySeconds ?? null,
    incidentSummary: source.incidentSummary || {
      total: actionableErrors.length,
      errors: actionableErrors.filter((error) => error.retryable === false).length,
      warnings: actionableErrors.filter((error) => error.retryable !== false).length,
      retryable: actionableErrors.filter((error) => error.retryable).length,
      codes: [...new Set(actionableErrors.map((error) => error.code).filter(Boolean))].sort(),
    },
    blockedBy,
    pendingBy,
    statusRows: statusRows.map((row) => ({
      key: row.key || "unknown",
      status: row.status || "unknown",
      accepted: row.accepted === true,
      restartSafe: row.restartSafe !== false,
      statusPath: row.statusPath || null,
      nextAction: row.nextAction || source.nextAction || "review-verifier-syscall-handoff",
    })),
    commands: commands.map((command) => ({
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || null,
    })),
    tenantDispatchGuard,
    recoveryTriageReceipt,
    actionableErrors,
    nextAction: source.nextAction
      || actionableErrors[0]?.action
      || (status === "dispatch-ready" ? "release-verifier-syscall-dispatch" : "review-verifier-syscall-handoff"),
  };
}

function buildClientRuntimeAdoptionState(
  boundary,
  dispatchBatchState,
  externalHandoffState,
  routePreviewAcceptanceState,
  lifecycleControls,
  upstreamMemoryPackage,
  upstreamVerifierPackage,
) {
  const providerJob = boundary.providerJob || {};
  const operatorControlState = boundary.operatorControlState || {};
  const clientRuntime = boundary.clientRuntime
    || boundary.providerJob?.clientRuntime
    || boundary.continuationPacket?.clientRuntime
    || {};
  const requestState = clientRuntime.requestState
    || operatorControlState.requestState
    || boundary.requestState
    || {};
  const requiredClientState = [
    "requestId",
    "workflowId",
    "boundaryId",
    "batchId",
    "handoffId",
    ...asArray(clientRuntime.requiredKeys),
  ];
  const observedState = {
    ...requestState,
    requestId: requestState.requestId || clientRuntime.requestId || boundary.requestId || providerJob.jobId || null,
    workflowId: requestState.workflowId || clientRuntime.workflowId || boundary.workflowId || "mailchimp-syscall-workflow",
    boundaryId: requestState.boundaryId || boundary.boundaryId,
    batchId: dispatchBatchState.batchId,
    handoffId: externalHandoffState.handoffId,
    previewId: routePreviewAcceptanceState.preview.previewId,
    acceptanceId: routePreviewAcceptanceState.acceptance.acceptanceId,
    memoryPreviewId: upstreamMemoryPackage.previewId,
    memoryPackageId: upstreamMemoryPackage.packageId,
    verifierPackageId: upstreamVerifierPackage.packageId,
    verifierSyncId: upstreamVerifierPackage.syncId,
    verifierTenantGuardId: upstreamVerifierPackage.tenantDispatchGuard.guardId,
    verifierTenantGuardStatus: upstreamVerifierPackage.tenantDispatchGuard.status,
    verifierTenantId: upstreamVerifierPackage.tenantDispatchGuard.tenantId,
    verifierWorkspaceId: upstreamVerifierPackage.tenantDispatchGuard.workspaceId,
    memoryControlPlaneId: upstreamMemoryPackage.controlPlane.controlPlaneId,
    memoryControlPlaneStatus: upstreamMemoryPackage.controlPlane.status,
    memoryClientWorkflowPacketId: upstreamMemoryPackage.clientWorkflowHandoff.packetId,
    memoryClientWorkflowStatus: upstreamMemoryPackage.clientWorkflowHandoff.status,
    memoryClientWorkflowReceiptId: upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.receiptId,
    memoryClientWorkflowReceiptStatus: upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.status,
    memoryOperatorResumePacketId: upstreamMemoryPackage.operatorResume.packetId,
    memoryOperatorResumeStatus: upstreamMemoryPackage.operatorResume.status,
    memoryBoundaryLeasePacketId: upstreamMemoryPackage.boundaryLease.packetId,
    memoryBoundaryLeaseStatus: upstreamMemoryPackage.boundaryLease.status,
    memoryProviderServiceContractId: upstreamMemoryPackage.providerService.contractId,
    memoryProviderServiceStatus: upstreamMemoryPackage.providerService.status,
    memoryProviderAssertionDigestId: upstreamMemoryPackage.providerAssertionDigest.digestId,
    memoryProviderAssertionStatus: upstreamMemoryPackage.providerAssertionDigest.status,
    memoryProviderSyncReleaseReceiptId: upstreamMemoryPackage.providerSyncReleaseReceipt.receiptId,
    memoryProviderSyncReleaseStatus: upstreamMemoryPackage.providerSyncReleaseReceipt.status,
    memoryAudienceSyncWatermarkId: upstreamMemoryPackage.audienceSyncWatermark.watermarkId,
    memoryAudienceSyncWatermarkStatus: upstreamMemoryPackage.audienceSyncWatermark.status,
    memoryAudienceContinuityReceiptId: upstreamMemoryPackage.audienceContinuityReceipt.receiptId,
    memoryAudienceContinuityStatus: upstreamMemoryPackage.audienceContinuityReceipt.status,
    memoryAudienceId: upstreamMemoryPackage.audienceSyncWatermark.audienceId,
    memorySegmentId: upstreamMemoryPackage.audienceSyncWatermark.segmentId,
    memorySyscallGateId: upstreamMemoryPackage.syscallDispatchGate.gateId,
    memorySyscallGateStatus: upstreamMemoryPackage.syscallDispatchGate.status,
    memoryOperatorReleasePacketId: upstreamMemoryPackage.operatorRelease.packetId,
    memoryOperatorReleaseStatus: upstreamMemoryPackage.operatorRelease.status,
    memoryRouteAcceptanceReceiptId: upstreamMemoryPackage.routeAcceptanceReceipt.receiptId,
    memoryRouteAcceptanceStatus: upstreamMemoryPackage.routeAcceptanceReceipt.status,
    memoryDispatchReleaseLedgerId: upstreamMemoryPackage.dispatchReleaseLedger.ledgerId,
    memoryDispatchReleaseStatus: upstreamMemoryPackage.dispatchReleaseLedger.status,
    memoryClaimRuntimeAdoptionReceiptId: upstreamMemoryPackage.claimRuntimeAdoptionReceipt.receiptId,
    memoryClaimRuntimeAdoptionStatus: upstreamMemoryPackage.claimRuntimeAdoptionReceipt.status,
    memoryRuntimeDispatchReleaseReceiptId: upstreamMemoryPackage.runtimeDispatchReleaseReceipt.receiptId,
    memoryRuntimeDispatchReleaseStatus: upstreamMemoryPackage.runtimeDispatchReleaseReceipt.status,
    memoryOperatorCommandReceiptId: upstreamMemoryPackage.operatorCommandReceipt.receiptId,
    memoryOperatorCommandStatus: upstreamMemoryPackage.operatorCommandReceipt.status,
  };
  const missingClientState = [...new Set(requiredClientState)]
    .filter((key) => observedState[key] == null)
    .sort();
  const memoryBlocked = upstreamMemoryPackage.blockedBy.length > 0
    || upstreamMemoryPackage.acceptedForRuntime === false
    || upstreamMemoryPackage.acceptedForProviderSync === false
    || upstreamMemoryPackage.controlPlane.blockedBy.length > 0
    || upstreamMemoryPackage.controlPlane.restartSafe === false
    || upstreamMemoryPackage.clientWorkflowHandoff.blockedBy.length > 0
    || upstreamMemoryPackage.clientWorkflowHandoff.restartSafe === false
    || upstreamMemoryPackage.clientWorkflowHandoff.acceptedForProviderSync === false
    || upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.blockedBy.length > 0
    || upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.restartSafe === false
    || upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.acceptedForProviderSync === false
    || upstreamMemoryPackage.boundaryLease.blockedBy.length > 0
    || upstreamMemoryPackage.boundaryLease.restartSafe === false
    || upstreamMemoryPackage.boundaryLease.acceptedForProviderSync === false
    || upstreamMemoryPackage.providerService.blockedBy.length > 0
    || upstreamMemoryPackage.providerService.restartSafe === false
    || upstreamMemoryPackage.providerService.acceptedForProviderSync === false
    || upstreamMemoryPackage.providerService.acceptedForSyscallDispatch === false
    || upstreamMemoryPackage.providerAssertionDigest.blockedBy.length > 0
    || upstreamMemoryPackage.providerAssertionDigest.restartSafe === false
    || upstreamMemoryPackage.providerAssertionDigest.acceptedForSyscallDispatch === false
    || upstreamMemoryPackage.providerSyncReleaseReceipt.blockedBy.length > 0
    || upstreamMemoryPackage.providerSyncReleaseReceipt.restartSafe === false
    || upstreamMemoryPackage.providerSyncReleaseReceipt.acceptedForSyscallDispatch === false
    || upstreamMemoryPackage.audienceSyncWatermark.blockedBy.length > 0
    || upstreamMemoryPackage.audienceSyncWatermark.restartSafe === false
    || upstreamMemoryPackage.audienceSyncWatermark.acceptedForSyscallDispatch === false
    || upstreamMemoryPackage.audienceContinuityReceipt.blockedBy.length > 0
    || upstreamMemoryPackage.audienceContinuityReceipt.restartSafe === false
    || upstreamMemoryPackage.audienceContinuityReceipt.acceptedForSyscallDispatch === false
    || upstreamMemoryPackage.operatorRelease.blockedBy.length > 0
    || upstreamMemoryPackage.operatorRelease.restartSafe === false
    || upstreamMemoryPackage.operatorRelease.acceptedForSyscallDispatch === false
    || upstreamMemoryPackage.operatorResume.blockedBy.length > 0
    || upstreamMemoryPackage.operatorResume.restartSafe === false
    || upstreamMemoryPackage.operatorResume.acceptedForProviderSync === false
    || upstreamMemoryPackage.syscallDispatchGate.blockedBy.length > 0
    || upstreamMemoryPackage.syscallDispatchGate.restartSafe === false
    || upstreamMemoryPackage.syscallDispatchGate.acceptedForSyscallDispatch === false
    || upstreamMemoryPackage.routeAcceptanceReceipt.blockedBy.length > 0
    || upstreamMemoryPackage.routeAcceptanceReceipt.restartSafe === false
    || upstreamMemoryPackage.routeAcceptanceReceipt.acceptedForRuntime === false
    || upstreamMemoryPackage.routeAcceptanceReceipt.acceptedForProviderSync === false
    || upstreamMemoryPackage.routeAcceptanceReceipt.acceptedForSyscallDispatch === false
    || upstreamMemoryPackage.dispatchReleaseLedger.blockedBy.length > 0
    || upstreamMemoryPackage.dispatchReleaseLedger.restartSafe === false
    || upstreamMemoryPackage.dispatchReleaseLedger.acceptedForProviderSync === false
    || upstreamMemoryPackage.dispatchReleaseLedger.acceptedForSyscallDispatch === false
    || upstreamMemoryPackage.claimRuntimeAdoptionReceipt.blockedBy.length > 0
    || upstreamMemoryPackage.claimRuntimeAdoptionReceipt.restartSafe === false
    || upstreamMemoryPackage.claimRuntimeAdoptionReceipt.acceptedForSyscallDispatch === false
    || upstreamMemoryPackage.runtimeDispatchReleaseReceipt.blockedBy.length > 0
    || upstreamMemoryPackage.runtimeDispatchReleaseReceipt.restartSafe === false
    || upstreamMemoryPackage.operatorCommandReceipt.blockedBy.length > 0
    || upstreamMemoryPackage.operatorCommandReceipt.restartSafe === false
    || upstreamMemoryPackage.operatorCommandReceipt.acceptedForSyscallDispatch === false;
  const memoryControlPending = !memoryBlocked
    && upstreamMemoryPackage.controlPlane.pendingBy.length > 0
    && upstreamMemoryPackage.controlPlane.acceptedForProviderSync !== true;
  const memoryWorkflowPending = !memoryBlocked
    && !memoryControlPending
    && upstreamMemoryPackage.clientWorkflowHandoff.pendingBy.length > 0
    && upstreamMemoryPackage.clientWorkflowHandoff.acceptedForProviderSync !== true;
  const memoryWorkflowReceiptPending = !memoryBlocked
    && !memoryControlPending
    && !memoryWorkflowPending
    && upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.pendingBy.length > 0
    && upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.acceptedForProviderSync !== true;
  const memoryBoundaryPending = !memoryBlocked
    && !memoryControlPending
    && !memoryWorkflowPending
    && !memoryWorkflowReceiptPending
    && upstreamMemoryPackage.boundaryLease.pendingBy.length > 0
    && upstreamMemoryPackage.boundaryLease.acceptedForProviderSync !== true;
  const memorySyscallGatePending = !memoryBlocked
    && !memoryControlPending
    && !memoryWorkflowPending
    && !memoryWorkflowReceiptPending
    && !memoryBoundaryPending
    && upstreamMemoryPackage.syscallDispatchGate.pendingBy.length > 0
    && upstreamMemoryPackage.syscallDispatchGate.acceptedForSyscallDispatch !== true;
  const memoryProviderAssertionPending = !memoryBlocked
    && !memoryControlPending
    && !memoryWorkflowPending
    && !memoryWorkflowReceiptPending
    && !memoryBoundaryPending
    && !memorySyscallGatePending
    && upstreamMemoryPackage.providerAssertionDigest.pendingBy.length > 0
    && upstreamMemoryPackage.providerAssertionDigest.acceptedForSyscallDispatch !== true;
  const memoryProviderSyncReleasePending = !memoryBlocked
    && !memoryControlPending
    && !memoryWorkflowPending
    && !memoryWorkflowReceiptPending
    && !memoryBoundaryPending
    && !memorySyscallGatePending
    && !memoryProviderAssertionPending
    && upstreamMemoryPackage.providerSyncReleaseReceipt.pendingBy.length > 0
    && upstreamMemoryPackage.providerSyncReleaseReceipt.acceptedForSyscallDispatch !== true;
  const memoryAudienceWatermarkPending = !memoryBlocked
    && !memoryControlPending
    && !memoryWorkflowPending
    && !memoryWorkflowReceiptPending
    && !memoryBoundaryPending
    && !memorySyscallGatePending
    && !memoryProviderAssertionPending
    && !memoryProviderSyncReleasePending
    && upstreamMemoryPackage.audienceSyncWatermark.pendingBy.length > 0
    && upstreamMemoryPackage.audienceSyncWatermark.acceptedForSyscallDispatch !== true;
  const memoryOperatorReleasePending = !memoryBlocked
    && !memoryControlPending
    && !memoryWorkflowPending
    && !memoryWorkflowReceiptPending
    && !memoryBoundaryPending
    && !memorySyscallGatePending
    && !memoryProviderAssertionPending
    && !memoryProviderSyncReleasePending
    && !memoryAudienceWatermarkPending
    && upstreamMemoryPackage.audienceContinuityReceipt.pendingBy.length === 0
    && upstreamMemoryPackage.operatorRelease.pendingBy.length > 0
    && upstreamMemoryPackage.operatorRelease.acceptedForSyscallDispatch !== true;
  const memoryDispatchLedgerPending = !memoryBlocked
    && !memoryControlPending
    && !memoryWorkflowPending
    && !memoryWorkflowReceiptPending
    && !memoryBoundaryPending
    && !memorySyscallGatePending
    && !memoryProviderAssertionPending
    && !memoryProviderSyncReleasePending
    && !memoryAudienceWatermarkPending
    && upstreamMemoryPackage.audienceContinuityReceipt.pendingBy.length === 0
    && !memoryOperatorReleasePending
    && upstreamMemoryPackage.dispatchReleaseLedger.pendingBy.length > 0
    && upstreamMemoryPackage.dispatchReleaseLedger.acceptedForSyscallDispatch !== true;
  const memoryClaimRuntimePending = !memoryBlocked
    && !memoryControlPending
    && !memoryWorkflowPending
    && !memoryWorkflowReceiptPending
    && !memoryBoundaryPending
    && !memorySyscallGatePending
    && !memoryProviderAssertionPending
    && !memoryProviderSyncReleasePending
    && !memoryAudienceWatermarkPending
    && upstreamMemoryPackage.audienceContinuityReceipt.pendingBy.length === 0
    && !memoryOperatorReleasePending
    && !memoryDispatchLedgerPending
    && upstreamMemoryPackage.claimRuntimeAdoptionReceipt.pendingBy.length > 0
    && upstreamMemoryPackage.claimRuntimeAdoptionReceipt.acceptedForSyscallDispatch !== true;
  const memoryRuntimeDispatchReleasePending = !memoryBlocked
    && !memoryControlPending
    && !memoryWorkflowPending
    && !memoryWorkflowReceiptPending
    && !memoryBoundaryPending
    && !memorySyscallGatePending
    && !memoryProviderAssertionPending
    && !memoryProviderSyncReleasePending
    && !memoryAudienceWatermarkPending
    && upstreamMemoryPackage.audienceContinuityReceipt.pendingBy.length === 0
    && !memoryOperatorReleasePending
    && !memoryDispatchLedgerPending
    && !memoryClaimRuntimePending
    && upstreamMemoryPackage.runtimeDispatchReleaseReceipt.pendingBy.length > 0
    && upstreamMemoryPackage.runtimeDispatchReleaseReceipt.acceptedForSyscallDispatch !== true;
  const memoryOperatorCommandPending = !memoryBlocked
    && !memoryControlPending
    && !memoryWorkflowPending
    && !memoryWorkflowReceiptPending
    && !memoryBoundaryPending
    && !memorySyscallGatePending
    && !memoryProviderAssertionPending
    && !memoryProviderSyncReleasePending
    && !memoryAudienceWatermarkPending
    && upstreamMemoryPackage.audienceContinuityReceipt.pendingBy.length === 0
    && !memoryOperatorReleasePending
    && !memoryDispatchLedgerPending
    && !memoryClaimRuntimePending
    && !memoryRuntimeDispatchReleasePending
    && upstreamMemoryPackage.operatorCommandReceipt.pendingBy.length > 0
    && upstreamMemoryPackage.operatorCommandReceipt.acceptedForSyscallDispatch !== true;
  const memoryPending = !memoryBlocked
    && !memoryControlPending
    && !memoryWorkflowPending
    && !memoryWorkflowReceiptPending
    && !memoryBoundaryPending
    && !memorySyscallGatePending
    && !memoryProviderAssertionPending
    && !memoryProviderSyncReleasePending
    && !memoryAudienceWatermarkPending
    && upstreamMemoryPackage.audienceContinuityReceipt.pendingBy.length === 0
    && !memoryOperatorReleasePending
    && !memoryDispatchLedgerPending
    && !memoryClaimRuntimePending
    && !memoryRuntimeDispatchReleasePending
    && !memoryOperatorCommandPending
    && (upstreamMemoryPackage.pendingChecks.length > 0
      || upstreamMemoryPackage.operatorResume.pendingBy.length > 0
      || upstreamMemoryPackage.routeAcceptanceReceipt.pendingBy.length > 0);
  const verifierBlocked = upstreamVerifierPackage.blockedBy.length > 0
    || upstreamVerifierPackage.acceptedForSyscallDispatch === false
    || upstreamVerifierPackage.restartSafe === false;
  const verifierPending = !verifierBlocked && upstreamVerifierPackage.pendingBy.length > 0;
  const routeBlocked = routePreviewAcceptanceState.readiness.status === "blocked";
  const acceptancePending = routePreviewAcceptanceState.readiness.status === "pending-acceptance";
  const acceptedForRuntime = missingClientState.length === 0
    && !memoryBlocked
    && !memoryPending
    && !memoryWorkflowReceiptPending
    && !memoryProviderAssertionPending
    && !memoryProviderSyncReleasePending
    && !memoryAudienceWatermarkPending
    && upstreamMemoryPackage.audienceContinuityReceipt.pendingBy.length === 0
    && !memoryOperatorReleasePending
    && !memoryDispatchLedgerPending
    && !memoryClaimRuntimePending
    && !memoryRuntimeDispatchReleasePending
    && !memoryOperatorCommandPending
    && !verifierBlocked
    && !verifierPending
    && routePreviewAcceptanceState.acceptance.acceptedForRuntime;
  const stateKey = clientRuntime.stateKey || stableId("mailchimp-syscall-client-state", [
    observedState.requestId,
    observedState.workflowId,
    dispatchBatchState.batchId,
  ]);
  const continuationToken = clientRuntime.continuationToken || stableId("mailchimp-syscall-continuation", [
    observedState.requestId,
    dispatchBatchState.batchId,
    routePreviewAcceptanceState.readiness.status,
    upstreamMemoryPackage.readinessStatus,
  ]);
  const adoptionStatus = missingClientState.length
    ? "needs-client-state"
    : memoryBlocked
      ? "blocked-by-memory-preview"
      : memoryPending
        ? "pending-memory-readiness"
        : memoryControlPending
          ? "pending-memory-control-plane"
        : memoryWorkflowPending
          ? "pending-memory-client-workflow"
        : memoryWorkflowReceiptPending
          ? "pending-memory-client-workflow-receipt"
        : memoryBoundaryPending
          ? "pending-memory-boundary-lease"
        : memorySyscallGatePending
          ? "pending-memory-syscall-dispatch-gate"
        : memoryProviderAssertionPending
          ? "pending-memory-provider-assertions"
        : memoryProviderSyncReleasePending
          ? "pending-memory-provider-sync-release"
        : memoryAudienceWatermarkPending
          ? "pending-memory-audience-watermark"
        : upstreamMemoryPackage.audienceContinuityReceipt.pendingBy.length
          ? "pending-memory-audience-continuity"
        : memoryOperatorReleasePending
          ? "pending-memory-operator-release"
        : memoryDispatchLedgerPending
          ? "pending-memory-dispatch-release-ledger"
        : memoryClaimRuntimePending
          ? "pending-memory-claim-runtime-adoption"
        : memoryRuntimeDispatchReleasePending
          ? "pending-memory-runtime-dispatch-release"
        : memoryOperatorCommandPending
          ? "pending-memory-operator-command-receipt"
        : verifierBlocked
          ? "blocked-by-verifier-handoff"
          : verifierPending
            ? "pending-verifier-handoff"
        : routeBlocked
          ? "blocked"
          : acceptancePending
            ? "pending-acceptance"
            : acceptedForRuntime
              ? "ready"
              : "waiting";
  const routeCommands = [
    {
      command: "render-syscall-preview",
      enabled: true,
      previewId: routePreviewAcceptanceState.preview.previewId,
    },
    {
      command: "persist-syscall-client-state",
      enabled: true,
      stateKey,
      idempotencyKey: `syscall-state:${stableId("syscall-state", [
        stateKey,
        dispatchBatchState.batchId,
        upstreamMemoryPackage.packageId,
        upstreamMemoryPackage.controlPlane.controlPlaneId,
        upstreamMemoryPackage.clientWorkflowHandoff.packetId,
        upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.receiptId,
        upstreamMemoryPackage.boundaryLease.packetId,
        upstreamMemoryPackage.operatorResume.packetId,
        upstreamMemoryPackage.syscallDispatchGate.gateId,
        upstreamMemoryPackage.providerAssertionDigest.digestId,
        upstreamMemoryPackage.providerSyncReleaseReceipt.receiptId,
        upstreamMemoryPackage.audienceSyncWatermark.watermarkId,
        upstreamMemoryPackage.audienceContinuityReceipt.receiptId,
        upstreamMemoryPackage.operatorRelease.packetId,
        upstreamMemoryPackage.routeAcceptanceReceipt.receiptId,
        upstreamMemoryPackage.dispatchReleaseLedger.ledgerId,
        upstreamMemoryPackage.claimRuntimeAdoptionReceipt.receiptId,
        upstreamMemoryPackage.runtimeDispatchReleaseReceipt.receiptId,
        upstreamMemoryPackage.operatorCommandReceipt.receiptId,
        upstreamVerifierPackage.packageId,
      ])}`,
    },
    {
      command: "accept-syscall-preview",
      enabled: routePreviewAcceptanceState.readiness.status !== "blocked"
        && !routePreviewAcceptanceState.acceptance.acceptedForRuntime
        && !memoryBlocked
        && !verifierBlocked,
      acceptanceId: routePreviewAcceptanceState.acceptance.acceptanceId,
    },
    {
      command: "handoff-syscall-batch-to-adapter",
      enabled: acceptedForRuntime,
      handoffId: externalHandoffState.handoffId,
      idempotencyKey: `syscall-handoff:${externalHandoffState.handoffId}`,
    },
  ];
  const nextSteps = [
    ...missingClientState.map((key) => ({
      action: "hydrate-syscall-client-state",
      subject: key,
      reason: "Syscall route state is required before adapter handoff",
    })),
    ...upstreamMemoryPackage.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.nextAction,
      subject: blocker,
      reason: "Memory mount preview is blocking syscall dispatch handoff",
    })),
    ...upstreamMemoryPackage.pendingChecks.map((check) => ({
      action: upstreamMemoryPackage.nextAction,
      subject: `memory-check:${check}`,
      reason: "Memory mount preview has a pending readiness check",
    })),
    ...upstreamMemoryPackage.controlPlane.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.controlPlane.nextAction,
      subject: pending,
      reason: "Memory control plane has not released provider sync for syscall dispatch",
    })),
    ...upstreamMemoryPackage.clientWorkflowHandoff.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.clientWorkflowHandoff.nextAction,
      subject: pending,
      reason: "Memory client workflow handoff has not released provider sync for syscall dispatch",
    })),
    ...upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.nextAction,
      subject: pending,
      reason: "Memory client workflow release receipt is still pending",
    })),
    ...upstreamMemoryPackage.boundaryLease.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.boundaryLease.nextAction,
      subject: blocker,
      reason: "Memory boundary lease is blocking syscall dispatch handoff",
    })),
    ...upstreamMemoryPackage.boundaryLease.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.boundaryLease.nextAction,
      subject: pending,
      reason: "Memory boundary lease must be released before syscall dispatch handoff",
    })),
    ...upstreamMemoryPackage.syscallDispatchGate.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.syscallDispatchGate.nextAction,
      subject: blocker,
      reason: "Memory syscall dispatch gate is blocking syscall adapter handoff",
    })),
    ...upstreamMemoryPackage.syscallDispatchGate.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.syscallDispatchGate.nextAction,
      subject: pending,
      reason: "Memory syscall dispatch gate has pending release work",
    })),
    ...upstreamMemoryPackage.providerAssertionDigest.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.providerAssertionDigest.nextAction,
      subject: blocker,
      reason: "Memory provider assertions are blocking syscall adapter handoff",
    })),
    ...upstreamMemoryPackage.providerAssertionDigest.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.providerAssertionDigest.nextAction,
      subject: pending,
      reason: "Memory provider assertions have pending release work",
    })),
    ...upstreamMemoryPackage.providerSyncReleaseReceipt.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.providerSyncReleaseReceipt.nextAction,
      subject: blocker,
      reason: "Memory provider sync release receipt is blocking syscall adapter handoff",
    })),
    ...upstreamMemoryPackage.providerSyncReleaseReceipt.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.providerSyncReleaseReceipt.nextAction,
      subject: pending,
      reason: "Memory provider sync release receipt has pending release work",
    })),
    ...upstreamMemoryPackage.audienceSyncWatermark.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.audienceSyncWatermark.nextAction,
      subject: blocker,
      reason: "Memory audience sync watermark is blocking syscall adapter handoff",
    })),
    ...upstreamMemoryPackage.audienceSyncWatermark.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.audienceSyncWatermark.nextAction,
      subject: pending,
      reason: "Memory audience sync watermark has pending provider metadata release work",
    })),
    ...upstreamMemoryPackage.audienceContinuityReceipt.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.audienceContinuityReceipt.nextAction,
      subject: blocker,
      reason: "Memory audience continuity receipt is blocking syscall adapter handoff",
    })),
    ...upstreamMemoryPackage.audienceContinuityReceipt.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.audienceContinuityReceipt.nextAction,
      subject: pending,
      reason: "Memory audience continuity receipt is waiting for stable audience or cursor metadata",
    })),
    ...upstreamMemoryPackage.operatorRelease.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.operatorRelease.nextAction,
      subject: blocker,
      reason: "Memory operator release is blocking syscall adapter handoff",
    })),
    ...upstreamMemoryPackage.operatorRelease.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.operatorRelease.nextAction,
      subject: pending,
      reason: "Memory operator release has pending release work",
    })),
    ...upstreamMemoryPackage.operatorResume.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.operatorResume.nextAction,
      subject: pending,
      reason: "Memory operator resume packet has not released provider sync for syscall dispatch",
    })),
    ...upstreamMemoryPackage.routeAcceptanceReceipt.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.routeAcceptanceReceipt.nextAction,
      subject: blocker,
      reason: "Memory route acceptance receipt is blocking syscall dispatch",
    })),
    ...upstreamMemoryPackage.routeAcceptanceReceipt.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.routeAcceptanceReceipt.nextAction,
      subject: pending,
      reason: "Memory route acceptance receipt has pending release work",
    })),
    ...upstreamMemoryPackage.dispatchReleaseLedger.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.dispatchReleaseLedger.nextAction,
      subject: blocker,
      reason: "Memory dispatch release ledger is blocking syscall adapter handoff",
    })),
    ...upstreamMemoryPackage.dispatchReleaseLedger.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.dispatchReleaseLedger.nextAction,
      subject: pending,
      reason: "Memory dispatch release ledger has pending persisted-state release work",
    })),
    ...upstreamMemoryPackage.claimRuntimeAdoptionReceipt.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.claimRuntimeAdoptionReceipt.nextAction,
      subject: blocker,
      reason: "Memory claim runtime adoption receipt is blocking syscall adapter handoff",
    })),
    ...upstreamMemoryPackage.claimRuntimeAdoptionReceipt.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.claimRuntimeAdoptionReceipt.nextAction,
      subject: pending,
      reason: "Memory claim runtime adoption receipt has pending provider status release work",
    })),
    ...upstreamMemoryPackage.runtimeDispatchReleaseReceipt.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.runtimeDispatchReleaseReceipt.nextAction,
      subject: blocker,
      reason: "Memory runtime dispatch release receipt is blocking syscall adapter handoff",
    })),
    ...upstreamMemoryPackage.runtimeDispatchReleaseReceipt.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.runtimeDispatchReleaseReceipt.nextAction,
      subject: pending,
      reason: "Memory runtime dispatch release receipt has pending final dispatch release work",
    })),
    ...upstreamMemoryPackage.operatorCommandReceipt.blockedBy.map((blocker) => ({
      action: upstreamMemoryPackage.operatorCommandReceipt.nextAction,
      subject: blocker,
      reason: "Memory operator command receipt is blocking syscall adapter handoff",
    })),
    ...upstreamMemoryPackage.operatorCommandReceipt.pendingBy.map((pending) => ({
      action: upstreamMemoryPackage.operatorCommandReceipt.nextAction,
      subject: pending,
      reason: "Memory operator command receipt has pending command release work",
    })),
    ...upstreamVerifierPackage.blockedBy.map((blocker) => ({
      action: upstreamVerifierPackage.nextAction,
      subject: `verifier:${blocker}`,
      reason: "Verifier handoff is blocking syscall dispatch",
    })),
    ...upstreamVerifierPackage.pendingBy.map((pending) => ({
      action: upstreamVerifierPackage.nextAction,
      subject: `verifier:${pending}`,
      reason: "Verifier handoff has pending dispatch readiness",
    })),
    ...(acceptedForRuntime ? [{
      action: "handoff-syscall-batch-to-adapter",
      subject: externalHandoffState.handoffId,
      reason: "Client state, memory readiness, and syscall acceptance are complete",
    }] : []),
  ];

  return {
    adoptionId: stableId("mailchimp-syscall-runtime-adoption", [
      observedState.requestId,
      observedState.workflowId,
      dispatchBatchState.batchId,
      externalHandoffState.handoffId,
      adoptionStatus,
    ]),
    status: adoptionStatus,
    requestId: observedState.requestId,
    workflowId: observedState.workflowId,
    stateKey,
    continuationToken,
    hydrated: missingClientState.length === 0,
    acceptedForRuntime,
    requiredClientState: [...new Set(requiredClientState)].sort(),
    missingClientState,
    persistedState: {
      ...observedState,
      stateKey,
      continuationToken,
      adoptionStatus,
      lifecycleMode: lifecycleControls.settings.mode,
      memoryReadinessStatus: upstreamMemoryPackage.readinessStatus,
      memoryControlPlaneStatus: upstreamMemoryPackage.controlPlane.status,
      memoryClientWorkflowStatus: upstreamMemoryPackage.clientWorkflowHandoff.status,
      memoryClientWorkflowReceiptStatus: upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.status,
      memoryBoundaryLeaseStatus: upstreamMemoryPackage.boundaryLease.status,
      memoryOperatorResumeStatus: upstreamMemoryPackage.operatorResume.status,
      memorySyscallGateStatus: upstreamMemoryPackage.syscallDispatchGate.status,
      memoryProviderAssertionStatus: upstreamMemoryPackage.providerAssertionDigest.status,
      memoryProviderSyncReleaseStatus: upstreamMemoryPackage.providerSyncReleaseReceipt.status,
      memoryAudienceSyncWatermarkStatus: upstreamMemoryPackage.audienceSyncWatermark.status,
      memoryAudienceContinuityStatus: upstreamMemoryPackage.audienceContinuityReceipt.status,
      memoryOperatorReleaseStatus: upstreamMemoryPackage.operatorRelease.status,
      memoryRouteAcceptanceStatus: upstreamMemoryPackage.routeAcceptanceReceipt.status,
      memoryDispatchReleaseStatus: upstreamMemoryPackage.dispatchReleaseLedger.status,
      memoryClaimRuntimeAdoptionStatus: upstreamMemoryPackage.claimRuntimeAdoptionReceipt.status,
      memoryRuntimeDispatchReleaseStatus: upstreamMemoryPackage.runtimeDispatchReleaseReceipt.status,
      memoryOperatorCommandStatus: upstreamMemoryPackage.operatorCommandReceipt.status,
      verifierHandoffStatus: upstreamVerifierPackage.status,
      verifierTenantGuardStatus: upstreamVerifierPackage.tenantDispatchGuard.status,
      verifierTenantGuardId: upstreamVerifierPackage.tenantDispatchGuard.guardId,
      nextAction: adoptionStatus === "needs-client-state"
        ? "hydrate-syscall-client-state"
        : adoptionStatus === "blocked-by-memory-preview" || adoptionStatus === "pending-memory-readiness"
          ? upstreamMemoryPackage.nextAction
          : adoptionStatus === "pending-memory-control-plane"
            ? upstreamMemoryPackage.controlPlane.nextAction
          : adoptionStatus === "pending-memory-client-workflow"
            ? upstreamMemoryPackage.clientWorkflowHandoff.nextAction
          : adoptionStatus === "pending-memory-client-workflow-receipt"
            ? upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.nextAction
          : adoptionStatus === "pending-memory-boundary-lease"
            ? upstreamMemoryPackage.boundaryLease.nextAction
          : adoptionStatus === "pending-memory-syscall-dispatch-gate"
            ? upstreamMemoryPackage.syscallDispatchGate.nextAction
          : adoptionStatus === "pending-memory-provider-assertions"
            ? upstreamMemoryPackage.providerAssertionDigest.nextAction
          : adoptionStatus === "pending-memory-provider-sync-release"
            ? upstreamMemoryPackage.providerSyncReleaseReceipt.nextAction
          : adoptionStatus === "pending-memory-audience-watermark"
            ? upstreamMemoryPackage.audienceSyncWatermark.nextAction
          : adoptionStatus === "pending-memory-audience-continuity"
            ? upstreamMemoryPackage.audienceContinuityReceipt.nextAction
          : adoptionStatus === "pending-memory-operator-release"
            ? upstreamMemoryPackage.operatorRelease.nextAction
          : adoptionStatus === "pending-memory-dispatch-release-ledger"
            ? upstreamMemoryPackage.dispatchReleaseLedger.nextAction
          : adoptionStatus === "pending-memory-claim-runtime-adoption"
            ? upstreamMemoryPackage.claimRuntimeAdoptionReceipt.nextAction
          : adoptionStatus === "pending-memory-runtime-dispatch-release"
            ? upstreamMemoryPackage.runtimeDispatchReleaseReceipt.nextAction
          : adoptionStatus === "pending-memory-operator-command-receipt"
            ? upstreamMemoryPackage.operatorCommandReceipt.nextAction
          : adoptionStatus === "blocked-by-verifier-handoff" || adoptionStatus === "pending-verifier-handoff"
            ? upstreamVerifierPackage.nextAction
          : routePreviewAcceptanceState.readiness.nextAction,
    },
    upstreamMemoryPackage,
    upstreamVerifierPackage,
    routeCommands,
    nextSteps,
    nextAction: adoptionStatus === "needs-client-state"
      ? "hydrate-syscall-client-state"
      : adoptionStatus === "blocked-by-memory-preview" || adoptionStatus === "pending-memory-readiness"
        ? upstreamMemoryPackage.nextAction
        : adoptionStatus === "pending-memory-control-plane"
          ? upstreamMemoryPackage.controlPlane.nextAction
        : adoptionStatus === "pending-memory-client-workflow"
          ? upstreamMemoryPackage.clientWorkflowHandoff.nextAction
        : adoptionStatus === "pending-memory-client-workflow-receipt"
          ? upstreamMemoryPackage.clientWorkflowHandoff.releaseReceipt.nextAction
        : adoptionStatus === "pending-memory-boundary-lease"
          ? upstreamMemoryPackage.boundaryLease.nextAction
        : adoptionStatus === "pending-memory-syscall-dispatch-gate"
          ? upstreamMemoryPackage.syscallDispatchGate.nextAction
        : adoptionStatus === "pending-memory-provider-assertions"
          ? upstreamMemoryPackage.providerAssertionDigest.nextAction
        : adoptionStatus === "pending-memory-provider-sync-release"
          ? upstreamMemoryPackage.providerSyncReleaseReceipt.nextAction
        : adoptionStatus === "pending-memory-audience-watermark"
          ? upstreamMemoryPackage.audienceSyncWatermark.nextAction
        : adoptionStatus === "pending-memory-audience-continuity"
          ? upstreamMemoryPackage.audienceContinuityReceipt.nextAction
        : adoptionStatus === "pending-memory-operator-release"
          ? upstreamMemoryPackage.operatorRelease.nextAction
        : adoptionStatus === "pending-memory-dispatch-release-ledger"
          ? upstreamMemoryPackage.dispatchReleaseLedger.nextAction
        : adoptionStatus === "pending-memory-claim-runtime-adoption"
          ? upstreamMemoryPackage.claimRuntimeAdoptionReceipt.nextAction
        : adoptionStatus === "pending-memory-runtime-dispatch-release"
          ? upstreamMemoryPackage.runtimeDispatchReleaseReceipt.nextAction
        : adoptionStatus === "pending-memory-operator-command-receipt"
          ? upstreamMemoryPackage.operatorCommandReceipt.nextAction
        : adoptionStatus === "blocked-by-verifier-handoff" || adoptionStatus === "pending-verifier-handoff"
          ? upstreamVerifierPackage.nextAction
        : acceptedForRuntime
          ? "handoff-syscall-batch-to-adapter"
          : routePreviewAcceptanceState.readiness.nextAction,
  };
}

function buildRestartSafeDispatchJournal(
  boundary,
  dispatchBatchState,
  externalHandoffState,
  routePreviewAcceptanceState,
  clientRuntimeAdoptionState,
  lifecycleControls,
  providerServiceContract,
) {
  const providerJob = boundary.providerJob || {};
  const journalSource = boundary.dispatchJournal
    || boundary.recovery?.dispatchJournal
    || providerJob.dispatchJournal
    || {};
  const existingEntries = asArray(journalSource.entries);
  const selectedSyscalls = dispatchBatchState.selectedSyscalls.map((syscall) => syscall.name);
  const heldExternalWrites = asArray(dispatchBatchState.heldExternalWrites);
  const blockedBy = [
    ...asArray(dispatchBatchState.blockedBy),
    ...providerServiceContract.missingCapabilities.map((capability) => `capability:${capability}`),
    ...clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.blockedBy.map((blocker) => `memory:${blocker}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.syscallDispatchGate.blockedBy
      .map((blocker) => `memory-syscall-gate:${blocker}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.providerAssertionDigest.blockedBy
      .map((blocker) => `memory-provider-assertion:${blocker}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.audienceContinuityReceipt.blockedBy
      .map((blocker) => `memory-audience-continuity:${blocker}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.operatorRelease.blockedBy
      .map((blocker) => `memory-operator-release:${blocker}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.dispatchReleaseLedger.blockedBy
      .map((blocker) => `memory-dispatch-ledger:${blocker}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.operatorCommandReceipt.blockedBy
      .map((blocker) => `memory-operator-command:${blocker}`),
    ...clientRuntimeAdoptionState.upstreamVerifierPackage.blockedBy.map((blocker) => `verifier:${blocker}`),
    ...asArray(routePreviewAcceptanceState.readiness.failedChecks).map((check) => `preview:${check}`),
  ].sort();
  const pendingBy = [
    ...heldExternalWrites.map((syscall) => `external-write:${syscall}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.pendingChecks.map((check) => `memory-check:${check}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.syscallDispatchGate.pendingBy
      .map((pending) => `memory-syscall-gate:${pending}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.providerAssertionDigest.pendingBy
      .map((pending) => `memory-provider-assertion:${pending}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.audienceContinuityReceipt.pendingBy
      .map((pending) => `memory-audience-continuity:${pending}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.operatorRelease.pendingBy
      .map((pending) => `memory-operator-release:${pending}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.dispatchReleaseLedger.pendingBy
      .map((pending) => `memory-dispatch-ledger:${pending}`),
    ...clientRuntimeAdoptionState.upstreamMemoryPackage.operatorCommandReceipt.pendingBy
      .map((pending) => `memory-operator-command:${pending}`),
    ...clientRuntimeAdoptionState.upstreamVerifierPackage.pendingBy.map((pending) => `verifier:${pending}`),
    ...asArray(routePreviewAcceptanceState.readiness.pendingChecks).map((check) => `preview:${check}`),
  ].sort();
  const restartSafe = clientRuntimeAdoptionState.hydrated
    && providerServiceContract.status === "negotiated"
    && blockedBy.length === 0
    && lifecycleControls.diagnostics.every((diagnostic) => diagnostic.level !== "error");
  const handoffReady = restartSafe
    && clientRuntimeAdoptionState.acceptedForRuntime
    && routePreviewAcceptanceState.acceptance.acceptedForRuntime;
  const journalId = journalSource.journalId || stableId("mailchimp-syscall-dispatch-journal", [
    boundary.boundaryId,
    dispatchBatchState.batchId,
    externalHandoffState.handoffId,
    clientRuntimeAdoptionState.stateKey,
  ]);
  const baseEntries = [
    {
      entryId: stableId("syscall-journal-entry", [journalId, "client-state"]),
      phase: "client-state",
      status: clientRuntimeAdoptionState.hydrated ? "persisted" : "needs-hydration",
      stateKey: clientRuntimeAdoptionState.stateKey,
      nextAction: clientRuntimeAdoptionState.hydrated
        ? "resume-syscall-preview"
        : "hydrate-syscall-client-state",
    },
    {
      entryId: stableId("syscall-journal-entry", [journalId, "memory"]),
      phase: "memory-readiness",
      status: clientRuntimeAdoptionState.upstreamMemoryPackage.present
        ? clientRuntimeAdoptionState.upstreamMemoryPackage.readinessStatus
        : "not-provided",
      packageId: clientRuntimeAdoptionState.upstreamMemoryPackage.packageId,
      nextAction: clientRuntimeAdoptionState.upstreamMemoryPackage.nextAction,
    },
    {
      entryId: stableId("syscall-journal-entry", [journalId, "verifier"]),
      phase: "verifier-handoff",
      status: clientRuntimeAdoptionState.upstreamVerifierPackage.present
        ? clientRuntimeAdoptionState.upstreamVerifierPackage.status
        : "not-provided",
      packageId: clientRuntimeAdoptionState.upstreamVerifierPackage.packageId,
      nextAction: clientRuntimeAdoptionState.upstreamVerifierPackage.nextAction,
    },
    {
      entryId: stableId("syscall-journal-entry", [journalId, "dispatch"]),
      phase: "dispatch-batch",
      status: dispatchBatchState.status,
      batchId: dispatchBatchState.batchId,
      syscalls: selectedSyscalls,
      nextAction: dispatchBatchState.nextAction,
    },
    {
      entryId: stableId("syscall-journal-entry", [journalId, "handoff"]),
      phase: "adapter-handoff",
      status: handoffReady ? "ready" : blockedBy.length ? "blocked" : "waiting",
      handoffId: externalHandoffState.handoffId,
      nextAction: handoffReady
        ? "handoff-syscall-batch-to-adapter"
        : clientRuntimeAdoptionState.nextAction,
    },
  ];
  const idempotentCommands = [
    ...clientRuntimeAdoptionState.routeCommands
      .filter((command) => command.idempotencyKey)
      .map((command) => ({
        command: command.command,
        idempotencyKey: command.idempotencyKey,
        enabled: command.enabled,
      })),
    {
      command: "persist-syscall-dispatch-journal",
      idempotencyKey: `syscall-journal:${journalId}`,
      enabled: true,
    },
    {
      command: "resume-syscall-dispatch",
      idempotencyKey: `syscall-resume:${stableId("syscall-resume", [
        journalId,
        dispatchBatchState.batchId,
        externalHandoffState.handoffId,
      ])}`,
      enabled: restartSafe && selectedSyscalls.length > 0,
    },
  ];
  const retryPlan = {
    retryable: restartSafe && !heldExternalWrites.length,
    backoff: {
      strategy: journalSource.backoff?.strategy || "bounded-exponential",
      initialDelaySeconds: Math.max(5, Number(journalSource.backoff?.initialDelaySeconds || 15)),
      maxDelaySeconds: Math.max(30, Number(journalSource.backoff?.maxDelaySeconds || 300)),
      maxAttempts: Math.max(1, Number(journalSource.backoff?.maxAttempts || 3)),
    },
    blockedBy,
    pendingBy,
    nextAction: blockedBy.length
      ? blockedBy[0].startsWith("client-state:")
        ? "hydrate-syscall-client-state"
        : blockedBy[0].startsWith("memory-dispatch-ledger:")
          ? clientRuntimeAdoptionState.upstreamMemoryPackage.dispatchReleaseLedger.nextAction
        : blockedBy[0].startsWith("memory:")
          ? clientRuntimeAdoptionState.upstreamMemoryPackage.nextAction
          : blockedBy[0].startsWith("verifier:")
            ? clientRuntimeAdoptionState.upstreamVerifierPackage.nextAction
          : "repair-syscall-dispatch-preview"
      : pendingBy.length
        ? pendingBy[0].startsWith("external-write:")
          ? "collect-operator-approval"
          : clientRuntimeAdoptionState.nextAction
        : handoffReady
          ? "handoff-syscall-batch-to-adapter"
          : clientRuntimeAdoptionState.nextAction,
  };

  return {
    journalId,
    status: blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : handoffReady
          ? "ready"
          : "waiting",
    restartSafe,
    handoffReady,
    providerJobId: providerJob.jobId || null,
    stateKey: clientRuntimeAdoptionState.stateKey,
    continuationToken: clientRuntimeAdoptionState.continuationToken,
    entries: [...baseEntries, ...existingEntries],
    persistedState: {
      ...(journalSource.persistedState || {}),
      journalId,
      boundaryId: boundary.boundaryId,
      batchId: dispatchBatchState.batchId,
      handoffId: externalHandoffState.handoffId,
      stateKey: clientRuntimeAdoptionState.stateKey,
      status: handoffReady ? "ready" : blockedBy.length ? "blocked" : "waiting",
      selectedSyscalls,
      heldExternalWrites,
      nextAction: retryPlan.nextAction,
    },
    idempotentCommands,
    retryPlan,
    resumeAfter: handoffReady
      ? "adapter-ack"
      : retryPlan.nextAction,
  };
}

function buildTenantAuditBoundaryState(
  boundary,
  lifecycleControls,
  routePreviewAcceptanceState,
  clientRuntimeAdoptionState,
  dispatchRecoveryJournal,
) {
  const providerJob = boundary.providerJob || {};
  const tenantPolicy = boundary.tenantPolicy || providerJob.tenantPolicy || {};
  const activeBoundary = tenantPolicy.activeBoundary || {};
  const operatorControlState = boundary.operatorControlState || {};
  const clientRuntime = boundary.clientRuntime || providerJob.clientRuntime || {};
  const actorRole = operatorControlState.actorRole
    || clientRuntime.actorRole
    || boundary.actorRole
    || "operator";
  const tenantId = activeBoundary.tenantId
    || tenantPolicy.tenantId
    || clientRuntime.tenantId
    || boundary.tenantId
    || null;
  const workspaceId = activeBoundary.workspaceId
    || clientRuntime.workspaceId
    || boundary.workspaceId
    || null;
  const allowedRoles = asArray(activeBoundary.allowedRoles || tenantPolicy.allowedRoles || [
    "operator",
    "approver",
    "admin",
  ]);
  const rolePolicies = asArray(tenantPolicy.rolePolicies);
  const explicitRolePolicy = rolePolicies.find((policy) => policy?.role === actorRole) || {};
  const canExecute = explicitRolePolicy.canExecute !== false && allowedRoles.includes(actorRole);
  const canApprove = explicitRolePolicy.canApprove === true
    || actorRole === "approver"
    || actorRole === "admin";
  const externalWriteRequested = routePreviewAcceptanceState.acceptance.required === true;
  const requiresApproval = activeBoundary.requiresApprovalForExternalWrite !== false
    && (tenantPolicy.requiresApprovalForExternalWrite !== false || externalWriteRequested);
  const tenantBlockedBy = [
    ...(tenantId ? [] : ["tenant:missing"]),
    ...(workspaceId ? [] : ["workspace:missing"]),
    ...(allowedRoles.includes(actorRole) ? [] : [`role:${actorRole}:not-allowed`]),
    ...(externalWriteRequested && requiresApproval && !canApprove
      ? [`role:${actorRole}:cannot-approve-external-write`]
      : []),
  ].sort();
  const auditEvents = [
    {
      event: "syscall.preview.rendered",
      subject: routePreviewAcceptanceState.preview.previewId,
      status: routePreviewAcceptanceState.preview.status,
    },
    {
      event: "syscall.client-state.persisted",
      subject: clientRuntimeAdoptionState.stateKey,
      status: clientRuntimeAdoptionState.hydrated ? "hydrated" : "needs-client-state",
    },
    {
      event: "syscall.dispatch.journaled",
      subject: dispatchRecoveryJournal.journalId,
      status: dispatchRecoveryJournal.status,
    },
    {
      event: "syscall.adapter-handoff",
      subject: dispatchRecoveryJournal.persistedState.handoffId,
      status: dispatchRecoveryJournal.handoffReady ? "ready" : "held",
    },
  ];
  const auditId = stableId("mailchimp-syscall-audit", [
    tenantId,
    workspaceId,
    actorRole,
    dispatchRecoveryJournal.journalId,
    auditEvents.map((event) => [event.event, event.status]),
  ]);
  const auditReady = tenantBlockedBy.length === 0
    && canExecute
    && (!externalWriteRequested || !requiresApproval || canApprove);
  const commandPolicy = [
    {
      command: "render-syscall-preview",
      enabled: tenantBlockedBy.length === 0,
      reason: tenantBlockedBy.length ? "tenant boundary must be resolved" : "preview is tenant-scoped",
    },
    {
      command: "persist-syscall-client-state",
      enabled: tenantBlockedBy.length === 0 && canExecute,
      reason: canExecute ? "actor can persist workspace route state" : "actor role cannot execute in workspace",
    },
    {
      command: "accept-syscall-preview",
      enabled: tenantBlockedBy.length === 0 && (!requiresApproval || canApprove),
      reason: requiresApproval && !canApprove
        ? "actor role cannot approve external-write syscall handoff"
        : "acceptance is allowed by tenant policy",
    },
    {
      command: "handoff-syscall-batch-to-adapter",
      enabled: auditReady && dispatchRecoveryJournal.handoffReady,
      reason: auditReady
        ? "tenant audit boundary is satisfied"
        : "tenant audit boundary blocks adapter handoff",
    },
  ];

  return {
    auditId,
    tenantId,
    workspaceId,
    actorRole,
    allowedRoles: [...new Set(allowedRoles)].sort(),
    canExecute,
    canApprove,
    requiresApproval,
    status: tenantBlockedBy.length
      ? "blocked"
      : auditReady
        ? "ready"
        : "needs-approval",
    tenantBlockedBy,
    auditEvents,
    commandPolicy,
    persistedState: {
      auditId,
      tenantId,
      workspaceId,
      actorRole,
      dispatchJournalId: dispatchRecoveryJournal.journalId,
      status: tenantBlockedBy.length ? "blocked" : "ready",
      nextAction: tenantBlockedBy.length
        ? "repair-tenant-boundary"
        : auditReady
          ? "persist-syscall-audit"
          : "collect-operator-approval",
    },
    nextAction: tenantBlockedBy.length
      ? "repair-tenant-boundary"
      : auditReady
        ? "persist-syscall-audit"
        : "collect-operator-approval",
  };
}

function buildSyscallOperationalReportingState(
  boundary,
  syscalls,
  lifecycleControls,
  providerServiceContract,
  dispatchBatchState,
  externalHandoffState,
  routePreviewAcceptanceState,
  clientRuntimeAdoptionState,
  dispatchRecoveryJournal,
  tenantAuditBoundaryState,
  lifecycleDiagnostics,
) {
  const upstreamMemory = clientRuntimeAdoptionState.upstreamMemoryPackage;
  const upstreamVerifier = clientRuntimeAdoptionState.upstreamVerifierPackage;
  const verifierTenantGuard = upstreamVerifier.tenantDispatchGuard;
  const lifecycleErrors = lifecycleDiagnostics.filter((diagnostic) => diagnostic.level === "error");
  const lifecycleWarnings = lifecycleDiagnostics.filter((diagnostic) => diagnostic.level === "warning");
  const readySyscalls = syscalls.filter((syscall) => syscall.status === "ready");
  const approvalGated = syscalls.filter((syscall) => syscall.status === "approval-gated");
  const blocked = syscalls.filter((syscall) => syscall.status === "blocked");
  const memoryHealthBlocks = upstreamMemory.blockedBy
    .filter((blocker) => blocker.startsWith("memory-health:"));
  const memoryHealthPending = upstreamMemory.pendingChecks
    .filter((check) => check.startsWith("memory-health:"));
  const memoryControlBlocked = upstreamMemory.controlPlane.blockedBy;
  const memoryControlPending = upstreamMemory.controlPlane.pendingBy;
  const memoryWorkflowBlocked = upstreamMemory.clientWorkflowHandoff.blockedBy;
  const memoryWorkflowPending = upstreamMemory.clientWorkflowHandoff.pendingBy;
  const memoryWorkflowReceiptBlocked = upstreamMemory.clientWorkflowHandoff.releaseReceipt.blockedBy;
  const memoryWorkflowReceiptPending = upstreamMemory.clientWorkflowHandoff.releaseReceipt.pendingBy;
  const memoryBoundaryBlocked = upstreamMemory.boundaryLease.blockedBy;
  const memoryBoundaryPending = upstreamMemory.boundaryLease.pendingBy;
  const memoryProviderServiceBlocked = upstreamMemory.providerService.blockedBy;
  const memoryProviderServicePending = upstreamMemory.providerService.pendingBy;
  const memoryProviderAssertionBlocked = upstreamMemory.providerAssertionDigest.blockedBy;
  const memoryProviderAssertionPending = upstreamMemory.providerAssertionDigest.pendingBy;
  const memoryReleaseRiskBlocked = upstreamMemory.releaseRiskBudget.blockedBy;
  const memoryReleaseRiskPending = upstreamMemory.releaseRiskBudget.pendingBy;
  const memoryOperatorReleaseBlocked = upstreamMemory.operatorRelease.blockedBy;
  const memoryOperatorReleasePending = upstreamMemory.operatorRelease.pendingBy;
  const memoryDispatchLedgerBlocked = upstreamMemory.dispatchReleaseLedger.blockedBy;
  const memoryDispatchLedgerPending = upstreamMemory.dispatchReleaseLedger.pendingBy;
  const memoryClaimRuntimeBlocked = upstreamMemory.claimRuntimeAdoptionReceipt.blockedBy;
  const memoryClaimRuntimePending = upstreamMemory.claimRuntimeAdoptionReceipt.pendingBy;
  const memoryResumeBlocked = upstreamMemory.operatorResume.blockedBy;
  const memoryResumePending = upstreamMemory.operatorResume.pendingBy;
  const memorySyscallGateBlocked = upstreamMemory.syscallDispatchGate.blockedBy;
  const memorySyscallGatePending = upstreamMemory.syscallDispatchGate.pendingBy;
  const exportBlockedBy = [
    ...blocked.map((syscall) => `syscall:${syscall.name}`),
    ...providerServiceContract.missingCapabilities.map((capability) => `capability:${capability}`),
    ...clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
    ...upstreamMemory.blockedBy.map((blocker) => `memory:${blocker}`),
    ...memoryClaimRuntimeBlocked.map((blocker) => `memory-claim-runtime:${blocker}`),
    ...upstreamVerifier.blockedBy.map((blocker) => `verifier:${blocker}`),
    ...verifierTenantGuard.blockedBy.map((blocker) => `verifier-tenant:${blocker}`),
    ...tenantAuditBoundaryState.tenantBlockedBy,
    ...lifecycleErrors.map((diagnostic) => diagnostic.code),
  ].sort();
  const exportPendingBy = [
    ...dispatchBatchState.heldExternalWrites.map((syscall) => `external-write:${syscall}`),
    ...upstreamMemory.pendingChecks.map((check) => `memory:${check}`),
    ...memoryClaimRuntimePending.map((pending) => `memory-claim-runtime:${pending}`),
    ...upstreamVerifier.pendingBy.map((pending) => `verifier:${pending}`),
    ...verifierTenantGuard.pendingBy.map((pending) => `verifier-tenant:${pending}`),
    ...asArray(routePreviewAcceptanceState.readiness.pendingChecks).map((check) => `preview:${check}`),
    ...lifecycleWarnings.map((diagnostic) => diagnostic.code),
  ].sort();
  const analyticsCounters = {
    syscallsTotal: syscalls.length,
    readySyscalls: readySyscalls.length,
    approvalGatedSyscalls: approvalGated.length,
    blockedSyscalls: blocked.length,
    selectedSyscalls: dispatchBatchState.selectedSyscalls.length,
    heldExternalWrites: dispatchBatchState.heldExternalWrites.length,
    missingProviderCapabilities: providerServiceContract.missingCapabilities.length,
    lifecycleErrors: lifecycleErrors.length,
    lifecycleWarnings: lifecycleWarnings.length,
    memoryPackagePresent: upstreamMemory.present ? 1 : 0,
    memoryHealthErrors: upstreamMemory.healthIncidentSummary.errors || 0,
    memoryHealthWarnings: upstreamMemory.healthIncidentSummary.warnings || 0,
    memoryHealthRetryable: upstreamMemory.healthIncidentSummary.retryable || 0,
    memoryHealthBlocks: memoryHealthBlocks.length,
    memoryHealthPending: memoryHealthPending.length,
    memoryControlPlanePresent: upstreamMemory.controlPlane.present ? 1 : 0,
    memoryControlPlaneBlocked: memoryControlBlocked.length,
    memoryControlPlanePending: memoryControlPending.length,
    memoryClientWorkflowPresent: upstreamMemory.clientWorkflowHandoff.present ? 1 : 0,
    memoryClientWorkflowBlocked: memoryWorkflowBlocked.length,
    memoryClientWorkflowPending: memoryWorkflowPending.length,
    memoryClientWorkflowReceiptBlocked: memoryWorkflowReceiptBlocked.length,
    memoryClientWorkflowReceiptPending: memoryWorkflowReceiptPending.length,
    memoryClientWorkflowReceiptGates: upstreamMemory.clientWorkflowHandoff.releaseReceipt.gateReceipts.length,
    memoryClaimRuntimeReceiptPresent: upstreamMemory.claimRuntimeAdoptionReceipt.present ? 1 : 0,
    memoryClaimRuntimeReceiptBlocked: memoryClaimRuntimeBlocked.length,
    memoryClaimRuntimeReceiptPending: memoryClaimRuntimePending.length,
    memoryClaimRuntimeEvidenceRows: upstreamMemory.claimRuntimeAdoptionReceipt.evidenceRows.length,
    memoryBoundaryLeasePresent: upstreamMemory.boundaryLease.present ? 1 : 0,
    memoryBoundaryLeaseBlocked: memoryBoundaryBlocked.length,
    memoryBoundaryLeasePending: memoryBoundaryPending.length,
    memoryProviderServicePresent: upstreamMemory.providerService.present ? 1 : 0,
    memoryProviderServiceBlocked: memoryProviderServiceBlocked.length,
    memoryProviderServicePending: memoryProviderServicePending.length,
    memoryProviderServiceRows: upstreamMemory.providerService.serviceBindingRows.length,
    memoryProviderAssertionPresent: upstreamMemory.providerAssertionDigest.present ? 1 : 0,
    memoryProviderAssertionBlocked: memoryProviderAssertionBlocked.length,
    memoryProviderAssertionPending: memoryProviderAssertionPending.length,
    memoryProviderAssertionRows: upstreamMemory.providerAssertionDigest.assertionRows.length,
    memoryProviderAssertionVerified: upstreamMemory.providerAssertionDigest.counters.verifiedRows || 0,
    memoryReleaseRiskPresent: upstreamMemory.releaseRiskBudget.present ? 1 : 0,
    memoryReleaseRiskBlocked: memoryReleaseRiskBlocked.length,
    memoryReleaseRiskPending: memoryReleaseRiskPending.length,
    memoryReleaseRiskScore: upstreamMemory.releaseRiskBudget.totalRiskScore,
    memoryReleaseRiskRows: upstreamMemory.releaseRiskBudget.releaseRows.length,
    memoryOperatorReleasePresent: upstreamMemory.operatorRelease.present ? 1 : 0,
    memoryOperatorReleaseBlocked: memoryOperatorReleaseBlocked.length,
    memoryOperatorReleasePending: memoryOperatorReleasePending.length,
    memoryOperatorReleaseRows: upstreamMemory.operatorRelease.gateRows.length,
    memoryDispatchLedgerPresent: upstreamMemory.dispatchReleaseLedger.present ? 1 : 0,
    memoryDispatchLedgerBlocked: memoryDispatchLedgerBlocked.length,
    memoryDispatchLedgerPending: memoryDispatchLedgerPending.length,
    memoryDispatchLedgerSources: upstreamMemory.dispatchReleaseLedger.sourceRows.length,
    memoryDispatchLedgerMounts: upstreamMemory.dispatchReleaseLedger.mountRows.length,
    memoryOperatorResumePresent: upstreamMemory.operatorResume.present ? 1 : 0,
    memoryOperatorResumeBlocked: memoryResumeBlocked.length,
    memoryOperatorResumePending: memoryResumePending.length,
    memorySyscallGatePresent: upstreamMemory.syscallDispatchGate.present ? 1 : 0,
    memorySyscallGateBlocked: memorySyscallGateBlocked.length,
    memorySyscallGatePending: memorySyscallGatePending.length,
    memorySyscallGateRows: upstreamMemory.syscallDispatchGate.gateRows.length,
    verifierPackagePresent: upstreamVerifier.present ? 1 : 0,
    verifierHealthErrors: upstreamVerifier.incidentSummary.errors || 0,
    verifierHealthWarnings: upstreamVerifier.incidentSummary.warnings || 0,
    verifierHealthRetryable: upstreamVerifier.incidentSummary.retryable || 0,
    verifierBlocked: upstreamVerifier.blockedBy.length,
    verifierPending: upstreamVerifier.pendingBy.length,
    verifierTenantGuardPresent: verifierTenantGuard.present ? 1 : 0,
    verifierTenantGuardBlocked: verifierTenantGuard.blockedBy.length,
    verifierTenantGuardPending: verifierTenantGuard.pendingBy.length,
    verifierTenantGuardRows: verifierTenantGuard.statusRows.length,
    restartJournalEntries: dispatchRecoveryJournal.entries.length,
  };
  const selectedByName = new Map(dispatchBatchState.selectedSyscalls.map((syscall) => [syscall.name, syscall]));
  const previewByName = new Map(routePreviewAcceptanceState.preview.rows.map((row) => [row.name, row]));
  const journalBySyscall = new Map(dispatchRecoveryJournal.entries.map((entry) => [entry.syscall, entry]));
  const auditBySyscall = new Map(tenantAuditBoundaryState.auditEvents.map((event) => [event.syscall, event]));
  const operationExportRows = syscalls.map((syscall) => {
    const selected = selectedByName.has(syscall.name);
    const preview = previewByName.get(syscall.name) || {};
    const journal = journalBySyscall.get(syscall.name) || {};
    const audit = auditBySyscall.get(syscall.name) || {};
    const blockedBy = [
      ...(syscall.status === "blocked" ? [`syscall:${syscall.name}`] : []),
      ...syscall.negotiation.missing.map((capability) => `capability:${capability}`),
      ...(selected ? [] : preview.displayState === "available" ? ["dispatch:not-selected"] : []),
      ...(syscall.status === "approval-gated" && !externalHandoffState.externalWrite.accepted
        ? ["external-write:approval-required"]
        : []),
      ...(tenantAuditBoundaryState.status === "blocked" ? tenantAuditBoundaryState.tenantBlockedBy : []),
    ].sort();
    const pendingBy = [
      ...(dispatchBatchState.heldExternalWrites.includes(syscall.name) ? ["external-write:held"] : []),
      ...(journal.replaySafe === false ? ["journal:operator-review-required"] : []),
      ...(audit.requiresApproval && audit.accepted !== true ? ["audit:approval-pending"] : []),
    ].sort();
    const exportState = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : selected
          ? "selected"
          : syscall.status === "ready"
            ? "available"
            : syscall.status;
    return {
      syscall: syscall.name,
      id: syscall.id,
      state: exportState,
      selected,
      displayState: preview.displayState || syscall.status,
      retrySafe: syscall.recovery.retrySafe,
      sideEffects: syscall.sideEffects,
      requiredCapabilities: syscall.requiredCapabilities,
      missingCapabilities: syscall.negotiation.missing,
      blockedBy,
      pendingBy,
      journalId: journal.journalId || dispatchRecoveryJournal.journalId,
      journalStatus: journal.status || dispatchRecoveryJournal.status,
      auditEventId: audit.eventId || null,
      auditStatus: audit.status || tenantAuditBoundaryState.status,
      statusChannel: selected ? dispatchBatchState.statusChannel : "syscall.preview.mailchimp",
      nextAction: blockedBy.length
        ? syscall.recovery.nextAction
        : pendingBy.includes("external-write:held") || pendingBy.includes("audit:approval-pending")
          ? "collect-operator-approval"
          : selected
            ? "handoff-syscall-batch-to-adapter"
            : preview.nextAction || syscall.recovery.nextAction,
    };
  });
  const exportReadyRows = operationExportRows.filter((row) => row.state === "selected");
  const exportBlockedRows = operationExportRows.filter((row) => row.state === "blocked");
  const exportPendingRows = operationExportRows.filter((row) => row.state === "pending");
  const healthTimeline = [
    {
      phase: "memory-health",
      status: upstreamMemory.healthStatus,
      healthId: upstreamMemory.healthId,
      counters: upstreamMemory.healthIncidentSummary,
      nextAction: upstreamMemory.retryableHealth
        ? "schedule-memory-health-retry"
        : upstreamMemory.nextAction,
    },
    {
      phase: "memory-control-plane",
      status: upstreamMemory.controlPlane.status,
      healthId: upstreamMemory.controlPlane.controlPlaneId,
      counters: {
        blockedBy: memoryControlBlocked.length,
        pendingBy: memoryControlPending.length,
        commands: upstreamMemory.controlPlane.commands.length,
      },
      nextAction: upstreamMemory.controlPlane.nextAction,
    },
    {
      phase: "memory-client-workflow",
      status: upstreamMemory.clientWorkflowHandoff.status,
      healthId: upstreamMemory.clientWorkflowHandoff.packetId,
      counters: {
        blockedBy: memoryWorkflowBlocked.length,
        pendingBy: memoryWorkflowPending.length,
        receiptBlockedBy: memoryWorkflowReceiptBlocked.length,
        receiptPendingBy: memoryWorkflowReceiptPending.length,
        receiptGates: upstreamMemory.clientWorkflowHandoff.releaseReceipt.gateReceipts.length,
        commands: upstreamMemory.clientWorkflowHandoff.commands.length,
      },
      nextAction: upstreamMemory.clientWorkflowHandoff.nextAction,
    },
    {
      phase: "memory-boundary-lease",
      status: upstreamMemory.boundaryLease.status,
      healthId: upstreamMemory.boundaryLease.packetId,
      counters: {
        blockedBy: memoryBoundaryBlocked.length,
        pendingBy: memoryBoundaryPending.length,
        leaseRows: upstreamMemory.boundaryLease.leaseRows.length,
        ttlSeconds: upstreamMemory.boundaryLease.ttlSeconds || 0,
      },
      nextAction: upstreamMemory.boundaryLease.nextAction,
    },
    {
      phase: "memory-provider-service",
      status: upstreamMemory.providerService.status,
      healthId: upstreamMemory.providerService.contractId,
      counters: {
        blockedBy: memoryProviderServiceBlocked.length,
        pendingBy: memoryProviderServicePending.length,
        requestedCapabilities: upstreamMemory.providerService.requestedCapabilities.length,
        negotiatedCapabilities: upstreamMemory.providerService.negotiatedCapabilities.length,
        serviceBindings: upstreamMemory.providerService.serviceBindingRows.length,
      },
      nextAction: upstreamMemory.providerService.nextAction,
    },
    {
      phase: "memory-provider-assertions",
      status: upstreamMemory.providerAssertionDigest.status,
      healthId: upstreamMemory.providerAssertionDigest.digestId,
      counters: {
        blockedBy: memoryProviderAssertionBlocked.length,
        pendingBy: memoryProviderAssertionPending.length,
        assertionRows: upstreamMemory.providerAssertionDigest.assertionRows.length,
        verifiedRows: upstreamMemory.providerAssertionDigest.counters.verifiedRows || 0,
      },
      nextAction: upstreamMemory.providerAssertionDigest.nextAction,
    },
    {
      phase: "memory-release-risk",
      status: upstreamMemory.releaseRiskBudget.status,
      healthId: upstreamMemory.releaseRiskBudget.budgetId,
      counters: {
        blockedBy: memoryReleaseRiskBlocked.length,
        pendingBy: memoryReleaseRiskPending.length,
        totalRiskScore: upstreamMemory.releaseRiskBudget.totalRiskScore,
        releaseRows: upstreamMemory.releaseRiskBudget.releaseRows.length,
      },
      nextAction: upstreamMemory.releaseRiskBudget.nextAction,
    },
    {
      phase: "memory-operator-release",
      status: upstreamMemory.operatorRelease.status,
      healthId: upstreamMemory.operatorRelease.packetId,
      counters: {
        blockedBy: memoryOperatorReleaseBlocked.length,
        pendingBy: memoryOperatorReleasePending.length,
        gates: upstreamMemory.operatorRelease.gateRows.length,
        acceptedForSyscallDispatch: upstreamMemory.operatorRelease.acceptedForSyscallDispatch ? 1 : 0,
      },
      nextAction: upstreamMemory.operatorRelease.nextAction,
    },
    {
      phase: "memory-dispatch-release-ledger",
      status: upstreamMemory.dispatchReleaseLedger.status,
      healthId: upstreamMemory.dispatchReleaseLedger.ledgerId,
      counters: {
        blockedBy: memoryDispatchLedgerBlocked.length,
        pendingBy: memoryDispatchLedgerPending.length,
        sources: upstreamMemory.dispatchReleaseLedger.sourceRows.length,
        mounts: upstreamMemory.dispatchReleaseLedger.mountRows.length,
        acceptedForSyscallDispatch: upstreamMemory.dispatchReleaseLedger.acceptedForSyscallDispatch ? 1 : 0,
      },
      nextAction: upstreamMemory.dispatchReleaseLedger.nextAction,
    },
    {
      phase: "memory-claim-runtime-adoption",
      status: upstreamMemory.claimRuntimeAdoptionReceipt.status,
      healthId: upstreamMemory.claimRuntimeAdoptionReceipt.receiptId,
      counters: {
        blockedBy: memoryClaimRuntimeBlocked.length,
        pendingBy: memoryClaimRuntimePending.length,
        evidenceRows: upstreamMemory.claimRuntimeAdoptionReceipt.evidenceRows.length,
        acceptedForSyscallDispatch: upstreamMemory.claimRuntimeAdoptionReceipt.acceptedForSyscallDispatch ? 1 : 0,
      },
      nextAction: upstreamMemory.claimRuntimeAdoptionReceipt.nextAction,
    },
    {
      phase: "memory-operator-resume",
      status: upstreamMemory.operatorResume.status,
      healthId: upstreamMemory.operatorResume.packetId,
      counters: {
        blockedBy: memoryResumeBlocked.length,
        pendingBy: memoryResumePending.length,
        commands: upstreamMemory.operatorResume.commands.length,
      },
      nextAction: upstreamMemory.operatorResume.nextAction,
    },
    {
      phase: "memory-syscall-dispatch-gate",
      status: upstreamMemory.syscallDispatchGate.status,
      healthId: upstreamMemory.syscallDispatchGate.gateId,
      counters: {
        blockedBy: memorySyscallGateBlocked.length,
        pendingBy: memorySyscallGatePending.length,
        gates: upstreamMemory.syscallDispatchGate.gateRows.length,
        retryable: upstreamMemory.syscallDispatchGate.retryable ? 1 : 0,
      },
      nextAction: upstreamMemory.syscallDispatchGate.nextAction,
    },
    {
      phase: "verifier-handoff",
      status: upstreamVerifier.status,
      healthId: upstreamVerifier.healthId,
      counters: upstreamVerifier.incidentSummary,
      nextAction: upstreamVerifier.retryable
        ? "schedule-verifier-syscall-health-retry"
        : upstreamVerifier.nextAction,
    },
    {
      phase: "verifier-tenant-dispatch-guard",
      status: verifierTenantGuard.status,
      healthId: verifierTenantGuard.guardId,
      counters: {
        blockedBy: verifierTenantGuard.blockedBy.length,
        pendingBy: verifierTenantGuard.pendingBy.length,
        statusRows: verifierTenantGuard.statusRows.length,
        acceptedForSyscallDispatch: verifierTenantGuard.acceptedForSyscallDispatch ? 1 : 0,
      },
      nextAction: verifierTenantGuard.nextAction,
    },
    {
      phase: "provider-negotiation",
      status: providerServiceContract.status,
      counters: {
        requestedCapabilities: providerServiceContract.requestedCapabilities.length,
        negotiatedCapabilities: providerServiceContract.negotiatedCapabilities.length,
        missingCapabilities: providerServiceContract.missingCapabilities.length,
      },
      nextAction: providerServiceContract.status === "negotiated"
        ? "prepare-syscall-dispatch"
        : "refresh-provider-service-capabilities",
    },
    {
      phase: "dispatch-batch",
      status: dispatchBatchState.status,
      counters: {
        selectedSyscalls: dispatchBatchState.selectedSyscalls.length,
        blockedBy: dispatchBatchState.blockedBy.length,
        heldExternalWrites: dispatchBatchState.heldExternalWrites.length,
      },
      nextAction: dispatchBatchState.nextAction,
    },
    {
      phase: "tenant-audit",
      status: tenantAuditBoundaryState.status,
      counters: {
        blockers: tenantAuditBoundaryState.tenantBlockedBy.length,
        commands: tenantAuditBoundaryState.commandPolicy.length,
      },
      nextAction: tenantAuditBoundaryState.nextAction,
    },
    {
      phase: "restart-journal",
      status: dispatchRecoveryJournal.status,
      counters: {
        entries: dispatchRecoveryJournal.entries.length,
        blockedBy: dispatchRecoveryJournal.retryPlan.blockedBy.length,
        pendingBy: dispatchRecoveryJournal.retryPlan.pendingBy.length,
      },
      nextAction: dispatchRecoveryJournal.retryPlan.nextAction,
    },
    {
      phase: "export-rows",
      status: exportBlockedRows.length
        ? "blocked"
        : exportPendingRows.length
          ? "pending"
          : exportReadyRows.length
            ? "ready"
            : "waiting",
      counters: {
        rows: operationExportRows.length,
        ready: exportReadyRows.length,
        blocked: exportBlockedRows.length,
        pending: exportPendingRows.length,
      },
      nextAction: exportBlockedRows[0]?.nextAction
        || exportPendingRows[0]?.nextAction
        || "publish-syscall-operational-report",
    },
  ].map((event, index) => ({
    eventId: stableId("mailchimp-syscall-report-event", [
      boundary.boundaryId,
      event.phase,
      event.status,
      event.nextAction,
      index,
    ]),
    index,
    ...event,
  }));
  const reportStatus = exportBlockedBy.length
    ? "blocked"
    : exportPendingBy.length
      ? "pending"
      : clientRuntimeAdoptionState.acceptedForRuntime
        ? "ready"
        : "waiting";
  let nextAction = clientRuntimeAdoptionState.acceptedForRuntime
    ? "handoff-syscall-batch-to-adapter"
    : clientRuntimeAdoptionState.nextAction;
  if (exportBlockedBy.length) {
    const blocker = exportBlockedBy[0];
    nextAction = blocker.startsWith("memory:")
      ? upstreamMemory.nextAction
      : blocker.startsWith("verifier-tenant:")
        ? verifierTenantGuard.nextAction
      : blocker.startsWith("verifier:")
        ? upstreamVerifier.nextAction
        : blocker.startsWith("capability:")
          ? "refresh-provider-service-capabilities"
          : blocker.startsWith("client-state:")
            ? "hydrate-syscall-client-state"
            : "repair-syscall-dispatch-preview";
    } else if (exportPendingBy.length) {
    const pending = exportPendingBy[0];
    nextAction = pending.startsWith("memory:memory-health:")
      ? upstreamMemory.nextAction
      : pending.startsWith("memory:memory-boundary:")
        ? upstreamMemory.boundaryLease.nextAction
      : pending.startsWith("memory:memory-resume:")
        ? upstreamMemory.operatorResume.nextAction
      : pending.startsWith("verifier-tenant:")
        ? verifierTenantGuard.nextAction
      : pending.startsWith("verifier:")
        ? upstreamVerifier.nextAction
        : routePreviewAcceptanceState.readiness.nextAction;
  }

  return {
    reportId: stableId("mailchimp-syscall-report", [
      boundary.boundaryId,
      dispatchBatchState.batchId,
      externalHandoffState.handoffId,
      reportStatus,
      upstreamMemory.healthId,
      upstreamVerifier.healthId,
    ]),
    status: reportStatus,
    generatedDeterministically: true,
    analyticsCounters,
    memoryHealth: {
      present: upstreamMemory.present,
      packageId: upstreamMemory.packageId,
      healthId: upstreamMemory.healthId,
      status: upstreamMemory.healthStatus,
      degradedMode: upstreamMemory.degradedMode,
      retryable: upstreamMemory.retryableHealth,
      nextRetrySeconds: upstreamMemory.nextHealthRetrySeconds,
      statusChannel: upstreamMemory.healthStatusChannel,
      incidentSummary: upstreamMemory.healthIncidentSummary,
      actionableErrors: upstreamMemory.healthActionableErrors,
    },
    memorySyscallDispatchGate: {
      present: upstreamMemory.syscallDispatchGate.present,
      gateId: upstreamMemory.syscallDispatchGate.gateId,
      status: upstreamMemory.syscallDispatchGate.status,
      acceptedForSyscallDispatch: upstreamMemory.syscallDispatchGate.acceptedForSyscallDispatch,
      restartSafe: upstreamMemory.syscallDispatchGate.restartSafe,
      retryable: upstreamMemory.syscallDispatchGate.retryable,
      nextRetrySeconds: upstreamMemory.syscallDispatchGate.nextDelaySeconds,
      statusChannel: upstreamMemory.syscallDispatchGate.statusChannel,
      blockedBy: memorySyscallGateBlocked,
      pendingBy: memorySyscallGatePending,
      gateRows: upstreamMemory.syscallDispatchGate.gateRows,
      actionableErrors: upstreamMemory.syscallDispatchGate.actionableErrors,
      nextAction: upstreamMemory.syscallDispatchGate.nextAction,
    },
    memoryControlPlane: {
      present: upstreamMemory.controlPlane.present,
      controlPlaneId: upstreamMemory.controlPlane.controlPlaneId,
      status: upstreamMemory.controlPlane.status,
      statusChannel: upstreamMemory.controlPlane.statusChannel,
      acceptedForProviderSync: upstreamMemory.controlPlane.acceptedForProviderSync,
      restartSafe: upstreamMemory.controlPlane.restartSafe,
      blockedBy: memoryControlBlocked,
      pendingBy: memoryControlPending,
      enabledCommands: upstreamMemory.controlPlane.enabledCommands,
      nextAction: upstreamMemory.controlPlane.nextAction,
    },
    memoryOperatorRelease: {
      present: upstreamMemory.operatorRelease.present,
      packetId: upstreamMemory.operatorRelease.packetId,
      status: upstreamMemory.operatorRelease.status,
      releaseReady: upstreamMemory.operatorRelease.releaseReady,
      acceptedForProviderSync: upstreamMemory.operatorRelease.acceptedForProviderSync,
      acceptedForSyscallDispatch: upstreamMemory.operatorRelease.acceptedForSyscallDispatch,
      restartSafe: upstreamMemory.operatorRelease.restartSafe,
      statusChannel: upstreamMemory.operatorRelease.statusChannel,
      blockedBy: memoryOperatorReleaseBlocked,
      pendingBy: memoryOperatorReleasePending,
      gateRows: upstreamMemory.operatorRelease.gateRows,
      nextAction: upstreamMemory.operatorRelease.nextAction,
    },
    memoryDispatchReleaseLedger: {
      present: upstreamMemory.dispatchReleaseLedger.present,
      ledgerId: upstreamMemory.dispatchReleaseLedger.ledgerId,
      status: upstreamMemory.dispatchReleaseLedger.status,
      acceptedForProviderSync: upstreamMemory.dispatchReleaseLedger.acceptedForProviderSync,
      acceptedForSyscallDispatch: upstreamMemory.dispatchReleaseLedger.acceptedForSyscallDispatch,
      restartSafe: upstreamMemory.dispatchReleaseLedger.restartSafe,
      statusChannel: upstreamMemory.dispatchReleaseLedger.statusChannel,
      blockedBy: memoryDispatchLedgerBlocked,
      pendingBy: memoryDispatchLedgerPending,
      sourceRows: upstreamMemory.dispatchReleaseLedger.sourceRows,
      mountRows: upstreamMemory.dispatchReleaseLedger.mountRows,
      nextAction: upstreamMemory.dispatchReleaseLedger.nextAction,
    },
    memoryClaimRuntimeAdoptionReceipt: {
      present: upstreamMemory.claimRuntimeAdoptionReceipt.present,
      receiptId: upstreamMemory.claimRuntimeAdoptionReceipt.receiptId,
      status: upstreamMemory.claimRuntimeAdoptionReceipt.status,
      acceptedForClaimRuntime: upstreamMemory.claimRuntimeAdoptionReceipt.acceptedForClaimRuntime,
      acceptedForClaimProviderSync: upstreamMemory.claimRuntimeAdoptionReceipt.acceptedForClaimProviderSync,
      acceptedForSyscallDispatch: upstreamMemory.claimRuntimeAdoptionReceipt.acceptedForSyscallDispatch,
      restartSafe: upstreamMemory.claimRuntimeAdoptionReceipt.restartSafe,
      blockedBy: memoryClaimRuntimeBlocked,
      pendingBy: memoryClaimRuntimePending,
      evidenceRows: upstreamMemory.claimRuntimeAdoptionReceipt.evidenceRows,
      nextAction: upstreamMemory.claimRuntimeAdoptionReceipt.nextAction,
    },
    memoryClientWorkflow: {
      present: upstreamMemory.clientWorkflowHandoff.present,
      packetId: upstreamMemory.clientWorkflowHandoff.packetId,
      status: upstreamMemory.clientWorkflowHandoff.status,
      releaseReady: upstreamMemory.clientWorkflowHandoff.releaseReady,
      acceptedForProviderSync: upstreamMemory.clientWorkflowHandoff.acceptedForProviderSync,
      restartSafe: upstreamMemory.clientWorkflowHandoff.restartSafe,
      statusChannel: upstreamMemory.clientWorkflowHandoff.statusChannel,
      blockedBy: memoryWorkflowBlocked,
      pendingBy: memoryWorkflowPending,
      releaseReceipt: upstreamMemory.clientWorkflowHandoff.releaseReceipt,
      nextAction: upstreamMemory.clientWorkflowHandoff.nextAction,
    },
    memoryBoundaryLease: {
      present: upstreamMemory.boundaryLease.present,
      packetId: upstreamMemory.boundaryLease.packetId,
      status: upstreamMemory.boundaryLease.status,
      releaseReady: upstreamMemory.boundaryLease.releaseReady,
      acceptedForProviderSync: upstreamMemory.boundaryLease.acceptedForProviderSync,
      restartSafe: upstreamMemory.boundaryLease.restartSafe,
      tenantAuditId: upstreamMemory.boundaryLease.tenantAuditId,
      ttlSeconds: upstreamMemory.boundaryLease.ttlSeconds,
      blockedBy: memoryBoundaryBlocked,
      pendingBy: memoryBoundaryPending,
      leaseRows: upstreamMemory.boundaryLease.leaseRows,
      nextAction: upstreamMemory.boundaryLease.nextAction,
    },
    memoryProviderService: {
      present: upstreamMemory.providerService.present,
      contractId: upstreamMemory.providerService.contractId,
      providerService: upstreamMemory.providerService.providerService,
      status: upstreamMemory.providerService.status,
      statusChannel: upstreamMemory.providerService.statusChannel,
      acceptedForProviderSync: upstreamMemory.providerService.acceptedForProviderSync,
      acceptedForSyscallDispatch: upstreamMemory.providerService.acceptedForSyscallDispatch,
      restartSafe: upstreamMemory.providerService.restartSafe,
      requestedCapabilities: upstreamMemory.providerService.requestedCapabilities,
      negotiatedCapabilities: upstreamMemory.providerService.negotiatedCapabilities,
      missingCapabilities: upstreamMemory.providerService.missingCapabilities,
      blockedBy: memoryProviderServiceBlocked,
      pendingBy: memoryProviderServicePending,
      serviceBindingRows: upstreamMemory.providerService.serviceBindingRows,
      nextAction: upstreamMemory.providerService.nextAction,
    },
    memoryProviderAssertions: {
      present: upstreamMemory.providerAssertionDigest.present,
      digestId: upstreamMemory.providerAssertionDigest.digestId,
      status: upstreamMemory.providerAssertionDigest.status,
      acceptedForProviderSync: upstreamMemory.providerAssertionDigest.acceptedForProviderSync,
      acceptedForSyscallDispatch: upstreamMemory.providerAssertionDigest.acceptedForSyscallDispatch,
      restartSafe: upstreamMemory.providerAssertionDigest.restartSafe,
      counters: upstreamMemory.providerAssertionDigest.counters,
      blockedBy: memoryProviderAssertionBlocked,
      pendingBy: memoryProviderAssertionPending,
      assertionRows: upstreamMemory.providerAssertionDigest.assertionRows,
      nextAction: upstreamMemory.providerAssertionDigest.nextAction,
    },
    memoryReleaseRiskBudget: {
      present: upstreamMemory.releaseRiskBudget.present,
      budgetId: upstreamMemory.releaseRiskBudget.budgetId,
      status: upstreamMemory.releaseRiskBudget.status,
      releaseReady: upstreamMemory.releaseRiskBudget.releaseReady,
      acceptedForSyscallDispatch: upstreamMemory.releaseRiskBudget.acceptedForSyscallDispatch,
      restartSafe: upstreamMemory.releaseRiskBudget.restartSafe,
      totalRiskScore: upstreamMemory.releaseRiskBudget.totalRiskScore,
      counters: upstreamMemory.releaseRiskBudget.counters,
      blockedBy: memoryReleaseRiskBlocked,
      pendingBy: memoryReleaseRiskPending,
      releaseRows: upstreamMemory.releaseRiskBudget.releaseRows,
      nextAction: upstreamMemory.releaseRiskBudget.nextAction,
    },
    memoryOperatorResume: {
      present: upstreamMemory.operatorResume.present,
      packetId: upstreamMemory.operatorResume.packetId,
      status: upstreamMemory.operatorResume.status,
      releaseReady: upstreamMemory.operatorResume.releaseReady,
      acceptedForProviderSync: upstreamMemory.operatorResume.acceptedForProviderSync,
      restartSafe: upstreamMemory.operatorResume.restartSafe,
      statusChannel: upstreamMemory.operatorResume.statusChannel,
      blockedBy: upstreamMemory.operatorResume.blockedBy,
      pendingBy: upstreamMemory.operatorResume.pendingBy,
      nextAction: upstreamMemory.operatorResume.nextAction,
    },
    verifierHealth: {
      present: upstreamVerifier.present,
      packageId: upstreamVerifier.packageId,
      syncId: upstreamVerifier.syncId,
      previewId: upstreamVerifier.previewId,
      acceptanceId: upstreamVerifier.acceptanceId,
      healthId: upstreamVerifier.healthId,
      status: upstreamVerifier.status,
      healthStatus: upstreamVerifier.healthStatus,
      acceptedForSyscallDispatch: upstreamVerifier.acceptedForSyscallDispatch,
      restartSafe: upstreamVerifier.restartSafe,
      retryable: upstreamVerifier.retryable,
      nextRetrySeconds: upstreamVerifier.nextDelaySeconds,
      statusChannel: upstreamVerifier.statusChannel,
      incidentSummary: upstreamVerifier.incidentSummary,
      actionableErrors: upstreamVerifier.actionableErrors,
    },
    verifierTenantDispatchGuard: {
      present: verifierTenantGuard.present,
      guardId: verifierTenantGuard.guardId,
      status: verifierTenantGuard.status,
      tenantId: verifierTenantGuard.tenantId,
      workspaceId: verifierTenantGuard.workspaceId,
      expectedTenantId: verifierTenantGuard.expectedTenantId,
      expectedWorkspaceId: verifierTenantGuard.expectedWorkspaceId,
      actorRole: verifierTenantGuard.actorRole,
      acceptedForSyscallDispatch: verifierTenantGuard.acceptedForSyscallDispatch,
      restartSafe: verifierTenantGuard.restartSafe,
      blockedBy: verifierTenantGuard.blockedBy,
      pendingBy: verifierTenantGuard.pendingBy,
      statusRows: verifierTenantGuard.statusRows,
      nextAction: verifierTenantGuard.nextAction,
    },
    exportSummary: {
      exportKind: "mailchimp.syscallDispatch.operationalSummary",
      status: reportStatus,
      boundaryId: boundary.boundaryId,
      batchId: dispatchBatchState.batchId,
      handoffId: externalHandoffState.handoffId,
      selectedSyscalls: dispatchBatchState.selectedSyscalls,
      heldExternalWrites: dispatchBatchState.heldExternalWrites,
      rows: operationExportRows,
      blockedBy: exportBlockedBy,
      pendingBy: exportPendingBy,
      totals: {
        ...analyticsCounters,
        exportRows: operationExportRows.length,
        exportReadyRows: exportReadyRows.length,
        exportBlockedRows: exportBlockedRows.length,
        exportPendingRows: exportPendingRows.length,
      },
      nextAction,
    },
    historySnapshots: healthTimeline,
    timelineState: {
      currentPhase: healthTimeline.find((event) => event.status === "blocked")?.phase
        || healthTimeline.find((event) => event.status === "degraded")?.phase
        || healthTimeline.find((event) => event.status === "pending")?.phase
        || healthTimeline.at(-1)?.phase
        || "dispatch-batch",
      phases: healthTimeline.map((event) => ({
        index: event.index,
        phase: event.phase,
        status: event.status,
        counters: event.counters,
        nextAction: event.nextAction,
      })),
      latestReadyExport: exportReadyRows.at(-1) || null,
      blockedExports: exportBlockedRows.map((row) => ({
        syscall: row.syscall,
        blockedBy: row.blockedBy,
        nextAction: row.nextAction,
      })),
      reportChannels: [
        "syscall.status.mailchimp",
        upstreamMemory.operatorResume.statusChannel || "memory.operator-resume.mailchimp",
        upstreamMemory.controlPlane.statusChannel || "memory.control.mailchimp",
        upstreamMemory.healthStatusChannel || "memory.health.mailchimp",
        upstreamVerifier.statusChannel || "verifier.syscall-handoff.mailchimp",
      ],
    },
    commands: [
      {
        command: "publish-syscall-operational-report",
        enabled: reportStatus !== "blocked",
        reportId: stableId("mailchimp-syscall-report-command", [
          boundary.boundaryId,
          reportStatus,
          dispatchBatchState.batchId,
        ]),
      },
      ...upstreamMemory.healthCommands
        .filter((command) => command.enabled)
        .map((command) => ({
          command: command.command,
          enabled: command.enabled,
          delaySeconds: command.delaySeconds,
          idempotencyKey: command.idempotencyKey,
          source: "memory-health",
        })),
      ...upstreamMemory.controlPlane.commands
        .filter((command) => command.enabled)
        .map((command) => ({
          command: command.command,
          enabled: command.enabled,
          delaySeconds: command.delaySeconds,
          idempotencyKey: command.idempotencyKey,
          source: "memory-control-plane",
        })),
      ...upstreamMemory.clientWorkflowHandoff.commands
        .filter((command) => command.enabled)
        .map((command) => ({
          command: command.command,
          enabled: command.enabled,
          idempotencyKey: command.idempotencyKey,
          source: "memory-client-workflow",
        })),
      ...upstreamMemory.providerAssertionDigest.commands
        .filter((command) => command.enabled)
        .map((command) => ({
          command: command.command,
          enabled: command.enabled,
          idempotencyKey: command.idempotencyKey,
          source: "memory-provider-assertions",
        })),
      ...upstreamMemory.releaseRiskBudget.commands
        .filter((command) => command.enabled)
        .map((command) => ({
          command: command.command,
          enabled: command.enabled,
          delaySeconds: command.delaySeconds,
          idempotencyKey: command.idempotencyKey,
          source: "memory-release-risk",
        })),
      ...upstreamMemory.operatorResume.commands
        .filter((command) => command.enabled)
        .map((command) => ({
          command: command.command,
          enabled: command.enabled,
          idempotencyKey: command.idempotencyKey,
          source: "memory-operator-resume",
        })),
      ...upstreamVerifier.commands
        .filter((command) => command.enabled)
        .map((command) => ({
          command: command.command,
          enabled: command.enabled,
          delaySeconds: command.delaySeconds,
          idempotencyKey: command.idempotencyKey,
          source: "verifier-handoff",
        })),
    ],
    nextAction,
  };
}

function buildAdapterRecoveryHandoffPackage(
  boundary,
  dispatchBatchState,
  externalHandoffState,
  routePreviewAcceptanceState,
  clientRuntimeAdoptionState,
  dispatchRecoveryJournal,
  tenantAuditBoundaryState,
  operationalReportingState,
) {
  const providerJob = boundary.providerJob || {};
  const memoryAdapterResume = clientRuntimeAdoptionState.upstreamMemoryPackage.adapterResumeReceipt || {};
  const externalWriteRows = [
    ...dispatchBatchState.selectedSyscalls.filter((syscall) => syscall.sideEffects.includes("external-provider-write")),
    ...dispatchBatchState.heldExternalWrites.map((name) => ({ name, sideEffects: ["external-provider-write"] })),
  ];
  const permissionBoundaryPacket = {
    format: "aios.mailchimp.permissionBoundaryPacket.v1",
    packetId: stableId("mailchimp-syscall-permission-boundary", [
      boundary.boundaryId,
      tenantAuditBoundaryState.auditId,
      tenantAuditBoundaryState.tenantId,
      tenantAuditBoundaryState.workspaceId,
      tenantAuditBoundaryState.actorRole,
      tenantAuditBoundaryState.status,
    ]),
    provider: "mailchimp",
    packageId: null,
    operationId: dispatchBatchState.batchId,
    ownerId: tenantAuditBoundaryState.actorRole
      ? `role:${tenantAuditBoundaryState.actorRole}`
      : null,
    status: tenantAuditBoundaryState.status === "ready"
      ? externalWriteRows.length
        ? "lease-audit-ready"
        : "accepted"
      : tenantAuditBoundaryState.status,
    accepted: tenantAuditBoundaryState.status === "ready",
    restartSafe: tenantAuditBoundaryState.tenantBlockedBy.length === 0,
    externalWrite: externalWriteRows.length > 0,
    boundary: {
      boundaryKey: boundary.boundaryId,
      tenant: tenantAuditBoundaryState.tenantId,
      workspace: tenantAuditBoundaryState.workspaceId,
      environment: boundary.tenantPolicy?.environment || boundary.environment || "production",
      status: tenantAuditBoundaryState.status,
      statusPath: tenantAuditBoundaryState.persistedState?.boundaryStatusPath || null,
      requiredRoles: tenantAuditBoundaryState.allowedRoles,
      observedRoles: [tenantAuditBoundaryState.actorRole].filter(Boolean),
      deniedRoles: [],
      checks: {
        tenantPresent: Boolean(tenantAuditBoundaryState.tenantId),
        workspacePresent: Boolean(tenantAuditBoundaryState.workspaceId),
        roleAllowed: tenantAuditBoundaryState.canExecute === true,
        approvalAllowed: tenantAuditBoundaryState.canApprove === true || !tenantAuditBoundaryState.requiresApproval,
      },
    },
    audit: {
      auditId: tenantAuditBoundaryState.auditId,
      auditChannel: boundary.tenantPolicy?.auditChannel || `mailchimp.audit.${tenantAuditBoundaryState.tenantId || "unknown"}`,
      status: tenantAuditBoundaryState.status === "ready" ? "audit-ready" : "boundary-blocked",
      required: tenantAuditBoundaryState.requiresApproval === true || externalWriteRows.length > 0,
      correlation: {
        journalId: dispatchRecoveryJournal.journalId,
        handoffId: externalHandoffState.handoffId,
        batchId: dispatchBatchState.batchId,
        statusChannel: operationalReportingState.statusChannel || "syscall.status.mailchimp",
      },
    },
    lease: {
      capabilities: externalWriteRows.map((row) => row.name).sort(),
      requiresLease: externalWriteRows.length > 0,
      releaseStatus: externalWriteRows.length ? ["release-after-provider-ack"] : [],
    },
    blockedBy: tenantAuditBoundaryState.tenantBlockedBy,
    nextAction: tenantAuditBoundaryState.nextAction,
  };
  const statusRows = [
    {
      key: "client",
      status: clientRuntimeAdoptionState.status,
      statusPath: clientRuntimeAdoptionState.persistedState?.clientStatusPath
        || clientRuntimeAdoptionState.persistedState?.statusPath
        || null,
      accepted: clientRuntimeAdoptionState.acceptedForRuntime === true,
      restartSafe: clientRuntimeAdoptionState.hydrated === true,
      blockedBy: clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      key: "journal",
      status: dispatchRecoveryJournal.status,
      statusPath: dispatchRecoveryJournal.persistedState?.statusPath || null,
      accepted: dispatchRecoveryJournal.handoffReady === true,
      restartSafe: dispatchRecoveryJournal.restartSafe === true,
      blockedBy: dispatchRecoveryJournal.retryPlan.blockedBy,
      nextAction: dispatchRecoveryJournal.retryPlan.nextAction,
    },
    {
      key: "tenant-audit",
      status: tenantAuditBoundaryState.status,
      statusPath: tenantAuditBoundaryState.persistedState?.boundaryStatusPath || null,
      accepted: tenantAuditBoundaryState.status === "ready",
      restartSafe: tenantAuditBoundaryState.tenantBlockedBy.length === 0,
      blockedBy: tenantAuditBoundaryState.tenantBlockedBy,
      permissionBoundaryPacketId: permissionBoundaryPacket.packetId,
      nextAction: tenantAuditBoundaryState.nextAction,
    },
    {
      key: "operational-report",
      status: operationalReportingState.status,
      statusPath: operationalReportingState.verifierHealth.statusChannel
        || operationalReportingState.memoryHealth.statusChannel
        || "syscall.status.mailchimp",
      accepted: operationalReportingState.status !== "blocked",
      restartSafe: operationalReportingState.memoryHealth.degradedMode !== true
        && operationalReportingState.verifierHealth.restartSafe !== false,
      blockedBy: operationalReportingState.exportSummary.blockedBy,
      nextAction: operationalReportingState.nextAction,
    },
    {
      key: "memory-adapter-resume",
      status: memoryAdapterResume.status || "not-provided",
      statusPath: memoryAdapterResume.statusChannel || memoryAdapterResume.receiptId || null,
      accepted: memoryAdapterResume.acceptedForSyscallDispatch !== false
        && memoryAdapterResume.acceptedForAdapterResume !== false,
      restartSafe: memoryAdapterResume.restartSafe !== false,
      blockedBy: asArray(memoryAdapterResume.blockedBy).map((blocker) => `memory-adapter-resume:${blocker}`),
      pendingBy: asArray(memoryAdapterResume.pendingBy).map((pending) => `memory-adapter-resume:${pending}`),
      receiptId: memoryAdapterResume.receiptId || null,
      resumeToken: memoryAdapterResume.resumeToken || null,
      nextAction: memoryAdapterResume.nextAction || clientRuntimeAdoptionState.upstreamMemoryPackage.nextAction,
    },
  ];
  const selectedRows = dispatchBatchState.selectedSyscalls.map((syscall) => ({
    operation: syscall.name,
    syscallId: syscall.id,
    kind: syscall.sideEffects.includes("external-provider-write") ? "external-write" : "runtime",
    retrySafe: syscall.retrySafe,
    command: "resume-syscall-dispatch",
    commandEnabled: dispatchRecoveryJournal.restartSafe === true && syscall.retrySafe !== false,
    idempotencyKey: `syscall-recovery:${stableId("syscall-recovery-command", [
      dispatchRecoveryJournal.journalId,
      syscall.name,
      externalHandoffState.handoffId,
    ])}`,
    statusPath: clientRuntimeAdoptionState.persistedState?.clientStatusPath
      || clientRuntimeAdoptionState.persistedState?.statusPath
      || null,
    nextAction: dispatchRecoveryJournal.handoffReady
      ? "handoff-syscall-batch-to-adapter"
      : dispatchRecoveryJournal.retryPlan.nextAction,
  }));
  const heldRows = dispatchBatchState.heldExternalWrites.map((syscallName) => ({
    operation: syscallName,
    kind: "external-write",
    retrySafe: false,
    command: "collect-operator-approval",
    commandEnabled: false,
    idempotencyKey: `syscall-recovery-held:${stableId("syscall-recovery-held", [
      dispatchRecoveryJournal.journalId,
      syscallName,
    ])}`,
    statusPath: null,
    nextAction: "collect-operator-approval",
  }));
  const blockedBy = [...new Set(statusRows.flatMap((row) => row.blockedBy || []))].sort();
  const pendingBy = [...new Set([
    ...dispatchRecoveryJournal.retryPlan.pendingBy,
    ...statusRows
      .filter((row) => !row.accepted && !row.blockedBy?.length)
      .map((row) => `status:${row.key}:${row.status}`),
    ...statusRows.flatMap((row) => row.pendingBy || []),
  ])].sort();
  const restartSafe = blockedBy.length === 0
    && statusRows.every((row) => row.restartSafe)
    && selectedRows.every((row) => row.retrySafe !== false);
  const acceptedForAdapter = restartSafe
    && pendingBy.length === 0
    && routePreviewAcceptanceState.acceptance.acceptedForRuntime === true
    && tenantAuditBoundaryState.status === "ready";
  const packageId = stableId("mailchimp-syscall-recovery-handoff", [
    boundary.boundaryId,
    dispatchBatchState.batchId,
    externalHandoffState.handoffId,
    dispatchRecoveryJournal.journalId,
    selectedRows.map((row) => [row.operation, row.commandEnabled]),
    blockedBy,
    pendingBy,
  ]);
  const nextAction = blockedBy.length
    ? blockedBy[0].startsWith("client-state:")
      ? "hydrate-syscall-client-state"
      : blockedBy[0].startsWith("tenant:")
        ? "repair-tenant-boundary"
        : dispatchRecoveryJournal.retryPlan.nextAction
    : pendingBy.length
      ? pendingBy[0].startsWith("external-write:")
        ? "collect-operator-approval"
        : dispatchRecoveryJournal.retryPlan.nextAction
      : acceptedForAdapter
        ? "handoff-syscall-batch-to-adapter"
        : routePreviewAcceptanceState.readiness.nextAction;

  return {
    format: "aios.mailchimp.syscall.recoveryHandoff.v1",
    packageId,
    provider: "mailchimp",
    providerJobId: providerJob.jobId || null,
    boundaryId: boundary.boundaryId,
    batchId: dispatchBatchState.batchId,
    handoffId: externalHandoffState.handoffId,
    journalId: dispatchRecoveryJournal.journalId,
    status: blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : acceptedForAdapter
          ? "adapter-ready"
          : "waiting",
    restartSafe,
    acceptedForAdapter,
    stateKeys: {
      clientStateKey: clientRuntimeAdoptionState.stateKey,
      continuationToken: clientRuntimeAdoptionState.continuationToken,
      auditId: tenantAuditBoundaryState.auditId,
      reportId: operationalReportingState.reportId,
    },
    statusRows,
    permissionBoundaryPacket,
    operationRows: [...selectedRows, ...heldRows],
    blockedBy,
    pendingBy,
    commands: [
      {
        command: "persist-syscall-recovery-handoff",
        enabled: true,
        idempotencyKey: `syscall-recovery-handoff:${packageId}`,
      },
      ...selectedRows.map((row) => ({
        command: row.command,
        enabled: row.commandEnabled && acceptedForAdapter,
        operation: row.operation,
        idempotencyKey: row.idempotencyKey,
        statusPath: row.statusPath,
      })),
    ],
    payloadShape: {
      packageId: "string",
      boundaryId: "string",
      batchId: "string",
      handoffId: "string",
      journalId: "string",
      restartSafe: "boolean",
      acceptedForAdapter: "boolean",
      permissionBoundaryPacket: "object",
      operationRows: "array",
      statusRows: "array",
    },
    userVisiblePreview: {
      title: "Mailchimp restart-safe syscall handoff",
      status: acceptedForAdapter ? "ready" : blockedBy.length ? "blocked" : "pending",
      rows: statusRows.map((row) => ({
        label: row.key,
        status: row.status,
        accepted: row.accepted,
        restartSafe: row.restartSafe,
        nextAction: row.nextAction,
      })),
      nextAction,
    },
    nextAction,
  };
}

function buildSyscallControlPlaneState(
  boundary,
  lifecycleControls,
  schedulingState,
  providerServiceContract,
  dispatchBatchState,
  routePreviewAcceptanceState,
  clientRuntimeAdoptionState,
  dispatchRecoveryJournal,
  tenantAuditBoundaryState,
  operationalReportingState,
  adapterRecoveryHandoffPackage,
) {
  const settingsErrors = lifecycleControls.diagnostics
    .filter((diagnostic) => diagnostic.level === "error")
    .map((diagnostic) => diagnostic.code)
    .sort();
  const statusBlockers = [
    ...settingsErrors.map((code) => `settings:${code}`),
    ...providerServiceContract.missingCapabilities.map((capability) => `capability:${capability}`),
    ...routePreviewAcceptanceState.acceptance.blockedBy.map((blocker) => `acceptance:${blocker}`),
    ...clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
    ...tenantAuditBoundaryState.tenantBlockedBy.map((blocker) => `tenant:${blocker}`),
    ...operationalReportingState.exportSummary.blockedBy.map((blocker) => `report:${blocker}`),
    ...adapterRecoveryHandoffPackage.blockedBy.map((blocker) => `recovery:${blocker}`),
  ].sort();
  const pendingBy = [
    ...(routePreviewAcceptanceState.acceptance.required && !routePreviewAcceptanceState.acceptance.acceptedForExternalWrite
      ? ["approval:external-write"]
      : []),
    ...(schedulingState.enabled ? [`schedule:${schedulingState.scheduleId}`] : []),
    ...adapterRecoveryHandoffPackage.pendingBy.map((pending) => `recovery:${pending}`),
  ].sort();
  const commandCandidates = [
    {
      command: "apply-syscall-lifecycle-settings",
      enabled: settingsErrors.length > 0,
      idempotencyKey: `syscall-control-settings:${boundary.boundaryId}`,
      reason: "Lifecycle settings must be corrected before Mailchimp dispatch can continue.",
    },
    {
      command: "refresh-syscall-provider-capabilities",
      enabled: providerServiceContract.missingCapabilities.length > 0,
      idempotencyKey: `syscall-control-capabilities:${providerServiceContract.serviceId}`,
      reason: "Provider capabilities are missing for the requested Mailchimp syscalls.",
    },
    {
      command: "persist-syscall-control-plane",
      enabled: true,
      idempotencyKey: `syscall-control-plane:${dispatchBatchState.batchId}`,
      reason: "Persist the deterministic dispatch control state for restart-safe handoff.",
    },
    {
      command: "schedule-syscall-control-tick",
      enabled: schedulingState.enabled && statusBlockers.length === 0,
      idempotencyKey: `syscall-control-schedule:${schedulingState.scheduleId}`,
      delaySeconds: schedulingState.intervalSeconds,
      reason: "Continue lifecycle-managed Mailchimp dispatch on the configured cadence.",
    },
    {
      command: "handoff-syscall-control-plane",
      enabled: statusBlockers.length === 0
        && pendingBy.filter((pending) => !pending.startsWith("schedule:")).length === 0
        && clientRuntimeAdoptionState.acceptedForRuntime === true
        && adapterRecoveryHandoffPackage.acceptedForAdapter === true,
      idempotencyKey: `syscall-control-handoff:${adapterRecoveryHandoffPackage.packageId}`,
      reason: "Runtime, recovery, audit, and provider state are ready for adapter handoff.",
    },
  ];
  const enabledCommands = commandCandidates.filter((command) => command.enabled);
  const status = statusBlockers.length
    ? "blocked"
    : pendingBy.some((pending) => pending.startsWith("approval:"))
      ? "approval-pending"
      : enabledCommands.some((command) => command.command === "handoff-syscall-control-plane")
        ? "handoff-ready"
        : enabledCommands.some((command) => command.command === "schedule-syscall-control-tick")
          ? "scheduled"
          : "observing";

  return {
    format: "aios.mailchimp.syscall.controlPlane.v1",
    controlPlaneId: stableId("mailchimp-syscall-control-plane", [
      boundary.boundaryId,
      providerServiceContract.serviceId,
      dispatchBatchState.batchId,
      adapterRecoveryHandoffPackage.packageId,
      status,
    ]),
    provider: "mailchimp",
    boundaryId: boundary.boundaryId,
    status,
    statusChannel: status === "blocked"
      ? "syscall.control.mailchimp.blocked"
      : schedulingState.enabled
        ? schedulingState.statusChannel
        : "syscall.control.mailchimp",
    blockedBy: statusBlockers,
    pendingBy,
    commands: commandCandidates,
    enabledCommands: enabledCommands.map((command) => command.command),
    persistedState: {
      batchId: dispatchBatchState.batchId,
      handoffId: adapterRecoveryHandoffPackage.packageId,
      serviceId: providerServiceContract.serviceId,
      scheduleId: schedulingState.scheduleId,
      continuationToken: clientRuntimeAdoptionState.continuationToken,
      restartJournalId: dispatchRecoveryJournal.journalId,
      acceptedForRuntime: clientRuntimeAdoptionState.acceptedForRuntime,
      restartSafe: dispatchRecoveryJournal.restartSafe,
      nextAction: enabledCommands[0]?.command || lifecycleControls.nextAction,
    },
    nextAction: statusBlockers.length
      ? statusBlockers[0].startsWith("settings:")
        ? "repair-syscall-lifecycle-settings"
        : statusBlockers[0].startsWith("capability:")
          ? "refresh-provider-service-capabilities"
          : statusBlockers[0].startsWith("client-state:")
            ? "hydrate-syscall-client-runtime-state"
            : statusBlockers[0].startsWith("tenant:")
              ? tenantAuditBoundaryState.nextAction
              : adapterRecoveryHandoffPackage.nextAction
      : pendingBy.some((pending) => pending.startsWith("approval:"))
        ? "collect-operator-approval"
        : enabledCommands[0]?.command || lifecycleControls.nextAction,
  };
}

function buildSyscallProviderGateSummary(clientRuntimeAdoptionState, controlPlaneState, adapterRecoveryHandoffPackage) {
  const memory = clientRuntimeAdoptionState.upstreamMemoryPackage;
  const verifier = clientRuntimeAdoptionState.upstreamVerifierPackage;
  const gates = [
    {
      gate: "memory-workflow",
      status: memory.controlPlane?.status || memory.readinessStatus || memory.status,
      accepted: memory.acceptedForProviderSync === true
        && memory.controlPlane?.restartSafe !== false
        && memory.clientWorkflowHandoff?.restartSafe !== false
        && memory.clientWorkflowHandoff?.releaseReceipt?.restartSafe !== false
        && memory.clientWorkflowHandoff?.releaseReceipt?.acceptedForProviderSync !== false
        && memory.boundaryLease?.restartSafe !== false
        && memory.controlPlane?.blockedBy?.length === 0,
      restartSafe: memory.controlPlane?.restartSafe !== false,
      packetId: memory.controlPlane?.controlPlaneId || memory.packageId,
      blockedBy: [
        ...asArray(memory.blockedBy).map((blocker) => `memory:${blocker}`),
        ...asArray(memory.controlPlane?.blockedBy).map((blocker) => `memory-control:${blocker}`),
        ...asArray(memory.clientWorkflowHandoff?.blockedBy).map((blocker) => `memory-client-workflow:${blocker}`),
        ...asArray(memory.clientWorkflowHandoff?.releaseReceipt?.blockedBy)
          .map((blocker) => `memory-client-workflow-receipt:${blocker}`),
        ...asArray(memory.boundaryLease?.blockedBy).map((blocker) => `memory-boundary:${blocker}`),
      ].sort(),
      pendingBy: [
        ...asArray(memory.pendingChecks).map((pending) => `memory:${pending}`),
        ...asArray(memory.controlPlane?.pendingBy).map((pending) => `memory-control:${pending}`),
        ...asArray(memory.clientWorkflowHandoff?.pendingBy).map((pending) => `memory-client-workflow:${pending}`),
        ...asArray(memory.clientWorkflowHandoff?.releaseReceipt?.pendingBy)
          .map((pending) => `memory-client-workflow-receipt:${pending}`),
        ...asArray(memory.boundaryLease?.pendingBy).map((pending) => `memory-boundary:${pending}`),
      ].sort(),
      nextAction: memory.controlPlane?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-client-workflow",
      status: memory.clientWorkflowHandoff?.status || "not-provided",
      accepted: memory.clientWorkflowHandoff?.present
        ? memory.clientWorkflowHandoff.acceptedForProviderSync === true
          && memory.clientWorkflowHandoff.restartSafe !== false
          && memory.clientWorkflowHandoff.releaseReceipt.acceptedForProviderSync !== false
          && memory.clientWorkflowHandoff.releaseReceipt.restartSafe !== false
          && memory.clientWorkflowHandoff.blockedBy.length === 0
          && memory.clientWorkflowHandoff.releaseReceipt.blockedBy.length === 0
        : true,
      restartSafe: memory.clientWorkflowHandoff?.restartSafe !== false
        && memory.clientWorkflowHandoff?.releaseReceipt?.restartSafe !== false,
      packetId: memory.clientWorkflowHandoff?.packetId || null,
      blockedBy: asArray(memory.clientWorkflowHandoff?.blockedBy)
        .concat(asArray(memory.clientWorkflowHandoff?.releaseReceipt?.blockedBy))
        .map((blocker) => `memory-client-workflow:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.clientWorkflowHandoff?.pendingBy)
        .concat(asArray(memory.clientWorkflowHandoff?.releaseReceipt?.pendingBy))
        .map((pending) => `memory-client-workflow:${pending}`)
        .sort(),
      nextAction: memory.clientWorkflowHandoff?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-route-acceptance",
      status: memory.routeAcceptanceReceipt?.status || "not-provided",
      accepted: memory.routeAcceptanceReceipt?.present
        ? memory.routeAcceptanceReceipt.acceptedForSyscallDispatch === true
          && memory.routeAcceptanceReceipt.acceptedForProviderSync === true
          && memory.routeAcceptanceReceipt.restartSafe !== false
          && memory.routeAcceptanceReceipt.blockedBy.length === 0
        : true,
      restartSafe: memory.routeAcceptanceReceipt?.restartSafe !== false,
      packetId: memory.routeAcceptanceReceipt?.receiptId || null,
      blockedBy: asArray(memory.routeAcceptanceReceipt?.blockedBy)
        .map((blocker) => `memory-route-acceptance:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.routeAcceptanceReceipt?.pendingBy)
        .map((pending) => `memory-route-acceptance:${pending}`)
        .sort(),
      nextAction: memory.routeAcceptanceReceipt?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-dispatch-release-ledger",
      status: memory.dispatchReleaseLedger?.status || "not-provided",
      accepted: memory.dispatchReleaseLedger?.present
        ? memory.dispatchReleaseLedger.acceptedForSyscallDispatch === true
          && memory.dispatchReleaseLedger.acceptedForProviderSync === true
          && memory.dispatchReleaseLedger.restartSafe !== false
          && memory.dispatchReleaseLedger.blockedBy.length === 0
          && memory.dispatchReleaseLedger.pendingBy.length === 0
        : true,
      restartSafe: memory.dispatchReleaseLedger?.restartSafe !== false,
      packetId: memory.dispatchReleaseLedger?.ledgerId || null,
      blockedBy: asArray(memory.dispatchReleaseLedger?.blockedBy)
        .map((blocker) => `memory-dispatch-ledger:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.dispatchReleaseLedger?.pendingBy)
        .map((pending) => `memory-dispatch-ledger:${pending}`)
        .sort(),
      nextAction: memory.dispatchReleaseLedger?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-claim-runtime-adoption",
      status: memory.claimRuntimeAdoptionReceipt?.status || "not-provided",
      accepted: memory.claimRuntimeAdoptionReceipt?.present
        ? memory.claimRuntimeAdoptionReceipt.acceptedForSyscallDispatch === true
          && memory.claimRuntimeAdoptionReceipt.acceptedForClaimProviderSync === true
          && memory.claimRuntimeAdoptionReceipt.restartSafe !== false
          && memory.claimRuntimeAdoptionReceipt.blockedBy.length === 0
          && memory.claimRuntimeAdoptionReceipt.pendingBy.length === 0
        : true,
      restartSafe: memory.claimRuntimeAdoptionReceipt?.restartSafe !== false,
      packetId: memory.claimRuntimeAdoptionReceipt?.receiptId || null,
      blockedBy: asArray(memory.claimRuntimeAdoptionReceipt?.blockedBy)
        .map((blocker) => `memory-claim-runtime:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.claimRuntimeAdoptionReceipt?.pendingBy)
        .map((pending) => `memory-claim-runtime:${pending}`)
        .sort(),
      nextAction: memory.claimRuntimeAdoptionReceipt?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-adapter-resume",
      status: memory.adapterResumeReceipt?.status || "not-provided",
      accepted: memory.adapterResumeReceipt?.present
        ? memory.adapterResumeReceipt.acceptedForSyscallDispatch === true
          && memory.adapterResumeReceipt.acceptedForAdapterResume === true
          && memory.adapterResumeReceipt.restartSafe !== false
          && memory.adapterResumeReceipt.blockedBy.length === 0
          && memory.adapterResumeReceipt.pendingBy.length === 0
        : true,
      restartSafe: memory.adapterResumeReceipt?.restartSafe !== false,
      packetId: memory.adapterResumeReceipt?.receiptId || null,
      blockedBy: asArray(memory.adapterResumeReceipt?.blockedBy)
        .map((blocker) => `memory-adapter-resume:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.adapterResumeReceipt?.pendingBy)
        .map((pending) => `memory-adapter-resume:${pending}`)
        .sort(),
      nextAction: memory.adapterResumeReceipt?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-boundary-lease",
      status: memory.boundaryLease?.status || "not-provided",
      accepted: memory.boundaryLease?.present
        ? memory.boundaryLease.acceptedForProviderSync === true
          && memory.boundaryLease.restartSafe !== false
          && memory.boundaryLease.blockedBy.length === 0
        : true,
      restartSafe: memory.boundaryLease?.restartSafe !== false,
      packetId: memory.boundaryLease?.packetId || null,
      blockedBy: asArray(memory.boundaryLease?.blockedBy)
        .map((blocker) => `memory-boundary:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.boundaryLease?.pendingBy)
        .map((pending) => `memory-boundary:${pending}`)
        .sort(),
      nextAction: memory.boundaryLease?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-provider-service",
      status: memory.providerService?.status || "not-provided",
      accepted: memory.providerService?.present
        ? memory.providerService.acceptedForSyscallDispatch === true
          && memory.providerService.acceptedForProviderSync === true
          && memory.providerService.restartSafe !== false
          && memory.providerService.blockedBy.length === 0
          && memory.providerService.pendingBy.length === 0
        : true,
      restartSafe: memory.providerService?.restartSafe !== false,
      packetId: memory.providerService?.contractId || null,
      blockedBy: asArray(memory.providerService?.blockedBy)
        .map((blocker) => `memory-provider-service:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.providerService?.pendingBy)
        .map((pending) => `memory-provider-service:${pending}`)
        .sort(),
      nextAction: memory.providerService?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-provider-assertions",
      status: memory.providerAssertionDigest?.status || "not-provided",
      accepted: memory.providerAssertionDigest?.present
        ? memory.providerAssertionDigest.acceptedForSyscallDispatch === true
          && memory.providerAssertionDigest.acceptedForProviderSync !== false
          && memory.providerAssertionDigest.restartSafe !== false
          && memory.providerAssertionDigest.blockedBy.length === 0
          && memory.providerAssertionDigest.pendingBy.length === 0
        : true,
      restartSafe: memory.providerAssertionDigest?.restartSafe !== false,
      packetId: memory.providerAssertionDigest?.digestId || null,
      blockedBy: asArray(memory.providerAssertionDigest?.blockedBy)
        .map((blocker) => `memory-provider-assertion:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.providerAssertionDigest?.pendingBy)
        .map((pending) => `memory-provider-assertion:${pending}`)
        .sort(),
      nextAction: memory.providerAssertionDigest?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-audience-sync-watermark",
      status: memory.audienceSyncWatermark?.status || "not-provided",
      accepted: memory.audienceSyncWatermark?.present
        ? memory.audienceSyncWatermark.acceptedForSyscallDispatch === true
          && memory.audienceSyncWatermark.acceptedForProviderSync === true
          && memory.audienceSyncWatermark.restartSafe !== false
          && memory.audienceSyncWatermark.blockedBy.length === 0
          && memory.audienceSyncWatermark.pendingBy.length === 0
        : true,
      restartSafe: memory.audienceSyncWatermark?.restartSafe !== false,
      packetId: memory.audienceSyncWatermark?.watermarkId || null,
      blockedBy: asArray(memory.audienceSyncWatermark?.blockedBy)
        .map((blocker) => `memory-audience-watermark:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.audienceSyncWatermark?.pendingBy)
        .map((pending) => `memory-audience-watermark:${pending}`)
        .sort(),
      nextAction: memory.audienceSyncWatermark?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-audience-continuity",
      status: memory.audienceContinuityReceipt?.status || "not-provided",
      accepted: memory.audienceContinuityReceipt?.present
        ? memory.audienceContinuityReceipt.acceptedForSyscallDispatch === true
          && memory.audienceContinuityReceipt.acceptedForProviderSync === true
          && memory.audienceContinuityReceipt.restartSafe !== false
          && memory.audienceContinuityReceipt.blockedBy.length === 0
          && memory.audienceContinuityReceipt.pendingBy.length === 0
        : true,
      restartSafe: memory.audienceContinuityReceipt?.restartSafe !== false,
      packetId: memory.audienceContinuityReceipt?.receiptId || null,
      blockedBy: asArray(memory.audienceContinuityReceipt?.blockedBy)
        .map((blocker) => `memory-audience-continuity:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.audienceContinuityReceipt?.pendingBy)
        .map((pending) => `memory-audience-continuity:${pending}`)
        .sort(),
      nextAction: memory.audienceContinuityReceipt?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-release-risk",
      status: memory.releaseRiskBudget?.status || "not-provided",
      accepted: memory.releaseRiskBudget?.present
        ? memory.releaseRiskBudget.acceptedForSyscallDispatch === true
          && memory.releaseRiskBudget.releaseReady === true
          && memory.releaseRiskBudget.restartSafe !== false
          && memory.releaseRiskBudget.blockedBy.length === 0
        : true,
      restartSafe: memory.releaseRiskBudget?.restartSafe !== false,
      packetId: memory.releaseRiskBudget?.budgetId || null,
      blockedBy: asArray(memory.releaseRiskBudget?.blockedBy)
        .map((blocker) => `memory-release-risk:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.releaseRiskBudget?.pendingBy)
        .map((pending) => `memory-release-risk:${pending}`)
        .sort(),
      nextAction: memory.releaseRiskBudget?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-operator-release",
      status: memory.operatorRelease?.status || "not-provided",
      accepted: memory.operatorRelease?.present
        ? memory.operatorRelease.acceptedForSyscallDispatch === true
          && memory.operatorRelease.acceptedForProviderSync !== false
          && memory.operatorRelease.restartSafe !== false
          && memory.operatorRelease.blockedBy.length === 0
          && memory.operatorRelease.pendingBy.length === 0
        : true,
      restartSafe: memory.operatorRelease?.restartSafe !== false,
      packetId: memory.operatorRelease?.packetId || null,
      blockedBy: asArray(memory.operatorRelease?.blockedBy)
        .map((blocker) => `memory-operator-release:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.operatorRelease?.pendingBy)
        .map((pending) => `memory-operator-release:${pending}`)
        .sort(),
      nextAction: memory.operatorRelease?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-operator-resume",
      status: memory.operatorResume?.status || "not-provided",
      accepted: memory.operatorResume?.present
        ? memory.operatorResume.acceptedForProviderSync === true
          && memory.operatorResume.restartSafe !== false
          && memory.operatorResume.blockedBy.length === 0
        : true,
      restartSafe: memory.operatorResume?.restartSafe !== false,
      packetId: memory.operatorResume?.packetId || null,
      blockedBy: asArray(memory.operatorResume?.blockedBy).map((blocker) => `memory-resume:${blocker}`).sort(),
      pendingBy: asArray(memory.operatorResume?.pendingBy).map((pending) => `memory-resume:${pending}`).sort(),
      nextAction: memory.operatorResume?.nextAction || memory.nextAction,
    },
    {
      gate: "memory-syscall-dispatch",
      status: memory.syscallDispatchGate?.status || "not-provided",
      accepted: memory.syscallDispatchGate?.present
        ? memory.syscallDispatchGate.acceptedForSyscallDispatch === true
          && memory.syscallDispatchGate.restartSafe !== false
          && memory.syscallDispatchGate.blockedBy.length === 0
        : true,
      restartSafe: memory.syscallDispatchGate?.restartSafe !== false,
      packetId: memory.syscallDispatchGate?.gateId || null,
      blockedBy: asArray(memory.syscallDispatchGate?.blockedBy)
        .map((blocker) => `memory-syscall-gate:${blocker}`)
        .sort(),
      pendingBy: asArray(memory.syscallDispatchGate?.pendingBy)
        .map((pending) => `memory-syscall-gate:${pending}`)
        .sort(),
      nextAction: memory.syscallDispatchGate?.nextAction || memory.nextAction,
    },
    {
      gate: "verifier-handoff",
      status: verifier.status,
      accepted: verifier.acceptedForSyscallDispatch === true && verifier.restartSafe !== false,
      restartSafe: verifier.restartSafe !== false,
      packetId: verifier.packageId,
      blockedBy: asArray(verifier.blockedBy).map((blocker) => `verifier:${blocker}`).sort(),
      pendingBy: asArray(verifier.pendingBy).map((pending) => `verifier:${pending}`).sort(),
      nextAction: verifier.nextAction,
    },
    {
      gate: "verifier-tenant-dispatch",
      status: verifier.tenantDispatchGuard?.status || "not-provided",
      accepted: verifier.tenantDispatchGuard?.acceptedForSyscallDispatch !== false
        && verifier.tenantDispatchGuard?.restartSafe !== false,
      restartSafe: verifier.tenantDispatchGuard?.restartSafe !== false,
      packetId: verifier.tenantDispatchGuard?.guardId || null,
      blockedBy: asArray(verifier.tenantDispatchGuard?.blockedBy)
        .map((blocker) => `verifier-tenant:${blocker}`)
        .sort(),
      pendingBy: asArray(verifier.tenantDispatchGuard?.pendingBy)
        .map((pending) => `verifier-tenant:${pending}`)
        .sort(),
      nextAction: verifier.tenantDispatchGuard?.nextAction || verifier.nextAction,
    },
    {
      gate: "syscall-control-plane",
      status: controlPlaneState.status,
      accepted: controlPlaneState.status === "handoff-ready",
      restartSafe: controlPlaneState.persistedState.restartSafe === true,
      packetId: controlPlaneState.controlPlaneId,
      blockedBy: asArray(controlPlaneState.blockedBy).map((blocker) => `syscall-control:${blocker}`).sort(),
      pendingBy: asArray(controlPlaneState.pendingBy).map((pending) => `syscall-control:${pending}`).sort(),
      nextAction: controlPlaneState.nextAction,
    },
    {
      gate: "adapter-recovery",
      status: adapterRecoveryHandoffPackage.status,
      accepted: adapterRecoveryHandoffPackage.acceptedForAdapter === true,
      restartSafe: adapterRecoveryHandoffPackage.restartSafe === true,
      packetId: adapterRecoveryHandoffPackage.packageId,
      blockedBy: asArray(adapterRecoveryHandoffPackage.blockedBy).map((blocker) => `recovery:${blocker}`).sort(),
      pendingBy: asArray(adapterRecoveryHandoffPackage.pendingBy).map((pending) => `recovery:${pending}`).sort(),
      nextAction: adapterRecoveryHandoffPackage.nextAction,
    },
  ];
  const blockedBy = gates.flatMap((gate) => gate.blockedBy).sort();
  const pendingBy = gates.flatMap((gate) => gate.pendingBy).sort();
  const releaseReady = blockedBy.length === 0
    && pendingBy.filter((pending) => !pending.startsWith("syscall-control:schedule:")).length === 0
    && gates.every((gate) => gate.accepted);

  return {
    format: "aios.mailchimp.syscall.providerGateSummary.v1",
    summaryId: stableId("mailchimp-syscall-provider-gates", [
      gates.map((gate) => [gate.gate, gate.status, gate.accepted]),
      releaseReady,
    ]),
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : releaseReady ? "release-ready" : "waiting",
    releaseReady,
    gates,
    blockedBy,
    pendingBy,
    commands: [
      {
        command: "persist-syscall-provider-gate-summary",
        enabled: true,
        idempotencyKey: `syscall-provider-gates:${controlPlaneState.controlPlaneId}`,
      },
      {
        command: "release-syscall-provider-dispatch",
        enabled: releaseReady,
        idempotencyKey: `syscall-provider-release:${adapterRecoveryHandoffPackage.packageId}`,
      },
    ],
    nextAction: blockedBy.length
      ? gates.find((gate) => gate.blockedBy.length)?.nextAction || "repair-syscall-provider-gates"
      : pendingBy.length
        ? gates.find((gate) => gate.pendingBy.length)?.nextAction || "wait-for-syscall-provider-gates"
        : releaseReady
          ? "release-syscall-provider-dispatch"
          : controlPlaneState.nextAction,
  };
}

function buildSyscallExternalHandoffEnvelope(
  boundary,
  lifecycleControls,
  providerServiceContract,
  dispatchBatchState,
  externalHandoffState,
  routePreviewAcceptanceState,
  clientRuntimeAdoptionState,
  dispatchRecoveryJournal,
  tenantAuditBoundaryState,
  operationalReportingState,
  adapterRecoveryHandoffPackage,
  controlPlaneState,
  providerGateSummary,
) {
  const commandSources = [
    ["lifecycle", lifecycleControls.commands],
    ["route", clientRuntimeAdoptionState.routeCommands],
    ["operational-report", operationalReportingState.commands],
    ["recovery-handoff", adapterRecoveryHandoffPackage.commands],
    ["control-plane", controlPlaneState.commands],
    ["provider-gate", providerGateSummary.commands],
  ];
  const commandQueue = commandSources
    .flatMap(([sourceName, commands]) => asArray(commands).map((command) => ({
      source: sourceName,
      command: command.command,
      enabled: command.enabled === true,
      delaySeconds: command.delaySeconds ?? null,
      idempotencyKey: command.idempotencyKey || command.reportId || command.packageId || null,
    })))
    .filter((command) => command.command)
    .map((command, index) => ({
      index,
      ...command,
      dispatchState: command.enabled ? "queued" : "held",
    }));
  const blockedBy = [
    ...providerServiceContract.missingCapabilities.map((capability) => `capability:${capability}`),
    ...asArray(dispatchBatchState.blockedBy).map((blocker) => `dispatch:${blocker}`),
    ...asArray(routePreviewAcceptanceState.acceptance?.blockedBy).map((blocker) => `acceptance:${blocker}`),
    ...asArray(clientRuntimeAdoptionState.missingClientState).map((key) => `client-state:${key}`),
    ...asArray(clientRuntimeAdoptionState.upstreamMemoryPackage?.blockedBy).map((blocker) => `memory:${blocker}`),
    ...asArray(clientRuntimeAdoptionState.upstreamVerifierPackage?.blockedBy).map((blocker) => `verifier:${blocker}`),
    ...asArray(dispatchRecoveryJournal.blockedBy).map((blocker) => `journal:${blocker}`),
    ...asArray(tenantAuditBoundaryState.tenantBlockedBy).map((blocker) => `tenant:${blocker}`),
    ...asArray(operationalReportingState.exportSummary?.blockedBy).map((blocker) => `report:${blocker}`),
    ...asArray(adapterRecoveryHandoffPackage.blockedBy).map((blocker) => `recovery:${blocker}`),
    ...asArray(controlPlaneState.blockedBy).map((blocker) => `control-plane:${blocker}`),
    ...asArray(providerGateSummary.blockedBy).map((blocker) => `provider-gate:${blocker}`),
  ].sort();
  const pendingBy = [
    ...asArray(routePreviewAcceptanceState.readiness?.pendingChecks).map((check) => `readiness:${check}`),
    ...asArray(clientRuntimeAdoptionState.upstreamMemoryPackage?.pendingChecks).map((pending) => `memory:${pending}`),
    ...asArray(clientRuntimeAdoptionState.upstreamVerifierPackage?.pendingBy).map((pending) => `verifier:${pending}`),
    ...asArray(operationalReportingState.exportSummary?.pendingBy).map((pending) => `report:${pending}`),
    ...asArray(adapterRecoveryHandoffPackage.pendingBy).map((pending) => `recovery:${pending}`),
    ...asArray(providerGateSummary.pendingBy).map((pending) => `provider-gate:${pending}`),
  ].sort();
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && externalHandoffState.acceptedForAdapter === true
    && clientRuntimeAdoptionState.acceptedForRuntime === true
    && adapterRecoveryHandoffPackage.acceptedForAdapter === true
    && providerGateSummary.releaseReady === true
    && controlPlaneState.status !== "blocked";
  const nextCommand = commandQueue.find((command) => command.enabled)
    || commandQueue.find((command) => command.dispatchState === "held")
    || null;

  return {
    format: "aios.mailchimp.syscall.externalHandoffEnvelope.v1",
    envelopeId: stableId("mailchimp-syscall-external-handoff", [
      boundary.boundaryId,
      dispatchBatchState.batchId,
      externalHandoffState.handoffId,
      adapterRecoveryHandoffPackage.packageId,
      releaseReady,
    ]),
    providerService: providerServiceContract.providerService,
    serviceId: providerServiceContract.serviceId,
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : releaseReady ? "dispatch-ready" : "waiting",
    releaseReady,
    acceptedForAdapter: releaseReady,
    restartSafe: releaseReady && dispatchRecoveryJournal.restartSafe === true && adapterRecoveryHandoffPackage.restartSafe === true,
    handoffId: externalHandoffState.handoffId,
    batchId: dispatchBatchState.batchId,
    blockedBy,
    pendingBy,
    commandQueue,
    enabledCommands: commandQueue.filter((command) => command.enabled).map((command) => command.command),
    statusRows: [
      {
        key: "provider-capabilities",
        status: providerServiceContract.status,
        accepted: providerServiceContract.status === "negotiated",
        blockedBy: providerServiceContract.missingCapabilities,
        pendingBy: [],
        nextAction: providerServiceContract.status === "negotiated"
          ? "continue-syscall-dispatch"
          : "refresh-provider-service-capabilities",
      },
      {
        key: "dispatch-batch",
        status: dispatchBatchState.status,
        accepted: dispatchBatchState.status === "ready" || dispatchBatchState.status === "ready-with-held-external-write",
        blockedBy: asArray(dispatchBatchState.blockedBy),
        pendingBy: dispatchBatchState.heldExternalWrites,
        nextAction: dispatchBatchState.nextAction,
      },
      {
        key: "client-runtime",
        status: clientRuntimeAdoptionState.hydrated ? "hydrated" : "needs-client-state",
        accepted: clientRuntimeAdoptionState.acceptedForRuntime === true,
        blockedBy: clientRuntimeAdoptionState.missingClientState,
        pendingBy: [],
        nextAction: clientRuntimeAdoptionState.nextAction,
      },
      {
        key: "adapter-recovery",
        status: adapterRecoveryHandoffPackage.status,
        accepted: adapterRecoveryHandoffPackage.acceptedForAdapter === true,
        blockedBy: asArray(adapterRecoveryHandoffPackage.blockedBy),
        pendingBy: asArray(adapterRecoveryHandoffPackage.pendingBy),
        nextAction: adapterRecoveryHandoffPackage.nextAction,
      },
      {
        key: "control-plane",
        status: controlPlaneState.status,
        accepted: controlPlaneState.status === "handoff-ready",
        blockedBy: asArray(controlPlaneState.blockedBy),
        pendingBy: asArray(controlPlaneState.pendingBy),
        nextAction: controlPlaneState.nextAction,
      },
    ],
    syncMetadata: {
      ...externalHandoffState.syncMetadata,
      recoveryHandoffPackageId: adapterRecoveryHandoffPackage.packageId,
      controlPlaneId: controlPlaneState.controlPlaneId,
      providerGateSummaryId: providerGateSummary.summaryId,
    },
    nextAction: blockedBy.length
      ? "repair-syscall-external-handoff"
      : pendingBy.length
        ? nextCommand?.command || "wait-for-syscall-external-handoff"
      : releaseReady
          ? "handoff-syscall-batch-to-adapter"
          : nextCommand?.command || "hold-syscall-external-handoff",
  };
}

function buildSyscallAnalyticsHandoffBundle(
  boundary,
  syscalls,
  operationalReportingState,
  externalHandoffEnvelope,
  providerGateSummary,
  controlPlaneState,
  dispatchRecoveryJournal,
) {
  const exportRows = asArray(operationalReportingState.exportSummary?.rows);
  const historySnapshots = asArray(operationalReportingState.historySnapshots);
  const blockedRows = exportRows.filter((row) => asArray(row.blockedBy).length > 0);
  const pendingRows = exportRows.filter((row) => asArray(row.pendingBy).length > 0);
  const readyRows = exportRows.filter((row) => row.exportReady === true || row.state === "selected");
  const blockedBy = [
    ...asArray(operationalReportingState.exportSummary?.blockedBy).map((blocker) => `report:${blocker}`),
    ...asArray(externalHandoffEnvelope.blockedBy).map((blocker) => `handoff:${blocker}`),
    ...asArray(providerGateSummary.blockedBy).map((blocker) => `provider-gate:${blocker}`),
    ...asArray(controlPlaneState.blockedBy).map((blocker) => `control-plane:${blocker}`),
    ...asArray(dispatchRecoveryJournal.blockedBy).map((blocker) => `journal:${blocker}`),
  ].sort();
  const pendingBy = [
    ...asArray(operationalReportingState.exportSummary?.pendingBy).map((pending) => `report:${pending}`),
    ...asArray(externalHandoffEnvelope.pendingBy).map((pending) => `handoff:${pending}`),
    ...asArray(providerGateSummary.pendingBy).map((pending) => `provider-gate:${pending}`),
    ...asArray(controlPlaneState.pendingBy).map((pending) => `control-plane:${pending}`),
    ...asArray(dispatchRecoveryJournal.pendingBy).map((pending) => `journal:${pending}`),
  ].sort();
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : externalHandoffEnvelope.acceptedForAdapter
        ? "export-ready"
        : "observing";
  const syscallByName = new Map(syscalls.map((syscall) => [syscall.name, syscall]));
  const rowLedger = exportRows.map((row, index) => {
    const syscall = syscallByName.get(row.syscall) || {};
    const rowBlockedBy = asArray(row.blockedBy);
    const rowPendingBy = asArray(row.pendingBy);
    return {
      index,
      syscall: row.syscall,
      syscallId: syscall.id || row.syscallId || null,
      state: row.state || "unknown",
      selected: row.selected === true,
      exportReady: rowBlockedBy.length === 0 && rowPendingBy.length === 0,
      sideEffects: asArray(syscall.sideEffects || row.sideEffects),
      requiredCapabilities: asArray(syscall.requiredCapabilities || row.requiredCapabilities).sort(),
      blockedBy: rowBlockedBy,
      pendingBy: rowPendingBy,
      nextAction: rowBlockedBy.length
        ? row.nextAction || operationalReportingState.nextAction
        : rowPendingBy.length
          ? row.nextAction || "wait-for-syscall-export"
          : externalHandoffEnvelope.nextAction,
    };
  });
  const timelineDigest = historySnapshots.map((snapshot, index) => ({
    index,
    phase: snapshot.phase,
    status: snapshot.status,
    subject: snapshot.subject || snapshot.phase,
    counters: snapshot.counters || {},
    nextAction: snapshot.nextAction || operationalReportingState.nextAction,
  }));
  const latestBlockingPhase = timelineDigest.find((snapshot) => snapshot.status === "blocked") || null;
  const latestPendingPhase = timelineDigest.find((snapshot) => snapshot.status === "pending") || null;
  const reportChannels = [
    "syscall.analytics.mailchimp",
    operationalReportingState.statusChannel,
    controlPlaneState.statusChannel,
    externalHandoffEnvelope.statusChannel,
    ...asArray(operationalReportingState.timelineState?.reportChannels),
  ].filter(Boolean).sort();

  return {
    format: "aios.mailchimp.syscall.analyticsHandoff.v1",
    bundleId: stableId("mailchimp-syscall-analytics-handoff", [
      boundary.boundaryId,
      operationalReportingState.reportId,
      externalHandoffEnvelope.envelopeId,
      providerGateSummary.summaryId,
      status,
    ]),
    provider: "mailchimp",
    boundaryId: boundary.boundaryId,
    status,
    reportId: operationalReportingState.reportId,
    externalHandoffEnvelopeId: externalHandoffEnvelope.envelopeId,
    providerGateSummaryId: providerGateSummary.summaryId,
    controlPlaneId: controlPlaneState.controlPlaneId,
    restartJournalId: dispatchRecoveryJournal.journalId,
    acceptedForExport: status === "export-ready",
    restartSafe: dispatchRecoveryJournal.restartSafe === true
      && externalHandoffEnvelope.restartSafe !== false
      && blockedBy.length === 0,
    counters: {
      ...operationalReportingState.analyticsCounters,
      syscalls: syscalls.length,
      exportRows: rowLedger.length,
      exportReadyRows: readyRows.length,
      exportBlockedRows: blockedRows.length,
      exportPendingRows: pendingRows.length,
      historySnapshots: timelineDigest.length,
      blockedReasons: blockedBy.length,
      pendingReasons: pendingBy.length,
    },
    rowLedger,
    timelineDigest,
    latestBlockingPhase,
    latestPendingPhase,
    blockedBy,
    pendingBy,
    reportChannels,
    commands: [
      {
        command: "persist-syscall-analytics-handoff",
        enabled: true,
        idempotencyKey: `syscall-analytics-handoff:${operationalReportingState.reportId}`,
      },
      {
        command: "publish-syscall-analytics-export",
        enabled: status === "export-ready",
        idempotencyKey: `syscall-analytics-export:${externalHandoffEnvelope.envelopeId}`,
      },
      {
        command: "refresh-syscall-analytics-history",
        enabled: status !== "export-ready" && pendingBy.length > 0 && blockedBy.length === 0,
        idempotencyKey: `syscall-analytics-history:${stableId("syscall-analytics-history", [
          operationalReportingState.reportId,
          pendingBy,
        ])}`,
      },
    ],
    nextAction: blockedBy.length
      ? latestBlockingPhase?.nextAction || operationalReportingState.nextAction
      : pendingBy.length
        ? latestPendingPhase?.nextAction || "refresh-syscall-analytics-history"
        : status === "export-ready"
          ? "publish-syscall-analytics-export"
          : externalHandoffEnvelope.nextAction,
  };
}

function buildSyscallUpstreamReleaseGate(
  boundary,
  clientRuntimeAdoptionState,
  operationalReportingState,
  providerGateSummary,
  dispatchRecoveryJournal,
  adapterRecoveryHandoffPackage,
) {
  const memoryReplay = clientRuntimeAdoptionState.upstreamMemoryPackage?.replayStatusReceipt || {};
  const memorySyscallBoundary = clientRuntimeAdoptionState.upstreamMemoryPackage?.syscallBoundaryReceipt || {};
  const verifierRecovery = clientRuntimeAdoptionState.upstreamVerifierPackage?.recoveryTriageReceipt || {};
  const gateRows = [
    {
      gate: "memory-provider-gates",
      status: providerGateSummary.status,
      accepted: providerGateSummary.releaseReady === true,
      restartSafe: providerGateSummary.restartSafe !== false,
      statusPath: providerGateSummary.summaryId || null,
      blockedBy: asArray(providerGateSummary.blockedBy),
      pendingBy: asArray(providerGateSummary.pendingBy),
      nextAction: providerGateSummary.nextAction,
    },
    {
      gate: "memory-replay-status",
      status: memoryReplay.status || (memoryReplay.receiptId ? "provided" : "not-provided"),
      accepted: !memoryReplay.receiptId || memoryReplay.acceptedForProviderReplay === true,
      restartSafe: !memoryReplay.receiptId || memoryReplay.restartSafe !== false,
      statusPath: memoryReplay.receiptId || null,
      blockedBy: asArray(memoryReplay.blockedBy),
      pendingBy: asArray(memoryReplay.pendingBy),
      nextAction: memoryReplay.nextAction || "review-memory-replay-status",
    },
    {
      gate: "memory-syscall-boundary",
      status: memorySyscallBoundary.status || (memorySyscallBoundary.receiptId ? "provided" : "not-provided"),
      accepted: !memorySyscallBoundary.receiptId || memorySyscallBoundary.acceptedForSyscallDispatch === true,
      restartSafe: !memorySyscallBoundary.receiptId || memorySyscallBoundary.restartSafe !== false,
      statusPath: memorySyscallBoundary.receiptId || null,
      blockedBy: asArray(memorySyscallBoundary.blockedBy),
      pendingBy: asArray(memorySyscallBoundary.pendingBy),
      nextAction: memorySyscallBoundary.nextAction || "review-memory-syscall-boundary",
    },
    {
      gate: "verifier-recovery-triage",
      status: verifierRecovery.status || (verifierRecovery.receiptId ? "provided" : "not-provided"),
      accepted: !verifierRecovery.receiptId || verifierRecovery.acceptedForSyscallDispatch === true,
      restartSafe: !verifierRecovery.receiptId || verifierRecovery.restartSafe !== false,
      statusPath: verifierRecovery.receiptId || null,
      blockedBy: asArray(verifierRecovery.blockedBy),
      pendingBy: asArray(verifierRecovery.pendingBy),
      nextAction: verifierRecovery.nextAction || "review-verifier-recovery-triage",
    },
    {
      gate: "dispatch-recovery-journal",
      status: dispatchRecoveryJournal.status,
      accepted: dispatchRecoveryJournal.restartSafe === true,
      restartSafe: dispatchRecoveryJournal.restartSafe === true,
      statusPath: dispatchRecoveryJournal.journalId,
      blockedBy: asArray(dispatchRecoveryJournal.blockedBy),
      pendingBy: asArray(dispatchRecoveryJournal.pendingBy),
      nextAction: dispatchRecoveryJournal.nextAction || "persist-syscall-dispatch-journal",
    },
    {
      gate: "adapter-recovery-handoff",
      status: adapterRecoveryHandoffPackage.status,
      accepted: adapterRecoveryHandoffPackage.acceptedForAdapter === true,
      restartSafe: adapterRecoveryHandoffPackage.restartSafe === true,
      statusPath: adapterRecoveryHandoffPackage.packageId,
      blockedBy: asArray(adapterRecoveryHandoffPackage.blockedBy),
      pendingBy: asArray(adapterRecoveryHandoffPackage.pendingBy),
      nextAction: adapterRecoveryHandoffPackage.nextAction,
    },
  ];
  const blockedBy = gateRows
    .flatMap((row) => row.blockedBy.map((blocker) => `${row.gate}:${blocker}`))
    .sort();
  const pendingBy = gateRows
    .flatMap((row) => row.pendingBy.map((pending) => `${row.gate}:${pending}`))
    .sort();
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && gateRows.every((row) => row.accepted && row.restartSafe !== false);
  const gateId = stableId("mailchimp-syscall-upstream-release", [
    boundary.boundaryId,
    providerGateSummary.summaryId,
    memoryReplay.receiptId,
    memorySyscallBoundary.receiptId,
    verifierRecovery.receiptId,
    dispatchRecoveryJournal.journalId,
    adapterRecoveryHandoffPackage.packageId,
    gateRows.map((row) => [row.gate, row.status]),
  ]);

  return {
    format: "aios.mailchimp.syscall.upstreamReleaseGate.v1",
    gateId,
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : releaseReady ? "release-ready" : "waiting",
    releaseReady,
    acceptedForDispatch: releaseReady && operationalReportingState.status !== "blocked",
    restartSafe: gateRows.every((row) => row.restartSafe !== false),
    statusChannel: releaseReady ? "syscall.upstream.mailchimp.release" : "syscall.upstream.mailchimp.hold",
    blockedBy,
    pendingBy,
    gateRows,
    commands: [
      {
        command: "persist-syscall-upstream-release-gate",
        enabled: true,
        idempotencyKey: `syscall-upstream-release:${gateId}`,
      },
      {
        command: "release-syscall-upstream-dispatch",
        enabled: releaseReady,
        idempotencyKey: `syscall-upstream-dispatch:${stableId("syscall-upstream-dispatch", [
          gateId,
          adapterRecoveryHandoffPackage.packageId,
        ])}`,
      },
    ],
    nextAction: blockedBy.length
      ? gateRows.find((row) => row.blockedBy.length)?.nextAction || "repair-syscall-upstream-release"
      : pendingBy.length
        ? gateRows.find((row) => row.pendingBy.length)?.nextAction || "wait-syscall-upstream-release"
        : releaseReady
          ? "release-syscall-upstream-dispatch"
          : operationalReportingState.nextAction,
  };
}

function buildSyscallDispatchObservabilityExport(
  boundary,
  syscalls,
  lifecycleControls,
  operationalReportingState,
  externalHandoffEnvelope,
  analyticsHandoffBundle,
  upstreamReleaseGate,
  providerGateSummary,
) {
  const historySnapshots = asArray(operationalReportingState.historySnapshots);
  const reportBlockedBy = asArray(operationalReportingState.exportSummary?.blockedBy);
  const handoffBlockedBy = asArray(externalHandoffEnvelope.blockedBy);
  const analyticsBlockedBy = asArray(analyticsHandoffBundle.blockedBy);
  const upstreamBlockedBy = asArray(upstreamReleaseGate.blockedBy);
  const blockedBy = [
    ...reportBlockedBy.map((blocker) => `report:${blocker}`),
    ...handoffBlockedBy.map((blocker) => `handoff:${blocker}`),
    ...analyticsBlockedBy.map((blocker) => `analytics:${blocker}`),
    ...upstreamBlockedBy.map((blocker) => `upstream:${blocker}`),
  ].sort();
  const pendingBy = [
    ...asArray(operationalReportingState.exportSummary?.pendingBy).map((pending) => `report:${pending}`),
    ...asArray(externalHandoffEnvelope.pendingBy).map((pending) => `handoff:${pending}`),
    ...asArray(analyticsHandoffBundle.pendingBy).map((pending) => `analytics:${pending}`),
    ...asArray(upstreamReleaseGate.pendingBy).map((pending) => `upstream:${pending}`),
  ].sort();
  const syscallRows = syscalls.map((syscall) => {
    const analyticsRow = asArray(analyticsHandoffBundle.rowLedger)
      .find((row) => row.syscall === syscall.name) || {};
    const selected = operationalReportingState.exportSummary?.rows
      ?.some((row) => row.syscall === syscall.name && row.selected) === true;
    return {
      syscall: syscall.name,
      id: syscall.id,
      status: syscall.status,
      selected,
      retrySafe: syscall.recovery.retrySafe,
      requiresApproval: syscall.recovery.requiresApproval,
      sideEffects: syscall.sideEffects,
      analyticsState: analyticsRow.state || (selected ? "selected" : "observed"),
      blockedBy: syscall.status === "blocked"
        ? [
          ...asArray(syscall.negotiation?.missing).map((capability) => `capability:${capability}`),
          ...(syscall.recovery.nextAction ? [`recovery:${syscall.recovery.nextAction}`] : []),
        ].sort()
        : [],
      nextAction: syscall.status === "blocked"
        ? syscall.recovery.nextAction
        : syscall.status === "approval-gated"
          ? "collect-operator-approval"
          : selected
            ? "handoff-syscall-batch-to-adapter"
            : "hold-syscall-selection",
    };
  });
  const incidentRows = [
    ...blockedBy.map((blocker, index) => ({
      incidentId: stableId("mailchimp-syscall-observability-incident", [
        boundary.boundaryId,
        "blocked",
        blocker,
        index,
      ]),
      severity: "error",
      blocker,
      retryable: blocker.includes("capability:") || blocker.includes("health:retry"),
      action: blocker.includes("capability:")
        ? "refresh-provider-service-capabilities"
        : blocker.includes("tenant")
          ? "repair-syscall-tenant-boundary"
          : blocker.includes("upstream")
            ? "repair-syscall-upstream-release"
            : "repair-syscall-operational-report",
    })),
    ...pendingBy.map((pending, index) => ({
      incidentId: stableId("mailchimp-syscall-observability-incident", [
        boundary.boundaryId,
        "pending",
        pending,
        index,
      ]),
      severity: "warning",
      blocker: pending,
      retryable: pending.includes("retry") || pending.includes("health"),
      action: pending.includes("approval")
        ? "collect-operator-approval"
        : pending.includes("analytics")
          ? "publish-syscall-analytics-handoff"
          : "continue-syscall-release",
    })),
  ];
  const timelineRows = historySnapshots.map((snapshot, index) => ({
    index,
    eventId: snapshot.eventId || stableId("mailchimp-syscall-observability-event", [
      boundary.boundaryId,
      snapshot.phase,
      snapshot.status,
      index,
    ]),
    phase: snapshot.phase,
    status: snapshot.status,
    subject: snapshot.subject || snapshot.phase,
    counters: snapshot.counters || {},
    nextAction: snapshot.nextAction || operationalReportingState.nextAction,
  }));
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : externalHandoffEnvelope.acceptedForAdapter && analyticsHandoffBundle.acceptedForExport
        ? "export-ready"
        : "observing";
  const retryableIncidents = incidentRows.filter((incident) => incident.retryable);
  const exportId = stableId("mailchimp-syscall-dispatch-observability", [
    boundary.boundaryId,
    operationalReportingState.reportId,
    externalHandoffEnvelope.envelopeId,
    analyticsHandoffBundle.bundleId,
    status,
  ]);

  return {
    format: "aios.mailchimp.syscall.dispatchObservabilityExport.v1",
    exportId,
    status,
    reportId: operationalReportingState.reportId,
    externalHandoffEnvelopeId: externalHandoffEnvelope.envelopeId,
    analyticsBundleId: analyticsHandoffBundle.bundleId,
    upstreamReleaseGateId: upstreamReleaseGate.gateId,
    generatedDeterministically: true,
    counters: {
      syscalls: syscallRows.length,
      selected: syscallRows.filter((row) => row.selected).length,
      blocked: syscallRows.filter((row) => row.status === "blocked").length,
      approvalGated: syscallRows.filter((row) => row.status === "approval-gated").length,
      timelineEvents: timelineRows.length,
      incidents: incidentRows.length,
      retryableIncidents: retryableIncidents.length,
      providerGates: asArray(providerGateSummary.gates).length,
    },
    syscallRows,
    timelineRows,
    incidentRows,
    blockedBy,
    pendingBy,
    retryPlan: {
      retryable: retryableIncidents.length > 0,
      retryableIncidentIds: retryableIncidents.map((incident) => incident.incidentId),
      nextDelaySeconds: retryableIncidents.length
        ? Math.max(30, lifecycleControls.settings.scheduleEverySeconds || 30)
        : null,
      statusChannel: retryableIncidents.length
        ? "syscall.observability.mailchimp.retry"
        : "syscall.observability.mailchimp",
    },
    commands: [
      {
        command: "persist-syscall-dispatch-observability",
        enabled: true,
        idempotencyKey: `syscall-observability:${exportId}`,
      },
      {
        command: "publish-syscall-dispatch-observability",
        enabled: status !== "blocked",
        statusChannel: "syscall.observability.mailchimp",
      },
      {
        command: "schedule-syscall-observability-retry",
        enabled: retryableIncidents.length > 0,
        delaySeconds: retryableIncidents.length
          ? Math.max(30, lifecycleControls.settings.scheduleEverySeconds || 30)
          : null,
      },
    ],
    nextAction: blockedBy.length
      ? incidentRows.find((incident) => incident.severity === "error")?.action || "repair-syscall-operational-report"
      : pendingBy.length
        ? incidentRows.find((incident) => incident.severity === "warning")?.action || "continue-syscall-release"
        : status === "export-ready"
          ? "publish-syscall-dispatch-observability"
          : operationalReportingState.nextAction,
  };
}

export function analyzeMailchimpSyscalls(source = {}, options = {}) {
  const boundary = normalizeBoundary(source);
  const manifest = createMailchimpSyscallManifest(boundary);
  const syscalls = manifest.syscalls.map((syscall) => classifySyscall(syscall, manifest));
  const blocked = syscalls.filter((syscall) => syscall.status === "blocked");
  const approvalGated = syscalls.filter((syscall) => syscall.status === "approval-gated");
  const requiredCapabilities = [...new Set(syscalls.flatMap((syscall) => syscall.requiredCapabilities))].sort();
  const lifecycleSettings = normalizeLifecycleSettings(boundary, options);
  const lifecycleDiagnostics = validateLifecycleSettings(lifecycleSettings);
  const allowedExternalWrites = approvalGated.filter((syscall) => (
    lifecycleSettings.externalWritesEnabled
      && options.operatorApproved === true
      && syscall.name === MAILCHIMP_SYSCALLS.commitAdapterBatch
  ));
  const lifecycleControls = buildLifecycleControls(
    syscalls,
    lifecycleSettings,
    blocked,
    approvalGated,
    allowedExternalWrites,
    lifecycleDiagnostics,
  );
  const schedulingState = buildSchedulingState(boundary, lifecycleSettings, lifecycleControls);
  const providerServiceContract = inferProviderServiceContract(boundary, manifest, syscalls);
  const dispatchBatchState = buildDispatchBatchState(
    boundary,
    syscalls,
    providerServiceContract,
    lifecycleControls,
    schedulingState,
  );
  const externalHandoffState = buildExternalHandoffState(
    boundary,
    providerServiceContract,
    dispatchBatchState,
    lifecycleControls,
  );
  const routePreviewAcceptanceState = buildRoutePreviewAcceptanceState(
    boundary,
    syscalls,
    dispatchBatchState,
    externalHandoffState,
    lifecycleControls,
  );
  const upstreamMemoryPackage = normalizeUpstreamMemoryPackage(boundary, options);
  const upstreamVerifierPackage = normalizeUpstreamVerifierPackage(boundary, options);
  const clientRuntimeAdoptionState = buildClientRuntimeAdoptionState(
    boundary,
    dispatchBatchState,
    externalHandoffState,
    routePreviewAcceptanceState,
    lifecycleControls,
    upstreamMemoryPackage,
    upstreamVerifierPackage,
  );
  const dispatchRecoveryJournal = buildRestartSafeDispatchJournal(
    boundary,
    dispatchBatchState,
    externalHandoffState,
    routePreviewAcceptanceState,
    clientRuntimeAdoptionState,
    lifecycleControls,
    providerServiceContract,
  );
  const tenantAuditBoundaryState = buildTenantAuditBoundaryState(
    boundary,
    lifecycleControls,
    routePreviewAcceptanceState,
    clientRuntimeAdoptionState,
    dispatchRecoveryJournal,
  );
  const operationalReportingState = buildSyscallOperationalReportingState(
    boundary,
    syscalls,
    lifecycleControls,
    providerServiceContract,
    dispatchBatchState,
    externalHandoffState,
    routePreviewAcceptanceState,
    clientRuntimeAdoptionState,
    dispatchRecoveryJournal,
    tenantAuditBoundaryState,
    lifecycleDiagnostics,
  );
  const adapterRecoveryHandoffPackage = buildAdapterRecoveryHandoffPackage(
    boundary,
    dispatchBatchState,
    externalHandoffState,
    routePreviewAcceptanceState,
    clientRuntimeAdoptionState,
    dispatchRecoveryJournal,
    tenantAuditBoundaryState,
    operationalReportingState,
  );
  const controlPlaneState = buildSyscallControlPlaneState(
    boundary,
    lifecycleControls,
    schedulingState,
    providerServiceContract,
    dispatchBatchState,
    routePreviewAcceptanceState,
    clientRuntimeAdoptionState,
    dispatchRecoveryJournal,
    tenantAuditBoundaryState,
    operationalReportingState,
    adapterRecoveryHandoffPackage,
  );
  const providerGateSummary = buildSyscallProviderGateSummary(
    clientRuntimeAdoptionState,
    controlPlaneState,
    adapterRecoveryHandoffPackage,
  );
  const externalHandoffEnvelope = buildSyscallExternalHandoffEnvelope(
    boundary,
    lifecycleControls,
    providerServiceContract,
    dispatchBatchState,
    externalHandoffState,
    routePreviewAcceptanceState,
    clientRuntimeAdoptionState,
    dispatchRecoveryJournal,
    tenantAuditBoundaryState,
    operationalReportingState,
    adapterRecoveryHandoffPackage,
    controlPlaneState,
    providerGateSummary,
  );
  const analyticsHandoffBundle = buildSyscallAnalyticsHandoffBundle(
    boundary,
    syscalls,
    operationalReportingState,
    externalHandoffEnvelope,
    providerGateSummary,
    controlPlaneState,
    dispatchRecoveryJournal,
  );
  const upstreamReleaseGate = buildSyscallUpstreamReleaseGate(
    boundary,
    clientRuntimeAdoptionState,
    operationalReportingState,
    providerGateSummary,
    dispatchRecoveryJournal,
    adapterRecoveryHandoffPackage,
  );
  const dispatchObservabilityExport = buildSyscallDispatchObservabilityExport(
    boundary,
    syscalls,
    lifecycleControls,
    operationalReportingState,
    externalHandoffEnvelope,
    analyticsHandoffBundle,
    upstreamReleaseGate,
    providerGateSummary,
  );
  const status = blocked.length
    ? "blocked"
    : lifecycleDiagnostics.some((diagnostic) => diagnostic.level === "error")
      ? "settings-invalid"
      : approvalGated.length
        ? "ready-with-approval-gates"
        : "ready";

  return {
    kind: "aios.semantic.syscallAnalysis",
    version: MAILCHIMP_SYSCALL_ANALYSIS_VERSION,
    provider: "mailchimp",
    status,
    boundaryId: manifest.boundaryId,
    manifest,
    syscalls,
    syscallContract: {
      requiredCapabilities,
      negotiatedCapabilities: providerServiceContract.negotiatedCapabilities,
      missingProviderCapabilities: providerServiceContract.missingCapabilities,
      dispatchable: syscalls.filter((syscall) => syscall.status === "ready").map((syscall) => syscall.name),
      approvalGated: approvalGated.map((syscall) => syscall.name),
      blocked: blocked.map((syscall) => syscall.name),
      allowedExternalWrites: allowedExternalWrites.map((syscall) => syscall.name),
    },
    adapterHandoff: {
      statusChannel: "syscall.status.mailchimp",
      acceptedForDispatch: lifecycleControls.canDispatch
        && providerServiceContract.status === "negotiated"
        && tenantAuditBoundaryState.status !== "blocked"
        && operationalReportingState.memoryHealth.degradedMode !== true
        && operationalReportingState.memoryControlPlane.restartSafe !== false
        && operationalReportingState.memoryControlPlane.blockedBy.length === 0
        && operationalReportingState.memoryClientWorkflow.restartSafe !== false
        && operationalReportingState.memoryClientWorkflow.blockedBy.length === 0
        && operationalReportingState.memoryClientWorkflow.acceptedForProviderSync !== false
        && operationalReportingState.memoryBoundaryLease.restartSafe !== false
        && operationalReportingState.memoryBoundaryLease.blockedBy.length === 0
        && operationalReportingState.memoryBoundaryLease.acceptedForProviderSync !== false
        && operationalReportingState.memoryProviderService.restartSafe !== false
        && operationalReportingState.memoryProviderService.blockedBy.length === 0
        && operationalReportingState.memoryProviderService.acceptedForProviderSync !== false
        && operationalReportingState.memoryProviderService.acceptedForSyscallDispatch !== false
        && operationalReportingState.memoryProviderAssertions.restartSafe !== false
        && operationalReportingState.memoryProviderAssertions.blockedBy.length === 0
        && operationalReportingState.memoryProviderAssertions.acceptedForSyscallDispatch !== false
        && operationalReportingState.memoryReleaseRiskBudget.restartSafe !== false
        && operationalReportingState.memoryReleaseRiskBudget.blockedBy.length === 0
        && operationalReportingState.memoryReleaseRiskBudget.acceptedForSyscallDispatch !== false
        && operationalReportingState.memoryOperatorRelease.restartSafe !== false
        && operationalReportingState.memoryOperatorRelease.blockedBy.length === 0
        && operationalReportingState.memoryOperatorRelease.acceptedForSyscallDispatch !== false
        && operationalReportingState.memoryDispatchReleaseLedger.restartSafe !== false
        && operationalReportingState.memoryDispatchReleaseLedger.blockedBy.length === 0
        && operationalReportingState.memoryDispatchReleaseLedger.acceptedForSyscallDispatch !== false
        && operationalReportingState.memoryClaimRuntimeAdoptionReceipt.restartSafe !== false
        && operationalReportingState.memoryClaimRuntimeAdoptionReceipt.blockedBy.length === 0
        && operationalReportingState.memoryClaimRuntimeAdoptionReceipt.acceptedForSyscallDispatch !== false
        && clientRuntimeAdoptionState.upstreamMemoryPackage.syscallBoundaryReceipt.restartSafe !== false
        && clientRuntimeAdoptionState.upstreamMemoryPackage.syscallBoundaryReceipt.blockedBy.length === 0
        && clientRuntimeAdoptionState.upstreamMemoryPackage.syscallBoundaryReceipt.pendingBy.length === 0
        && clientRuntimeAdoptionState.upstreamMemoryPackage.syscallBoundaryReceipt.acceptedForSyscallDispatch !== false
        && operationalReportingState.memoryOperatorResume.restartSafe !== false
        && operationalReportingState.memoryOperatorResume.blockedBy.length === 0
        && operationalReportingState.memoryOperatorResume.acceptedForProviderSync !== false
        && operationalReportingState.verifierHealth.acceptedForSyscallDispatch !== false
        && operationalReportingState.verifierHealth.status !== "blocked"
        && operationalReportingState.verifierTenantDispatchGuard.acceptedForSyscallDispatch !== false
        && operationalReportingState.verifierTenantDispatchGuard.status !== "blocked"
        && operationalReportingState.verifierTenantDispatchGuard.restartSafe !== false
        && upstreamReleaseGate.acceptedForDispatch === true
        && operationalReportingState.status !== "blocked",
      externalWriteAccepted: allowedExternalWrites.length > 0,
      providerService: providerServiceContract.providerService,
      handoffId: externalHandoffState.handoffId,
      batchId: dispatchBatchState.batchId,
      restartJournalId: dispatchRecoveryJournal.journalId,
      restartSafe: dispatchRecoveryJournal.restartSafe,
      operationalReportId: operationalReportingState.reportId,
      recoveryHandoffPackageId: adapterRecoveryHandoffPackage.packageId,
      upstreamReleaseGateId: upstreamReleaseGate.gateId,
      dispatchObservabilityExportId: dispatchObservabilityExport.exportId,
      nextAction: operationalReportingState.status === "blocked"
        ? operationalReportingState.nextAction
        : blocked.length
        ? blocked[0].recovery.nextAction
        : providerServiceContract.status !== "negotiated"
          ? "refresh-provider-service-capabilities"
        : tenantAuditBoundaryState.status === "blocked"
          ? tenantAuditBoundaryState.nextAction
        : lifecycleControls.nextAction === "repair-syscall-lifecycle-settings"
          ? lifecycleControls.nextAction
        : approvalGated.length && allowedExternalWrites.length === 0
          ? "collect-operator-approval"
          : "dispatch-syscall-plan",
    },
    lifecycleControls,
    schedulingState,
    providerServiceContract,
    dispatchBatchState,
    externalHandoffState,
    routePreviewAcceptanceState,
    previewState: routePreviewAcceptanceState.preview,
    acceptanceState: routePreviewAcceptanceState.acceptance,
    readinessSummary: routePreviewAcceptanceState.readiness,
    clientRuntimeAdoptionState,
    dispatchRecoveryJournal,
    tenantAuditBoundaryState,
    adapterRecoveryHandoffPackage,
    controlPlaneState,
    providerGateSummary,
    externalHandoffEnvelope,
    analyticsHandoffBundle,
    upstreamReleaseGate,
    dispatchObservabilityExport,
    analytics: operationalReportingState.analyticsCounters,
    operationalReportingState,
    exportSummary: operationalReportingState.exportSummary,
    historySnapshots: operationalReportingState.historySnapshots,
    timelineState: operationalReportingState.timelineState,
    nextSteps: routePreviewAcceptanceState.nextSteps,
    nextActionState: {
      action: tenantAuditBoundaryState.status === "blocked"
        ? tenantAuditBoundaryState.nextAction
        : operationalReportingState.nextAction,
      command: clientRuntimeAdoptionState.acceptedForRuntime
        && providerGateSummary.releaseReady
        ? "handoff-syscall-batch-to-adapter"
        : providerGateSummary.commands.find((command) => command.enabled)?.command
          || operationalReportingState.commands.find((command) => command.enabled)?.command
          || clientRuntimeAdoptionState.routeCommands.find((command) => command.enabled)?.command
          || lifecycleControls.commands.find((command) => command.enabled)?.command
          || "hold-syscall-plan",
      blockedBy: [
        ...blocked.map((syscall) => syscall.name),
        ...providerServiceContract.missingCapabilities.map((capability) => `capability:${capability}`),
        ...clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
        ...clientRuntimeAdoptionState.upstreamMemoryPackage.blockedBy.map((blocker) => `memory:${blocker}`),
        ...clientRuntimeAdoptionState.upstreamMemoryPackage.boundaryLease.blockedBy.map((blocker) => `memory-boundary:${blocker}`),
        ...clientRuntimeAdoptionState.upstreamMemoryPackage.providerAssertionDigest.blockedBy
          .map((blocker) => `memory-provider-assertion:${blocker}`),
        ...clientRuntimeAdoptionState.upstreamMemoryPackage.releaseRiskBudget.blockedBy
          .map((blocker) => `memory-release-risk:${blocker}`),
        ...clientRuntimeAdoptionState.upstreamMemoryPackage.operatorRelease.blockedBy
          .map((blocker) => `memory-operator-release:${blocker}`),
        ...clientRuntimeAdoptionState.upstreamVerifierPackage.blockedBy.map((blocker) => `verifier:${blocker}`),
        ...providerGateSummary.blockedBy,
        ...tenantAuditBoundaryState.tenantBlockedBy,
        ...operationalReportingState.exportSummary.blockedBy.map((blocker) => `report:${blocker}`),
        ...lifecycleDiagnostics
          .filter((diagnostic) => diagnostic.level === "error")
          .map((diagnostic) => diagnostic.code),
      ].sort(),
      statusChannel: operationalReportingState.memoryHealth.degradedMode
        ? operationalReportingState.memoryHealth.statusChannel
        : operationalReportingState.verifierHealth.status === "blocked" || operationalReportingState.verifierHealth.status === "pending"
          ? operationalReportingState.verifierHealth.statusChannel
        : schedulingState.enabled
          ? schedulingState.statusChannel
          : controlPlaneState.statusChannel,
    },
    recovery: {
      restartSafe: dispatchRecoveryJournal.restartSafe
        && blocked.every((syscall) => syscall.recovery.retrySafe)
        && lifecycleDiagnostics.every((diagnostic) => diagnostic.level !== "error")
        && clientRuntimeAdoptionState.hydrated,
      upstreamReleaseGate,
      retryableSyscalls: syscalls.filter((syscall) => syscall.recovery.retrySafe).map((syscall) => syscall.name),
      blockedRecoveryActions: [...new Set(blocked.map((syscall) => syscall.recovery.nextAction))].sort(),
      persistedStateKey: clientRuntimeAdoptionState.stateKey,
      continuationToken: clientRuntimeAdoptionState.continuationToken,
      dispatchJournal: dispatchRecoveryJournal,
      auditBoundary: tenantAuditBoundaryState,
      idempotentCommands: dispatchRecoveryJournal.idempotentCommands.concat(
        operationalReportingState.commands
          .filter((command) => command.idempotencyKey)
          .map((command) => ({
            command: command.command,
            idempotencyKey: command.idempotencyKey,
            enabled: command.enabled,
          })),
        adapterRecoveryHandoffPackage.commands
          .filter((command) => command.idempotencyKey)
          .map((command) => ({
            command: command.command,
            idempotencyKey: command.idempotencyKey,
            enabled: command.enabled,
          })),
        dispatchObservabilityExport.commands
          .filter((command) => command.idempotencyKey)
          .map((command) => ({
            command: command.command,
            idempotencyKey: command.idempotencyKey,
            enabled: command.enabled,
          })),
      ),
      retryPlan: dispatchRecoveryJournal.retryPlan,
      adapterRecoveryHandoffPackage,
      controlPlaneState,
      resumeAfter: clientRuntimeAdoptionState.acceptedForRuntime
        ? "adapter-ack"
        : dispatchRecoveryJournal.resumeAfter,
    },
  };
}

export function validateMailchimpSyscallAnalysis(analysis) {
  const diagnostics = [];
  if (analysis?.kind !== "aios.semantic.syscallAnalysis") {
    diagnostics.push({ level: "error", code: "syscall.analysis.kind.invalid" });
  }
  if (!analysis?.manifest?.syscalls?.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.manifest.empty" });
  }
  if (!analysis?.syscallContract?.requiredCapabilities?.includes("memory.local.artifact.write")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-capability.missing" });
  }
  if (analysis?.adapterHandoff?.externalWriteAccepted && !analysis.syscallContract.allowedExternalWrites.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.external-write.inconsistent" });
  }
  if (analysis?.lifecycleControls?.canCommitExternalWrite && analysis.lifecycleControls.settings?.mode !== "adapter-mediated") {
    diagnostics.push({ level: "error", code: "syscall.analysis.lifecycle.external-write-mode.invalid" });
  }
  if (analysis?.schedulingState?.enabled && !analysis?.lifecycleControls?.canDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.schedule.enabled-without-dispatch" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch && analysis?.providerServiceContract?.status !== "negotiated") {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-without-provider-negotiation" });
  }
  if (analysis?.dispatchBatchState?.schedule?.enabled && !analysis.dispatchBatchState.selectedSyscalls.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.schedule-without-selected-syscalls" });
  }
  if (analysis?.externalHandoffState?.externalWrite?.accepted && !analysis.syscallContract.allowedExternalWrites.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.external-handoff-without-allowed-write" });
  }
  if (analysis?.acceptanceState?.acceptedForRuntime && analysis?.readinessSummary?.status !== "ready") {
    diagnostics.push({ level: "error", code: "syscall.analysis.accepted-while-preview-not-ready" });
  }
  if (analysis?.previewState?.rows?.length !== analysis?.syscalls?.length) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.preview.rows-mismatch" });
  }
  if (analysis?.readinessSummary?.status === "ready" && analysis?.acceptanceState?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.ready-with-acceptance-blockers" });
  }
  if (!Array.isArray(analysis?.nextSteps)) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.next-steps.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.acceptedForRuntime && analysis?.clientRuntimeAdoptionState?.hydrated !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.runtime-adoption-without-client-state" });
  }
  if (analysis?.clientRuntimeAdoptionState?.acceptedForRuntime
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.runtime-adoption-with-memory-blockers" });
  }
  if (!analysis?.clientRuntimeAdoptionState?.routeCommands?.some((command) => command.command === "render-syscall-preview")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.preview-route-command.missing" });
  }
  if (analysis?.recovery?.restartSafe && analysis?.clientRuntimeAdoptionState?.hydrated !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.restart-safe-without-client-state" });
  }
  if (analysis?.adapterHandoff?.restartSafe && analysis?.dispatchRecoveryJournal?.restartSafe !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.adapter-restart-safe-without-journal" });
  }
  if (analysis?.dispatchRecoveryJournal?.handoffReady && analysis?.clientRuntimeAdoptionState?.acceptedForRuntime !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.journal-ready-without-runtime-adoption" });
  }
  if (!analysis?.dispatchRecoveryJournal?.idempotentCommands?.some((command) => command.command === "persist-syscall-dispatch-journal")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.dispatch-journal-command.missing" });
  }
  if (analysis?.recovery?.restartSafe && analysis?.dispatchRecoveryJournal?.status === "blocked") {
    diagnostics.push({ level: "error", code: "syscall.analysis.restart-safe-with-blocked-journal" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch && analysis?.tenantAuditBoundaryState?.status === "blocked") {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-tenant-blocker" });
  }
  if (analysis?.tenantAuditBoundaryState?.requiresApproval
    && analysis?.tenantAuditBoundaryState?.canApprove === false
    && analysis?.acceptanceState?.acceptedForExternalWrite) {
    diagnostics.push({ level: "error", code: "syscall.analysis.external-write-accepted-by-unapproved-role" });
  }
  if (!analysis?.tenantAuditBoundaryState?.auditEvents?.some((event) => event.event === "syscall.dispatch.journaled")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.audit-journal-event.missing" });
  }
  if (!analysis?.tenantAuditBoundaryState?.commandPolicy?.some((policy) => policy.command === "handoff-syscall-batch-to-adapter")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.audit-command-policy.missing" });
  }
  if (!analysis?.operationalReportingState?.reportId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.operational-report.missing" });
  }
  if (analysis?.operationalReportingState?.memoryHealth?.degradedMode
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-degraded-memory-health" });
  }
  if (analysis?.operationalReportingState?.memoryControlPlane?.blockedBy?.length
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-blocked-memory-control-plane" });
  }
  if (analysis?.operationalReportingState?.memoryControlPlane?.restartSafe === false
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-control-plane" });
  }
  if (analysis?.operationalReportingState?.memoryClientWorkflow?.blockedBy?.length
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-blocked-memory-client-workflow" });
  }
  if (analysis?.operationalReportingState?.memoryClientWorkflow?.restartSafe === false
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-client-workflow" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.clientWorkflowHandoff?.present
    && !analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "memory-client-workflow")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-client-workflow-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.clientWorkflowHandoff?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-client-workflow")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-client-workflow-gate.missing" });
  }
  if (analysis?.operationalReportingState?.memoryBoundaryLease?.blockedBy?.length
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-blocked-memory-boundary-lease" });
  }
  if (analysis?.operationalReportingState?.memoryBoundaryLease?.restartSafe === false
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-boundary-lease" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.boundaryLease?.present
    && !analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "memory-boundary-lease")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-boundary-lease-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.boundaryLease?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-boundary-lease")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-boundary-lease-gate.missing" });
  }
  if (analysis?.operationalReportingState?.memoryBoundaryLease?.packetId
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.boundaryLease?.packetId !== analysis.operationalReportingState.memoryBoundaryLease.packetId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-boundary-lease-id.inconsistent" });
  }
  if (analysis?.operationalReportingState?.memoryProviderService?.blockedBy?.length
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-blocked-memory-provider-service" });
  }
  if (analysis?.operationalReportingState?.memoryProviderService?.restartSafe === false
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-provider-service" });
  }
  if (analysis?.operationalReportingState?.memoryProviderService?.acceptedForSyscallDispatch === false
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-provider-service-release" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.providerService?.present
    && !analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "memory-provider-service")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-provider-service-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.providerService?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-provider-service")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-provider-service-gate.missing" });
  }
  if (analysis?.operationalReportingState?.memoryProviderService?.contractId
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.providerService?.contractId !== analysis.operationalReportingState.memoryProviderService.contractId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-provider-service-id.inconsistent" });
  }
  if (analysis?.operationalReportingState?.memoryProviderAssertions?.blockedBy?.length
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-blocked-memory-provider-assertions" });
  }
  if (analysis?.operationalReportingState?.memoryProviderAssertions?.restartSafe === false
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-provider-assertions" });
  }
  if (analysis?.operationalReportingState?.memoryProviderAssertions?.acceptedForSyscallDispatch === false
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-provider-assertions" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.providerAssertionDigest?.present
    && !analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "memory-provider-assertions")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-provider-assertions-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.providerAssertionDigest?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-provider-assertions")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-provider-assertions-gate.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.audienceSyncWatermark?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-audience-sync-watermark")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-audience-watermark-gate.missing" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.audienceSyncWatermark?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-audience-watermark" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.audienceSyncWatermark?.acceptedForSyscallDispatch
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.audienceSyncWatermark?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "syscall.analysis.memory-audience-watermark-accepted-without-restart-safe" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.audienceContinuityReceipt?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-audience-continuity")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-audience-continuity-gate.missing" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.audienceContinuityReceipt?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-audience-continuity" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.audienceContinuityReceipt?.acceptedForSyscallDispatch
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.audienceContinuityReceipt?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "syscall.analysis.memory-audience-continuity-accepted-without-restart-safe" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.audienceContinuityReceipt?.blockedBy?.length
    && analysis?.clientRuntimeAdoptionState?.acceptedForRuntime) {
    diagnostics.push({ level: "error", code: "syscall.analysis.runtime-adoption-with-memory-audience-continuity-blockers" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.releaseRiskBudget?.present
    && !analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "memory-release-risk")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-release-risk-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.releaseRiskBudget?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-release-risk")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-release-risk-gate.missing" });
  }
  if (analysis?.operationalReportingState?.memoryReleaseRiskBudget?.budgetId
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.releaseRiskBudget?.budgetId !== analysis.operationalReportingState.memoryReleaseRiskBudget.budgetId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-release-risk-id.inconsistent" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.operationalReportingState?.memoryReleaseRiskBudget?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-release-risk" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.operationalReportingState?.memoryReleaseRiskBudget?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-release-risk" });
  }
  if (analysis?.operationalReportingState?.memoryOperatorRelease?.blockedBy?.length
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-blocked-memory-operator-release" });
  }
  if (analysis?.operationalReportingState?.memoryOperatorRelease?.restartSafe === false
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-operator-release" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.operationalReportingState?.memoryOperatorRelease?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-operator-release" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.operatorRelease?.present
    && !analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "memory-operator-release")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-operator-release-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.operatorRelease?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-operator-release")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-operator-release-gate.missing" });
  }
  if (analysis?.operationalReportingState?.memoryOperatorRelease?.packetId
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.operatorRelease?.packetId !== analysis.operationalReportingState.memoryOperatorRelease.packetId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-operator-release-id.inconsistent" });
  }
  if (analysis?.operationalReportingState?.memoryReleaseRiskBudget?.releaseReady
    && analysis?.operationalReportingState?.memoryReleaseRiskBudget?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.memory-release-risk-ready-with-blockers" });
  }
  if (analysis?.operationalReportingState?.memoryProviderAssertions?.digestId
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.providerAssertionDigest?.digestId !== analysis.operationalReportingState.memoryProviderAssertions.digestId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-provider-assertions-id.inconsistent" });
  }
  if (analysis?.operationalReportingState?.memoryClientWorkflow?.packetId
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.clientWorkflowHandoff?.packetId !== analysis.operationalReportingState.memoryClientWorkflow.packetId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-client-workflow-id.inconsistent" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.clientWorkflowHandoff?.releaseReceipt?.present
    && !analysis?.operationalReportingState?.memoryClientWorkflow?.releaseReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-client-workflow-receipt-report.missing" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.clientWorkflowHandoff?.releaseReceipt?.acceptedForProviderSync === false) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-workflow-receipt" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.clientWorkflowHandoff?.releaseReceipt?.restartSafe === false
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-workflow-receipt" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.clientWorkflowHandoff?.releaseReceipt?.blockedBy?.length
    && analysis?.clientRuntimeAdoptionState?.acceptedForRuntime) {
    diagnostics.push({ level: "error", code: "syscall.analysis.runtime-adoption-with-memory-workflow-receipt-blockers" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.routeAcceptanceReceipt?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-route-acceptance")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-route-acceptance-gate.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.dispatchReleaseLedger?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-dispatch-release-ledger")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-dispatch-ledger-gate.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.dispatchReleaseLedger?.present
    && !analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "memory-dispatch-release-ledger")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-dispatch-ledger-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.claimRuntimeAdoptionReceipt?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-claim-runtime-adoption")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-claim-runtime-gate.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.claimRuntimeAdoptionReceipt?.present
    && !analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "memory-claim-runtime-adoption")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-claim-runtime-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.runtimeDispatchReleaseReceipt?.present
    && !analysis?.clientRuntimeAdoptionState?.persistedState?.memoryRuntimeDispatchReleaseReceiptId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-runtime-dispatch-release-state.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.runtimeDispatchReleaseReceipt?.blockedBy?.length
    && analysis?.clientRuntimeAdoptionState?.acceptedForRuntime) {
    diagnostics.push({ level: "error", code: "syscall.analysis.runtime-adoption-with-memory-runtime-dispatch-blockers" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.runtimeDispatchReleaseReceipt?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-runtime-dispatch-release" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.runtimeDispatchReleaseReceipt?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-runtime-dispatch-release" });
  }
  if (analysis?.operationalReportingState?.memoryDispatchReleaseLedger?.ledgerId
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.dispatchReleaseLedger?.ledgerId !== analysis.operationalReportingState.memoryDispatchReleaseLedger.ledgerId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-dispatch-ledger-id.inconsistent" });
  }
  if (analysis?.operationalReportingState?.memoryClaimRuntimeAdoptionReceipt?.receiptId
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.claimRuntimeAdoptionReceipt?.receiptId !== analysis.operationalReportingState.memoryClaimRuntimeAdoptionReceipt.receiptId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-claim-runtime-id.inconsistent" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.dispatchReleaseLedger?.blockedBy?.length
    && analysis?.clientRuntimeAdoptionState?.acceptedForRuntime) {
    diagnostics.push({ level: "error", code: "syscall.analysis.runtime-adoption-with-memory-dispatch-ledger-blockers" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.claimRuntimeAdoptionReceipt?.blockedBy?.length
    && analysis?.clientRuntimeAdoptionState?.acceptedForRuntime) {
    diagnostics.push({ level: "error", code: "syscall.analysis.runtime-adoption-with-memory-claim-runtime-blockers" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.operationalReportingState?.memoryDispatchReleaseLedger?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-dispatch-ledger" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.operationalReportingState?.memoryDispatchReleaseLedger?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-dispatch-ledger" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.operationalReportingState?.memoryClaimRuntimeAdoptionReceipt?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-claim-runtime" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.operationalReportingState?.memoryClaimRuntimeAdoptionReceipt?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-claim-runtime" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.routeAcceptanceReceipt?.blockedBy?.length
    && analysis?.clientRuntimeAdoptionState?.acceptedForRuntime) {
    diagnostics.push({ level: "error", code: "syscall.analysis.runtime-adoption-with-memory-route-receipt-blockers" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.routeAcceptanceReceipt?.acceptedForSyscallDispatch === false) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-route-receipt" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.routeAcceptanceReceipt?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-route-receipt" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.adapterResumeReceipt?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-adapter-resume")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-adapter-resume-gate.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.adapterResumeReceipt?.present
    && !analysis?.adapterRecoveryHandoffPackage?.statusRows?.some((row) => row.key === "memory-adapter-resume")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-adapter-resume-row.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.adapterResumeReceipt?.receiptId
    && analysis?.adapterRecoveryHandoffPackage?.statusRows?.find((row) => row.key === "memory-adapter-resume")?.receiptId
      !== analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.adapterResumeReceipt.receiptId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-adapter-resume-id.inconsistent" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.adapterResumeReceipt?.blockedBy?.length
    && analysis?.clientRuntimeAdoptionState?.acceptedForRuntime) {
    diagnostics.push({ level: "error", code: "syscall.analysis.runtime-adoption-with-memory-adapter-resume-blockers" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.adapterResumeReceipt?.acceptedForSyscallDispatch === false) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-adapter-resume" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.adapterResumeReceipt?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-adapter-resume" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.adapterResumeReceipt?.retryable
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.adapterResumeReceipt?.nextDelaySeconds == null) {
    diagnostics.push({ level: "error", code: "syscall.analysis.memory-adapter-resume-retry-without-delay" });
  }
  if (analysis?.operationalReportingState?.memoryOperatorResume?.blockedBy?.length
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-blocked-memory-resume" });
  }
  if (analysis?.operationalReportingState?.memoryOperatorResume?.restartSafe === false
    && analysis?.adapterHandoff?.acceptedForDispatch) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-unsafe-memory-resume" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.operatorResume?.present
    && !analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "memory-operator-resume")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-operator-resume-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.operatorResume?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-operator-resume")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-operator-resume-gate.missing" });
  }
  if (analysis?.operationalReportingState?.memoryOperatorResume?.packetId
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.operatorResume?.packetId !== analysis.operationalReportingState.memoryOperatorResume.packetId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-operator-resume-id.inconsistent" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.syscallDispatchGate?.present
    && !analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "memory-syscall-dispatch-gate")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-syscall-gate-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.syscallDispatchGate?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "memory-syscall-dispatch")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-syscall-gate-provider-gate.missing" });
  }
  if (analysis?.operationalReportingState?.memorySyscallDispatchGate?.gateId
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.syscallDispatchGate?.gateId !== analysis.operationalReportingState.memorySyscallDispatchGate.gateId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-syscall-gate-id.inconsistent" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.operationalReportingState?.memorySyscallDispatchGate?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-syscall-gate" });
  }
  if (analysis?.operationalReportingState?.memorySyscallDispatchGate?.retryable
    && analysis?.operationalReportingState?.memorySyscallDispatchGate?.nextRetrySeconds == null) {
    diagnostics.push({ level: "error", code: "syscall.analysis.memory-syscall-gate-retry-without-delay" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.controlPlane?.present
    && !analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "memory-control-plane")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-control-plane-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.controlPlane?.present
    && !analysis?.operationalReportingState?.commands?.some((command) => command.source === "memory-control-plane")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-control-plane-command.missing" });
  }
  if (analysis?.operationalReportingState?.memoryHealth?.retryable
    && analysis?.operationalReportingState?.memoryHealth?.nextRetrySeconds == null) {
    diagnostics.push({ level: "error", code: "syscall.analysis.memory-health-retry-without-delay" });
  }
  if (analysis?.exportSummary?.status === "ready"
    && analysis?.exportSummary?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.export-ready-with-blockers" });
  }
  if (!analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "memory-health")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-health-history.missing" });
  }
  if (analysis?.operationalReportingState?.memoryHealth?.healthId
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.healthId !== analysis.operationalReportingState.memoryHealth.healthId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.memory-health-id.inconsistent" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.operationalReportingState?.verifierHealth?.status === "blocked") {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-with-blocked-verifier-health" });
  }
  if (analysis?.clientRuntimeAdoptionState?.acceptedForRuntime
    && analysis?.clientRuntimeAdoptionState?.upstreamVerifierPackage?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.runtime-adoption-with-verifier-blockers" });
  }
  if (analysis?.operationalReportingState?.verifierHealth?.retryable
    && analysis?.operationalReportingState?.verifierHealth?.nextRetrySeconds == null) {
    diagnostics.push({ level: "error", code: "syscall.analysis.verifier-health-retry-without-delay" });
  }
  if (analysis?.operationalReportingState?.verifierHealth?.packageId
    && analysis?.clientRuntimeAdoptionState?.upstreamVerifierPackage?.packageId !== analysis.operationalReportingState.verifierHealth.packageId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.verifier-package-id.inconsistent" });
  }
  if (!analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "verifier-handoff")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.verifier-handoff-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamVerifierPackage?.tenantDispatchGuard?.present
    && !analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "verifier-tenant-dispatch-guard")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.verifier-tenant-guard-history.missing" });
  }
  if (analysis?.clientRuntimeAdoptionState?.upstreamVerifierPackage?.tenantDispatchGuard?.present
    && !analysis?.providerGateSummary?.gates?.some((gate) => gate.gate === "verifier-tenant-dispatch")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.verifier-tenant-guard-provider-gate.missing" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.operationalReportingState?.verifierTenantDispatchGuard?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-verifier-tenant-guard" });
  }
  if (analysis?.operationalReportingState?.verifierTenantDispatchGuard?.tenantId
    && analysis.operationalReportingState.verifierTenantDispatchGuard.expectedTenantId
    && analysis.operationalReportingState.verifierTenantDispatchGuard.tenantId
      !== analysis.operationalReportingState.verifierTenantDispatchGuard.expectedTenantId) {
    diagnostics.push({ level: "error", code: "syscall.analysis.verifier-tenant-guard.tenant-mismatch" });
  }
  if (analysis?.operationalReportingState?.verifierTenantDispatchGuard?.workspaceId
    && analysis.operationalReportingState.verifierTenantDispatchGuard.expectedWorkspaceId
    && analysis.operationalReportingState.verifierTenantDispatchGuard.workspaceId
      !== analysis.operationalReportingState.verifierTenantDispatchGuard.expectedWorkspaceId) {
    diagnostics.push({ level: "error", code: "syscall.analysis.verifier-tenant-guard.workspace-mismatch" });
  }
  if (!analysis?.adapterRecoveryHandoffPackage?.packageId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.recovery-handoff-package.missing" });
  }
  if (analysis?.adapterRecoveryHandoffPackage?.acceptedForAdapter
    && analysis?.adapterRecoveryHandoffPackage?.restartSafe !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.recovery-handoff-accepted-without-restart-safe" });
  }
  if (analysis?.adapterRecoveryHandoffPackage?.status === "adapter-ready"
    && analysis?.adapterRecoveryHandoffPackage?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.recovery-handoff-ready-with-blockers" });
  }
  if (!analysis?.adapterRecoveryHandoffPackage?.commands?.some((command) => command.command === "persist-syscall-recovery-handoff")) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.recovery-handoff-command.missing" });
  }
  if (!analysis?.recovery?.idempotentCommands?.some((command) => command.command === "publish-syscall-operational-report")
    && analysis?.operationalReportingState?.status !== "blocked") {
    diagnostics.push({ level: "warning", code: "syscall.analysis.operational-report-command.missing" });
  }
  if (!analysis?.controlPlaneState?.controlPlaneId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.control-plane.missing" });
  }
  if (analysis?.controlPlaneState?.status === "handoff-ready"
    && !analysis.controlPlaneState.enabledCommands?.includes("handoff-syscall-control-plane")) {
    diagnostics.push({ level: "error", code: "syscall.analysis.control-plane.ready-without-handoff-command" });
  }
  if (analysis?.controlPlaneState?.status === "blocked"
    && !analysis.controlPlaneState.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.control-plane.blocked-without-reason" });
  }
  if (analysis?.controlPlaneState?.persistedState?.restartSafe
    && analysis?.dispatchRecoveryJournal?.restartSafe !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.control-plane.restart-safe-without-journal" });
  }
  if (!Array.isArray(analysis?.exportSummary?.rows) || analysis.exportSummary.rows.length !== analysis.syscalls?.length) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.export-rows.missing-or-mismatched" });
  }
  if (analysis?.exportSummary?.rows?.some((row) => row.state === "selected" && !row.selected)) {
    diagnostics.push({ level: "error", code: "syscall.analysis.export-row-selected-state-inconsistent" });
  }
  if (analysis?.timelineState?.phases?.some((phase) => phase.phase === "export-rows")
    && analysis.timelineState.phases.find((phase) => phase.phase === "export-rows")?.counters?.rows !== analysis.exportSummary?.rows?.length) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.export-row-timeline-count.inconsistent" });
  }
  if (analysis?.timelineState?.latestReadyExport
    && !analysis.exportSummary?.rows?.some((row) => row.syscall === analysis.timelineState.latestReadyExport.syscall)) {
    diagnostics.push({ level: "error", code: "syscall.analysis.latest-ready-export-missing-row" });
  }
  if (!analysis?.externalHandoffEnvelope?.envelopeId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.external-handoff-envelope.missing" });
  }
  if (analysis?.externalHandoffEnvelope?.acceptedForAdapter
    && analysis?.externalHandoffEnvelope?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.external-handoff-ready-with-blockers" });
  }
  if (analysis?.externalHandoffEnvelope?.acceptedForAdapter
    && analysis?.externalHandoffEnvelope?.restartSafe !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.external-handoff-ready-without-restart-safe" });
  }
  if (analysis?.externalHandoffEnvelope?.releaseReady
    && analysis?.adapterHandoff?.acceptedForDispatch !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.external-handoff-without-adapter-acceptance" });
  }
  if (!analysis?.analyticsHandoffBundle?.bundleId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.analytics-handoff-bundle.missing" });
  }
  if (analysis?.analyticsHandoffBundle?.acceptedForExport
    && analysis?.analyticsHandoffBundle?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.analytics-export-ready-with-blockers" });
  }
  if (analysis?.analyticsHandoffBundle?.acceptedForExport
    && analysis?.externalHandoffEnvelope?.acceptedForAdapter !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.analytics-export-without-external-handoff" });
  }
  if (analysis?.analyticsHandoffBundle?.rowLedger?.length !== analysis?.exportSummary?.rows?.length) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.analytics-row-ledger.mismatched" });
  }
  if (!analysis?.analyticsHandoffBundle?.commands?.some((command) => (
    command.command === "persist-syscall-analytics-handoff"
  ))) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.analytics-handoff-persist-command.missing" });
  }
  if (!analysis?.upstreamReleaseGate?.gateId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.upstream-release-gate.missing" });
  }
  if (analysis?.upstreamReleaseGate?.releaseReady && analysis?.upstreamReleaseGate?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.upstream-release-ready-with-blockers" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.upstreamReleaseGate?.acceptedForDispatch !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-upstream-release" });
  }
  if (analysis?.adapterHandoff?.acceptedForDispatch
    && analysis?.clientRuntimeAdoptionState?.upstreamMemoryPackage?.syscallBoundaryReceipt?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-accepted-without-memory-syscall-boundary" });
  }
  if (analysis?.upstreamReleaseGate?.gateRows?.some((row) => (
    row.gate === "memory-syscall-boundary" && row.accepted === true && row.restartSafe === false
  ))) {
    diagnostics.push({ level: "error", code: "syscall.analysis.memory-syscall-boundary-accepted-unsafe" });
  }
  if (analysis?.upstreamReleaseGate?.restartSafe
    && analysis?.upstreamReleaseGate?.gateRows?.some((row) => row.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "syscall.analysis.upstream-release-safe-with-unsafe-row" });
  }
  if (!analysis?.upstreamReleaseGate?.commands?.some((command) => (
    command.command === "persist-syscall-upstream-release-gate"
  ))) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.upstream-release-persist-command.missing" });
  }
  if (!analysis?.dispatchObservabilityExport?.exportId) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.dispatch-observability.missing" });
  }
  if (analysis?.dispatchObservabilityExport?.status === "export-ready"
    && analysis?.externalHandoffEnvelope?.acceptedForAdapter !== true) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-observability-ready-without-handoff" });
  }
  if (analysis?.dispatchObservabilityExport?.status === "blocked"
    && !analysis?.dispatchObservabilityExport?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-observability-blocked-without-reason" });
  }
  if (analysis?.dispatchObservabilityExport?.retryPlan?.retryable
    && analysis?.dispatchObservabilityExport?.retryPlan?.nextDelaySeconds == null) {
    diagnostics.push({ level: "error", code: "syscall.analysis.dispatch-observability-retry-without-delay" });
  }
  if (analysis?.dispatchObservabilityExport?.counters?.syscalls !== analysis?.syscalls?.length) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.dispatch-observability-syscall-count.mismatched" });
  }
  if (!analysis?.dispatchObservabilityExport?.commands?.some((command) => (
    command.command === "persist-syscall-dispatch-observability"
  ))) {
    diagnostics.push({ level: "warning", code: "syscall.analysis.dispatch-observability-persist-command.missing" });
  }
  for (const diagnostic of analysis?.lifecycleControls?.diagnostics || []) {
    diagnostics.push(diagnostic);
  }
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    diagnostics,
  };
}

export function selfCheckMailchimpSyscallAnalysis() {
  const analysis = analyzeMailchimpSyscalls();
  const validation = validateMailchimpSyscallAnalysis(analysis);
  return {
    ok: validation.ok && analysis.syscalls.length > 0,
    status: analysis.status,
    syscallCount: analysis.syscalls.length,
    dispatchable: analysis.syscallContract.dispatchable,
    analytics: analysis.analytics,
    operationalReport: analysis.operationalReportingState,
    exportSummary: analysis.exportSummary,
    upstreamMemoryControlPlane: analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.controlPlane,
    upstreamMemoryOperatorResume: analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.operatorResume,
    upstreamMemorySyscallDispatchGate: analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.syscallDispatchGate,
    upstreamMemoryProviderService: analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.providerService,
    upstreamMemoryProviderAssertionDigest: analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.providerAssertionDigest,
    upstreamMemoryAudienceSyncWatermark: analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.audienceSyncWatermark,
    upstreamMemoryAudienceContinuityReceipt: analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.audienceContinuityReceipt,
    upstreamMemoryReleaseRiskBudget: analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.releaseRiskBudget,
    upstreamMemoryDispatchReleaseLedger: analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.dispatchReleaseLedger,
    upstreamMemoryClaimRuntimeAdoptionReceipt: analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.claimRuntimeAdoptionReceipt,
    upstreamMemoryAdapterResumeReceipt: analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.adapterResumeReceipt,
    upstreamMemorySyscallBoundaryReceipt: analysis.clientRuntimeAdoptionState.upstreamMemoryPackage.syscallBoundaryReceipt,
    controlPlaneState: analysis.controlPlaneState,
    externalHandoffEnvelope: analysis.externalHandoffEnvelope,
    analyticsHandoffBundle: analysis.analyticsHandoffBundle,
    upstreamReleaseGate: analysis.upstreamReleaseGate,
    dispatchObservabilityExport: analysis.dispatchObservabilityExport,
    diagnostics: validation.diagnostics,
  };
}
