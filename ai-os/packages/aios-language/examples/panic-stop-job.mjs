import {
  createAuditExportSnapshot,
  createEvidence,
  createStatusEvent,
  createTruthBoundaryReport,
} from "../stdlib/audit.mjs";
import {
  buildProviderServiceContract,
  compilePackageSource,
} from "../stdlib/packages.mjs";
import {
  buildRecoveryStatusHandoff,
  buildRollbackContract,
  summarizeRollbackContract,
} from "../stdlib/rollback.mjs";

export const panicStopJobSource = `# deterministic Mailchimp panic stop with recovery handoff
use mailchimp:campaign.read
use memory:campaign.local
use verifier:evidence.record
use rollback:snapshot.create
use status:timeline.write
recover rollback=snapshot retry=1
step capture-runtime-state input=campaignId output=runtimeState verify.intent=panic-stop
step stop-mutating-commands input=runtimeState output=stopReceipt verify.boundary=no-external-write
step snapshot-local-memory input=stopReceipt output=snapshot verify.intent=rollback-safe
step emit-panic-status input=snapshot output=statusEvent verify.status=adapter-handoff
`;

export function buildPanicStopProgram(options = {}) {
  return compilePackageSource(panicStopJobSource, {
    name: options.name ?? "mailchimp-panic-stop-job",
    version: options.version ?? "0.1.0",
    description: "Compile a Mailchimp panic-stop job that freezes runtime mutation and hands recovery state to the adapter.",
    capabilities: options.capabilities ?? [],
    exports: {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      recoveryStatus: "./examples/panic-stop-job.mjs#buildPanicStopRecoveryStatus",
      panicStop: "./examples/panic-stop-job.mjs#buildPanicStopContract",
    },
  }, {
    name: "mailchimp-panic-stop-job",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: options.dryRun ?? true,
      requireApproval: options.requireApproval ?? true,
      approvalTicket: options.approvalTicket,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 8,
    },
  });
}

export function buildPanicStopAudit(program = buildPanicStopProgram(), options = {}) {
  const missingSubjects = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missingSubjects.has(subject))
    .map((subject) => createEvidence(
      subject.includes("verify.status") ? "operator-attestation" : "runtime-local-receipt",
      subject,
      { example: "panic-stop-job", panicStop: true },
    ));

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "rolled_back",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "panic stop requested" }),
      createStatusEvent("running", { at: "logical:1", message: "runtime mutation freeze evaluated" }),
      createStatusEvent("verifying", { at: "logical:2", message: "local snapshot evidence checked" }),
      createStatusEvent(options.status ?? "rolled_back", {
        at: "logical:3",
        message: "panic stop recovery status shaped",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildPanicStopContract(
  program = buildPanicStopProgram(),
  audit = buildPanicStopAudit(program),
  options = {},
) {
  const exportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:4",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const providerContract = buildProviderServiceContract(program, {
    checkpoint: exportSnapshot.exportId,
    externalApproval: options.approvalTicket,
    providerResource: "campaign-runtime",
    supportedCapabilities: options.supportedCapabilities,
  });
  const rollbackContract = buildRollbackContract(withRollbackVerifierHints(program), audit, {
    adapterStatus: options.adapterHealth,
    adapterCheckedAt: options.adapterCheckedAt ?? "logical:5",
    commandStatuses: options.commandStatuses,
    completedSteps: options.completedSteps ?? 2,
    failedStep: options.failedStep,
    retryAfterSeconds: options.adapterRetryAfterSeconds,
  });
  const recoveryStatus = buildRecoveryStatusHandoff(rollbackContract, {
    accepted: options.accepted ?? false,
  });
  const providerSync = buildPanicStopProviderSync(program, audit, providerContract, recoveryStatus, options);
  const previewAcceptance = buildPanicStopPreviewAcceptance(
    program,
    audit,
    exportSnapshot,
    providerSync,
    recoveryStatus,
    options,
  );
  const continuity = buildPanicStopContinuityPacket(
    program,
    audit,
    providerSync,
    previewAcceptance,
    recoveryStatus,
    options,
  );
  const persistedState = buildPanicStopPersistedState(
    program,
    audit,
    providerSync,
    previewAcceptance,
    continuity,
    recoveryStatus,
    options,
  );
  const workspaceBoundary = buildPanicStopWorkspaceBoundary(
    program,
    audit,
    providerSync,
    previewAcceptance,
    continuity,
    persistedState,
    recoveryStatus,
    options,
  );
  const providerServiceManifest = buildPanicStopProviderServiceManifest(
    program,
    audit,
    providerContract,
    providerSync,
    previewAcceptance,
    continuity,
    persistedState,
    workspaceBoundary,
    recoveryStatus,
    options,
  );
  const routeDecisionPacket = buildPanicStopRouteDecisionPacket(
    program,
    audit,
    providerSync,
    previewAcceptance,
    continuity,
    persistedState,
    workspaceBoundary,
    providerServiceManifest,
    recoveryStatus,
    options,
  );
  const blockers = uniqueSorted([
    ...audit.evidence.missing.map((subject) => `missing panic-stop evidence: ${subject}`),
    ...audit.boundary.externalWritesObserved.map((write) => `external write during panic stop: ${write.subject ?? write}`),
    ...providerContract.handoffState.blockedReasons,
    ...recoveryStatus.blockedReasons,
    ...providerSync.validation.blockers,
    ...previewAcceptance.validation.blockers,
    ...continuity.validation.blockers,
    ...persistedState.validation.blockers,
    ...workspaceBoundary.validation.blockers,
    ...providerServiceManifest.validation.blockers,
    ...routeDecisionPacket.validation.blockers,
  ]);
  const ready = blockers.length === 0
    && exportSnapshot.truthBoundary.readyForExport
    && recoveryStatus.ready
    && providerSync.validation.ready
    && previewAcceptance.validation.ready
    && persistedState.validation.ready
    && workspaceBoundary.validation.ready
    && providerServiceManifest.validation.ready;

  return {
    kind: "mailchimp.panic-stop.contract",
    apiVersion: "aios.example/v1",
    jobId: program.job.id,
    status: audit.status,
    panicStop: {
      mutationFrozen: audit.boundary.externalWritesObserved.length === 0,
      rollbackPolicy: program.job.recovery.rollback,
      retryAttempts: program.job.recovery.retry.attempts,
      memoryWritePolicy: program.job.memory.writePolicy,
    },
    persistedState,
    workspaceBoundary,
    providerServiceManifest,
    routeDecisionPacket,
    previewAcceptance,
    continuity,
    providerContract,
    providerSync,
    rollback: {
      contract: rollbackContract,
      summary: summarizeRollbackContract(rollbackContract),
      statusHandoff: recoveryStatus,
    },
    exportSnapshot,
    readiness: {
      ready,
      nextAction: ready ? "handoff-panic-stop-recovery" : "review-panic-stop-blockers",
      blockers,
    },
    runtimeHandoff: {
      ready,
      command: ready ? "panic.stop.resume" : "panic.stop.review",
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
      restartToken: recoveryStatus.restartToken,
      externalState: providerSync.externalHandoffState,
      previewToken: previewAcceptance.preview.previewToken,
      continuityKey: continuity.continuityKey,
      persistedStateKey: persistedState.stateKey,
      workspaceBoundaryKey: workspaceBoundary.boundaryKey,
      providerServiceManifestKey: providerServiceManifest.manifestKey,
      providerServiceState: providerServiceManifest.serviceState.status,
      providerServiceCommand: providerServiceManifest.commands.sync.command,
      routeDecisionPacketKey: routeDecisionPacket.packetKey,
      routePrimaryCommand: routeDecisionPacket.commands.primary.command,
      routePreviewStatus: routeDecisionPacket.preview.status,
      statusEpoch: persistedState.statusLedger.epoch,
      idempotencyKey: persistedState.commands.resume.idempotencyKey,
      clientStatus: continuity.clientStatus,
      auditHandoff: workspaceBoundary.auditHandoff,
      nextSteps: previewAcceptance.nextSteps,
    },
  };
}

