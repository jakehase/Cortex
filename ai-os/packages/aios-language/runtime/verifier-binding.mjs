import { stableContractDigest } from "./provider-contract-binding.mjs";

const REQUIRED_PROVIDER_VERIFIERS = Object.freeze([
  "mailchimp.provider.contract",
  "mailchimp.no_plaintext_secret",
]);

const REQUIRED_WORKSPACE_VERIFIERS = Object.freeze([
  "workspace.local_no_external_write",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asIssueCode(issue) {
  return typeof issue?.code === "string" && issue.code.trim() ? issue.code.trim() : "issue.unknown";
}

function asStringList(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(list.map((entry) => String(entry ?? "").trim()).filter(Boolean))].sort();
}

function countSeverities(issues) {
  return issues.reduce(
    (counts, issue) => ({
      ...counts,
      [issue.severity ?? "unknown"]: (counts[issue.severity ?? "unknown"] ?? 0) + 1,
    }),
    {},
  );
}

function normalizeVerifierInput(input = {}) {
  const workspaceBinding = input.kind === "aios.workspace.boundary_binding" ? input : null;
  const providerJob = workspaceBinding?.providerJob ?? input.providerJob ?? input.job ?? input;
  const artifactPlan = workspaceBinding?.artifactPlan ?? input.artifactPlan ?? input.artifacts ?? [];
  const artifactBinding = workspaceBinding?.artifactBinding
    ?? input.artifactBinding
    ?? providerJob.artifactBinding
    ?? providerJob.adapterHandoff?.artifactBinding
    ?? null;
  const panicBinding = workspaceBinding?.panicBinding
    ?? input.panicBinding
    ?? providerJob.panicBinding
    ?? providerJob.adapterHandoff?.panicBinding
    ?? null;
  const memoryContract = workspaceBinding?.memoryContract ?? input.memoryContract ?? providerJob.memory ?? {};
  const memoryBinding = workspaceBinding?.memoryBinding
    ?? input.memoryBinding
    ?? providerJob.memoryBinding
    ?? providerJob.adapterHandoff?.memoryBinding
    ?? null;
  const workspaceAuthorizationPosture = workspaceBinding?.workspaceAuthorizationPosture
    ?? input.workspaceAuthorizationPosture
    ?? providerJob.workspaceAuthorizationPosture
    ?? providerJob.adapterHandoff?.workspaceAuthorizationPosture
    ?? null;
  const verifierContracts = [
    ...asArray(providerJob.verifierContracts),
    ...asArray(workspaceBinding?.verifierContracts ?? input.verifierContracts),
  ];
  const issues = [
    ...asArray(providerJob.issues),
    ...asArray(workspaceBinding?.issues ?? input.issues),
  ];

  return {
    workspaceBinding,
    providerJob,
    artifactPlan,
    artifactBinding,
    panicBinding,
    memoryContract,
    memoryBinding,
    workspaceAuthorizationPosture,
    verifierContracts,
    issues,
  };
}

function normalizePanicLifecycleContract(panicBinding) {
  const controls = panicBinding?.exportContract?.lifecycleControls
    ?? panicBinding?.lifecycleControls
    ?? panicBinding?.panicLifecycleControls
    ?? null;
  if (!controls || typeof controls !== "object") {
    return {
      present: false,
      enabled: null,
      ready: null,
      status: "missing",
      nextAction: "compile_panic_lifecycle_controls",
      commands: [],
      unsafeCommands: [],
      blockedCommands: [],
      scheduledCommands: [],
      scope: {
        tenant: "",
        workspace: "",
        auditSink: "",
      },
      permissions: {
        operatorRequired: null,
        holdExternalWrites: null,
        allowDegradedPreview: null,
        enabledCommands: [],
        disabledCommands: [],
      },
      schedule: {
        mode: "missing",
        scheduled: false,
        retryAfterSeconds: 0,
      },
      auditEvent: null,
    };
  }

  const auditEvent = controls.auditEvent && typeof controls.auditEvent === "object"
    ? controls.auditEvent
    : {};
  const permissions = controls.permissions && typeof controls.permissions === "object"
    ? controls.permissions
    : {};
  const schedule = controls.schedule && typeof controls.schedule === "object"
    ? controls.schedule
    : {};
  const commands = asArray(controls.commands).map((command) => ({
    command: typeof command?.command === "string" && command.command.trim() ? command.command.trim() : "unknown",
    state: typeof command?.state === "string" && command.state.trim() ? command.state.trim() : "unknown",
    idempotencyKey: typeof command?.idempotencyKey === "string" ? command.idempotencyKey.trim() : "",
    restartSafe: command?.restartSafe === true,
    blockedReasons: asStringList(command?.blockedReasons),
  }));

  return {
    present: true,
    enabled: controls.enabled === true,
    ready: controls.ready === true,
    status: typeof controls.status === "string" && controls.status.trim() ? controls.status.trim() : "unknown",
    nextAction: typeof controls.nextAction === "string" && controls.nextAction.trim()
      ? controls.nextAction.trim()
      : "repair_panic_lifecycle_controls",
    commands,
    unsafeCommands: commands.filter((command) => (
      ["ready", "scheduled", "pending"].includes(command.state)
        && (!command.idempotencyKey || command.restartSafe !== true)
    )),
    blockedCommands: commands.filter((command) => command.state === "blocked"),
    scheduledCommands: commands.filter((command) => command.state === "scheduled"),
    scope: {
      tenant: typeof auditEvent.tenant === "string" ? auditEvent.tenant.trim() : "",
      workspace: typeof auditEvent.workspace === "string" ? auditEvent.workspace.trim() : "",
      auditSink: typeof auditEvent.auditSink === "string" ? auditEvent.auditSink.trim() : "",
    },
    permissions: {
      operatorRequired: permissions.operatorRequired === true,
      holdExternalWrites: permissions.holdExternalWrites === true,
      allowDegradedPreview: permissions.allowDegradedPreview === true,
      enabledCommands: asStringList(permissions.enabledCommands),
      disabledCommands: asStringList(permissions.disabledCommands),
    },
    schedule: {
      mode: typeof schedule.mode === "string" && schedule.mode.trim() ? schedule.mode.trim() : "unknown",
      scheduled: schedule.scheduled === true,
      retryAfterSeconds: Number.isFinite(Number(schedule.retryAfterSeconds))
        ? Math.max(0, Math.floor(Number(schedule.retryAfterSeconds)))
        : 0,
      notBefore: typeof schedule.notBefore === "string" ? schedule.notBefore.trim() : "",
      notAfter: typeof schedule.notAfter === "string" ? schedule.notAfter.trim() : "",
    },
    auditEvent,
  };
}

function makeCheck(name, required, status, evidence, issueCodes = []) {
  return {
    name,
    required,
    status,
    evidence,
    issueCodes: [...new Set(issueCodes)].sort(),
  };
}

function evaluateProviderContract(normalized) {
  const providerJob = normalized.providerJob ?? {};
  const verifierNames = new Set(normalized.verifierContracts.map((contract) => contract.name));
  const errorCodes = normalized.issues.filter((issue) => issue.severity === "error").map(asIssueCode);
  const missing = REQUIRED_PROVIDER_VERIFIERS.filter((name) => !verifierNames.has(name));

  return [
    makeCheck(
      "mailchimp.provider.contract",
      true,
      errorCodes.length ? "failed" : missing.includes("mailchimp.provider.contract") ? "missing" : "passed",
      {
        provider: providerJob.provider ?? "mailchimp",
        jobId: providerJob.jobId ?? null,
        status: providerJob.status ?? "unknown",
      },
      [...errorCodes, ...missing.map((name) => `verifier.missing:${name}`)],
    ),
    makeCheck(
      "mailchimp.no_plaintext_secret",
      true,
      typeof providerJob.adapterHandoff?.auth?.secretRef === "string"
        && providerJob.adapterHandoff.auth.secretRef.startsWith("secret://")
        ? "passed"
        : "failed",
      {
        exposure: providerJob.adapterHandoff?.auth?.exposure ?? null,
        secretRefBoundary: typeof providerJob.adapterHandoff?.auth?.secretRef === "string"
          ? providerJob.adapterHandoff.auth.secretRef.split("://")[0]
          : "missing",
      },
      typeof providerJob.adapterHandoff?.auth?.secretRef === "string"
        && providerJob.adapterHandoff.auth.secretRef.startsWith("secret://")
        ? []
        : ["auth.secret_ref_boundary"],
    ),
  ];
}

function evaluateWorkspaceBoundary(normalized) {
  const artifactPlan = asArray(normalized.artifactPlan);
  const memoryContract = normalized.memoryContract ?? {};
  const verifierNames = new Set(normalized.verifierContracts.map((contract) => contract.name));
  const writable = asArray(memoryContract.writable);
  const externalWritable = asArray(memoryContract.externalWritable);
  const artifactPaths = artifactPlan.map((artifact) => artifact.path).filter(Boolean);
  const artifactPathSet = new Set(artifactPaths);
  const writableMissingFromPlan = writable.filter((path) => !artifactPathSet.has(path));
  const nonLocalPaths = [...artifactPaths, ...writable].filter(
    (path) => typeof path !== "string" || (!path.startsWith("workspace://") && !path.startsWith("memory://")),
  );
  const missing = REQUIRED_WORKSPACE_VERIFIERS.filter((name) => !verifierNames.has(name));
  const localBoundaryIssueCodes = [
    ...missing.map((name) => `verifier.missing:${name}`),
    ...writableMissingFromPlan.map((path) => `memory.unplanned_write:${path}`),
    ...nonLocalPaths.map((path) => `memory.non_local_path:${path}`),
    ...externalWritable.map((path) => `memory.external_write:${path}`),
  ];

  return [
    makeCheck(
      "workspace.local_no_external_write",
      true,
      localBoundaryIssueCodes.length ? "failed" : "passed",
      {
        artifactCount: artifactPlan.length,
        writableCount: writable.length,
        externalWritableCount: externalWritable.length,
      },
      localBoundaryIssueCodes,
    ),
    makeCheck(
      "workspace.artifact_plan_covered",
      true,
      artifactPlan.length > 0 && writableMissingFromPlan.length === 0 ? "passed" : "failed",
      {
        artifactLogicalNames: artifactPlan.map((artifact) => artifact.logicalName).filter(Boolean),
        writableMissingFromPlan,
      },
      artifactPlan.length > 0
        ? writableMissingFromPlan.map((path) => `memory.unplanned_write:${path}`)
        : ["artifact_plan.empty"],
    ),
  ];
}

function normalizeWorkspaceAuthorizationPosture(posture) {
  if (!posture || typeof posture !== "object") {
    return {
      present: false,
      status: "missing",
      postureId: null,
      digest: null,
      nextAction: "bind-runtime-boundary",
      blockedReasons: ["workspace_authorization_posture.missing"],
      scope: {
        tenant: "",
        workspace: "",
        actorId: "",
      },
      permissions: {
        required: [],
        missing: [],
        deniedActions: [],
      },
      gates: {
        workspaceMatches: null,
        auditReady: null,
        safeForPreview: null,
        safeForCommit: null,
        localOnly: null,
      },
      auditHandoff: {
        sink: "",
        appendOnly: null,
        restartSafe: null,
      },
    };
  }

  const scope = posture.scope && typeof posture.scope === "object" ? posture.scope : {};
  const permissions = posture.permissions && typeof posture.permissions === "object" ? posture.permissions : {};
  const gates = posture.gates && typeof posture.gates === "object" ? posture.gates : {};
  const auditHandoff = posture.auditHandoff && typeof posture.auditHandoff === "object" ? posture.auditHandoff : {};

  return {
    present: true,
    status: typeof posture.status === "string" && posture.status.trim() ? posture.status.trim() : "unknown",
    postureId: typeof posture.postureId === "string" && posture.postureId.trim() ? posture.postureId.trim() : null,
    digest: typeof posture.digest === "string" && posture.digest.trim() ? posture.digest.trim() : null,
    nextAction: typeof posture.nextAction === "string" && posture.nextAction.trim()
      ? posture.nextAction.trim()
      : "operator.review",
    blockedReasons: asStringList(posture.blockedReasons),
    scope: {
      tenant: typeof scope.tenant === "string" ? scope.tenant.trim() : "",
      workspace: typeof scope.workspace === "string" ? scope.workspace.trim() : "",
      actorId: typeof scope.actorId === "string" ? scope.actorId.trim() : "",
    },
    permissions: {
      required: asStringList(permissions.required),
      missing: asStringList(permissions.missing),
      deniedActions: asStringList(permissions.deniedActions),
    },
    gates: {
      workspaceMatches: gates.workspaceMatches === true,
      auditReady: gates.auditReady === true,
      safeForPreview: gates.safeForPreview === true,
      safeForCommit: gates.safeForCommit === true,
      localOnly: gates.localOnly === true,
      commitRequested: gates.commitRequested === true,
    },
    auditHandoff: {
      sink: typeof auditHandoff.sink === "string" ? auditHandoff.sink.trim() : "",
      appendOnly: auditHandoff.appendOnly === true,
      restartSafe: auditHandoff.restartSafe === true,
      eventType: typeof auditHandoff.eventType === "string" ? auditHandoff.eventType.trim() : "",
    },
  };
}

function evaluateWorkspaceAuthorizationPosture(normalized) {
  const posture = normalizeWorkspaceAuthorizationPosture(normalized.workspaceAuthorizationPosture);
  if (!posture.present) {
    return [
      makeCheck(
        "workspace.authorization_posture",
        true,
        "missing",
        {
          postureId: null,
          nextAction: posture.nextAction,
        },
        ["workspace_authorization_posture.missing"],
      ),
    ];
  }

  const issueCodes = [
    ...(posture.postureId ? [] : ["workspace_authorization_posture.missing_id"]),
    ...(posture.digest ? [] : ["workspace_authorization_posture.missing_digest"]),
    ...(posture.scope.tenant ? [] : ["workspace_authorization_posture.scope_missing_tenant"]),
    ...(posture.scope.workspace ? [] : ["workspace_authorization_posture.scope_missing_workspace"]),
    ...(posture.gates.workspaceMatches ? [] : ["workspace_authorization_posture.workspace_mismatch"]),
    ...(posture.gates.localOnly ? [] : ["workspace_authorization_posture.local_only_disabled"]),
    ...(posture.gates.auditReady ? [] : ["workspace_authorization_posture.audit_not_restart_safe"]),
    ...(posture.gates.safeForPreview ? [] : ["workspace_authorization_posture.preview_not_authorized"]),
    ...(posture.gates.commitRequested && !posture.gates.safeForCommit
      ? ["workspace_authorization_posture.commit_not_authorized"]
      : []),
    ...posture.permissions.missing.map((permission) => `workspace_authorization_posture.permission_missing:${permission}`),
    ...posture.permissions.deniedActions.map((action) => `workspace_authorization_posture.denied_action:${action}`),
    ...posture.blockedReasons.map((reason) => `workspace_authorization_posture.blocked:${reason}`),
  ];
  const status = issueCodes.length
    ? posture.gates.safeForPreview && posture.gates.auditReady
      ? "degraded"
      : "failed"
    : "passed";

  return [
    makeCheck(
      "workspace.authorization_posture",
      true,
      status,
      {
        postureId: posture.postureId,
        status: posture.status,
        digest: posture.digest,
        nextAction: posture.nextAction,
        scope: posture.scope,
        permissions: posture.permissions,
        gates: posture.gates,
        auditHandoff: posture.auditHandoff,
        blockedReasons: posture.blockedReasons,
      },
      issueCodes,
    ),
  ];
}

function evaluateLifecycleHandoff(normalized) {
  const providerJob = normalized.providerJob ?? {};
  const lifecycle = providerJob.lifecycleState ?? providerJob.adapterHandoff?.lifecycle ?? {};
  const previewAcceptance = providerJob.previewAcceptance ?? providerJob.adapterHandoff?.previewAcceptance ?? {};
  const operationalHealth = providerJob.operationalHealth ?? providerJob.adapterHandoff?.operationalHealth ?? {};
  const commandQueue = asArray(lifecycle.commandQueue);
  const nextAction = lifecycle.nextAction ?? "operator.review";
  const commitAllowed = lifecycle.controls?.commitAllowed === true;
  const acceptanceStatus = previewAcceptance.acceptanceGate?.status ?? "unknown";
  const blockedCommandCodes = commandQueue
    .filter((entry) => entry.status !== "ready")
    .map((entry) => `command.blocked:${entry.command}`);
  const issueCodes = [
    ...(operationalHealth.failureState?.terminal ? ["operational_health.terminal"] : []),
    ...(commitAllowed && acceptanceStatus === "blocked" ? ["acceptance.blocked_commit"] : []),
  ];

  return [
    makeCheck(
      "runtime.lifecycle_status_handoff",
      false,
      issueCodes.length ? "failed" : "passed",
      {
        nextAction,
        healthStatus: operationalHealth.status ?? "unknown",
        acceptanceStatus,
        readyCommands: commandQueue.filter((entry) => entry.status === "ready").map((entry) => entry.command),
        blockedCommands: blockedCommandCodes,
      },
      issueCodes,
    ),
  ];
}

function evaluatePanicLifecycleBoundary(normalized) {
  const panicLifecycle = normalizePanicLifecycleContract(normalized.panicBinding);
  if (!panicLifecycle.present) {
    return [
      makeCheck(
        "runtime.panic_lifecycle_controls",
        false,
        "missing",
        {
          status: panicLifecycle.status,
          nextAction: panicLifecycle.nextAction,
          commandCount: 0,
        },
        [],
      ),
    ];
  }

  const clientHandoff = normalizeArtifactClientHandoffContract(normalized.artifactBinding);
  const providerJob = normalized.providerJob ?? {};
  const expectedTenant = clientHandoff.scope.tenant
    || providerJob.tenant
    || providerJob.tenantId
    || providerJob.adapterHandoff?.tenant
    || "";
  const expectedWorkspace = clientHandoff.scope.workspace
    || providerJob.workspace
    || providerJob.workspaceId
    || providerJob.adapterHandoff?.workspace
    || "";
  const tenantMatches = Boolean(
    !expectedTenant
      || !panicLifecycle.scope.tenant
      || panicLifecycle.scope.tenant === expectedTenant,
  );
  const workspaceMatches = Boolean(
    !expectedWorkspace
      || !panicLifecycle.scope.workspace
      || panicLifecycle.scope.workspace === expectedWorkspace,
  );
  const lifecycleBlockedReasons = [
    ...(panicLifecycle.enabled ? [] : ["panic_lifecycle.disabled"]),
    ...(panicLifecycle.ready || panicLifecycle.scheduledCommands.length > 0 ? [] : ["panic_lifecycle.no_ready_or_scheduled_command"]),
    ...(panicLifecycle.scope.tenant ? [] : ["panic_lifecycle.scope_missing_tenant"]),
    ...(panicLifecycle.scope.workspace ? [] : ["panic_lifecycle.scope_missing_workspace"]),
    ...(panicLifecycle.scope.auditSink ? [] : ["panic_lifecycle.audit_sink_missing"]),
    ...(tenantMatches ? [] : [`panic_lifecycle.tenant_mismatch:${panicLifecycle.scope.tenant}`]),
    ...(workspaceMatches ? [] : [`panic_lifecycle.workspace_mismatch:${panicLifecycle.scope.workspace}`]),
    ...panicLifecycle.blockedCommands.map((command) => `panic_lifecycle.blocked_command:${command.command}`),
    ...panicLifecycle.unsafeCommands.map((command) => `panic_lifecycle.unsafe_command:${command.command}`),
  ];
  const scheduledOnly = lifecycleBlockedReasons.length === 0
    && panicLifecycle.ready !== true
    && panicLifecycle.scheduledCommands.length > 0;

  return [
    makeCheck(
      "runtime.panic_lifecycle_controls",
      true,
      lifecycleBlockedReasons.length ? "failed" : scheduledOnly ? "scheduled" : "passed",
      {
        status: panicLifecycle.status,
        ready: panicLifecycle.ready,
        enabled: panicLifecycle.enabled,
        nextAction: panicLifecycle.nextAction,
        commandCount: panicLifecycle.commands.length,
        readyCommands: panicLifecycle.commands
          .filter((command) => command.state === "ready")
          .map((command) => command.command),
        scheduledCommands: panicLifecycle.scheduledCommands.map((command) => command.command),
        blockedCommands: panicLifecycle.blockedCommands.map((command) => command.command),
        unsafeCommands: panicLifecycle.unsafeCommands.map((command) => command.command),
        scope: panicLifecycle.scope,
        expectedScope: {
          tenant: expectedTenant || "",
          workspace: expectedWorkspace || "",
        },
        permissions: panicLifecycle.permissions,
        schedule: panicLifecycle.schedule,
        auditEventType: panicLifecycle.auditEvent?.type ?? null,
      },
      lifecycleBlockedReasons,
    ),
  ];
}

function normalizeArtifactGateContract(artifactBinding) {
  const gates = artifactBinding?.exportContract?.gates ?? artifactBinding?.gateHandoff ?? artifactBinding?.gates ?? null;
  if (!gates || typeof gates !== "object") {
    return {
      present: false,
      ready: null,
      state: "missing",
      nextAction: "compile_artifact_binding",
      blockedReasons: [],
      acceptanceMissingKeys: [],
      syscallBlockedCommands: [],
      recoveryRestartSafe: null,
      artifactHash: null,
    };
  }

  return {
    present: true,
    ready: gates.ready === true,
    state: typeof gates.state === "string" && gates.state.trim() ? gates.state.trim() : "unknown",
    nextAction: typeof gates.nextAction === "string" && gates.nextAction.trim()
      ? gates.nextAction.trim()
      : "repair_artifact_binding",
    blockedReasons: asStringList(gates.blockedReasons),
    acceptanceMissingKeys: asStringList(gates.acceptance?.missingKeys),
    syscallBlockedCommands: asStringList(gates.syscall?.blockedCommands),
    recoveryRestartSafe: gates.recovery?.restartSafe === true,
    artifactHash: artifactBinding?.exportContract?.artifactHash ?? artifactBinding?.artifactHash ?? null,
  };
}

function normalizeArtifactClientHandoffContract(artifactBinding) {
  const handoff = artifactBinding?.exportContract?.clientHandoff
    ?? artifactBinding?.clientHandoff
    ?? artifactBinding?.artifactClientHandoff
    ?? null;
  if (!handoff || typeof handoff !== "object") {
    return {
      present: false,
      ready: null,
      restartSafe: null,
      canResume: null,
      handoffKey: null,
      nextAction: "compile_artifact_client_handoff",
      missingClientState: [],
      blockedReasons: [],
      commands: [],
      unsafeCommands: [],
      scope: {
        tenant: "",
        workspace: "",
        auditSink: "",
      },
      auditEvent: null,
    };
  }
  const commands = asArray(handoff.commands).map((command) => ({
    command: typeof command?.command === "string" ? command.command.trim() : "unknown",
    state: typeof command?.state === "string" ? command.state.trim() : "unknown",
    idempotencyKey: typeof command?.idempotencyKey === "string" ? command.idempotencyKey.trim() : "",
    restartSafe: command?.restartSafe === true,
  }));
  const missingClientState = asStringList(
    handoff.requestState?.missingFields
      ?? handoff.missingClientState
      ?? handoff.clientState?.missingFields,
  );
  const blockedReasons = asStringList(handoff.blockedReasons);
  const unsafeCommands = commands.filter((command) => (
    command.state === "ready"
      && (!command.idempotencyKey || command.restartSafe !== true)
  ));
  const scope = handoff.scope && typeof handoff.scope === "object" ? handoff.scope : {};

  return {
    present: true,
    ready: handoff.ready === true,
    restartSafe: handoff.restartSafe === true,
    canResume: handoff.canResume === true,
    handoffKey: typeof handoff.handoffKey === "string" && handoff.handoffKey.trim()
      ? handoff.handoffKey.trim()
      : null,
    nextAction: typeof handoff.nextAction === "string" && handoff.nextAction.trim()
      ? handoff.nextAction.trim()
      : "repair_artifact_client_handoff",
    missingClientState,
    blockedReasons,
    commands,
    unsafeCommands,
    scope: {
      tenant: typeof scope.tenant === "string" ? scope.tenant.trim() : "",
      workspace: typeof scope.workspace === "string" ? scope.workspace.trim() : "",
      auditSink: typeof scope.auditSink === "string" ? scope.auditSink.trim() : "",
    },
    auditEvent: handoff.auditEvent && typeof handoff.auditEvent === "object" ? handoff.auditEvent : null,
  };
}

function normalizeArtifactPersistenceContract(artifactBinding) {
  const persistedState = artifactBinding?.exportContract?.persistedState
    ?? artifactBinding?.persistedState
    ?? null;
  const commandLedger = artifactBinding?.exportContract?.commandLedger
    ?? artifactBinding?.persistedStateLedger
    ?? artifactBinding?.commandLedger
    ?? null;
  if (!persistedState && !commandLedger) {
    return {
      present: false,
      key: null,
      ledgerKey: null,
      status: "missing",
      restartSafe: null,
      replayToken: null,
      ready: null,
      blockedReasons: [],
      commands: [],
      unsafeCommands: [],
      blockedCommands: [],
    };
  }
  const rows = asArray(commandLedger?.rows).map((row) => ({
    command: typeof row?.command === "string" ? row.command.trim() : "unknown",
    state: typeof row?.state === "string" ? row.state.trim() : "unknown",
    idempotencyKey: typeof row?.idempotencyKey === "string" ? row.idempotencyKey.trim() : "",
    ledgerEntryKey: typeof row?.ledgerEntryKey === "string" ? row.ledgerEntryKey.trim() : "",
    restartSafe: row?.restartSafe === true,
    blocker: typeof row?.blocker === "string" ? row.blocker.trim() : "",
  }));
  const blockedReasons = asStringList(
    persistedState?.blockedReasons
      ?? commandLedger?.summary?.blockedReasons,
  );
  const unsafeCommands = rows.filter((row) => (
    row.state !== "blocked"
      && (!row.idempotencyKey || !row.ledgerEntryKey || row.restartSafe !== true)
  ));
  const blockedCommands = rows.filter((row) => row.state === "blocked");

  return {
    present: true,
    key: typeof persistedState?.key === "string" && persistedState.key.trim()
      ? persistedState.key.trim()
      : typeof commandLedger?.persistedStateKey === "string"
        ? commandLedger.persistedStateKey.trim()
        : null,
    ledgerKey: typeof persistedState?.ledgerKey === "string" && persistedState.ledgerKey.trim()
      ? persistedState.ledgerKey.trim()
      : typeof commandLedger?.ledgerKey === "string"
        ? commandLedger.ledgerKey.trim()
        : null,
    status: typeof persistedState?.status === "string" && persistedState.status.trim()
      ? persistedState.status.trim()
      : typeof commandLedger?.status === "string" && commandLedger.status.trim()
        ? commandLedger.status.trim()
        : "unknown",
    restartSafe: persistedState?.restartSafe === true || commandLedger?.restartSafe === true,
    replayToken: typeof persistedState?.replayToken === "string" && persistedState.replayToken.trim()
      ? persistedState.replayToken.trim()
      : typeof commandLedger?.replayToken === "string"
        ? commandLedger.replayToken.trim()
        : null,
    ready: commandLedger?.ready === true || persistedState?.restartSafe === true,
    blockedReasons,
    commands: rows,
    unsafeCommands,
    blockedCommands,
  };
}

function normalizeMemoryOperationalHandoffContract(memoryBinding) {
  const handoff = memoryBinding?.exportContract?.operationalHandoff
    ?? memoryBinding?.operationalHandoff
    ?? memoryBinding?.memoryOperationalHandoff
    ?? null;
  if (!handoff || typeof handoff !== "object") {
    return {
      present: false,
      ready: null,
      status: "missing",
      handoffKey: null,
      nextAction: "compile_memory_operational_handoff",
      blockedReasons: [],
      commands: [],
      unsafeCommands: [],
      retryBackoff: {
        retryable: false,
        scheduled: false,
        retryAfterSeconds: 0,
        maxAttempts: 0,
        issueCodes: [],
      },
      degradedMode: {
        active: false,
        mode: "missing",
        externalCommitSuppressed: null,
        localPreviewAllowed: null,
      },
      failureState: {
        terminal: null,
        circuitOpen: null,
        providerUnavailable: null,
        externalCommitSuppressed: null,
        actionableIssueCodes: [],
      },
      providerBoundary: {
        ready: null,
        digest: null,
        tenant: "",
        workspace: "",
        blockedReasons: [],
      },
    };
  }

  const commands = asArray(handoff.commands).map((command) => ({
    command: typeof command?.command === "string" && command.command.trim() ? command.command.trim() : "unknown",
    state: typeof command?.state === "string" && command.state.trim() ? command.state.trim() : "unknown",
    idempotencyKey: typeof command?.idempotencyKey === "string" ? command.idempotencyKey.trim() : "",
    restartSafe: command?.restartSafe === true,
  }));
  const retryBackoff = handoff.retryBackoff && typeof handoff.retryBackoff === "object" ? handoff.retryBackoff : {};
  const degradedMode = handoff.degradedMode && typeof handoff.degradedMode === "object" ? handoff.degradedMode : {};
  const failureState = handoff.failureState && typeof handoff.failureState === "object" ? handoff.failureState : {};
  const providerBoundary = handoff.providerBoundary && typeof handoff.providerBoundary === "object" ? handoff.providerBoundary : {};
  const unsafeCommands = commands.filter((command) => (
    ["ready", "scheduled", "pending"].includes(command.state)
      && (!command.idempotencyKey || command.restartSafe !== true)
  ));

  return {
    present: true,
    ready: handoff.ready === true,
    status: typeof handoff.status === "string" && handoff.status.trim() ? handoff.status.trim() : "unknown",
    handoffKey: typeof handoff.handoffKey === "string" && handoff.handoffKey.trim()
      ? handoff.handoffKey.trim()
      : null,
    nextAction: typeof handoff.nextAction === "string" && handoff.nextAction.trim()
      ? handoff.nextAction.trim()
      : "repair_memory_operational_handoff",
    blockedReasons: asStringList(handoff.blockedReasons),
    commands,
    unsafeCommands,
    retryBackoff: {
      retryable: retryBackoff.retryable === true,
      scheduled: retryBackoff.scheduled === true,
      mode: typeof retryBackoff.mode === "string" ? retryBackoff.mode.trim() : "",
      backoff: typeof retryBackoff.backoff === "string" ? retryBackoff.backoff.trim() : "",
      retryAfterSeconds: Number.isFinite(Number(retryBackoff.retryAfterSeconds))
        ? Math.max(0, Math.floor(Number(retryBackoff.retryAfterSeconds)))
        : 0,
      maxAttempts: Number.isFinite(Number(retryBackoff.maxAttempts))
        ? Math.max(0, Math.floor(Number(retryBackoff.maxAttempts)))
        : 0,
      issueCodes: asStringList(retryBackoff.issueCodes),
    },
    degradedMode: {
      active: degradedMode.active === true,
      mode: typeof degradedMode.mode === "string" && degradedMode.mode.trim() ? degradedMode.mode.trim() : "unknown",
      externalCommitSuppressed: degradedMode.externalCommitSuppressed === true,
      localPreviewAllowed: degradedMode.localPreviewAllowed === true,
    },
    failureState: {
      terminal: failureState.terminal === true,
      circuitOpen: failureState.circuitOpen === true,
      providerUnavailable: failureState.providerUnavailable === true,
      externalCommitSuppressed: failureState.externalCommitSuppressed === true,
      actionableIssueCodes: asStringList(failureState.actionableIssueCodes),
    },
    providerBoundary: {
      ready: providerBoundary.ready === true,
      digest: typeof providerBoundary.digest === "string" ? providerBoundary.digest.trim() : null,
      tenant: typeof providerBoundary.tenant === "string" ? providerBoundary.tenant.trim() : "",
      workspace: typeof providerBoundary.workspace === "string" ? providerBoundary.workspace.trim() : "",
      blockedReasons: asStringList(providerBoundary.blockedReasons),
    },
  };
}

function normalizePanicProviderServiceContract(panicBinding) {
  const service = panicBinding?.exportContract?.providerService
    ?? panicBinding?.providerService
    ?? panicBinding?.panicProviderService
    ?? null;
  if (!service || typeof service !== "object") {
    return {
      present: false,
      ready: null,
      status: "missing",
      contractKey: null,
      nextAction: "compile_panic_provider_service",
      capabilities: {
        required: [],
        granted: [],
        missing: [],
        disabled: [],
      },
      syncMetadata: {
        status: "missing",
        retryable: false,
        retryAfterSeconds: 0,
        consecutiveFailures: 0,
      },
      externalHandoff: {
        state: "missing",
        restartSafe: null,
        target: "",
        queue: "",
        correlationId: "",
      },
      blockedReasons: [],
    };
  }
  const capabilities = service.capabilities && typeof service.capabilities === "object" ? service.capabilities : {};
  const syncMetadata = service.syncMetadata && typeof service.syncMetadata === "object" ? service.syncMetadata : {};
  const externalHandoff = service.externalHandoff && typeof service.externalHandoff === "object" ? service.externalHandoff : {};

  return {
    present: true,
    ready: service.ready === true,
    status: typeof service.status === "string" && service.status.trim() ? service.status.trim() : "unknown",
    contractKey: typeof service.contractKey === "string" && service.contractKey.trim()
      ? service.contractKey.trim()
      : null,
    nextAction: typeof service.nextAction === "string" && service.nextAction.trim()
      ? service.nextAction.trim()
      : "repair_panic_provider_service",
    capabilities: {
      required: asStringList(capabilities.required),
      granted: asStringList(capabilities.granted),
      missing: asStringList(capabilities.missing),
      disabled: asStringList(capabilities.disabled),
    },
    syncMetadata: {
      status: typeof syncMetadata.status === "string" && syncMetadata.status.trim()
        ? syncMetadata.status.trim()
        : "unknown",
      retryable: syncMetadata.retryable === true,
      retryAfterSeconds: Number.isFinite(Number(syncMetadata.retryAfterSeconds))
        ? Math.max(0, Math.floor(Number(syncMetadata.retryAfterSeconds)))
        : 0,
      consecutiveFailures: Number.isFinite(Number(syncMetadata.consecutiveFailures))
        ? Math.max(0, Math.floor(Number(syncMetadata.consecutiveFailures)))
        : 0,
      cursor: typeof syncMetadata.cursor === "string" ? syncMetadata.cursor.trim() : "",
      lastProviderRequestId: typeof syncMetadata.lastProviderRequestId === "string"
        ? syncMetadata.lastProviderRequestId.trim()
        : "",
    },
    externalHandoff: {
      state: typeof externalHandoff.state === "string" && externalHandoff.state.trim()
        ? externalHandoff.state.trim()
        : "unknown",
      restartSafe: externalHandoff.restartSafe === true,
      target: typeof externalHandoff.target === "string" ? externalHandoff.target.trim() : "",
      queue: typeof externalHandoff.queue === "string" ? externalHandoff.queue.trim() : "",
      correlationId: typeof externalHandoff.correlationId === "string" ? externalHandoff.correlationId.trim() : "",
    },
    blockedReasons: asStringList(service.blockedReasons),
  };
}

function normalizePanicPreviewAcceptanceContract(panicBinding) {
  const preview = panicBinding?.exportContract?.previewAcceptance
    ?? panicBinding?.previewAcceptance
    ?? panicBinding?.panicPreviewAcceptance
    ?? null;
  if (!preview || typeof preview !== "object") {
    return {
      present: false,
      ready: null,
      restartSafe: null,
      state: "missing",
      previewDigest: null,
      nextAction: "compile_panic_preview_acceptance",
      blockedReasons: [],
      acceptance: {
        state: "missing",
        requiredKeys: [],
        missingKeys: [],
        allowPendingAcceptance: false,
      },
      preview: {
        allowed: false,
        degraded: false,
        externalWritesHeld: null,
        artifactHash: null,
        artifactExportState: "missing",
        artifactExportDigest: "",
        clientHandoffKey: null,
        timelineDigest: "",
      },
      readiness: {
        panicState: "missing",
        lifecycleStatus: "missing",
        providerServiceStatus: "missing",
        artifactLedgerStatus: "missing",
        missingClientState: [],
        cards: [],
      },
    };
  }
  const acceptance = preview.acceptance && typeof preview.acceptance === "object" ? preview.acceptance : {};
  const previewState = preview.preview && typeof preview.preview === "object" ? preview.preview : {};
  const readiness = preview.readiness && typeof preview.readiness === "object" ? preview.readiness : {};
  const cards = asArray(readiness.cards).map((card) => ({
    key: typeof card?.key === "string" && card.key.trim() ? card.key.trim() : "unknown",
    state: typeof card?.state === "string" && card.state.trim() ? card.state.trim() : "unknown",
    command: typeof card?.command === "string" && card.command.trim() ? card.command.trim() : "unknown",
    blockedReasons: asStringList(card?.blockedReasons),
  }));

  return {
    present: true,
    ready: preview.ready === true,
    restartSafe: preview.restartSafe === true,
    state: typeof preview.state === "string" && preview.state.trim() ? preview.state.trim() : "unknown",
    previewDigest: typeof preview.previewDigest === "string" && preview.previewDigest.trim()
      ? preview.previewDigest.trim()
      : null,
    nextAction: typeof preview.nextAction === "string" && preview.nextAction.trim()
      ? preview.nextAction.trim()
      : "repair_panic_preview_acceptance",
    blockedReasons: asStringList(preview.blockedReasons),
    acceptance: {
      state: typeof acceptance.state === "string" && acceptance.state.trim()
        ? acceptance.state.trim()
        : "unknown",
      requiredKeys: asStringList(acceptance.requiredKeys),
      missingKeys: asStringList(acceptance.missingKeys),
      allowPendingAcceptance: acceptance.allowPendingAcceptance === true,
    },
    preview: {
      allowed: previewState.allowed === true,
      degraded: previewState.degraded === true,
      externalWritesHeld: previewState.externalWritesHeld === true,
      artifactHash: typeof previewState.artifactHash === "string" && previewState.artifactHash.trim()
        ? previewState.artifactHash.trim()
        : null,
      artifactExportState: typeof previewState.artifactExportState === "string" && previewState.artifactExportState.trim()
        ? previewState.artifactExportState.trim()
        : "unknown",
      artifactExportDigest: typeof previewState.artifactExportDigest === "string"
        ? previewState.artifactExportDigest.trim()
        : "",
      clientHandoffKey: typeof previewState.clientHandoffKey === "string" && previewState.clientHandoffKey.trim()
        ? previewState.clientHandoffKey.trim()
        : null,
      timelineDigest: typeof previewState.timelineDigest === "string" ? previewState.timelineDigest.trim() : "",
    },
    readiness: {
      panicState: typeof readiness.panicState === "string" && readiness.panicState.trim()
        ? readiness.panicState.trim()
        : "unknown",
      lifecycleStatus: typeof readiness.lifecycleStatus === "string" && readiness.lifecycleStatus.trim()
        ? readiness.lifecycleStatus.trim()
        : "unknown",
      providerServiceStatus: typeof readiness.providerServiceStatus === "string" && readiness.providerServiceStatus.trim()
        ? readiness.providerServiceStatus.trim()
        : "unknown",
      artifactLedgerStatus: typeof readiness.artifactLedgerStatus === "string" && readiness.artifactLedgerStatus.trim()
        ? readiness.artifactLedgerStatus.trim()
        : "unknown",
      missingClientState: asStringList(readiness.missingClientState),
      cards,
    },
  };
}

function evaluateArtifactGateHandoff(normalized) {
  const artifactGate = normalizeArtifactGateContract(normalized.artifactBinding);
  if (!artifactGate.present) {
    return [
      makeCheck(
        "runtime.artifact_gate_handoff",
        false,
        "missing",
        {
          state: artifactGate.state,
          nextAction: artifactGate.nextAction,
          artifactHash: null,
        },
        [],
      ),
    ];
  }

  const issueCodes = [
    ...(artifactGate.ready ? [] : ["artifact_gate.not_ready"]),
    ...artifactGate.blockedReasons.map((reason) => `artifact_gate.blocked:${reason}`),
    ...artifactGate.acceptanceMissingKeys.map((key) => `artifact_gate.acceptance_missing:${key}`),
    ...artifactGate.syscallBlockedCommands.map((command) => `artifact_gate.syscall_blocked:${command}`),
    ...(artifactGate.recoveryRestartSafe ? [] : ["artifact_gate.recovery_not_restart_safe"]),
  ];

  return [
    makeCheck(
      "runtime.artifact_gate_handoff",
      true,
      issueCodes.length ? "failed" : "passed",
      {
        state: artifactGate.state,
        ready: artifactGate.ready,
        nextAction: artifactGate.nextAction,
        artifactHash: artifactGate.artifactHash,
        blockedReasons: artifactGate.blockedReasons,
        acceptanceMissingKeys: artifactGate.acceptanceMissingKeys,
        syscallBlockedCommands: artifactGate.syscallBlockedCommands,
        recoveryRestartSafe: artifactGate.recoveryRestartSafe,
      },
      issueCodes,
    ),
  ];
}

function evaluatePanicPreviewAcceptance(normalized) {
  const preview = normalizePanicPreviewAcceptanceContract(normalized.panicBinding);
  if (!preview.present) {
    return [
      makeCheck(
        "runtime.panic_preview_acceptance",
        false,
        "missing",
        {
          state: preview.state,
          nextAction: preview.nextAction,
          previewDigest: null,
        },
        [],
      ),
    ];
  }

  const issueCodes = [
    ...(preview.previewDigest ? [] : ["panic_preview_acceptance.missing_digest"]),
    ...(preview.ready || preview.acceptance.allowPendingAcceptance ? [] : ["panic_preview_acceptance.not_ready"]),
    ...(preview.restartSafe ? [] : ["panic_preview_acceptance.not_restart_safe"]),
    ...(preview.preview.allowed ? [] : ["panic_preview_acceptance.preview_not_allowed"]),
    ...(preview.preview.artifactHash ? [] : ["panic_preview_acceptance.missing_artifact_hash"]),
    ...(preview.preview.clientHandoffKey ? [] : ["panic_preview_acceptance.missing_client_handoff_key"]),
    ...preview.blockedReasons.map((reason) => `panic_preview_acceptance.blocked:${reason}`),
    ...preview.acceptance.missingKeys.map((key) => `panic_preview_acceptance.acceptance_missing:${key}`),
    ...preview.readiness.missingClientState.map((field) => `panic_preview_acceptance.client_state_missing:${field}`),
    ...preview.readiness.cards.flatMap((card) => (
      card.blockedReasons.map((reason) => `panic_preview_acceptance.card_blocked:${card.key}:${reason}`)
    )),
  ];
  const status = issueCodes.length
    ? preview.acceptance.allowPendingAcceptance || preview.preview.degraded
      ? "degraded"
      : "failed"
    : "passed";

  return [
    makeCheck(
      "runtime.panic_preview_acceptance",
      false,
      status,
      {
        previewDigest: preview.previewDigest,
        state: preview.state,
        ready: preview.ready,
        restartSafe: preview.restartSafe,
        nextAction: preview.nextAction,
        acceptance: preview.acceptance,
        preview: preview.preview,
        readiness: {
          ...preview.readiness,
          cardCount: preview.readiness.cards.length,
        },
        blockedReasons: preview.blockedReasons,
      },
      issueCodes,
    ),
  ];
}

function evaluateMemoryOperationalHandoff(normalized) {
  const handoff = normalizeMemoryOperationalHandoffContract(normalized.memoryBinding);
  if (!handoff.present) {
    return [
      makeCheck(
        "runtime.memory_operational_handoff",
        false,
        "missing",
        {
          status: handoff.status,
          nextAction: handoff.nextAction,
          handoffKey: null,
        },
        [],
      ),
    ];
  }

  const issueCodes = [
    ...(handoff.handoffKey ? [] : ["memory_operational_handoff.missing_key"]),
    ...(handoff.ready || handoff.retryBackoff.scheduled || handoff.degradedMode.active
      ? []
      : ["memory_operational_handoff.not_ready"]),
    ...handoff.blockedReasons.map((reason) => `memory_operational_handoff.blocked:${reason}`),
    ...handoff.providerBoundary.blockedReasons.map((reason) => `memory_operational_handoff.provider_boundary:${reason}`),
    ...(handoff.providerBoundary.ready ? [] : ["memory_operational_handoff.provider_boundary_not_ready"]),
    ...(handoff.failureState.terminal ? ["memory_operational_handoff.failure_terminal"] : []),
    ...(handoff.failureState.circuitOpen && !handoff.retryBackoff.scheduled
      ? ["memory_operational_handoff.circuit_open_without_retry"]
      : []),
    ...(handoff.degradedMode.active && !handoff.degradedMode.localPreviewAllowed
      ? ["memory_operational_handoff.degraded_preview_unavailable"]
      : []),
    ...handoff.unsafeCommands.map((command) => `memory_operational_handoff.unsafe_command:${command.command}`),
  ];
  const status = issueCodes.length
    ? handoff.retryBackoff.scheduled || handoff.degradedMode.active
      ? "degraded"
      : "failed"
    : "passed";

  return [
    makeCheck(
      "runtime.memory_operational_handoff",
      true,
      status,
      {
        handoffKey: handoff.handoffKey,
        status: handoff.status,
        ready: handoff.ready,
        nextAction: handoff.nextAction,
        blockedReasons: handoff.blockedReasons,
        retryBackoff: handoff.retryBackoff,
        degradedMode: handoff.degradedMode,
        failureState: handoff.failureState,
        providerBoundary: handoff.providerBoundary,
        commandCount: handoff.commands.length,
        unsafeCommands: handoff.unsafeCommands.map((command) => command.command),
      },
      issueCodes,
    ),
  ];
}

function evaluatePanicProviderService(normalized) {
  const service = normalizePanicProviderServiceContract(normalized.panicBinding);
  if (!service.present) {
    return [
      makeCheck(
        "runtime.panic_provider_service",
        false,
        "missing",
        {
          status: service.status,
          nextAction: service.nextAction,
          contractKey: null,
        },
        [],
      ),
    ];
  }

  const issueCodes = [
    ...(service.contractKey ? [] : ["panic_provider_service.missing_key"]),
    ...(service.ready || service.syncMetadata.retryable ? [] : ["panic_provider_service.not_ready"]),
    ...service.blockedReasons.map((reason) => `panic_provider_service.blocked:${reason}`),
    ...service.capabilities.missing.map((capability) => `panic_provider_service.capability_missing:${capability}`),
    ...(service.externalHandoff.restartSafe ? [] : ["panic_provider_service.external_handoff_not_restart_safe"]),
    ...(service.syncMetadata.retryable && service.syncMetadata.retryAfterSeconds <= 0
      ? ["panic_provider_service.retry_without_backoff"]
      : []),
  ];

  return [
    makeCheck(
      "runtime.panic_provider_service",
      true,
      issueCodes.length
        ? service.syncMetadata.retryable
          ? "degraded"
          : "failed"
        : "passed",
      {
        contractKey: service.contractKey,
        status: service.status,
        ready: service.ready,
        nextAction: service.nextAction,
        capabilities: service.capabilities,
        syncMetadata: service.syncMetadata,
        externalHandoff: service.externalHandoff,
        blockedReasons: service.blockedReasons,
      },
      issueCodes,
    ),
  ];
}

function evaluateArtifactClientHandoff(normalized) {
  const clientHandoff = normalizeArtifactClientHandoffContract(normalized.artifactBinding);
  if (!clientHandoff.present) {
    return [
      makeCheck(
        "runtime.artifact_client_handoff",
        true,
        "missing",
        {
          handoffKey: null,
          nextAction: clientHandoff.nextAction,
          ready: null,
          restartSafe: null,
          canResume: null,
        },
        ["artifact_client_handoff.missing"],
      ),
    ];
  }

  const issueCodes = [
    ...(clientHandoff.ready ? [] : ["artifact_client_handoff.not_ready"]),
    ...(clientHandoff.restartSafe ? [] : ["artifact_client_handoff.not_restart_safe"]),
    ...(clientHandoff.canResume ? [] : ["artifact_client_handoff.resume_unavailable"]),
    ...(clientHandoff.handoffKey ? [] : ["artifact_client_handoff.missing_key"]),
    ...(clientHandoff.scope.tenant ? [] : ["artifact_client_handoff.scope_missing_tenant"]),
    ...(clientHandoff.scope.workspace ? [] : ["artifact_client_handoff.scope_missing_workspace"]),
    ...clientHandoff.missingClientState.map((field) => `artifact_client_handoff.client_state_missing:${field}`),
    ...clientHandoff.blockedReasons.map((reason) => `artifact_client_handoff.blocked:${reason}`),
    ...clientHandoff.unsafeCommands.map((command) => `artifact_client_handoff.unsafe_command:${command.command}`),
  ];

  return [
    makeCheck(
      "runtime.artifact_client_handoff",
      true,
      issueCodes.length ? "failed" : "passed",
      {
        handoffKey: clientHandoff.handoffKey,
        ready: clientHandoff.ready,
        restartSafe: clientHandoff.restartSafe,
        canResume: clientHandoff.canResume,
        nextAction: clientHandoff.nextAction,
        missingClientState: clientHandoff.missingClientState,
        blockedReasons: clientHandoff.blockedReasons,
        commandCount: clientHandoff.commands.length,
        unsafeCommands: clientHandoff.unsafeCommands.map((command) => command.command),
        scope: clientHandoff.scope,
        auditEventType: clientHandoff.auditEvent?.type ?? null,
      },
      issueCodes,
    ),
  ];
}

function evaluateArtifactPersistenceHandoff(normalized) {
  const persistence = normalizeArtifactPersistenceContract(normalized.artifactBinding);
  if (!persistence.present) {
    return [
      makeCheck(
        "runtime.artifact_persisted_state",
        true,
        "missing",
        {
          key: null,
          ledgerKey: null,
          status: persistence.status,
          restartSafe: null,
          replayToken: null,
        },
        ["artifact_persistence.missing"],
      ),
    ];
  }

  const issueCodes = [
    ...(persistence.key ? [] : ["artifact_persistence.missing_key"]),
    ...(persistence.ledgerKey ? [] : ["artifact_persistence.missing_ledger_key"]),
    ...(persistence.restartSafe ? [] : ["artifact_persistence.not_restart_safe"]),
    ...(persistence.replayToken ? [] : ["artifact_persistence.missing_replay_token"]),
    ...persistence.blockedReasons.map((reason) => `artifact_persistence.blocked:${reason}`),
    ...persistence.blockedCommands.map((row) => `artifact_persistence.blocked_command:${row.command}`),
    ...persistence.unsafeCommands.map((row) => `artifact_persistence.unsafe_command:${row.command}`),
  ];

  return [
    makeCheck(
      "runtime.artifact_persisted_state",
      true,
      issueCodes.length ? "failed" : "passed",
      {
        key: persistence.key,
        ledgerKey: persistence.ledgerKey,
        status: persistence.status,
        restartSafe: persistence.restartSafe,
        replayToken: persistence.replayToken,
        blockedReasons: persistence.blockedReasons,
        commandCount: persistence.commands.length,
        blockedCommands: persistence.blockedCommands.map((row) => row.command),
        unsafeCommands: persistence.unsafeCommands.map((row) => row.command),
      },
      issueCodes,
    ),
  ];
}

function summarizeChecks(checks) {
  const requiredFailed = checks.filter((check) => check.required && check.status !== "passed");
  const optionalFailed = checks.filter((check) => !check.required && check.status !== "passed");

  return {
    status: requiredFailed.length ? "failed" : optionalFailed.length ? "degraded" : "passed",
    requiredPassed: checks.filter((check) => check.required && check.status === "passed").length,
    requiredFailed: requiredFailed.length,
    optionalFailed: optionalFailed.length,
    issueCodes: [...new Set(checks.flatMap((check) => check.issueCodes))].sort(),
  };
}

export function evaluateMailchimpVerifierBinding(input = {}) {
  const normalized = normalizeVerifierInput(input);
  const checks = [
    ...evaluateProviderContract(normalized),
    ...evaluateWorkspaceBoundary(normalized),
    ...evaluateWorkspaceAuthorizationPosture(normalized),
    ...evaluateLifecycleHandoff(normalized),
    ...evaluateMemoryOperationalHandoff(normalized),
    ...evaluatePanicLifecycleBoundary(normalized),
    ...evaluatePanicProviderService(normalized),
    ...evaluatePanicPreviewAcceptance(normalized),
    ...evaluateArtifactGateHandoff(normalized),
    ...evaluateArtifactClientHandoff(normalized),
    ...evaluateArtifactPersistenceHandoff(normalized),
  ];
  const summary = summarizeChecks(checks);
  const issueCounts = countSeverities(normalized.issues);
  const artifactClientHandoff = normalizeArtifactClientHandoffContract(normalized.artifactBinding);
  const artifactPersistence = normalizeArtifactPersistenceContract(normalized.artifactBinding);
  const panicLifecycle = normalizePanicLifecycleContract(normalized.panicBinding);
  const memoryOperationalHandoff = normalizeMemoryOperationalHandoffContract(normalized.memoryBinding);
  const panicProviderService = normalizePanicProviderServiceContract(normalized.panicBinding);
  const panicPreviewAcceptance = normalizePanicPreviewAcceptanceContract(normalized.panicBinding);
  const workspaceAuthorizationPosture = normalizeWorkspaceAuthorizationPosture(normalized.workspaceAuthorizationPosture);
  const digest = stableContractDigest({
    jobId: normalized.providerJob?.jobId ?? null,
    checks,
    issueCodes: summary.issueCodes,
    artifactPaths: asArray(normalized.artifactPlan).map((artifact) => artifact.path),
    artifactHash: normalized.artifactBinding?.exportContract?.artifactHash ?? null,
    artifactClientHandoffKey: artifactClientHandoff.handoffKey,
    artifactPersistenceLedgerKey: artifactPersistence.ledgerKey,
    memoryOperationalHandoffKey: memoryOperationalHandoff.handoffKey,
    panicLifecycleStatus: panicLifecycle.status,
    panicLifecycleNextAction: panicLifecycle.nextAction,
    panicProviderServiceKey: panicProviderService.contractKey,
    panicPreviewAcceptanceDigest: panicPreviewAcceptance.previewDigest,
    workspaceAuthorizationPostureDigest: workspaceAuthorizationPosture.digest,
  });

  return {
    kind: "aios.verifier.execution_report",
    reportId: `verifier:${digest.slice(-8)}`,
    status: summary.status,
    digest,
    checks,
    summary: {
      ...summary,
      sourceIssueCounts: issueCounts,
    },
    handoff: {
      providerJobId: normalized.providerJob?.jobId ?? null,
      adapter: normalized.providerJob?.adapterHandoff?.provider ?? normalized.providerJob?.provider ?? "mailchimp",
      nextAction: normalized.providerJob?.lifecycleState?.nextAction ?? "operator.review",
      retryMode: normalized.providerJob?.operationalHealth?.retryPlan?.mode ?? null,
      memoryOperationalHandoff: {
        present: memoryOperationalHandoff.present,
        handoffKey: memoryOperationalHandoff.handoffKey,
        ready: memoryOperationalHandoff.ready,
        status: memoryOperationalHandoff.status,
        nextAction: memoryOperationalHandoff.nextAction,
        retryBackoff: memoryOperationalHandoff.retryBackoff,
        degradedMode: memoryOperationalHandoff.degradedMode,
        failureState: memoryOperationalHandoff.failureState,
        blockedReasons: memoryOperationalHandoff.blockedReasons,
      },
      workspaceAuthorizationPosture: {
        present: workspaceAuthorizationPosture.present,
        postureId: workspaceAuthorizationPosture.postureId,
        status: workspaceAuthorizationPosture.status,
        digest: workspaceAuthorizationPosture.digest,
        nextAction: workspaceAuthorizationPosture.nextAction,
        scope: workspaceAuthorizationPosture.scope,
        gates: workspaceAuthorizationPosture.gates,
        missingPermissions: workspaceAuthorizationPosture.permissions.missing,
        deniedActions: workspaceAuthorizationPosture.permissions.deniedActions,
        auditHandoff: workspaceAuthorizationPosture.auditHandoff,
        blockedReasons: workspaceAuthorizationPosture.blockedReasons,
      },
      artifactGateState: normalizeArtifactGateContract(normalized.artifactBinding).state,
      artifactClientHandoff: {
        present: artifactClientHandoff.present,
        handoffKey: artifactClientHandoff.handoffKey,
        ready: artifactClientHandoff.ready,
        restartSafe: artifactClientHandoff.restartSafe,
        canResume: artifactClientHandoff.canResume,
        nextAction: artifactClientHandoff.nextAction,
        missingClientState: artifactClientHandoff.missingClientState,
        scope: artifactClientHandoff.scope,
      },
      artifactPersistence: {
        present: artifactPersistence.present,
        key: artifactPersistence.key,
        ledgerKey: artifactPersistence.ledgerKey,
        status: artifactPersistence.status,
        restartSafe: artifactPersistence.restartSafe,
        replayToken: artifactPersistence.replayToken,
        blockedReasons: artifactPersistence.blockedReasons,
      },
      panicLifecycle: {
        present: panicLifecycle.present,
        enabled: panicLifecycle.enabled,
        ready: panicLifecycle.ready,
        status: panicLifecycle.status,
        nextAction: panicLifecycle.nextAction,
        commandCount: panicLifecycle.commands.length,
        blockedCommands: panicLifecycle.blockedCommands.map((command) => command.command),
        scheduledCommands: panicLifecycle.scheduledCommands.map((command) => command.command),
        scope: panicLifecycle.scope,
        schedule: panicLifecycle.schedule,
      },
      panicProviderService: {
        present: panicProviderService.present,
        contractKey: panicProviderService.contractKey,
        ready: panicProviderService.ready,
        status: panicProviderService.status,
        nextAction: panicProviderService.nextAction,
        capabilities: panicProviderService.capabilities,
        syncMetadata: panicProviderService.syncMetadata,
        externalHandoff: panicProviderService.externalHandoff,
        blockedReasons: panicProviderService.blockedReasons,
      },
      panicPreviewAcceptance: {
        present: panicPreviewAcceptance.present,
        previewDigest: panicPreviewAcceptance.previewDigest,
        ready: panicPreviewAcceptance.ready,
        restartSafe: panicPreviewAcceptance.restartSafe,
        state: panicPreviewAcceptance.state,
        nextAction: panicPreviewAcceptance.nextAction,
        acceptance: panicPreviewAcceptance.acceptance,
        preview: panicPreviewAcceptance.preview,
        readiness: panicPreviewAcceptance.readiness,
        blockedReasons: panicPreviewAcceptance.blockedReasons,
      },
      verifierIssueCodes: summary.issueCodes,
    },
  };
}

export function summarizeMailchimpVerifierStatus(input = {}) {
  const report = input.kind === "aios.verifier.execution_report"
    ? input
    : evaluateMailchimpVerifierBinding(input);

  return {
    reportId: report.reportId,
    status: report.status,
    requiredPassed: report.summary.requiredPassed,
    requiredFailed: report.summary.requiredFailed,
    issueCodes: report.summary.issueCodes,
    nextAction: report.handoff.nextAction,
    memoryOperationalHandoff: report.handoff.memoryOperationalHandoff,
    workspaceAuthorizationPosture: report.handoff.workspaceAuthorizationPosture,
    artifactClientHandoff: report.handoff.artifactClientHandoff,
    artifactPersistence: report.handoff.artifactPersistence,
    panicLifecycle: report.handoff.panicLifecycle,
    panicProviderService: report.handoff.panicProviderService,
    panicPreviewAcceptance: report.handoff.panicPreviewAcceptance,
  };
}
