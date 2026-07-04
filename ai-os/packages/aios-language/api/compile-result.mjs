import {
  mergeTruthBoundaries,
  createTruthBoundaryHandoff,
  exportTruthBoundaryReport,
  normalizeOperationalHealth,
  normalizeTruthBoundary,
  summarizeOperationalHealth,
  summarizeTruthBoundary,
} from "./truth-boundary.mjs";

const COMPILE_STATUSES = new Set(["compiled", "blocked", "partial"]);
const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:[.:][a-z][a-z0-9-]*)*$/;

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function diagnostic(severity, code, message, path = "$") {
  return { severity, code, message, path };
}

function stableUnique(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const cleaned = cleanText(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

function normalizeCapability(capability, index) {
  const name = cleanText(typeof capability === "string" ? capability : capability?.name);
  const mode = cleanText(capability?.mode) || "use";
  const target = cleanText(capability?.target) || null;
  return { id: `capability-${index + 1}`, name, mode, target };
}

function normalizeMemoryContract(memory = {}) {
  const reads = stableUnique([
    ...asArray(memory.reads),
    ...asArray(memory.read),
    ...asArray(memory.inputs),
  ]);
  const writes = stableUnique([
    ...asArray(memory.writes),
    ...asArray(memory.write),
    ...asArray(memory.outputs),
  ]);
  const scopes = stableUnique([
    ...asArray(memory.scopes),
    ...asArray(memory.scope),
  ]);
  return { reads, writes, scopes, localOnly: memory.localOnly !== false };
}

function normalizeVerifierContracts(contracts = []) {
  return asArray(contracts).map((contract, index) => {
    if (typeof contract === "string") {
      return { id: `verifier-${index + 1}`, kind: "assertion", expression: cleanText(contract), required: true };
    }
    return {
      id: cleanText(contract?.id) || `verifier-${index + 1}`,
      kind: cleanText(contract?.kind) || "assertion",
      expression: cleanText(contract?.expression ?? contract?.assertion ?? contract?.text),
      required: contract?.required !== false,
    };
  }).filter((contract) => contract.expression);
}

function normalizeRequestContract(request = {}, jobId = "kernel-job-1") {
  const channel = cleanText(request.channel) || "client";
  const workflow = cleanText(request.workflow ?? request.name) || "default";
  const clientRequestId = cleanText(request.clientRequestId ?? request.requestId ?? request.id) || `${jobId}:request`;
  const idempotencyKey = cleanText(request.idempotencyKey ?? request.idempotency) || `${clientRequestId}:${workflow}`;
  const tenantId = cleanText(request.tenantId ?? request.tenant) || "local";
  const workspaceId = cleanText(request.workspaceId ?? request.workspace) || "default";

  return {
    channel,
    workflow,
    clientRequestId,
    idempotencyKey,
    tenantId,
    workspaceId,
    userVisibleStatus: cleanText(request.userVisibleStatus ?? request.status) || "queued",
  };
}

function normalizeAccessPolicy(policy = {}, requestContract, capabilities, memory) {
  const capabilityNames = stableUnique(capabilities.map((capability) => capability.name));
  const roles = stableUnique([
    ...asArray(policy.roles),
    ...asArray(policy.role),
    ...asArray(requestContract.role),
  ]);
  const permissions = stableUnique([
    ...asArray(policy.permissions),
    ...asArray(policy.permission),
    ...asArray(policy.allow),
  ]);
  const allowedPermissions = permissions.length > 0 ? permissions : capabilityNames;
  const boundaryMode = cleanText(policy.boundaryMode ?? policy.mode)
    || (memory.localOnly ? "local-only" : "external-reviewed");
  const defaultRole = cleanText(policy.defaultRole ?? policy.default)
    || roles[0]
    || "runtime-adapter";
  const tenantIsolation = policy.tenantIsolation !== false;
  const workspaceIsolation = policy.workspaceIsolation !== false;
  const audit = policy.audit && typeof policy.audit === "object" ? policy.audit : {};
  const auditRequired = audit.required !== false;
  const auditHandoff = cleanText(audit.handoff ?? audit.target)
    || `${requestContract.tenantId}:${requestContract.workspaceId}:audit`;
  const missingCapabilityPermissions = allowedPermissions.filter((permission) => {
    const normalized = permission.toLowerCase();
    return capabilityNames.length > 0
      && !capabilityNames.some((capability) => capability.toLowerCase() === normalized);
  });
  const scopeKey = `${requestContract.tenantId}:${requestContract.workspaceId}`;

  return {
    scopeKey,
    tenantId: requestContract.tenantId,
    workspaceId: requestContract.workspaceId,
    roles,
    defaultRole,
    permissions: allowedPermissions,
    capabilityPermissions: capabilityNames,
    boundaryMode,
    tenantIsolation,
    workspaceIsolation,
    localOnly: memory.localOnly,
    audit: {
      required: auditRequired,
      handoff: auditHandoff,
      evidence: cleanText(audit.evidence) || "runtime-receipt",
    },
    validation: {
      missingCapabilityPermissions,
      boundaryReady: memory.localOnly || boundaryMode !== "local-only",
      auditReady: !auditRequired || Boolean(auditHandoff),
      roleReady: roles.length > 0,
    },
  };
}

function normalizeClientState(state = {}, requestContract) {
  const visibleFields = stableUnique([
    ...asArray(state.visibleFields),
    ...asArray(state.visible),
  ]);
  const hiddenFields = stableUnique([
    ...asArray(state.hiddenFields),
    ...asArray(state.hidden),
  ]);
  const persistedKeys = stableUnique([
    ...asArray(state.persistedKeys),
    ...asArray(state.persist),
    requestContract.clientRequestId,
    requestContract.idempotencyKey,
  ]);

  return {
    statusLabel: cleanText(state.statusLabel) || requestContract.userVisibleStatus,
    handoffLabel: cleanText(state.handoffLabel) || `${requestContract.workflow}:${requestContract.channel}`,
    visibleFields,
    hiddenFields,
    persistedKeys,
    resumeCursor: cleanText(state.resumeCursor ?? state.cursor) || `${requestContract.idempotencyKey}:0`,
  };
}

function normalizePersistedCommand(command, index, requestContract) {
  const commandId = cleanText(command?.id) || `${requestContract.idempotencyKey}:command-${index + 1}`;
  const idempotencyKey = cleanText(command?.idempotencyKey ?? command?.idempotency) || commandId;
  const status = cleanText(command?.status) || "pending";
  const checkpoint = cleanText(command?.checkpoint ?? command?.checkpointKey) || `${requestContract.idempotencyKey}:checkpoint-${index + 1}`;

  return {
    id: commandId,
    name: cleanText(command?.name ?? command?.command) || "runtime.handoff",
    idempotencyKey,
    status,
    checkpoint,
    replayable: command?.replayable !== false,
    rollbackAction: cleanText(command?.rollbackAction ?? command?.rollback) || null,
  };
}

function normalizePersistedCheckpoint(checkpoint, index, requestContract) {
  if (typeof checkpoint === "string") {
    return {
      key: cleanText(checkpoint),
      status: "pending",
      required: true,
      commandId: null,
    };
  }
  return {
    key: cleanText(checkpoint?.key ?? checkpoint?.id) || `${requestContract.idempotencyKey}:checkpoint-${index + 1}`,
    status: cleanText(checkpoint?.status) || "pending",
    required: checkpoint?.required !== false,
    commandId: cleanText(checkpoint?.commandId ?? checkpoint?.command) || null,
  };
}

function buildRestartFingerprint(requestContract, commands, checkpoints) {
  return [
    requestContract.tenantId,
    requestContract.workspaceId,
    requestContract.idempotencyKey,
    commands.map((command) => command.idempotencyKey).join("|"),
    checkpoints.map((checkpoint) => checkpoint.key).join("|"),
  ].join(":");
}

function normalizePersistedState(state = {}, requestContract, recovery) {
  const snapshotKey = cleanText(state.snapshotKey ?? state.key) || `aios:${requestContract.tenantId}:${requestContract.workspaceId}:${requestContract.idempotencyKey}`;
  const restartToken = cleanText(state.restartToken ?? state.resumeToken) || `${snapshotKey}:restart`;
  const commands = asArray(state.commands ?? state.command).map((command, index) => normalizePersistedCommand(command, index, requestContract));
  const commandCheckpoints = commands.map((command) => ({
    key: command.checkpoint,
    status: command.status,
    required: true,
    commandId: command.id,
  }));
  const checkpoints = [
    ...asArray(state.checkpoints ?? state.checkpoint).map((checkpoint, index) => normalizePersistedCheckpoint(checkpoint, index, requestContract)),
    ...commandCheckpoints,
  ];
  const completedCheckpointCount = checkpoints.filter((checkpoint) => checkpoint.status === "completed" || checkpoint.status === "succeeded").length;
  const requiredCheckpointCount = checkpoints.filter((checkpoint) => checkpoint.required).length;
  const restartSafe = state.restartSafe !== false && commands.every((command) => command.idempotencyKey && command.replayable);

  return {
    snapshotKey,
    restartToken,
    resumeMode: cleanText(state.resumeMode) || "idempotent-replay",
    restartSafe,
    statusOnRestart: cleanText(state.statusOnRestart) || recovery.statusOnFailure,
    resumeCursor: cleanText(state.resumeCursor ?? state.cursor) || `${restartToken}:cursor:${completedCheckpointCount}`,
    restartFingerprint: cleanText(state.restartFingerprint) || buildRestartFingerprint(requestContract, commands, checkpoints),
    commands,
    checkpoints,
    ledger: {
      commandCount: commands.length,
      replayableCommandCount: commands.filter((command) => command.replayable).length,
      pendingCommandCount: commands.filter((command) => command.status === "pending").length,
      completedCheckpointCount,
      requiredCheckpointCount,
      restartReady: restartSafe && completedCheckpointCount >= requiredCheckpointCount,
    },
  };
}

function normalizeWorkflowHandoff(handoff = {}, requestContract, clientState) {
  return {
    title: cleanText(handoff.title) || clientState.handoffLabel,
    nextAction: cleanText(handoff.nextAction) || "await-runtime-receipt",
    userMessage: cleanText(handoff.userMessage ?? handoff.message) || `Request ${requestContract.clientRequestId} accepted for ${requestContract.workflow}.`,
    statusUrl: cleanText(handoff.statusUrl) || null,
  };
}

function buildStatusHandoff(job, input = {}) {
  const healthSummary = summarizeOperationalHealth(job.operationalHealth);
  const truthHandoff = createTruthBoundaryHandoff(job.truthBoundary, {
    id: `${job.id}:truth`,
    reviewer: job.accessPolicy.audit.required ? job.accessPolicy.audit.handoff : job.accessPolicy.defaultRole,
  });
  const requiredRuntimeReceipts = [
    "adapter-receipt",
    ...(job.accessPolicy.audit.required ? ["audit-handoff"] : []),
    ...(job.persistedState.commands.length > 0 ? ["command-ledger"] : []),
    ...(truthHandoff.reviewRequired ? ["truth-review"] : []),
  ];
  const readiness = {
    accessPolicyReady: job.accessPolicy.validation.missingCapabilityPermissions.length === 0
      && job.accessPolicy.validation.boundaryReady
      && job.accessPolicy.validation.auditReady,
    persistenceReady: job.persistedState.restartSafe,
    truthReady: truthHandoff.exportReady,
    healthReady: healthSummary.status !== "failed",
  };
  const status = Object.values(readiness).every(Boolean) ? "ready" : "needs-review";

  return {
    handoffKind: "aios.compile.status-handoff.v1",
    handoffId: cleanText(input.handoffId ?? input.id) || `${job.requestContract.idempotencyKey}:${job.id}:status`,
    jobId: job.id,
    jobName: job.name,
    expectedAdapter: job.adapter,
    action: job.action,
    status,
    statusOnFailure: job.recovery.statusOnFailure,
    tenantId: job.requestContract.tenantId,
    workspaceId: job.requestContract.workspaceId,
    scopeKey: job.accessPolicy.scopeKey,
    clientRequestId: job.requestContract.clientRequestId,
    idempotencyKey: job.requestContract.idempotencyKey,
    workflow: job.requestContract.workflow,
    userVisibleStatus: job.requestContract.userVisibleStatus,
    resumeCursor: job.persistedState.resumeCursor,
    restartToken: job.persistedState.restartToken,
    restartFingerprint: job.persistedState.restartFingerprint,
    boundaryMode: job.accessPolicy.boundaryMode,
    localOnly: job.accessPolicy.localOnly,
    auditRequired: job.accessPolicy.audit.required,
    auditTarget: job.accessPolicy.audit.handoff,
    requiredRole: job.accessPolicy.defaultRole,
    requiredPermissions: job.accessPolicy.permissions,
    capabilityManifest: job.capabilities.map((capability) => capability.name),
    requiredRuntimeReceipts,
    readiness,
    truth: {
      status: truthHandoff.status,
      reviewRequired: truthHandoff.reviewRequired,
      debt: truthHandoff.summary.truthDebt,
      evidenceCount: truthHandoff.evidence.length,
    },
    health: healthSummary,
  };
}

function commandRestartState(command) {
  if (command.status === "succeeded" || command.status === "completed") return "already-applied";
  if (command.status === "failed") return command.replayable ? "retryable-failure" : "operator-required";
  if (command.replayable) return "replayable";
  return "operator-required";
}

function checkpointRestartState(checkpoint) {
  if (checkpoint.status === "succeeded" || checkpoint.status === "completed") return "closed";
  if (checkpoint.status === "failed") return checkpoint.required ? "blocked" : "optional-failed";
  return checkpoint.required ? "open-required" : "open-optional";
}

function permissionCoverageState(job) {
  const capabilitySet = new Set(job.capabilities.map((capability) => capability.name.toLowerCase()));
  const permissionSet = new Set(job.accessPolicy.permissions.map((permission) => permission.toLowerCase()));
  const capabilityPermissions = job.capabilities.map((capability) => ({
    capability: capability.name,
    permission: capability.name,
    covered: permissionSet.has(capability.name.toLowerCase()),
    mode: capability.mode,
    target: capability.target,
  }));
  const extraPermissions = job.accessPolicy.permissions
    .filter((permission) => !capabilitySet.has(permission.toLowerCase()));
  const missingCapabilityPermissions = capabilityPermissions
    .filter((entry) => !entry.covered)
    .map((entry) => entry.permission);

  return {
    capabilityPermissions,
    extraPermissions,
    missingCapabilityPermissions,
    complete: extraPermissions.length === 0 && missingCapabilityPermissions.length === 0,
  };
}

function deriveBoundaryDecision(job, permissionCoverage) {
  if (job.accessPolicy.tenantIsolation && !job.requestContract.tenantId) {
    return { state: "blocked", reason: "tenant-required", nextAction: "operator-review" };
  }
  if (job.accessPolicy.workspaceIsolation && !job.requestContract.workspaceId) {
    return { state: "blocked", reason: "workspace-required", nextAction: "operator-review" };
  }
  if (!job.accessPolicy.validation.boundaryReady) {
    return { state: "blocked", reason: "local-boundary-conflict", nextAction: "operator-review" };
  }
  if (!permissionCoverage.complete) {
    return { state: "blocked", reason: "permission-capability-mismatch", nextAction: "operator-review" };
  }
  if (job.accessPolicy.audit.required && !job.accessPolicy.validation.auditReady) {
    return { state: "blocked", reason: "audit-handoff-missing", nextAction: "operator-review" };
  }
  if (job.statusHandoff.status === "needs-review") {
    return { state: "review", reason: "status-handoff-review", nextAction: "audit-review" };
  }
  if (!job.accessPolicy.localOnly || job.accessPolicy.boundaryMode !== "local-only") {
    return { state: "review", reason: "external-boundary-review", nextAction: "audit-review" };
  }
  return { state: "allowed", reason: "local-scope-authorized", nextAction: "runtime-handoff" };
}

export function createPermissionBoundaryManifest(job) {
  const permissionCoverage = permissionCoverageState(job);
  const decision = deriveBoundaryDecision(job, permissionCoverage);
  const auditReceipts = job.statusHandoff.requiredRuntimeReceipts.filter((receipt) => (
    receipt === "audit-handoff" || receipt === "adapter-receipt"
  ));

  return {
    manifestKind: "aios.compile.permission-boundary-manifest.v1",
    manifestId: `${job.accessPolicy.scopeKey}:${job.id}:${job.requestContract.idempotencyKey}:permission-boundary`,
    jobId: job.id,
    tenantId: job.requestContract.tenantId,
    workspaceId: job.requestContract.workspaceId,
    scopeKey: job.accessPolicy.scopeKey,
    defaultRole: job.accessPolicy.defaultRole,
    allowedRoles: job.accessPolicy.roles,
    requiredPermissions: job.accessPolicy.permissions,
    capabilityManifest: job.capabilities.map((capability) => capability.name),
    permissionCoverage,
    isolation: {
      tenant: job.accessPolicy.tenantIsolation,
      workspace: job.accessPolicy.workspaceIsolation,
      localOnly: job.accessPolicy.localOnly,
      boundaryMode: job.accessPolicy.boundaryMode,
    },
    audit: {
      required: job.accessPolicy.audit.required,
      target: job.accessPolicy.audit.handoff,
      evidence: job.accessPolicy.audit.evidence,
      requiredReceipts: auditReceipts,
    },
    decision,
    readyForRuntime: decision.state === "allowed" || decision.state === "review",
  };
}

export function createScopeAuditManifest(job) {
  const commandLedger = job.persistedState.commands.map((command, index) => ({
    sequence: index + 1,
    commandId: command.id,
    name: command.name,
    idempotencyKey: command.idempotencyKey,
    checkpoint: command.checkpoint,
    expectedStatus: command.status,
    restartState: commandRestartState(command),
    replayable: command.replayable,
    rollbackAction: command.rollbackAction,
  }));
  const checkpointLedger = job.persistedState.checkpoints.map((checkpoint, index) => ({
    sequence: index + 1,
    key: checkpoint.key,
    commandId: checkpoint.commandId,
    required: checkpoint.required,
    expectedStatus: checkpoint.status,
    restartState: checkpointRestartState(checkpoint),
  }));
  const commandKeys = stableUnique(commandLedger.map((command) => command.idempotencyKey));
  const checkpointKeys = stableUnique(checkpointLedger.map((checkpoint) => checkpoint.key));
  const blockedCommands = commandLedger.filter((command) => command.restartState === "operator-required");
  const openRequiredCheckpoints = checkpointLedger.filter((checkpoint) => checkpoint.restartState === "open-required" || checkpoint.restartState === "blocked");
  const replayableCommands = commandLedger.filter((command) => command.restartState === "replayable" || command.restartState === "retryable-failure");
  const receiptPlan = job.statusHandoff.requiredRuntimeReceipts.map((receipt) => ({
    receipt,
    required: true,
    auditTarget: receipt === "audit-handoff" ? job.accessPolicy.audit.handoff : null,
  }));
  const restartDecision = blockedCommands.length > 0
    ? "operator-review"
    : replayableCommands.length > 0
      ? "replay"
      : openRequiredCheckpoints.length > 0
        ? "wait-for-checkpoint"
        : "resume-status";

  return {
    manifestKind: "aios.compile.scope-audit-manifest.v1",
    manifestId: `${job.accessPolicy.scopeKey}:${job.id}:${job.requestContract.idempotencyKey}`,
    jobId: job.id,
    tenantId: job.requestContract.tenantId,
    workspaceId: job.requestContract.workspaceId,
    scopeKey: job.accessPolicy.scopeKey,
    idempotencyKey: job.requestContract.idempotencyKey,
    clientRequestId: job.requestContract.clientRequestId,
    restartToken: job.persistedState.restartToken,
    resumeCursor: job.persistedState.resumeCursor,
    restartFingerprint: job.persistedState.restartFingerprint,
    statusOnRestart: job.persistedState.statusOnRestart,
    statusOnFailure: job.recovery.statusOnFailure,
    boundaryMode: job.accessPolicy.boundaryMode,
    localOnly: job.accessPolicy.localOnly,
    requiredRole: job.accessPolicy.defaultRole,
    requiredPermissions: job.accessPolicy.permissions,
    capabilityManifest: job.capabilities.map((capability) => capability.name),
    audit: {
      required: job.accessPolicy.audit.required,
      target: job.accessPolicy.audit.handoff,
      evidence: job.accessPolicy.audit.evidence,
    },
    commands: commandLedger,
    checkpoints: checkpointLedger,
    requiredRuntimeReceipts: receiptPlan,
    restartDecision,
    counters: {
      commandCount: commandLedger.length,
      replayableCommandCount: replayableCommands.length,
      blockedCommandCount: blockedCommands.length,
      checkpointCount: checkpointLedger.length,
      openRequiredCheckpointCount: openRequiredCheckpoints.length,
      requiredReceiptCount: receiptPlan.length,
      uniqueIdempotencyKeyCount: commandKeys.length,
      uniqueCheckpointKeyCount: checkpointKeys.length,
    },
    readyForRuntime: blockedCommands.length === 0
      && job.accessPolicy.validation.missingCapabilityPermissions.length === 0
      && job.persistedState.restartSafe,
  };
}

export function normalizeKernelJobDescriptor(job, index = 0) {
  const name = cleanText(job?.name) || `job-${index + 1}`;
  const adapter = cleanText(job?.adapter) || "local";
  const action = cleanText(job?.action ?? job?.op ?? job?.operation) || "run";
  const capabilities = asArray(job?.capabilities ?? job?.capability).map(normalizeCapability);
  const memory = normalizeMemoryContract(job?.memory);
  const verifierContracts = normalizeVerifierContracts(job?.verifierContracts ?? job?.verifiers);
  const truthBoundary = normalizeTruthBoundary(job?.truthBoundary);
  const rollback = {
    mode: cleanText(job?.rollback?.mode) || "compensating-action",
    action: cleanText(job?.rollback?.action) || `rollback:${name}`,
    required: job?.rollback?.required !== false,
  };

  const id = cleanText(job?.id) || `kernel-job-${index + 1}`;
  const recovery = {
    retryLimit: Number.isFinite(job?.recovery?.retryLimit) ? Math.max(0, Math.trunc(job.recovery.retryLimit)) : 0,
    statusOnFailure: cleanText(job?.recovery?.statusOnFailure) || "needs-operator",
  };
  const requestContract = normalizeRequestContract(job?.requestContract ?? job?.request, id);
  const accessPolicy = normalizeAccessPolicy(job?.accessPolicy ?? job?.policy, requestContract, capabilities, memory);
  const clientState = normalizeClientState(job?.clientState, requestContract);
  const persistedState = normalizePersistedState(job?.persistedState, requestContract, recovery);
  const workflowHandoff = normalizeWorkflowHandoff(job?.workflowHandoff ?? job?.handoff, requestContract, clientState);
  const operationalHealth = normalizeOperationalHealth(job?.operationalHealth ?? job?.health);
  const descriptor = {
    id,
    name,
    adapter,
    action,
    params: job?.params && typeof job.params === "object" ? { ...job.params } : {},
    capabilities,
    memory,
    verifierContracts,
    truthBoundary,
    rollback,
    recovery,
    requestContract,
    accessPolicy,
    clientState,
    persistedState,
    workflowHandoff,
    operationalHealth,
  };

  return {
    ...descriptor,
    statusHandoff: buildStatusHandoff(descriptor, job?.statusHandoff),
  };
}

function attachScopeAuditManifest(job) {
  const scopeAuditManifest = createScopeAuditManifest(job);
  const permissionBoundaryManifest = createPermissionBoundaryManifest(job);
  return {
    ...job,
    permissionBoundaryManifest,
    scopeAuditManifest,
    statusHandoff: {
      ...job.statusHandoff,
      permissionBoundaryManifest: {
        manifestId: permissionBoundaryManifest.manifestId,
        decisionState: permissionBoundaryManifest.decision.state,
        decisionReason: permissionBoundaryManifest.decision.reason,
        nextAction: permissionBoundaryManifest.decision.nextAction,
        readyForRuntime: permissionBoundaryManifest.readyForRuntime,
      },
      scopeAuditManifest: {
        manifestId: scopeAuditManifest.manifestId,
        restartDecision: scopeAuditManifest.restartDecision,
        readyForRuntime: scopeAuditManifest.readyForRuntime,
        commandCount: scopeAuditManifest.counters.commandCount,
        openRequiredCheckpointCount: scopeAuditManifest.counters.openRequiredCheckpointCount,
        requiredReceiptCount: scopeAuditManifest.counters.requiredReceiptCount,
      },
    },
  };
}

export function validateKernelJobDescriptor(job, path = "$.jobs[0]") {
  const diagnostics = [];
  if (!job.name) diagnostics.push(diagnostic("error", "AIOS_JOB_NAME_REQUIRED", "Kernel job requires a stable name.", `${path}.name`));
  if (!job.adapter) diagnostics.push(diagnostic("error", "AIOS_ADAPTER_REQUIRED", "Kernel job requires a runtime adapter.", `${path}.adapter`));
  if (!job.action) diagnostics.push(diagnostic("error", "AIOS_ACTION_REQUIRED", "Kernel job requires an action.", `${path}.action`));

  job.capabilities.forEach((capability, index) => {
    if (!capability.name) {
      diagnostics.push(diagnostic("error", "AIOS_CAPABILITY_NAME_REQUIRED", "Capability entries require a name.", `${path}.capabilities[${index}].name`));
    } else if (!CAPABILITY_PATTERN.test(capability.name)) {
      diagnostics.push(diagnostic("warning", "AIOS_CAPABILITY_FORMAT", `Capability "${capability.name}" is not in namespaced AI OS form.`, `${path}.capabilities[${index}].name`));
    }
  });

  if (!job.memory.localOnly) {
    diagnostics.push(diagnostic("error", "AIOS_EXTERNAL_MEMORY_WRITE_BLOCKED", "Compiler refuses non-local memory writes in this surface.", `${path}.memory.localOnly`));
  }

  if (job.truthBoundary.truthDebt > 0 && job.verifierContracts.length === 0) {
    diagnostics.push(diagnostic("warning", "AIOS_TRUTH_WITHOUT_VERIFIER", "Truth debt exists without a verifier contract.", `${path}.truthBoundary`));
  }
  if (!job.requestContract.idempotencyKey) {
    diagnostics.push(diagnostic("error", "AIOS_IDEMPOTENCY_REQUIRED", "Kernel job requires an idempotency key for restart-safe handoff.", `${path}.requestContract.idempotencyKey`));
  }
  if (!job.persistedState.restartSafe) {
    diagnostics.push(diagnostic("warning", "AIOS_RESTART_UNSAFE", "Persisted state is marked restart-unsafe; runtime status may require operator review after restart.", `${path}.persistedState.restartSafe`));
  }
  const commandKeys = new Set();
  job.persistedState.commands.forEach((command, index) => {
    const key = command.idempotencyKey.toLowerCase();
    if (commandKeys.has(key)) {
      diagnostics.push(diagnostic("error", "AIOS_DUPLICATE_COMMAND_IDEMPOTENCY", "Persisted commands must have unique idempotency keys for restart-safe replay.", `${path}.persistedState.commands[${index}].idempotencyKey`));
    }
    commandKeys.add(key);
    if (!command.replayable) {
      diagnostics.push(diagnostic("warning", "AIOS_COMMAND_NOT_REPLAYABLE", `Persisted command "${command.name}" is not replayable; restart recovery may require operator review.`, `${path}.persistedState.commands[${index}].replayable`));
    }
  });
  const checkpointKeys = new Set();
  job.persistedState.checkpoints.forEach((checkpoint, index) => {
    const key = checkpoint.key.toLowerCase();
    if (checkpointKeys.has(key)) return;
    checkpointKeys.add(key);
    if (checkpoint.required && checkpoint.status === "failed") {
      diagnostics.push(diagnostic("error", "AIOS_REQUIRED_CHECKPOINT_FAILED", "Required persisted checkpoint is already failed.", `${path}.persistedState.checkpoints[${index}].status`));
    }
  });
  if (job.requestContract.tenantId !== "local" && job.memory.scopes.length === 0) {
    diagnostics.push(diagnostic("warning", "AIOS_TENANT_SCOPE_UNDECLARED", "Tenant-scoped requests should declare a memory scope.", `${path}.memory.scopes`));
  }
  if (job.accessPolicy.validation.missingCapabilityPermissions.length > 0) {
    diagnostics.push(diagnostic(
      "error",
      "AIOS_PERMISSION_NOT_BACKED_BY_CAPABILITY",
      `Access policy permission(s) are not backed by compiled capabilities: ${job.accessPolicy.validation.missingCapabilityPermissions.join(", ")}.`,
      `${path}.accessPolicy.permissions`,
    ));
  }
  if (!job.accessPolicy.validation.boundaryReady) {
    diagnostics.push(diagnostic(
      "error",
      "AIOS_LOCAL_BOUNDARY_CONFLICT",
      "Access policy declares local-only execution while memory allows external behavior.",
      `${path}.accessPolicy.boundaryMode`,
    ));
  }
  if (!job.accessPolicy.validation.roleReady) {
    diagnostics.push(diagnostic(
      "warning",
      "AIOS_ROLE_POLICY_DEFAULTED",
      "Access policy did not declare an explicit role; runtime will use the adapter role.",
      `${path}.accessPolicy.roles`,
    ));
  }
  if (job.accessPolicy.audit.required && !job.accessPolicy.validation.auditReady) {
    diagnostics.push(diagnostic(
      "error",
      "AIOS_AUDIT_HANDOFF_REQUIRED",
      "Access policy requires an audit handoff target for runtime receipts.",
      `${path}.accessPolicy.audit.handoff`,
    ));
  }
  if (job.statusHandoff.status === "needs-review") {
    diagnostics.push(diagnostic(
      "warning",
      "AIOS_STATUS_HANDOFF_NEEDS_REVIEW",
      "Compiled status handoff is not fully ready for unattended runtime execution.",
      `${path}.statusHandoff`,
    ));
  }
  if (job.statusHandoff.requiredRuntimeReceipts.includes("truth-review") && job.verifierContracts.length === 0) {
    diagnostics.push(diagnostic(
      "warning",
      "AIOS_TRUTH_REVIEW_WITHOUT_VERIFIER",
      "Status handoff requires truth review but no verifier contract was compiled.",
      `${path}.statusHandoff.requiredRuntimeReceipts`,
    ));
  }
  if (!job.scopeAuditManifest.readyForRuntime) {
    diagnostics.push(diagnostic(
      "warning",
      "AIOS_SCOPE_AUDIT_MANIFEST_NOT_READY",
      "Scope audit manifest requires runtime review before automatic replay.",
      `${path}.scopeAuditManifest`,
    ));
  }
  if (job.scopeAuditManifest.counters.uniqueIdempotencyKeyCount !== job.scopeAuditManifest.counters.commandCount) {
    diagnostics.push(diagnostic(
      "error",
      "AIOS_SCOPE_AUDIT_DUPLICATE_COMMAND_KEYS",
      "Scope audit manifest detected duplicate command idempotency keys.",
      `${path}.scopeAuditManifest.commands`,
    ));
  }
  if (job.permissionBoundaryManifest.decision.state === "blocked") {
    diagnostics.push(diagnostic(
      "error",
      "AIOS_PERMISSION_BOUNDARY_BLOCKED",
      `Permission boundary blocked runtime handoff: ${job.permissionBoundaryManifest.decision.reason}.`,
      `${path}.permissionBoundaryManifest.decision`,
    ));
  } else if (job.permissionBoundaryManifest.decision.state === "review") {
    diagnostics.push(diagnostic(
      "warning",
      "AIOS_PERMISSION_BOUNDARY_REVIEW",
      `Permission boundary requires audit review: ${job.permissionBoundaryManifest.decision.reason}.`,
      `${path}.permissionBoundaryManifest.decision`,
    ));
  }
  if (job.permissionBoundaryManifest.permissionCoverage.missingCapabilityPermissions.length > 0) {
    diagnostics.push(diagnostic(
      "error",
      "AIOS_PERMISSION_BOUNDARY_CAPABILITY_MISSING",
      `Permission boundary is missing capability permissions: ${job.permissionBoundaryManifest.permissionCoverage.missingCapabilityPermissions.join(", ")}.`,
      `${path}.permissionBoundaryManifest.permissionCoverage`,
    ));
  }

  return diagnostics;
}

export function createCompileResult(input = {}) {
  const jobs = asArray(input.jobs ?? input.jobDescriptors ?? input.kernelJobs)
    .map(normalizeKernelJobDescriptor)
    .map(attachScopeAuditManifest);
  const diagnostics = [
    ...asArray(input.diagnostics),
    ...jobs.flatMap((job, index) => validateKernelJobDescriptor(job, `$.jobs[${index}]`)),
  ];
  if (jobs.length === 0) diagnostics.push(diagnostic("error", "AIOS_NO_JOBS", "Source did not lower into any kernel job descriptors.", "$.jobs"));

  const boundary = mergeTruthBoundaries(input.truthBoundary, ...jobs.map((job) => job.truthBoundary));
  const hasErrors = diagnostics.some((entry) => entry.severity === "error");
  const explicitStatus = COMPILE_STATUSES.has(input.status) ? input.status : null;
  const status = explicitStatus ?? (hasErrors ? "blocked" : diagnostics.length ? "partial" : "compiled");

  return {
    ok: status === "compiled" || status === "partial",
    status,
    target: cleanText(input.target) || "aios-kernel/job-descriptor.v1",
    sourceHash: cleanText(input.sourceHash) || null,
    ast: input.ast ?? null,
    jobs,
    diagnostics,
    capabilityManifest: stableUnique(jobs.flatMap((job) => job.capabilities.map((capability) => capability.name))),
    memoryContract: {
      reads: stableUnique(jobs.flatMap((job) => job.memory.reads)),
      writes: stableUnique(jobs.flatMap((job) => job.memory.writes)),
      scopes: stableUnique(jobs.flatMap((job) => job.memory.scopes)),
      localOnly: jobs.every((job) => job.memory.localOnly),
    },
    verifierContracts: jobs.flatMap((job) => job.verifierContracts),
    truthBoundary: boundary,
    truthSummary: summarizeTruthBoundary(boundary),
    truthReport: exportTruthBoundaryReport(boundary, { id: cleanText(input.sourceHash) || "compile-result" }),
    requestContracts: jobs.map((job) => job.requestContract),
    accessPolicies: jobs.map((job) => ({ jobId: job.id, ...job.accessPolicy })),
    boundaryScopes: jobs.map((job) => ({
      jobId: job.id,
      scopeKey: job.accessPolicy.scopeKey,
      tenantId: job.accessPolicy.tenantId,
      workspaceId: job.accessPolicy.workspaceId,
      boundaryMode: job.accessPolicy.boundaryMode,
      tenantIsolation: job.accessPolicy.tenantIsolation,
      workspaceIsolation: job.accessPolicy.workspaceIsolation,
      localOnly: job.accessPolicy.localOnly,
    })),
    clientState: {
      jobs: jobs.map((job) => ({ jobId: job.id, ...job.clientState })),
    },
    persistedState: {
      restartSafe: jobs.every((job) => job.persistedState.restartSafe),
      restartReady: jobs.every((job) => job.persistedState.ledger.restartReady),
      commandCount: jobs.reduce((total, job) => total + job.persistedState.ledger.commandCount, 0),
      pendingCommandCount: jobs.reduce((total, job) => total + job.persistedState.ledger.pendingCommandCount, 0),
      checkpoints: jobs.flatMap((job) => job.persistedState.checkpoints.map((checkpoint) => ({ jobId: job.id, ...checkpoint }))),
      snapshots: jobs.map((job) => ({ jobId: job.id, ...job.persistedState })),
    },
    workflowHandoffs: jobs.map((job) => ({ jobId: job.id, ...job.workflowHandoff })),
    statusHandoffs: jobs.map((job) => job.statusHandoff),
    auditHandoffPlan: jobs.map((job) => ({
      jobId: job.id,
      auditId: `${job.accessPolicy.scopeKey}:${job.requestContract.idempotencyKey}`,
      target: job.accessPolicy.audit.handoff,
      required: job.accessPolicy.audit.required,
      evidence: job.accessPolicy.audit.evidence,
      role: job.accessPolicy.defaultRole,
      permissionCount: job.accessPolicy.permissions.length,
    })),
    permissionBoundaryManifests: jobs.map((job) => job.permissionBoundaryManifest),
    permissionBoundarySummary: {
      allowedJobCount: jobs.filter((job) => job.permissionBoundaryManifest.decision.state === "allowed").length,
      reviewJobCount: jobs.filter((job) => job.permissionBoundaryManifest.decision.state === "review").length,
      blockedJobCount: jobs.filter((job) => job.permissionBoundaryManifest.decision.state === "blocked").length,
      tenantScopedJobCount: jobs.filter((job) => job.accessPolicy.tenantIsolation).length,
      workspaceScopedJobCount: jobs.filter((job) => job.accessPolicy.workspaceIsolation).length,
      localOnlyJobCount: jobs.filter((job) => job.accessPolicy.localOnly).length,
      decisions: jobs.map((job) => ({
        jobId: job.id,
        manifestId: job.permissionBoundaryManifest.manifestId,
        state: job.permissionBoundaryManifest.decision.state,
        reason: job.permissionBoundaryManifest.decision.reason,
        nextAction: job.permissionBoundaryManifest.decision.nextAction,
        scopeKey: job.permissionBoundaryManifest.scopeKey,
      })),
    },
    scopeAuditManifests: jobs.map((job) => job.scopeAuditManifest),
    restartAuditSummary: {
      readyForRuntime: jobs.every((job) => job.scopeAuditManifest.readyForRuntime),
      replayJobCount: jobs.filter((job) => job.scopeAuditManifest.restartDecision === "replay").length,
      operatorReviewJobCount: jobs.filter((job) => job.scopeAuditManifest.restartDecision === "operator-review").length,
      openRequiredCheckpointCount: jobs.reduce((total, job) => total + job.scopeAuditManifest.counters.openRequiredCheckpointCount, 0),
      requiredRuntimeReceiptCount: jobs.reduce((total, job) => total + job.scopeAuditManifest.counters.requiredReceiptCount, 0),
      manifests: jobs.map((job) => ({
        jobId: job.id,
        manifestId: job.scopeAuditManifest.manifestId,
        restartDecision: job.scopeAuditManifest.restartDecision,
        readyForRuntime: job.scopeAuditManifest.readyForRuntime,
      })),
    },
    operationalHealth: {
      jobs: jobs.map((job) => ({ jobId: job.id, ...job.operationalHealth })),
      summaries: jobs.map((job) => ({ jobId: job.id, ...summarizeOperationalHealth(job.operationalHealth) })),
    },
    recoveryPlan: jobs.map((job) => ({ jobId: job.id, rollback: job.rollback, recovery: job.recovery })),
  };
}

export { COMPILE_STATUSES };