export function buildPanicStopRecoveryStatus(options = {}) {
  const program = options.program ?? buildPanicStopProgram(options);
  const audit = options.audit ?? buildPanicStopAudit(program, options);
  const contract = buildPanicStopContract(program, audit, options);

  return {
    kind: "mailchimp.panic-stop.recovery-status",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready: contract.readiness.ready,
    statusEvent: contract.rollback.statusHandoff.statusEvent,
    runtimeCommand: contract.runtimeHandoff.command,
    adapter: contract.rollback.statusHandoff.adapter,
    truthBoundary: contract.rollback.statusHandoff.truthBoundary,
    providerSync: contract.providerSync,
    persistedState: contract.persistedState,
    workspaceBoundary: contract.workspaceBoundary,
    providerServiceManifest: contract.providerServiceManifest,
    routeDecisionPacket: contract.routeDecisionPacket,
    previewAcceptance: contract.previewAcceptance,
    continuity: contract.continuity,
    blockedReasons: contract.readiness.blockers,
  };
}

export function describePanicStopJob(options = {}) {
  const program = buildPanicStopProgram(options);
  const audit = buildPanicStopAudit(program, options);
  const contract = buildPanicStopContract(program, audit, options);

  return {
    jobId: program.job.id,
    package: program.manifest.name,
    status: audit.status,
    previewAcceptance: contract.previewAcceptance,
    persistedState: contract.persistedState,
    readiness: contract.readiness,
    runtimeHandoff: contract.runtimeHandoff,
    providerSync: contract.providerSync,
    continuity: contract.continuity,
    workspaceBoundary: contract.workspaceBoundary,
    providerServiceManifest: contract.providerServiceManifest,
    routeDecisionPacket: contract.routeDecisionPacket,
    recoveryStatus: buildPanicStopRecoveryStatus({ ...options, program, audit }),
  };
}

export function selfCheckPanicStopContract(options = {}) {
  const summary = describePanicStopJob(options);
  return {
    ok: (summary.readiness.ready || summary.recoveryStatus.blockedReasons.length > 0)
      && summary.previewAcceptance.preview.actions.length >= 2
      && (summary.continuity.validation.replaySafe === true
        || summary.continuity.validation.blockers.includes("panic-stop continuity requires a restart token"))
      && summary.workspaceBoundary.permissions.externalWritesAllowed === false
      && summary.workspaceBoundary.validation.workspaceIsolated === true
      && summary.providerServiceManifest.commands.freeze.idempotent === true
      && summary.providerServiceManifest.capabilityNegotiation.deniedWrites.includes("mailchimp:campaign.write")
      && summary.routeDecisionPacket.commands.keepFrozen.enabled === true
      && summary.routeDecisionPacket.validation.externalWritesAllowed === false
      && (summary.persistedState.validation.restartSafe === true
        || summary.persistedState.validation.blockers.includes("panic-stop state is restart-safe only after operator acceptance")
        || summary.persistedState.validation.blockers.includes("panic-stop state requires restart token")),
    jobId: summary.jobId,
    checked: ["compile", "audit", "rollback", "adapter-handoff", "provider-sync", "preview-acceptance", "continuity", "persisted-state", "workspace-boundary", "provider-service-manifest", "route-decision-packet"],
    blockers: summary.recoveryStatus.blockedReasons,
  };
}

function buildPanicStopProviderSync(program, audit, providerContract, recoveryStatus, options) {
  const requestedCapabilities = uniqueSorted([
    "mailchimp:campaign.read",
    "memory:campaign.local",
    "status:timeline.write",
    ...(options.requestedProviderCapabilities ?? []),
  ]);
  const negotiatedCapabilities = providerContract.negotiation?.supportedCapabilities ?? [];
  const supportedCapabilities = new Set(
    options.supportedCapabilities === undefined && negotiatedCapabilities.length === 0
      ? requestedCapabilities
      : negotiatedCapabilities,
  );
  const deniedCapabilities = requestedCapabilities
    .filter((capability) => !supportedCapabilities.has(capability));
  const syncCursor = options.providerSyncCursor ?? `${program.job.id}:panic-stop:logical:5`;
  const runtimeFence = {
    scope: options.providerResource ?? "campaign-runtime",
    cursor: syncCursor,
    commandFence: `panic-stop:${program.job.id}:${syncCursor}`,
    writesAllowed: false,
    readsAllowed: true,
  };
  const statusHandoff = {
    adapterState: recoveryStatus.adapter.status,
    lastStatusEvent: recoveryStatus.statusEvent,
    retryAfterSeconds: recoveryStatus.adapter.retryAfterSeconds,
    restartToken: recoveryStatus.restartToken,
    handoffToken: providerContract.handoffState.handoffToken,
  };
  const validationBlockers = uniqueSorted([
    ...(deniedCapabilities.length > 0
      ? deniedCapabilities.map((capability) => `provider capability not negotiated: ${capability}`)
      : []),
    ...(audit.status === "failed" ? ["panic-stop audit failed before provider sync"] : []),
    ...(recoveryStatus.statusEvent === "blocked" ? ["rollback recovery handoff is blocked"] : []),
  ]);

  return {
    kind: "mailchimp.panic-stop.provider-sync",
    apiVersion: "aios.integration/v1",
    provider: "mailchimp",
    sync: {
      cursor: syncCursor,
      mode: "local-freeze-handoff",
      metadata: {
        jobId: program.job.id,
        packageName: program.manifest.name,
        memoryNamespace: program.job.memory.namespace,
        evidenceComplete: audit.evidence.missing.length === 0,
      },
    },
    negotiation: {
      requestedCapabilities,
      supportedCapabilities: [...supportedCapabilities].sort(),
      deniedCapabilities,
      fallback: deniedCapabilities.length === 0 ? null : "read-only-status-handoff",
    },
    runtimeFence,
    externalHandoffState: {
      provider: "mailchimp",
      cursor: syncCursor,
      status: validationBlockers.length === 0 ? "ready_for_adapter" : "blocked",
      fenceKey: runtimeFence.commandFence,
      statusHandoff,
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
    },
  };
}

function buildPanicStopPreviewAcceptance(program, audit, exportSnapshot, providerSync, recoveryStatus, options) {
  const accepted = options.accepted === true;
  const operator = options.operator ?? "local-operator";
  const previewToken = options.previewToken
    ?? `${program.job.id}:panic-stop-preview:${exportSnapshot.exportId}`;
  const freezeReceipts = program.job.plan
    .filter((step) => step.op.includes("stop-") || step.op.includes("snapshot-"))
    .map((step) => ({
      stepId: step.id,
      command: step.op,
      output: step.output,
      visibleState: audit.evidence.missing.includes(`step:${step.op}`)
        ? "waiting_for_evidence"
        : "verified",
    }));
  const validationBlockers = uniqueSorted([
    ...(audit.evidence.missing.length > 0
      ? ["panic-stop preview cannot be accepted until required evidence is complete"]
      : []),
    ...(providerSync.validation.ready ? [] : ["provider sync must be ready before preview acceptance"]),
    ...(recoveryStatus.ready ? [] : ["rollback recovery status must be ready before preview acceptance"]),
    ...(accepted ? [] : ["operator acceptance is required for panic-stop recovery handoff"]),
  ]);
  const nextSteps = validationBlockers.length === 0
    ? [{
      id: "handoff-panic-stop-recovery",
      label: "Resume adapter with panic-stop recovery state",
      command: "panic.stop.resume",
      enabled: true,
      explains: "The runtime is frozen, rollback evidence is complete, and the adapter can resume from the restart token.",
    }]
    : [
      {
        id: "review-runtime-freeze",
        label: "Review runtime freeze preview",
        command: "panic.stop.review-freeze",
        enabled: true,
        explains: "Shows the local freeze fence, snapshot receipt, and current adapter handoff state.",
      },
      {
        id: "accept-panic-stop",
        label: "Accept panic-stop recovery",
        command: "panic.stop.accept",
        enabled: audit.evidence.missing.length === 0 && providerSync.validation.ready,
        explains: "Records the operator decision required before adapter recovery can continue.",
      },
    ];

  return {
    kind: "mailchimp.panic-stop.preview-acceptance",
    apiVersion: "aios.client/v1",
    preview: {
      previewToken,
      title: "Panic stop recovery",
      summary: providerSync.validation.ready
        ? "Runtime mutation is fenced locally and recovery state is ready for operator review."
        : "Runtime mutation is fenced locally, but provider recovery handoff still has blockers.",
      actions: [
        {
          id: "accept",
          command: "panic.stop.accept",
          enabled: audit.evidence.missing.length === 0 && providerSync.validation.ready,
        },
        {
          id: "keep-frozen",
          command: "panic.stop.keep-frozen",
          enabled: true,
        },
      ],
      freezeReceipts,
      handoffState: providerSync.externalHandoffState,
    },
    acceptance: {
      accepted,
      acceptedBy: accepted ? operator : null,
      acceptedAt: accepted ? (options.acceptedAt ?? "logical:6") : null,
      requiresOperatorDecision: !accepted,
      decisionKey: `${previewToken}:${operator}`,
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      summary: validationBlockers.length === 0
        ? "Panic-stop preview accepted and ready for adapter recovery handoff."
        : "Panic-stop recovery requires preview review, acceptance, or evidence resolution.",
    },
    nextSteps,
  };
}

function buildPanicStopContinuityPacket(program, audit, providerSync, previewAcceptance, recoveryStatus, options) {
  const continuityKey = options.continuityKey
    ?? `${program.job.memory.namespace}:panic-stop:continuity:${previewAcceptance.preview.previewToken}`;
  const frozenCommands = providerSync.runtimeFence.writesAllowed
    ? []
    : program.job.plan
      .filter((step) => step.op.includes("stop-") || step.op.includes("snapshot-") || step.output === "statusEvent")
      .map((step) => step.op);
  const allowedClientCommands = previewAcceptance.nextSteps
    .filter((step) => step.enabled)
    .map((step) => step.command);
  const clientStatus = previewAcceptance.validation.ready
    ? "ready_to_resume"
    : providerSync.validation.ready
      ? "awaiting_operator_acceptance"
      : "handoff_blocked";
  const replayInput = {
    restartToken: recoveryStatus.restartToken,
    providerCursor: providerSync.sync.cursor,
    previewToken: previewAcceptance.preview.previewToken,
    fenceKey: providerSync.externalHandoffState.fenceKey,
  };
  const validationBlockers = uniqueSorted([
    ...(providerSync.runtimeFence.writesAllowed ? ["panic-stop continuity requires a no-write runtime fence"] : []),
    ...(providerSync.externalHandoffState.status === "ready_for_adapter"
      ? []
      : ["panic-stop continuity cannot replay until provider handoff is ready"]),
    ...(recoveryStatus.restartToken ? [] : ["panic-stop continuity requires a restart token"]),
    ...(previewAcceptance.preview.freezeReceipts.length > 0 ? [] : ["panic-stop continuity requires freeze receipts"]),
    ...(allowedClientCommands.length > 0 ? [] : ["panic-stop continuity exposes no enabled client commands"]),
  ]);

  return {
    kind: "mailchimp.panic-stop.continuity-packet",
    apiVersion: "aios.client/v1",
    continuityKey,
    clientStatus,
    replayInput,
    frozenCommands,
    visibleWorkflow: {
      title: previewAcceptance.preview.title,
      phase: clientStatus,
      primaryCommand: previewAcceptance.validation.ready
        ? "panic.stop.resume"
        : "panic.stop.review-freeze",
      allowedCommands: allowedClientCommands,
      blockedCommandPolicy: {
        externalWritesAllowed: false,
        keepFrozenCommand: "panic.stop.keep-frozen",
      },
    },
    recoveryEnvelope: {
      restartToken: recoveryStatus.restartToken,
      statusEvent: recoveryStatus.statusEvent,
      adapterState: recoveryStatus.adapter.status,
      providerCursor: providerSync.sync.cursor,
      handoffToken: providerSync.externalHandoffState.statusHandoff.handoffToken,
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      replaySafe: validationBlockers.length === 0
        && providerSync.runtimeFence.writesAllowed === false
        && Boolean(recoveryStatus.restartToken),
    },
  };
}

function buildPanicStopPersistedState(
  program,
  audit,
  providerSync,
  previewAcceptance,
  continuity,
  recoveryStatus,
  options,
) {
  const priorState = options.priorState ?? {};
  const version = Number.isInteger(priorState.version) ? priorState.version + 1 : 1;
  const stateKey = options.stateKey
    ?? `${program.job.memory.namespace}:panic-stop:state:${continuity.continuityKey}`;
  const freezeReceipts = previewAcceptance.preview.freezeReceipts.map((receipt) => ({
    stepId: receipt.stepId,
    command: receipt.command,
    output: receipt.output,
    persistedAt: receipt.visibleState === "verified" ? (options.persistedAt ?? "logical:7") : null,
  }));
  const statusEpoch = Number.isInteger(priorState.statusEpoch) ? priorState.statusEpoch + 1 : version;
  const accepted = previewAcceptance.acceptance.accepted === true;
  const resumeReady = continuity.validation.replaySafe && accepted;
  const validationBlockers = uniqueSorted([
    ...(providerSync.runtimeFence.writesAllowed ? ["panic-stop state cannot persist with write-enabled runtime fence"] : []),
    ...(freezeReceipts.every((receipt) => receipt.persistedAt)
      ? []
      : ["panic-stop state requires persisted freeze and snapshot receipts"]),
    ...(recoveryStatus.restartToken ? [] : ["panic-stop state requires restart token"]),
    ...(continuity.recoveryEnvelope.providerCursor ? [] : ["panic-stop state requires provider cursor"]),
    ...(accepted ? [] : ["panic-stop state is restart-safe only after operator acceptance"]),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["panic-stop state cannot resume after observed external writes"]),
  ]);
  const commandBase = `${stateKey}:v${version}`;

  return {
    kind: "mailchimp.panic-stop.persisted-state",
    apiVersion: "aios.runtime/v1",
    stateKey,
    version,
    shape: {
      jobId: program.job.id,
      memoryNamespace: program.job.memory.namespace,
      status: validationBlockers.length === 0 ? "restart_safe_frozen" : "frozen_review_required",
      freezeReceipts,
      runtimeFence: {
        fenceKey: providerSync.runtimeFence.commandFence,
        cursor: providerSync.runtimeFence.cursor,
        writesAllowed: false,
        readsAllowed: providerSync.runtimeFence.readsAllowed,
      },
      recoveryEnvelope: continuity.recoveryEnvelope,
    },
    statusLedger: {
      epoch: statusEpoch,
      previousEpoch: priorState.statusEpoch ?? null,
      lastStatusEvent: recoveryStatus.statusEvent,
      clientStatus: continuity.clientStatus,
      adapterState: recoveryStatus.adapter.status,
      restartToken: recoveryStatus.restartToken,
      stableAcrossRestart: Boolean(recoveryStatus.restartToken)
        && continuity.replayInput.restartToken === recoveryStatus.restartToken,
    },
    recoveryPaths: {
      resume: {
        from: continuity.replayInput,
        command: resumeReady ? "panic.stop.resume" : "panic.stop.review",
        requiresAcceptance: !accepted,
      },
      keepFrozen: {
        from: stateKey,
        command: "panic.stop.keep-frozen",
        reason: validationBlockers[0] ?? "operator_hold",
      },
    },
    commands: {
      resume: {
        idempotent: true,
        idempotencyKey: `${commandBase}:resume:${recoveryStatus.restartToken}`,
        command: resumeReady ? "panic.stop.resume" : "panic.stop.review",
        enabled: resumeReady,
      },
      keepFrozen: {
        idempotent: true,
        idempotencyKey: `${commandBase}:keep-frozen:${providerSync.runtimeFence.commandFence}`,
        command: "panic.stop.keep-frozen",
        enabled: true,
      },
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      restartSafe: validationBlockers.length === 0
        && freezeReceipts.every((receipt) => receipt.persistedAt)
        && continuity.validation.replaySafe,
    },
  };
}

function buildPanicStopWorkspaceBoundary(
  program,
  audit,
  providerSync,
  previewAcceptance,
  continuity,
  persistedState,
  recoveryStatus,
  options,
) {
  const tenantId = options.tenantId ?? "tenant:local-mailchimp";
  const workspaceId = options.workspaceId ?? "workspace:mailchimp-local";
  const role = options.role ?? "operator";
  const allowedRoles = new Set(options.allowedRoles ?? ["operator", "runtime", "auditor"]);
  const restrictedTenants = new Set(options.restrictedTenants ?? []);
  const workspaceStatePrefix = `${program.job.memory.namespace}:panic-stop:`;
  const requiredPermissions = uniqueSorted([
    "mailchimp:campaign.read",
    "memory:campaign.local",
    "status:timeline.write",
    "rollback:snapshot.create",
    ...(options.requiredPermissions ?? []),
  ]);
  const grantedPermissions = new Set(options.grantedPermissions ?? requiredPermissions);
  const deniedPermissions = requiredPermissions
    .filter((permission) => !grantedPermissions.has(permission));
  const boundaryKey = options.boundaryKey
    ?? `${workspaceStatePrefix}boundary:${tenantId}:${workspaceId}:${persistedState.version}`;
  const allowedCommands = uniqueSorted([
    ...continuity.visibleWorkflow.allowedCommands,
    persistedState.commands.keepFrozen.command,
    persistedState.commands.resume.command,
  ]);
  const crossWorkspaceState = [
    persistedState.stateKey,
    continuity.continuityKey,
  ].filter((key) => !String(key).includes(program.job.memory.namespace));
  const validationBlockers = uniqueSorted([
    ...(tenantId && workspaceId ? [] : ["panic-stop boundary requires tenant and workspace scope"]),
    ...(restrictedTenants.has(tenantId) ? [`tenant is restricted for panic-stop handoff: ${tenantId}`] : []),
    ...(allowedRoles.has(role) ? [] : [`role cannot hand off panic-stop recovery: ${role}`]),
    ...deniedPermissions.map((permission) => `permission not granted for panic-stop boundary: ${permission}`),
    ...(providerSync.runtimeFence.writesAllowed ? ["panic-stop boundary requires provider writes to remain fenced"] : []),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["panic-stop boundary cannot resume after observed external writes"]),
    ...(recoveryStatus.restartToken ? [] : ["panic-stop boundary requires restart token"]),
    ...(previewAcceptance.acceptance.accepted ? [] : ["panic-stop boundary requires accepted operator decision"]),
    ...(persistedState.validation.restartSafe ? [] : ["panic-stop boundary requires restart-safe persisted state"]),
    ...(crossWorkspaceState.length === 0
      ? []
      : crossWorkspaceState.map((key) => `panic-stop state key escapes memory namespace: ${key}`)),
  ]);
  const auditDecision = validationBlockers.length === 0 ? "allow_panic_stop_handoff" : "review_required";

  return {
    kind: "mailchimp.panic-stop.workspace-boundary",
    apiVersion: "aios.runtime/v1",
    boundaryKey,
    scope: {
      tenantId,
      workspaceId,
      role,
      memoryNamespace: program.job.memory.namespace,
      statePrefix: workspaceStatePrefix,
      providerResource: providerSync.runtimeFence.scope,
    },
    permissions: {
      required: requiredPermissions,
      granted: [...grantedPermissions].sort(),
      denied: deniedPermissions,
      providerReadsOnly: true,
      externalWritesAllowed: false,
      rollbackSnapshotWriteAllowed: true,
      statusTimelineWriteAllowed: grantedPermissions.has("status:timeline.write"),
    },
    commandBoundary: {
      allowedCommands,
      blockedCommands: ["mailchimp.campaign.update", "mailchimp.campaign.send", "mailchimp.list.member.write"],
      fenceKey: providerSync.runtimeFence.commandFence,
      idempotencyKey: persistedState.commands.resume.idempotencyKey,
      fallbackCommand: persistedState.commands.keepFrozen.command,
    },
    isolation: {
      stateKey: persistedState.stateKey,
      continuityKey: continuity.continuityKey,
      allowedStatePrefix: workspaceStatePrefix,
      workspaceIsolated: persistedState.stateKey.startsWith(workspaceStatePrefix)
        && continuity.continuityKey.startsWith(`${workspaceStatePrefix}continuity:`)
        && boundaryKey.startsWith(`${workspaceStatePrefix}boundary:`),
      crossWorkspaceState,
    },
    auditHandoff: {
      handoffId: `${boundaryKey}:audit`,
      command: auditDecision === "allow_panic_stop_handoff"
        ? "panic.stop.audit-handoff"
        : "panic.stop.audit-review",
      statusEvent: recoveryStatus.statusEvent,
      decision: auditDecision,
      acceptedBy: previewAcceptance.acceptance.acceptedBy,
      acceptedAt: previewAcceptance.acceptance.acceptedAt,
      restartToken: recoveryStatus.restartToken,
      statusEpoch: persistedState.statusLedger.epoch,
    },
    safeBoundary: {
      externalProviderMutation: "blocked",
      localSnapshotMutation: "allowed",
      statusTimelineMutation: "allowed",
      clientStatus: continuity.clientStatus,
      resumeCommandEnabled: validationBlockers.length === 0,
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      workspaceIsolated: boundaryKey.startsWith(`${workspaceStatePrefix}boundary:`)
        && Boolean(tenantId)
        && Boolean(workspaceId)
        && crossWorkspaceState.length === 0,
    },
  };
}

function buildPanicStopProviderServiceManifest(
  program,
  audit,
  providerContract,
  providerSync,
  previewAcceptance,
  continuity,
  persistedState,
  workspaceBoundary,
  recoveryStatus,
  options,
) {
  const provider = options.provider ?? "mailchimp";
  const serviceName = options.serviceName ?? "mailchimp-panic-stop-runtime";
  const manifestKey = options.providerManifestKey
    ?? `${program.job.memory.namespace}:panic-stop:provider-service:${providerSync.sync.cursor}`;
  const requiredCapabilities = uniqueSorted([
    "mailchimp:campaign.read",
    "memory:campaign.local",
    "rollback:snapshot.create",
    "status:timeline.write",
    ...(options.requiredProviderCapabilities ?? []),
  ]);
  const optionalWriteCapabilities = uniqueSorted([
    "mailchimp:campaign.write",
    "mailchimp:campaign.send",
    ...(options.optionalWriteCapabilities ?? []),
  ]);
  const grantedCapabilities = new Set(options.grantedProviderCapabilities ?? requiredCapabilities);
  const missingCapabilities = requiredCapabilities
    .filter((capability) => !grantedCapabilities.has(capability));
  const deniedWrites = optionalWriteCapabilities
    .filter((capability) => !grantedCapabilities.has(capability));
  const providerStatusEvent = {
    at: options.providerManifestAt ?? "logical:8",
    status: workspaceBoundary.validation.ready ? "frozen" : "review_required",
    message: workspaceBoundary.validation.ready
      ? "Mailchimp runtime service is fenced and ready for panic-stop handoff."
      : "Mailchimp runtime service remains frozen while panic-stop blockers are reviewed.",
  };
  const receipts = previewAcceptance.preview.freezeReceipts.map((receipt) => ({
    receiptId: `${manifestKey}:receipt:${receipt.stepId}`,
    stepId: receipt.stepId,
    command: receipt.command,
    output: receipt.output,
    providerVisibleState: receipt.visibleState,
    syncCursor: providerSync.sync.cursor,
  }));
  const stateDependencies = [
    persistedState.stateKey,
    continuity.continuityKey,
    workspaceBoundary.boundaryKey,
  ];
  const commandBase = `${manifestKey}:${persistedState.version}`;
  const validationBlockers = uniqueSorted([
    ...missingCapabilities.map((capability) => `panic-stop provider manifest missing capability: ${capability}`),
    ...(providerSync.validation.ready ? [] : ["panic-stop provider manifest requires ready provider sync"]),
    ...(workspaceBoundary.validation.ready ? [] : ["panic-stop provider manifest requires workspace handoff boundary"]),
    ...(persistedState.validation.restartSafe ? [] : ["panic-stop provider manifest requires restart-safe persisted state"]),
    ...(continuity.validation.replaySafe ? [] : ["panic-stop provider manifest requires replay-safe continuity"]),
    ...(recoveryStatus.restartToken ? [] : ["panic-stop provider manifest requires restart token"]),
    ...(providerContract.handoffState.ready ? [] : providerContract.handoffState.blockedReasons),
    ...(receipts.length > 0 ? [] : ["panic-stop provider manifest requires freeze receipts"]),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["panic-stop provider manifest blocks observed external writes"]),
  ]);
  const ready = validationBlockers.length === 0;

  return {
    kind: "mailchimp.panic-stop.provider-service-manifest",
    apiVersion: "aios.integration/v1",
    manifestKey,
    provider,
    service: {
      name: serviceName,
      resource: providerContract.service?.resource ?? "campaign-runtime",
      mode: "frozen-runtime-recovery",
      command: ready ? "mailchimp.panic-stop.sync-frozen-runtime" : "mailchimp.panic-stop.review-frozen-runtime",
      idempotencyKey: `${commandBase}:service-sync:${recoveryStatus.restartToken}`,
    },
    syncMetadata: {
      cursor: providerSync.sync.cursor,
      checkpoint: providerContract.handoffState.checkpoint,
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
      statusEvent: recoveryStatus.statusEvent,
      restartToken: recoveryStatus.restartToken,
      memoryNamespace: program.job.memory.namespace,
      stateDependencies,
      receipts,
    },
    capabilityNegotiation: {
      requiredCapabilities,
      grantedCapabilities: [...grantedCapabilities].sort(),
      missingCapabilities,
      deniedWrites,
      externalWritesAllowed: false,
      fallbackMode: missingCapabilities.length > 0 ? "local-status-only" : "read-only-provider-handoff",
    },
    serviceState: {
      status: ready ? "ready_for_provider_ack" : "frozen_review_required",
      providerStatusEvent,
      runtimeFence: providerSync.runtimeFence,
      workspaceDecision: workspaceBoundary.auditHandoff.decision,
      clientStatus: continuity.clientStatus,
      accepted: previewAcceptance.acceptance.accepted,
    },
    commands: {
      sync: {
        idempotent: true,
        idempotencyKey: `${commandBase}:sync:${providerSync.sync.cursor}`,
        command: ready
          ? "mailchimp.panic-stop.sync-frozen-runtime"
          : "mailchimp.panic-stop.review-frozen-runtime",
        enabled: true,
      },
      freeze: {
        idempotent: true,
        idempotencyKey: `${commandBase}:freeze:${providerSync.runtimeFence.commandFence}`,
        command: "mailchimp.panic-stop.keep-provider-frozen",
        enabled: true,
      },
      acknowledge: {
        idempotent: true,
        idempotencyKey: `${commandBase}:ack:${providerContract.handoffState.handoffToken}`,
        command: ready ? "mailchimp.panic-stop.provider-ack" : "mailchimp.panic-stop.provider-review",
        enabled: ready,
      },
    },
    externalHandoffState: {
      state: ready ? "ready" : "blocked",
      channel: options.statusChannel ?? "status:timeline.write",
      providerQueue: receipts.map((receipt, index) => ({
        queueId: `${manifestKey}:queue:${index + 1}`,
        receiptId: receipt.receiptId,
        command: receipt.command,
        state: receipt.providerVisibleState === "verified" ? "ready" : "waiting_for_evidence",
      })),
      blockedCount: validationBlockers.length,
      nextAction: ready ? "acknowledge-frozen-runtime" : "review-frozen-runtime-manifest",
    },
    validation: {
      ready,
      blockers: validationBlockers,
      summary: ready
        ? "Mailchimp provider service can acknowledge the frozen panic-stop runtime without external writes."
        : "Mailchimp provider service manifest requires capability, receipt, or boundary review.",
    },
  };
}

function buildPanicStopRouteDecisionPacket(
  program,
  audit,
  providerSync,
  previewAcceptance,
  continuity,
  persistedState,
  workspaceBoundary,
  providerServiceManifest,
  recoveryStatus,
  options,
) {
  const routeName = String(options.routeName ?? "mailchimp.panic-stop.preview");
  const requestId = String(options.requestId ?? `${program.job.id}:panic-route:${previewAcceptance.preview.previewToken}`);
  const packetKey = String(options.routeDecisionPacketKey ?? `${program.job.memory.namespace}:panic-stop:route:${requestId}`);
  const visibleBlockers = uniqueSorted([
    ...providerSync.validation.blockers,
    ...previewAcceptance.validation.blockers,
    ...continuity.validation.blockers,
    ...persistedState.validation.blockers,
    ...workspaceBoundary.validation.blockers,
    ...providerServiceManifest.validation.blockers,
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : audit.boundary.externalWritesObserved.map((write) => `external write during panic-stop route: ${write.subject ?? write}`)),
  ]);
  const frozenReceipts = previewAcceptance.preview.freezeReceipts.map((receipt) => ({
    id: `${packetKey}:receipt:${receipt.stepId}`,
    stepId: receipt.stepId,
    command: receipt.command,
    output: receipt.output,
    status: receipt.visibleState,
    userVisible: true,
  }));
  const sections = [
    {
      id: "freeze-preview",
      label: "Freeze preview",
      status: frozenReceipts.every((receipt) => receipt.status === "verified") ? "ready" : "waiting",
      rows: frozenReceipts.map((receipt) => ({
        id: receipt.id,
        label: receipt.command,
        value: receipt.status,
        severity: receipt.status === "verified" ? "ready" : "review",
      })),
      explanation: previewAcceptance.preview.summary,
    },
    {
      id: "continuity",
      label: "Continuity",
      status: continuity.validation.replaySafe ? "ready" : "blocked",
      rows: [
        {
          id: "client-status",
          label: "Client status",
          value: continuity.clientStatus,
          severity: continuity.validation.replaySafe ? "ready" : "review",
        },
        {
          id: "restart-token",
          label: "Restart token",
          value: recoveryStatus.restartToken ? "present" : "missing",
          severity: recoveryStatus.restartToken ? "ready" : "blocked",
        },
        {
          id: "provider-cursor",
          label: "Provider cursor",
          value: providerSync.sync.cursor,
          severity: providerSync.validation.ready ? "ready" : "blocked",
        },
      ],
      explanation: continuity.validation.replaySafe
        ? "The frozen runtime can replay from the persisted restart envelope."
        : continuity.validation.blockers[0] ?? "Continuity replay requires review.",
    },
    {
      id: "workspace-boundary",
      label: "Workspace boundary",
      status: workspaceBoundary.validation.ready ? "ready" : "blocked",
      rows: [
        {
          id: "tenant",
          label: "Tenant",
          value: workspaceBoundary.scope.tenantId,
          severity: workspaceBoundary.validation.workspaceIsolated ? "ready" : "blocked",
        },
        {
          id: "external-writes",
          label: "External writes",
          value: workspaceBoundary.permissions.externalWritesAllowed ? "allowed" : "blocked",
          severity: workspaceBoundary.permissions.externalWritesAllowed ? "blocked" : "ready",
        },
        {
          id: "provider-service",
          label: "Provider service",
          value: providerServiceManifest.serviceState.status,
          severity: providerServiceManifest.validation.ready ? "ready" : "review",
        },
      ],
      explanation: workspaceBoundary.validation.ready
        ? "The client route is scoped to the frozen workspace boundary."
        : workspaceBoundary.validation.blockers[0] ?? "Workspace boundary requires review.",
    },
  ];
  const accepted = previewAcceptance.acceptance.accepted === true;
  const ready = visibleBlockers.length === 0
    && accepted
    && continuity.validation.replaySafe
    && persistedState.validation.restartSafe
    && workspaceBoundary.validation.ready
    && providerServiceManifest.validation.ready;
  const primaryCommand = ready
    ? "panic.stop.resume"
    : accepted
      ? "panic.stop.review"
      : "panic.stop.accept";
  const keepFrozenReason = visibleBlockers[0] ?? "operator_hold";
  const nextSteps = ready
    ? [{
      id: "resume-frozen-runtime",
      command: "panic.stop.resume",
      label: "Resume frozen runtime",
      enabled: true,
      explains: "Acceptance, continuity replay, persisted state, and provider service handoff are all ready.",
    }]
    : [
      {
        id: "review-freeze-preview",
        command: "panic.stop.review-freeze",
        label: "Review freeze preview",
        enabled: true,
        explains: sections.find((section) => section.status !== "ready")?.explanation ?? keepFrozenReason,
      },
      {
        id: "accept-panic-stop",
        command: "panic.stop.accept",
        label: "Accept panic-stop recovery",
        enabled: providerSync.validation.ready && audit.evidence.missing.length === 0,
        explains: accepted
          ? "The panic-stop preview has already been accepted."
          : "Operator acceptance is required before the route can expose resume.",
      },
      {
        id: "keep-provider-frozen",
        command: "panic.stop.keep-frozen",
        label: "Keep provider frozen",
        enabled: true,
        explains: keepFrozenReason,
      },
    ];

  return {
    kind: "mailchimp.panic-stop.route-decision-packet",
    apiVersion: "aios.client/v1",
    packetKey,
    request: {
      requestId,
      routeName,
      jobId: program.job.id,
      packageName: program.manifest.name,
      previewToken: previewAcceptance.preview.previewToken,
      continuityKey: continuity.continuityKey,
    },
    preview: {
      status: ready ? "ready_to_resume" : accepted ? "accepted_review_required" : "acceptance_required",
      title: previewAcceptance.preview.title,
      summary: previewAcceptance.preview.summary,
      sections,
      frozenReceipts,
    },
    acceptance: {
      required: true,
      accepted,
      acceptedBy: previewAcceptance.acceptance.acceptedBy,
      acceptedAt: previewAcceptance.acceptance.acceptedAt,
      decisionKey: previewAcceptance.acceptance.decisionKey,
      decisionCommand: accepted ? null : "panic.stop.accept",
    },
    validation: {
      ready,
      externalWritesAllowed: false,
      blockers: visibleBlockers,
      summary: ready
        ? "Panic-stop route packet is ready to resume from frozen runtime state."
        : `Panic-stop route requires review: ${visibleBlockers[0] ?? "operator acceptance pending"}`,
      counters: {
        freezeReceipts: frozenReceipts.length,
        verifiedFreezeReceipts: frozenReceipts.filter((receipt) => receipt.status === "verified").length,
        evidenceMissing: audit.evidence.missing.length,
        externalWrites: audit.boundary.externalWritesObserved.length,
        blockedSections: sections.filter((section) => section.status !== "ready").length,
      },
    },
    commands: {
      primary: {
        command: primaryCommand,
        enabled: ready || primaryCommand === "panic.stop.accept",
        idempotencyKey: `${packetKey}:primary:${primaryCommand}:${recoveryStatus.restartToken}`,
      },
      keepFrozen: {
        command: "panic.stop.keep-frozen",
        enabled: true,
        idempotencyKey: `${packetKey}:keep-frozen:${providerSync.runtimeFence.commandFence}`,
      },
      providerSync: {
        command: providerServiceManifest.commands.sync.command,
        enabled: providerServiceManifest.commands.sync.enabled,
        idempotencyKey: providerServiceManifest.commands.sync.idempotencyKey,
      },
    },
    handoff: {
      restartToken: recoveryStatus.restartToken,
      statusEvent: recoveryStatus.statusEvent,
      persistedStateKey: persistedState.stateKey,
      workspaceBoundaryKey: workspaceBoundary.boundaryKey,
      providerManifestKey: providerServiceManifest.manifestKey,
      providerCommand: providerServiceManifest.commands.sync.command,
      nextAction: ready ? "route-panic-stop-resume" : "route-panic-stop-review",
    },
    nextSteps,
    summary: {
      ready,
      routeName,
      packetKey,
      primaryCommand,
      clientStatus: continuity.clientStatus,
      blockedCount: visibleBlockers.length,
      sectionCount: sections.length,
      nextStepCount: nextSteps.length,
    },
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function withRollbackVerifierHints(program) {
  return {
    ...program,
    job: {
      ...program.job,
      plan: program.job.plan.map((step) => ({
        ...step,
        verifierHints: Object.entries(step.verifierHints ?? {})
          .map(([key, value]) => `${key}=${value}`),
      })),
    },
  };
}
