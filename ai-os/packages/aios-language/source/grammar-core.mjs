import { parse } from "./parser.mjs";
import { analyzePermissionBoundary, boundaryRisk, createAuditScope, createDiagnostic } from "./tokens.mjs";

const MAILCHIMP_MUTATING_OPERATIONS = new Set(["syncAudience", "upsertCampaign", "createCampaign", "scheduleCampaign"]);
const MAILCHIMP_READ_OPERATIONS = new Set(["fetchAudience", "syncAudience"]);

function literalToPlain(value) {
  if (!value || typeof value !== "object") {
    return value ?? null;
  }

  if (value.type === "ArrayExpression") {
    return Object.freeze(Array.from(value.entries ?? []).map(literalToPlain));
  }

  if (value.type === "ObjectExpression") {
    return Object.freeze(Object.fromEntries(Array.from(value.entries ?? []).map((entry) => [
      entry.key,
      literalToPlain(entry.value),
    ])));
  }

  return value.value ?? null;
}

function operationFromAdapter(adapter) {
  const parts = String(adapter || "").split(".");
  return parts.length > 1 ? parts.slice(1).join(".") : parts[0] || "run";
}

function providerFromAdapter(adapter) {
  return String(adapter || "").split(".")[0] || "runtime";
}

function clauseValues(job, type) {
  return Array.from(job?.clauses ?? []).filter((clause) => clause.type === type);
}

function firstClause(job, type) {
  return clauseValues(job, type)[0] ?? null;
}

function requiredMailchimpPermissions(adapter) {
  const operation = operationFromAdapter(adapter);
  const permissions = [];

  if (MAILCHIMP_READ_OPERATIONS.has(operation)) {
    permissions.push("mailchimp.read");
  }

  if (MAILCHIMP_MUTATING_OPERATIONS.has(operation)) {
    permissions.push("mailchimp.write");
  }

  return Object.freeze(permissions);
}

function stableStatePart(value) {
  return String(value ?? "none")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "none";
}

function stableContractId(...parts) {
  return parts.map(stableStatePart).join(":");
}

function deterministicStateShape(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(deterministicStateShape));
  }

  if (!value || typeof value !== "object") {
    return value ?? null;
  }

  return Object.freeze(Object.fromEntries(Object.keys(value)
    .sort()
    .map((key) => [key, deterministicStateShape(value[key])])));
}

function normalizeRolePermissions(roleClause) {
  return Object.freeze(Array.from(roleClause?.permissions?.entries ?? [])
    .map((entry) => literalToPlain(entry))
    .filter(Boolean));
}

function unsafeScopeValue(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" || text.includes("*") || text.includes("..");
}

function createTenantPermissionBoundaryContract(job, handoff, capabilityContracts, status) {
  const roleClause = firstClause(job, "RoleClause");
  const workspace = firstClause(job, "WorkspaceClause")?.workspace ?? null;
  const tenant = firstClause(job, "TenantClause")?.tenant ?? null;
  const role = roleClause?.role ?? null;
  const granted = normalizeRolePermissions(roleClause);
  const grantedSet = new Set(granted);
  const required = handoff.requiredPermissions;
  const missingPermissions = Object.freeze(required.filter((permission) => !grantedSet.has(permission)));
  const capabilityFailures = Object.freeze(capabilityContracts
    .filter((capability) => capability.permissionBoundary.ok === false)
    .map((capability) => Object.freeze({
      capability: capability.name,
      missing: capability.permissionBoundary.missing,
      risk: capability.permissionBoundary.risk,
    })));
  const scopeChecks = Object.freeze({
    workspace: Object.freeze({
      value: workspace,
      ok: !unsafeScopeValue(workspace),
      status: workspace ? unsafeScopeValue(workspace) ? "unsafe" : "scoped" : "missing",
      nextAction: workspace ? unsafeScopeValue(workspace) ? "narrow-workspace" : "continue" : "declare-workspace",
    }),
    tenant: Object.freeze({
      value: tenant,
      ok: !unsafeScopeValue(tenant),
      status: tenant ? unsafeScopeValue(tenant) ? "unsafe" : "scoped" : "missing",
      nextAction: tenant ? unsafeScopeValue(tenant) ? "narrow-tenant" : "continue" : "declare-tenant",
    }),
    role: Object.freeze({
      value: role,
      ok: !unsafeScopeValue(role),
      status: role ? unsafeScopeValue(role) ? "unsafe" : "scoped" : "missing",
      nextAction: role ? unsafeScopeValue(role) ? "narrow-role" : "continue" : "declare-role",
    }),
  });
  const scopeOk = Object.values(scopeChecks).every((check) => check.ok);
  const auditRequired = handoff.mailchimp || missingPermissions.length > 0 || capabilityFailures.length > 0 || !scopeOk;
  const auditReady = Boolean(status.auditChannel || status.channel);
  const isolationKey = stableContractId("tenant-boundary", workspace, tenant, role, handoff.provider, handoff.operation);
  const allowed = scopeOk && missingPermissions.length === 0 && capabilityFailures.length === 0 && (!auditRequired || auditReady);

  return Object.freeze({
    schema: "aios.kernel.tenant-permission-boundary.v1",
    isolationKey,
    scope: Object.freeze({ workspace, tenant, role }),
    provider: handoff.provider,
    operation: handoff.operation,
    mutatesProvider: handoff.mutatesProvider,
    requiredPermissions: required,
    grantedPermissions: granted,
    missingPermissions,
    capabilityFailures,
    scopeChecks,
    audit: Object.freeze({
      required: auditRequired,
      channel: status.auditChannel ?? status.channel,
      status: auditRequired
        ? auditReady ? "audit-ready" : "audit-channel-missing"
        : "audit-optional",
    }),
    allowed,
    status: allowed
      ? "handoff-allowed"
      : !scopeOk
        ? "scope-review"
        : missingPermissions.length > 0 || capabilityFailures.length > 0
          ? "permission-review"
          : "audit-review",
    nextAction: allowed
      ? "handoff-adapter"
      : !scopeChecks.workspace.ok
        ? scopeChecks.workspace.nextAction
        : !scopeChecks.tenant.ok
          ? scopeChecks.tenant.nextAction
          : !scopeChecks.role.ok
            ? scopeChecks.role.nextAction
            : missingPermissions.length > 0 || capabilityFailures.length > 0
              ? "align-role-permissions"
              : "declare-audit-channel",
  });
}

function createMemoryContracts(job) {
  return Object.freeze(clauseValues(job, "MemoryClause").map((clause) => Object.freeze({
    schema: "aios.kernel.memory.contract.v1",
    name: clause.name,
    alias: clause.alias ?? clause.name,
    restartCheckpoint: clause.alias === "ledger" || String(clause.name).includes("ledger"),
  })));
}

function createCapabilityContracts(job, roleClause) {
  const declaredPermissions = normalizeRolePermissions(roleClause);

  return Object.freeze(clauseValues(job, "CapabilityClause").map((clause) => {
    const required = clause.name?.startsWith("mailchimp")
      ? [`${clause.name.split(".")[0]}.${clause.scope ?? "access"}`]
      : [clause.name].filter(Boolean);
    const permissionBoundary = analyzePermissionBoundary(required, declaredPermissions, {
      expectedPrefix: clause.name?.split(".")[0] ?? null,
      position: job.location ?? { line: 1, column: 1, offset: 0 },
    });

    return Object.freeze({
      schema: "aios.kernel.capability.contract.v1",
      name: clause.name,
      scope: clause.scope ?? null,
      provider: clause.name?.split(".")[0] ?? "runtime",
      permissionBoundary,
    });
  }));
}

function createVerifierContracts(job) {
  return Object.freeze(clauseValues(job, "VerifyClause").map((clause) => Object.freeze({
    schema: "aios.kernel.verifier.contract.v1",
    boundary: clause.boundary,
    minConfidence: clause.minConfidence ?? null,
    status: clause.boundary ? "declared" : "missing-boundary",
  })));
}

function createStatusContract(job) {
  const status = firstClause(job, "StatusClause");
  const audit = firstClause(job, "AuditClause");
  const degraded = firstClause(job, "DegradedClause");

  return Object.freeze({
    schema: "aios.kernel.status.contract.v1",
    channel: status?.channel ?? null,
    auditChannel: audit?.channel ?? null,
    degradedStatus: degraded?.status ?? null,
    observable: Boolean(status?.channel || audit?.channel),
    nextAction: status?.channel || audit?.channel ? "emit-runtime-status" : "declare-status-channel",
  });
}

function statusChannelsForClient(status) {
  return Object.freeze([
    status?.channel ? Object.freeze({ kind: "status", channel: status.channel }) : null,
    status?.auditChannel ? Object.freeze({ kind: "audit", channel: status.auditChannel }) : null,
    status?.degradedStatus ? Object.freeze({ kind: "degraded", channel: status.degradedStatus }) : null,
  ].filter(Boolean));
}

function createRecoveryContract(job, handoff) {
  const retry = firstClause(job, "RetryClause");
  const recover = firstClause(job, "RecoverClause");
  const rollback = firstClause(job, "RollbackClause");
  const idempotency = firstClause(job, "IdempotencyClause");
  const mutating = handoff?.mutatesProvider === true;
  const restartSafe = !mutating || Boolean(recover?.checkpoint || idempotency?.key);

  return Object.freeze({
    schema: "aios.kernel.recovery.contract.v1",
    retry: Object.freeze({
      maxAttempts: retry?.maxAttempts ?? 0,
      backoff: retry?.backoff ?? "none",
    }),
    recoverFrom: recover?.checkpoint ?? null,
    rollbackTarget: rollback?.target ?? null,
    idempotencyKey: idempotency?.key ?? null,
    restartSafe,
    status: restartSafe ? "restart-safe" : "needs-idempotency-or-checkpoint",
    nextAction: restartSafe ? "handoff-adapter" : "declare-recovery-contract",
  });
}

function createPersistedStateContract(job, handoff, recovery, status) {
  const workspace = firstClause(job, "WorkspaceClause")?.workspace ?? null;
  const tenant = firstClause(job, "TenantClause")?.tenant ?? null;
  const role = firstClause(job, "RoleClause")?.role ?? null;
  const memoryContracts = createMemoryContracts(job);
  const checkpointMemory = memoryContracts.find((memory) => memory.restartCheckpoint) ?? memoryContracts[0] ?? null;
  const stateKey = stableContractId("job-state", workspace, tenant, job.name, handoff.provider, handoff.operation);
  const commandBase = stableContractId("runtime-command", workspace, tenant, job.name, handoff.adapter);
  const shapedParameters = deterministicStateShape(handoff.parameters);
  const restoreInputs = Object.freeze({
    workspace,
    tenant,
    role,
    job: job.name,
    adapter: handoff.adapter,
    provider: handoff.provider,
    operation: handoff.operation,
    parameters: shapedParameters,
    checkpoint: recovery.recoverFrom ?? checkpointMemory?.alias ?? null,
    idempotencyKey: recovery.idempotencyKey,
    statusChannel: status.channel,
    auditChannel: status.auditChannel,
  });
  const missing = Object.freeze([
    workspace ? null : "workspace",
    tenant ? null : "tenant",
    role ? null : "role",
    handoff.adapter ? null : "adapter",
    recovery.restartSafe ? null : "restart-safe-recovery",
    status.observable ? null : "observable-status",
    recovery.recoverFrom || checkpointMemory ? null : "checkpoint-memory",
  ].filter(Boolean));
  const commandLedger = Object.freeze([
    Object.freeze({
      id: stableContractId(commandBase, "prepare"),
      phase: "prepare",
      idempotent: true,
      writesProvider: false,
      status: "pending",
    }),
    Object.freeze({
      id: stableContractId(commandBase, "handoff"),
      phase: "handoff",
      idempotent: Boolean(recovery.idempotencyKey) || !handoff.mutatesProvider,
      writesProvider: handoff.mutatesProvider,
      status: "pending",
    }),
    Object.freeze({
      id: stableContractId(commandBase, "status"),
      phase: "status",
      idempotent: true,
      writesProvider: false,
      status: status.observable ? "pending" : "blocked",
    }),
  ]);
  const restartSafe = missing.length === 0 && commandLedger.every((command) => command.idempotent || !command.writesProvider);

  return Object.freeze({
    schema: "aios.kernel.persisted-state.contract.v1",
    stateKey,
    scope: Object.freeze({ workspace, tenant, role }),
    restoreInputs,
    commandLedger,
    checkpoint: Object.freeze({
      memory: checkpointMemory?.alias ?? null,
      recoverFrom: recovery.recoverFrom,
      rollbackTarget: recovery.rollbackTarget,
      idempotencyKey: recovery.idempotencyKey,
    }),
    statusMirror: Object.freeze({
      channel: status.channel,
      auditChannel: status.auditChannel,
      degradedStatus: status.degradedStatus,
      restartStatus: restartSafe ? "restart-safe" : "restart-review",
    }),
    restartSafe,
    missing,
    nextAction: restartSafe
      ? "persist-runtime-state"
      : missing.includes("checkpoint-memory")
        ? "declare-checkpoint-memory"
        : missing.includes("observable-status")
          ? "declare-status-channel"
          : missing.includes("restart-safe-recovery")
            ? "declare-recovery-contract"
            : "complete-runtime-boundary",
  });
}

function createHandoffContract(job) {
  const handoff = firstClause(job, "HandoffClause");
  const adapter = handoff?.adapter ?? null;
  const provider = providerFromAdapter(adapter);
  const operation = operationFromAdapter(adapter);
  const parameters = literalToPlain(handoff?.parameters ?? { type: "ObjectExpression", entries: [] }) ?? {};

  return Object.freeze({
    schema: "aios.kernel.adapter.handoff.v1",
    adapter,
    provider,
    operation,
    parameters,
    mailchimp: provider === "mailchimp",
    mutatesProvider: provider === "mailchimp" && MAILCHIMP_MUTATING_OPERATIONS.has(operation),
    requiredPermissions: provider === "mailchimp" ? requiredMailchimpPermissions(adapter) : Object.freeze([]),
    status: adapter ? "declared" : "missing-adapter",
  });
}

function createClaimContract(job, capabilityContracts, recovery, status) {
  const boundary = Object.freeze({
    workspace: firstClause(job, "WorkspaceClause")?.workspace ?? null,
    tenant: firstClause(job, "TenantClause")?.tenant ?? null,
    role: firstClause(job, "RoleClause")?.role ?? null,
  });
  const boundaryChecks = Object.freeze(Object.fromEntries(Object.entries(boundary).map(([key, value]) => [
    key,
    boundaryRisk(value, key),
  ])));
  const blockingCapability = capabilityContracts.find((contract) => contract.permissionBoundary.ok === false);

  return Object.freeze({
    schema: "aios.kernel.claim.contract.v1",
    job: job.name,
    boundary,
    audit: createAuditScope(boundary, normalizeRolePermissions(firstClause(job, "RoleClause"))),
    boundaryChecks,
    accepted: !blockingCapability && recovery.restartSafe && status.observable,
    nextAction: blockingCapability
      ? "align-capability-permissions"
      : !recovery.restartSafe
        ? "declare-recovery-contract"
        : !status.observable
          ? "declare-status-channel"
          : "submit-kernel-job",
  });
}

function createClientRuntimeHandoff(job, handoff, recovery, status, claim) {
  const role = firstClause(job, "RoleClause");
  const workspace = firstClause(job, "WorkspaceClause")?.workspace ?? null;
  const tenant = firstClause(job, "TenantClause")?.tenant ?? null;
  const statusChannels = statusChannelsForClient(status);
  const clientVisibleState = Object.freeze({
    workspace,
    tenant,
    role: role?.role ?? null,
    job: job.name,
    adapter: handoff.adapter,
    provider: handoff.provider,
    operation: handoff.operation,
    parameters: handoff.parameters,
  });
  const missing = Object.freeze([
    workspace ? null : "workspace",
    tenant ? null : "tenant",
    role?.role ? null : "role",
    handoff.adapter ? null : "adapter",
    statusChannels.length > 0 ? null : "status-channel",
    recovery.restartSafe ? null : "restart-safe-recovery",
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.grammar.client-runtime-handoff.v1",
    job: job.name,
    mailchimp: handoff.mailchimp,
    mutatesProvider: handoff.mutatesProvider,
    clientVisibleState,
    statusChannels,
    restore: Object.freeze({
      restartSafe: recovery.restartSafe,
      checkpoint: recovery.recoverFrom,
      idempotencyKey: recovery.idempotencyKey,
      rollbackTarget: recovery.rollbackTarget,
    }),
    readiness: Object.freeze({
      accepted: claim.accepted && missing.length === 0,
      missing,
      status: missing.length === 0
        ? "ready-for-client-runtime"
        : handoff.mailchimp
          ? "mailchimp-client-review"
          : "runtime-review",
      nextAction: missing.length === 0
        ? "handoff-client-runtime"
        : missing.includes("status-channel")
          ? "declare-status-channel"
          : missing.includes("restart-safe-recovery")
            ? "declare-recovery-contract"
            : "complete-runtime-boundary",
    }),
  });
}

function createClientExecutionIntentContract(job, handoff, recovery, status, tenantPermissionBoundary, persistedState) {
  const workspace = firstClause(job, "WorkspaceClause")?.workspace ?? null;
  const tenant = firstClause(job, "TenantClause")?.tenant ?? null;
  const role = firstClause(job, "RoleClause")?.role ?? null;
  const statusChannel = status.channel ?? status.auditChannel ?? null;
  const mutatingWithoutIdempotency = handoff.mutatesProvider && !recovery.idempotencyKey;
  const commandId = stableContractId(
    "client-execution-intent",
    persistedState.stateKey,
    handoff.adapter,
    statusChannel,
  );
  const statusCommandId = stableContractId(
    "client-execution-status",
    persistedState.stateKey,
    statusChannel,
    status.degradedStatus,
  );
  const missing = Object.freeze([
    handoff.adapter ? null : "adapter",
    tenantPermissionBoundary.allowed ? null : "tenant-permission-boundary",
    persistedState.restartSafe ? null : "restart-safe-state",
    statusChannel ? null : "status-channel",
    tenantPermissionBoundary.audit.status === "audit-ready" || !tenantPermissionBoundary.audit.required ? null : "audit-channel",
    mutatingWithoutIdempotency ? "idempotency-key" : null,
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const blockedGate = missing[0] ?? null;

  return Object.freeze({
    schema: "aios.grammar.client-execution-intent.contract.v1",
    intentId: commandId,
    job: job.name,
    adapter: handoff.adapter,
    provider: handoff.provider,
    operation: handoff.operation,
    mailchimp: handoff.mailchimp,
    accepted,
    status: accepted
      ? "execution-intent-ready"
      : blockedGate === "tenant-permission-boundary"
        ? tenantPermissionBoundary.status
        : blockedGate === "restart-safe-state"
          ? persistedState.statusMirror.restartStatus
          : blockedGate === "status-channel"
            ? "status-review"
            : blockedGate === "audit-channel"
              ? "audit-review"
              : blockedGate === "idempotency-key"
                ? "idempotency-review"
                : "execution-intent-review",
    boundary: Object.freeze({
      workspace,
      tenant,
      role,
      isolationKey: tenantPermissionBoundary.isolationKey,
    }),
    clientState: Object.freeze({
      stateKey: persistedState.stateKey,
      restoreInputs: persistedState.restoreInputs,
      statusChannel,
      auditChannel: status.auditChannel,
      degradedStatus: status.degradedStatus,
    }),
    commands: Object.freeze([
      Object.freeze({
        id: commandId,
        kind: "client-execution-intent",
        idempotent: !handoff.mutatesProvider || Boolean(recovery.idempotencyKey),
        writesProvider: handoff.mutatesProvider,
        status: accepted ? "ready" : "blocked",
        nextAction: accepted ? "submit-client-execution-intent" : "resolve-execution-intent-gate",
      }),
      Object.freeze({
        id: statusCommandId,
        kind: "client-execution-status",
        idempotent: true,
        writesProvider: false,
        status: statusChannel ? "ready" : "blocked",
        nextAction: statusChannel ? "emit-client-execution-status" : "declare-status-channel",
      }),
    ]),
    validationSummary: Object.freeze({
      boundaryReady: tenantPermissionBoundary.allowed,
      restartReady: persistedState.restartSafe,
      statusReady: Boolean(statusChannel),
      auditReady: tenantPermissionBoundary.audit.status === "audit-ready" || !tenantPermissionBoundary.audit.required,
      idempotencyReady: !mutatingWithoutIdempotency,
      missing,
    }),
    controls: Object.freeze({
      canPreview: Boolean(handoff.adapter),
      canPersist: persistedState.restartSafe,
      canReplay: persistedState.restartSafe && (!handoff.mutatesProvider || Boolean(recovery.idempotencyKey)),
      canSubmit: accepted,
      canEmitStatus: Boolean(statusChannel),
    }),
    nextAction: accepted
      ? "submit-client-execution-intent"
      : blockedGate === "tenant-permission-boundary"
        ? tenantPermissionBoundary.nextAction
        : blockedGate === "restart-safe-state"
          ? persistedState.nextAction
          : blockedGate === "status-channel"
            ? "declare-status-channel"
            : blockedGate === "audit-channel"
              ? "declare-audit-channel"
              : blockedGate === "idempotency-key"
                ? "declare-idempotency-key"
                : "declare-provider-adapter",
  });
}

function createExternalProviderServiceContract(job, handoff, recovery, status, tenantPermissionBoundary, persistedState) {
  const workspace = firstClause(job, "WorkspaceClause")?.workspace ?? null;
  const tenant = firstClause(job, "TenantClause")?.tenant ?? null;
  const role = firstClause(job, "RoleClause")?.role ?? null;
  const mutatingRequiresIdempotency = handoff.mutatesProvider && !recovery.idempotencyKey;
  const missing = Object.freeze([
    handoff.adapter ? null : "adapter",
    tenantPermissionBoundary.allowed ? null : "tenant-permission-boundary",
    persistedState.restartSafe ? null : "restart-safe-persisted-state",
    status.observable ? null : "status-channel",
    tenantPermissionBoundary.audit.status === "audit-ready" || !tenantPermissionBoundary.audit.required ? null : "audit-channel",
    mutatingRequiresIdempotency ? "idempotency-key" : null,
  ].filter(Boolean));
  const serviceKey = stableContractId(
    "external-provider-service",
    workspace,
    tenant,
    role,
    handoff.provider,
    handoff.operation,
    job.name,
  );
  const accepted = handoff.status === "declared"
    && missing.length === 0
    && handoff.requiredPermissions.every((permission) => tenantPermissionBoundary.grantedPermissions.includes(permission));

  return Object.freeze({
    schema: "aios.grammar.external-provider-service.contract.v1",
    serviceKey,
    job: job.name,
    adapter: handoff.adapter,
    provider: handoff.provider,
    operation: handoff.operation,
    mailchimp: handoff.mailchimp,
    mutatesProvider: handoff.mutatesProvider,
    accepted,
    boundary: Object.freeze({
      workspace,
      tenant,
      role,
      isolationKey: tenantPermissionBoundary.isolationKey,
      status: tenantPermissionBoundary.status,
    }),
    permissions: Object.freeze({
      required: handoff.requiredPermissions,
      granted: tenantPermissionBoundary.grantedPermissions,
      missing: tenantPermissionBoundary.missingPermissions,
    }),
    sync: Object.freeze({
      stateKey: persistedState.stateKey,
      statusChannel: status.channel,
      auditChannel: status.auditChannel,
      degradedStatus: status.degradedStatus,
      checkpoint: persistedState.checkpoint,
      idempotencyKey: recovery.idempotencyKey,
    }),
    recovery: Object.freeze({
      restartSafe: recovery.restartSafe && persistedState.restartSafe,
      recoverFrom: recovery.recoverFrom,
      rollbackTarget: recovery.rollbackTarget,
      nextAction: recovery.nextAction,
    }),
    handoffState: Object.freeze({
      missing,
      status: accepted
        ? "accepted"
        : missing.includes("tenant-permission-boundary")
          ? tenantPermissionBoundary.status
          : missing.includes("restart-safe-persisted-state")
            ? persistedState.statusMirror.restartStatus
            : missing.includes("status-channel")
              ? "status-review"
              : missing.includes("audit-channel")
                ? "audit-review"
                : missing.includes("idempotency-key")
                  ? "idempotency-review"
                  : "provider-review",
      nextAction: accepted
        ? "handoff-external-provider"
        : missing.includes("tenant-permission-boundary")
          ? tenantPermissionBoundary.nextAction
          : missing.includes("restart-safe-persisted-state")
            ? persistedState.nextAction
            : missing.includes("status-channel")
              ? "declare-status-channel"
              : missing.includes("audit-channel")
                ? "declare-audit-channel"
                : missing.includes("idempotency-key")
                  ? "declare-idempotency-key"
                  : "review-provider-service",
    }),
    nextAction: accepted
      ? "handoff-external-provider"
      : missing.includes("tenant-permission-boundary")
        ? tenantPermissionBoundary.nextAction
        : missing.includes("restart-safe-persisted-state")
          ? persistedState.nextAction
          : missing.includes("status-channel")
            ? "declare-status-channel"
            : missing.includes("audit-channel")
              ? "declare-audit-channel"
              : missing.includes("idempotency-key")
                ? "declare-idempotency-key"
                : "review-provider-service",
  });
}

function createExternalProviderStatusReceiptContract(job, handoff, recovery, status, tenantPermissionBoundary, persistedState, externalProviderService, clientExecutionIntent) {
  const statusChannel = status.channel ?? externalProviderService.sync.statusChannel ?? null;
  const auditChannel = status.auditChannel ?? externalProviderService.sync.auditChannel ?? null;
  const statusReady = Boolean(statusChannel);
  const auditReady = tenantPermissionBoundary.audit.status === "audit-ready" || !tenantPermissionBoundary.audit.required || Boolean(auditChannel);
  const idempotencyReady = !handoff.mutatesProvider || Boolean(recovery.idempotencyKey);
  const providerReady = !handoff.adapter || externalProviderService.accepted;
  const intentReady = !handoff.adapter || clientExecutionIntent.accepted;
  const restartReady = persistedState.restartSafe;
  const missing = Object.freeze([
    handoff.adapter ? null : "adapter",
    tenantPermissionBoundary.allowed ? null : "tenant-permission-boundary",
    providerReady ? null : "external-provider-service",
    intentReady ? null : "client-execution-intent",
    restartReady ? null : "restart-safe-persisted-state",
    statusReady ? null : "status-channel",
    auditReady ? null : "audit-channel",
    idempotencyReady ? null : "idempotency-key",
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const receiptId = stableContractId(
    "grammar-external-provider-status-receipt",
    job.name,
    handoff.provider,
    handoff.operation,
    persistedState.stateKey,
    statusChannel,
  );
  const eventBase = stableContractId("grammar-provider-status-event", receiptId);
  const firstMissing = missing[0] ?? null;

  return Object.freeze({
    schema: "aios.grammar.external-provider-status-receipt.contract.v1",
    receiptId,
    job: job.name,
    adapter: handoff.adapter,
    provider: handoff.provider,
    operation: handoff.operation,
    mailchimp: handoff.mailchimp,
    accepted,
    status: accepted
      ? handoff.mailchimp ? "mailchimp-status-receipt-ready" : "external-status-receipt-ready"
      : firstMissing === "tenant-permission-boundary"
        ? tenantPermissionBoundary.status
        : firstMissing === "external-provider-service"
          ? externalProviderService.handoffState.status
          : firstMissing === "client-execution-intent"
            ? clientExecutionIntent.status
            : firstMissing === "restart-safe-persisted-state"
              ? persistedState.statusMirror.restartStatus
              : firstMissing === "status-channel"
                ? "status-review"
                : firstMissing === "audit-channel"
                  ? "audit-review"
                  : firstMissing === "idempotency-key"
                    ? "idempotency-review"
                    : "provider-receipt-review",
    boundary: Object.freeze({
      workspace: tenantPermissionBoundary.scope.workspace,
      tenant: tenantPermissionBoundary.scope.tenant,
      role: tenantPermissionBoundary.scope.role,
      isolationKey: tenantPermissionBoundary.isolationKey,
    }),
    sync: Object.freeze({
      stateKey: persistedState.stateKey,
      serviceKey: externalProviderService.serviceKey,
      intentId: clientExecutionIntent.intentId,
      statusChannel,
      auditChannel,
      degradedStatus: status.degradedStatus,
      idempotencyKey: recovery.idempotencyKey,
      checkpoint: persistedState.checkpoint,
    }),
    events: Object.freeze([
      Object.freeze({
        schema: "aios.grammar.external-provider-status-receipt.event.v1",
        id: stableContractId(eventBase, "provider-status"),
        channel: statusChannel,
        status: accepted ? "provider-handoff-recorded" : "provider-handoff-review",
        required: Boolean(handoff.adapter),
        idempotent: true,
        observed: accepted,
        nextAction: statusChannel ? "emit-provider-status" : "declare-status-channel",
      }),
      Object.freeze({
        schema: "aios.grammar.external-provider-status-receipt.event.v1",
        id: stableContractId(eventBase, "audit-status"),
        channel: auditChannel,
        status: auditReady ? "audit-ready" : "audit-channel-missing",
        required: tenantPermissionBoundary.audit.required,
        idempotent: true,
        observed: auditReady,
        nextAction: auditReady ? "emit-provider-audit-status" : "declare-audit-channel",
      }),
    ]),
    validationSummary: Object.freeze({
      boundaryReady: tenantPermissionBoundary.allowed,
      providerReady,
      intentReady,
      restartReady,
      statusReady,
      auditReady,
      idempotencyReady,
      missing,
    }),
    controls: Object.freeze({
      canEmitStatus: statusReady,
      canEmitAudit: Boolean(auditChannel),
      canPersistReceipt: accepted,
      canReplayReceipt: restartReady && idempotencyReady,
      canHandoffProvider: accepted,
    }),
    exportSummary: Object.freeze({
      receiptId,
      status: accepted ? "external-status-receipt-ready" : "external-status-receipt-review",
      provider: handoff.provider,
      operation: handoff.operation,
      missing,
      nextAction: accepted
        ? "persist-external-provider-status-receipt"
        : firstMissing === "tenant-permission-boundary"
          ? tenantPermissionBoundary.nextAction
          : firstMissing === "external-provider-service"
            ? externalProviderService.nextAction
            : firstMissing === "client-execution-intent"
              ? clientExecutionIntent.nextAction
              : firstMissing === "restart-safe-persisted-state"
                ? persistedState.nextAction
                : firstMissing === "status-channel"
                  ? "declare-status-channel"
                  : firstMissing === "audit-channel"
                    ? "declare-audit-channel"
                    : firstMissing === "idempotency-key"
                      ? "declare-idempotency-key"
                      : "declare-provider-adapter",
    }),
    nextAction: accepted
      ? "persist-external-provider-status-receipt"
      : firstMissing === "tenant-permission-boundary"
        ? tenantPermissionBoundary.nextAction
        : firstMissing === "external-provider-service"
          ? externalProviderService.nextAction
          : firstMissing === "client-execution-intent"
            ? clientExecutionIntent.nextAction
            : firstMissing === "restart-safe-persisted-state"
              ? persistedState.nextAction
              : firstMissing === "status-channel"
                ? "declare-status-channel"
                : firstMissing === "audit-channel"
                  ? "declare-audit-channel"
                  : firstMissing === "idempotency-key"
                    ? "declare-idempotency-key"
                    : "declare-provider-adapter",
  });
}

function createMailchimpOperatorGateContract(job, handoff, recovery, status, tenantPermissionBoundary, externalProviderService) {
  if (!handoff.mailchimp) {
    return Object.freeze({
      schema: "aios.grammar.mailchimp-operator-gate.contract.v1",
      required: false,
      accepted: true,
      status: "not-required",
      nextAction: "continue",
    });
  }

  const parameters = handoff.parameters ?? {};
  const mode = ["preview", "manual", "scheduled", "immediate", "disabled"].includes(parameters.mode)
    ? parameters.mode
    : parameters.enabled === false
      ? "disabled"
      : parameters.scheduledAt
        ? "scheduled"
        : handoff.mutatesProvider
          ? "manual"
          : "preview";
  const acceptedBy = parameters.acceptedBy ?? parameters.operator ?? null;
  const scheduledAt = parameters.scheduledAt ?? null;
  const statusChannel = status.channel ?? externalProviderService.sync.statusChannel ?? null;
  const auditChannel = status.auditChannel ?? externalProviderService.sync.auditChannel ?? null;
  const enabled = mode !== "disabled" && parameters.enabled !== false;
  const scheduleReady = mode !== "scheduled" || Boolean(scheduledAt);
  const operatorReady = mode === "preview" || Boolean(acceptedBy);
  const idempotencyReady = !handoff.mutatesProvider || Boolean(recovery.idempotencyKey);
  const statusReady = Boolean(statusChannel);
  const auditReady = !tenantPermissionBoundary.audit.required || tenantPermissionBoundary.audit.status === "audit-ready" || Boolean(auditChannel);
  const missing = Object.freeze([
    enabled ? null : "mailchimp-operator-enabled",
    tenantPermissionBoundary.allowed ? null : "tenant-permission-boundary",
    externalProviderService.accepted ? null : "external-provider-service",
    operatorReady ? null : "operator-acceptance",
    scheduleReady ? null : "schedule",
    statusReady ? null : "status-channel",
    auditReady ? null : "audit-channel",
    idempotencyReady ? null : "idempotency-key",
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const firstMissing = missing[0] ?? null;
  const gateId = stableContractId(
    "grammar-mailchimp-operator-gate",
    job.name,
    handoff.operation,
    mode,
    tenantPermissionBoundary.isolationKey,
  );

  return Object.freeze({
    schema: "aios.grammar.mailchimp-operator-gate.contract.v1",
    required: true,
    gateId,
    job: job.name,
    adapter: handoff.adapter,
    operation: handoff.operation,
    mode,
    accepted,
    status: accepted
      ? mode === "preview" ? "preview-ready" : "operator-gate-ready"
      : firstMissing === "mailchimp-operator-enabled"
        ? "disabled"
        : firstMissing === "tenant-permission-boundary"
          ? tenantPermissionBoundary.status
          : firstMissing === "external-provider-service"
            ? externalProviderService.handoffState.status
            : firstMissing === "operator-acceptance"
              ? "operator-acceptance-required"
              : firstMissing === "schedule"
                ? "schedule-review"
                : firstMissing === "idempotency-key"
                  ? "idempotency-review"
                  : firstMissing === "status-channel"
                    ? "status-review"
                    : "audit-review",
    channels: Object.freeze({
      status: statusChannel,
      audit: auditChannel,
    }),
    schedule: Object.freeze({
      enabled,
      mode,
      scheduledAt,
      mutatesProvider: handoff.mutatesProvider,
      idempotencyKey: recovery.idempotencyKey,
    }),
    validationSummary: Object.freeze({
      enabled,
      boundaryReady: tenantPermissionBoundary.allowed,
      providerReady: externalProviderService.accepted,
      operatorAccepted: operatorReady,
      scheduleReady,
      statusReady,
      auditReady,
      idempotencyReady,
      missing,
    }),
    controls: Object.freeze({
      canEnable: !enabled,
      canDisable: enabled,
      canPreview: tenantPermissionBoundary.allowed,
      canAccept: enabled && tenantPermissionBoundary.allowed && externalProviderService.accepted,
      canSchedule: enabled && operatorReady && idempotencyReady,
      canRunNow: accepted && mode === "immediate",
      canRunScheduled: accepted && mode === "scheduled",
      canHandoffRuntime: accepted,
    }),
    nextAction: accepted
      ? mode === "scheduled" ? "schedule-mailchimp-runtime-handoff" : mode === "preview" ? "show-mailchimp-runtime-preview" : "handoff-mailchimp-runtime"
      : firstMissing === "mailchimp-operator-enabled"
        ? "enable-mailchimp-operator-gate"
        : firstMissing === "tenant-permission-boundary"
          ? tenantPermissionBoundary.nextAction
          : firstMissing === "external-provider-service"
            ? externalProviderService.nextAction
            : firstMissing === "operator-acceptance"
              ? "accept-mailchimp-runtime-preview"
              : firstMissing === "schedule"
                ? "declare-mailchimp-schedule"
                : firstMissing === "status-channel"
                  ? "declare-status-channel"
                  : firstMissing === "audit-channel"
                    ? "declare-audit-channel"
                    : "declare-idempotency-key",
  });
}

function createMailchimpLifecycleControlContract(job, handoff, recovery, status, tenantPermissionBoundary, externalProviderService, operatorGate) {
  if (!handoff.mailchimp) {
    return Object.freeze({
      schema: "aios.grammar.mailchimp-lifecycle-control.contract.v1",
      required: false,
      accepted: true,
      status: "not-required",
      nextAction: "continue",
    });
  }

  const parameters = handoff.parameters ?? {};
  const mode = ["preview", "manual", "scheduled", "immediate", "disabled"].includes(parameters.mode)
    ? parameters.mode
    : parameters.enabled === false
      ? "disabled"
      : parameters.scheduledAt
        ? "scheduled"
        : handoff.mutatesProvider
          ? "manual"
          : "preview";
  const enabled = mode !== "disabled" && parameters.enabled !== false;
  const scheduledAt = parameters.scheduledAt ?? operatorGate.schedule?.scheduledAt ?? null;
  const dryRun = parameters.dryRun !== false;
  const allowMutatingSync = parameters.allowMutatingSync === true;
  const acceptedBy = parameters.acceptedBy ?? parameters.operator ?? operatorGate.acceptance?.acceptedBy ?? null;
  const statusChannel = status.channel ?? externalProviderService.sync.statusChannel ?? operatorGate.channels?.status ?? null;
  const auditChannel = status.auditChannel ?? externalProviderService.sync.auditChannel ?? operatorGate.channels?.audit ?? null;
  const mutationAllowed = !handoff.mutatesProvider || dryRun || allowMutatingSync;
  const idempotencyReady = !handoff.mutatesProvider || dryRun || Boolean(recovery.idempotencyKey);
  const scheduleReady = mode !== "scheduled" || Boolean(scheduledAt);
  const operatorReady = mode === "preview" || Boolean(acceptedBy);
  const statusReady = Boolean(statusChannel);
  const auditReady = !tenantPermissionBoundary.audit.required
    || tenantPermissionBoundary.audit.status === "audit-ready"
    || Boolean(auditChannel);
  const missing = Object.freeze([
    enabled ? null : "mailchimp-enabled",
    tenantPermissionBoundary.allowed ? null : "tenant-permission-boundary",
    externalProviderService.accepted ? null : "external-provider-service",
    operatorGate.accepted ? null : "operator-gate",
    operatorReady ? null : "operator-acceptance",
    scheduleReady ? null : "schedule",
    statusReady ? null : "status-channel",
    auditReady ? null : "audit-channel",
    mutationAllowed ? null : "mutating-sync-control",
    idempotencyReady ? null : "idempotency-key",
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const blocked = missing[0] ?? null;
  const controlId = stableContractId(
    "grammar-mailchimp-lifecycle-control",
    job.name,
    handoff.operation,
    mode,
    tenantPermissionBoundary.isolationKey,
  );

  return Object.freeze({
    schema: "aios.grammar.mailchimp-lifecycle-control.contract.v1",
    required: true,
    controlId,
    job: job.name,
    adapter: handoff.adapter,
    operation: handoff.operation,
    accepted,
    status: accepted
      ? mode === "scheduled" ? "scheduled" : mode === "preview" ? "preview-ready" : "ready"
      : blocked === "mailchimp-enabled"
        ? "disabled"
        : blocked === "tenant-permission-boundary"
          ? tenantPermissionBoundary.status
          : blocked === "external-provider-service"
            ? externalProviderService.handoffState.status
            : blocked === "operator-gate"
              ? operatorGate.status
              : blocked === "operator-acceptance"
                ? "operator-acceptance-required"
                : blocked === "schedule"
                  ? "schedule-review"
                  : blocked === "status-channel"
                    ? "status-review"
                    : blocked === "audit-channel"
                      ? "audit-review"
                      : blocked === "mutating-sync-control"
                        ? "mutation-control-review"
                        : "idempotency-review",
    schedule: Object.freeze({
      mode,
      enabled,
      scheduledAt,
      dryRun,
      allowMutatingSync,
      mutatesProvider: handoff.mutatesProvider,
      idempotencyKey: recovery.idempotencyKey,
    }),
    channels: Object.freeze({
      status: statusChannel,
      audit: auditChannel,
    }),
    validationSummary: Object.freeze({
      enabled,
      boundaryReady: tenantPermissionBoundary.allowed,
      providerReady: externalProviderService.accepted,
      operatorGateReady: operatorGate.accepted,
      operatorAccepted: operatorReady,
      scheduleReady,
      statusReady,
      auditReady,
      mutationAllowed,
      idempotencyReady,
      missing,
    }),
    controls: Object.freeze({
      canEnable: !enabled,
      canDisable: enabled,
      canPreview: tenantPermissionBoundary.allowed,
      canAccept: enabled && tenantPermissionBoundary.allowed && externalProviderService.accepted,
      canSchedule: enabled && scheduleReady && operatorReady && mutationAllowed && idempotencyReady,
      canRunNow: accepted && mode === "immediate",
      canRunScheduled: accepted && mode === "scheduled",
      canHandoffRuntime: accepted,
      canEmitStatus: statusReady,
    }),
    exportSummary: Object.freeze({
      controlId,
      status: accepted ? "mailchimp-lifecycle-ready" : "mailchimp-lifecycle-review",
      mode,
      blocked,
      missing,
      nextAction: accepted
        ? mode === "scheduled" ? "schedule-mailchimp-runtime-handoff" : "handoff-mailchimp-runtime"
        : blocked === "mailchimp-enabled"
          ? "enable-mailchimp-lifecycle"
          : blocked === "tenant-permission-boundary"
            ? tenantPermissionBoundary.nextAction
            : blocked === "external-provider-service"
              ? externalProviderService.nextAction
              : blocked === "operator-gate"
                ? operatorGate.nextAction
                : blocked === "operator-acceptance"
                  ? "accept-mailchimp-runtime-preview"
                  : blocked === "schedule"
                    ? "declare-mailchimp-schedule"
                    : blocked === "status-channel"
                      ? "declare-status-channel"
                      : blocked === "audit-channel"
                        ? "declare-audit-channel"
                        : blocked === "mutating-sync-control"
                          ? "enable-mutating-mailchimp-sync-or-dry-run"
                          : "declare-idempotency-key",
    }),
    nextAction: accepted
      ? mode === "scheduled" ? "schedule-mailchimp-runtime-handoff" : "handoff-mailchimp-runtime"
      : blocked === "mailchimp-enabled"
        ? "enable-mailchimp-lifecycle"
        : blocked === "tenant-permission-boundary"
          ? tenantPermissionBoundary.nextAction
          : blocked === "external-provider-service"
            ? externalProviderService.nextAction
            : blocked === "operator-gate"
              ? operatorGate.nextAction
              : blocked === "operator-acceptance"
                ? "accept-mailchimp-runtime-preview"
                : blocked === "schedule"
                  ? "declare-mailchimp-schedule"
                  : blocked === "status-channel"
                    ? "declare-status-channel"
                    : blocked === "audit-channel"
                      ? "declare-audit-channel"
                      : blocked === "mutating-sync-control"
                        ? "enable-mutating-mailchimp-sync-or-dry-run"
                        : "declare-idempotency-key",
  });
}

function createRestartStatusHandoff(job, persistedState) {
  const blocked = persistedState.missing.length > 0;

  return Object.freeze({
    schema: "aios.grammar.restart-status-handoff.v1",
    job: job.name,
    stateKey: persistedState.stateKey,
    restartSafe: persistedState.restartSafe,
    status: persistedState.restartSafe
      ? "restart-safe"
      : blocked
        ? "restart-blocked"
        : "restart-review",
    statusMirror: persistedState.statusMirror,
    commandIds: Object.freeze(persistedState.commandLedger.map((command) => command.id)),
    missing: persistedState.missing,
    nextAction: persistedState.nextAction,
  });
}

function createJobResumptionManifest(job, handoff, recovery, status, tenantPermissionBoundary, persistedState, externalProviderService, externalProviderStatusReceipt, mailchimpOperatorGate) {
  const statusChannel = status.channel ?? status.auditChannel ?? null;
  const auditReady = tenantPermissionBoundary.audit.status === "audit-ready" || !tenantPermissionBoundary.audit.required;
  const restartReady = recovery.restartSafe && persistedState.restartSafe;
  const providerReady = !handoff.mailchimp || externalProviderService.accepted;
  const idempotencyReady = !handoff.mutatesProvider || Boolean(recovery.idempotencyKey);
  const gates = Object.freeze([
    Object.freeze({
      schema: "aios.grammar.resumption-manifest.gate.v1",
      label: "persisted-state",
      accepted: persistedState.restartSafe,
      status: persistedState.statusMirror.restartStatus,
      nextAction: persistedState.restartSafe ? "continue" : persistedState.nextAction,
      references: Object.freeze({
        stateKey: persistedState.stateKey,
        checkpoint: persistedState.checkpoint,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.resumption-manifest.gate.v1",
      label: "tenant-permission-boundary",
      accepted: tenantPermissionBoundary.allowed,
      status: tenantPermissionBoundary.status,
      nextAction: tenantPermissionBoundary.allowed ? "continue" : tenantPermissionBoundary.nextAction,
      references: Object.freeze({
        isolationKey: tenantPermissionBoundary.isolationKey,
        missingPermissions: tenantPermissionBoundary.missingPermissions,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.resumption-manifest.gate.v1",
      label: "status-audit",
      accepted: Boolean(statusChannel) && auditReady,
      status: statusChannel ? tenantPermissionBoundary.audit.status : "status-channel-missing",
      nextAction: statusChannel
        ? auditReady ? "continue" : "declare-audit-channel"
        : "declare-status-channel",
      references: Object.freeze({
        statusChannel,
        auditChannel: status.auditChannel,
        degradedStatus: status.degradedStatus,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.resumption-manifest.gate.v1",
      label: "idempotent-command",
      accepted: idempotencyReady,
      status: idempotencyReady ? "idempotent" : "idempotency-review",
      nextAction: idempotencyReady ? "continue" : "declare-idempotency-key",
      references: Object.freeze({
        mutatesProvider: handoff.mutatesProvider,
        idempotencyKey: recovery.idempotencyKey,
        commandLedger: persistedState.commandLedger.map((command) => Object.freeze({
          id: command.id,
          phase: command.phase,
          idempotent: command.idempotent,
          writesProvider: command.writesProvider,
        })),
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.resumption-manifest.gate.v1",
      label: "external-provider",
      accepted: providerReady,
      status: providerReady ? "accepted" : externalProviderService.handoffState.status,
      nextAction: providerReady ? "continue" : externalProviderService.nextAction,
      references: Object.freeze({
        serviceKey: externalProviderService.serviceKey,
        provider: handoff.provider,
        operation: handoff.operation,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.resumption-manifest.gate.v1",
      label: "external-status-receipt",
      accepted: externalProviderStatusReceipt.accepted,
      status: externalProviderStatusReceipt.status,
      nextAction: externalProviderStatusReceipt.accepted ? "continue" : externalProviderStatusReceipt.nextAction,
      references: Object.freeze({
        receiptId: externalProviderStatusReceipt.receiptId,
        statusChannel: externalProviderStatusReceipt.sync.statusChannel,
        auditChannel: externalProviderStatusReceipt.sync.auditChannel,
        missing: externalProviderStatusReceipt.validationSummary.missing,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.resumption-manifest.gate.v1",
      label: "mailchimp-operator-gate",
      accepted: !handoff.mailchimp || mailchimpOperatorGate.accepted,
      status: handoff.mailchimp ? mailchimpOperatorGate.status : "not-required",
      nextAction: !handoff.mailchimp || mailchimpOperatorGate.accepted ? "continue" : mailchimpOperatorGate.nextAction,
      references: Object.freeze({
        gateId: handoff.mailchimp ? mailchimpOperatorGate.gateId : null,
        mode: handoff.mailchimp ? mailchimpOperatorGate.mode : null,
        missing: handoff.mailchimp ? mailchimpOperatorGate.validationSummary.missing : Object.freeze([]),
      }),
    }),
  ]);
  const blocked = gates.filter((gate) => !gate.accepted);
  const manifestId = stableContractId("grammar-resumption-manifest", persistedState.stateKey, handoff.provider, handoff.operation);

  return Object.freeze({
    schema: "aios.grammar.resumption-manifest.v1",
    manifestId,
    job: job.name,
    provider: handoff.provider,
    operation: handoff.operation,
    adapter: handoff.adapter,
    ready: blocked.length === 0 && restartReady,
    status: blocked.length === 0 && restartReady
      ? "resumption-ready"
      : blocked[0]?.status ?? "restart-review",
    state: Object.freeze({
      stateKey: persistedState.stateKey,
      isolationKey: tenantPermissionBoundary.isolationKey,
      restartSafe: restartReady,
      recoverFrom: recovery.recoverFrom,
      rollbackTarget: recovery.rollbackTarget,
      idempotencyKey: recovery.idempotencyKey,
      statusChannel,
      auditChannel: status.auditChannel,
    }),
    gates,
    blockedGates: Object.freeze(blocked.map((gate) => gate.label)),
    commands: persistedState.commandLedger,
    controls: Object.freeze({
      canResume: blocked.length === 0 && restartReady,
      canReplay: restartReady && idempotencyReady,
      canEmitStatus: Boolean(statusChannel),
      canAudit: auditReady,
      canHandoffProvider: providerReady,
      canPersistExternalStatusReceipt: externalProviderStatusReceipt.accepted,
    }),
    exportSummary: Object.freeze({
      manifestId,
      status: blocked.length === 0 && restartReady ? "resumption-ready" : "resumption-review",
      blockedCount: blocked.length,
      firstBlocked: blocked[0]?.label ?? null,
      nextAction: blocked.length === 0 && restartReady
        ? "resume-runtime-job"
        : blocked[0]?.nextAction ?? persistedState.nextAction,
    }),
    nextAction: blocked.length === 0 && restartReady
      ? "resume-runtime-job"
      : blocked[0]?.nextAction ?? persistedState.nextAction,
  });
}

function createJobContract(job) {
  const roleClause = firstClause(job, "RoleClause");
  const handoff = createHandoffContract(job);
  const capabilities = createCapabilityContracts(job, roleClause);
  const memory = createMemoryContracts(job);
  const verifiers = createVerifierContracts(job);
  const status = createStatusContract(job);
  const recovery = createRecoveryContract(job, handoff);
  const tenantPermissionBoundary = createTenantPermissionBoundaryContract(job, handoff, capabilities, status);
  const persistedState = createPersistedStateContract(job, handoff, recovery, status);
  const claim = createClaimContract(job, capabilities, recovery, status);
  const clientRuntime = createClientRuntimeHandoff(job, handoff, recovery, status, claim);
  const clientExecutionIntent = createClientExecutionIntentContract(
    job,
    handoff,
    recovery,
    status,
    tenantPermissionBoundary,
    persistedState,
  );
  const externalProviderService = createExternalProviderServiceContract(
    job,
    handoff,
    recovery,
    status,
    tenantPermissionBoundary,
    persistedState,
  );
  const externalProviderStatusReceipt = createExternalProviderStatusReceiptContract(
    job,
    handoff,
    recovery,
    status,
    tenantPermissionBoundary,
    persistedState,
    externalProviderService,
    clientExecutionIntent,
  );
  const mailchimpOperatorGate = createMailchimpOperatorGateContract(
    job,
    handoff,
    recovery,
    status,
    tenantPermissionBoundary,
    externalProviderService,
  );
  const mailchimpLifecycleControl = createMailchimpLifecycleControlContract(
    job,
    handoff,
    recovery,
    status,
    tenantPermissionBoundary,
    externalProviderService,
    mailchimpOperatorGate,
  );
  const restartStatus = createRestartStatusHandoff(job, persistedState);
  const resumptionManifest = createJobResumptionManifest(
    job,
    handoff,
    recovery,
    status,
    tenantPermissionBoundary,
    persistedState,
    externalProviderService,
    externalProviderStatusReceipt,
    mailchimpOperatorGate,
  );

  return Object.freeze({
    schema: "aios.kernel.job.contract.v1",
    name: job.name,
    location: job.location,
    handoff,
    capabilities,
    memory,
    verifiers,
    status,
    recovery,
    tenantPermissionBoundary,
    persistedState,
    externalProviderService,
    externalProviderStatusReceipt,
    mailchimpOperatorGate,
    mailchimpLifecycleControl,
    restartStatus,
    resumptionManifest,
    claim,
    clientRuntime,
    clientExecutionIntent,
    ready: claim.accepted
      && handoff.status === "declared"
      && persistedState.restartSafe
      && tenantPermissionBoundary.allowed
      && clientExecutionIntent.accepted
      && externalProviderStatusReceipt.accepted
      && resumptionManifest.ready
      && mailchimpOperatorGate.accepted
      && mailchimpLifecycleControl.accepted
      && (!handoff.mailchimp || externalProviderService.accepted),
  });
}

function createRuntimeResumptionManifestSummary(jobs) {
  const manifests = Object.freeze(Array.from(jobs ?? []).map((job) => job.resumptionManifest));
  const blocked = manifests.filter((manifest) => !manifest.ready);
  const mailchimp = manifests.filter((manifest) => manifest.provider === "mailchimp");
  const statusChannels = Object.freeze([...new Set(manifests
    .map((manifest) => manifest.state.statusChannel)
    .filter(Boolean))].sort());
  const auditChannels = Object.freeze([...new Set(manifests
    .map((manifest) => manifest.state.auditChannel)
    .filter(Boolean))].sort());

  return Object.freeze({
    schema: "aios.grammar.runtime-resumption-manifest-summary.v1",
    ready: blocked.length === 0,
    status: blocked.length === 0 ? "runtime-resumption-ready" : blocked[0].status,
    counters: Object.freeze({
      total: manifests.length,
      mailchimp: mailchimp.length,
      blocked: blocked.length,
      restartSafe: manifests.filter((manifest) => manifest.state.restartSafe).length,
      idempotentCommands: manifests.filter((manifest) => manifest.controls.canReplay).length,
    }),
    statusChannels,
    auditChannels,
    manifests: Object.freeze(manifests.map((manifest) => manifest.exportSummary)),
    blockedJobs: Object.freeze(blocked.map((manifest) => Object.freeze({
      job: manifest.job,
      manifestId: manifest.manifestId,
      blockedGates: manifest.blockedGates,
      nextAction: manifest.nextAction,
    }))),
    controls: Object.freeze({
      canResumeAll: blocked.length === 0,
      canExportAudit: auditChannels.length > 0,
      canEmitStatus: statusChannels.length > 0,
      canResumeMailchimp: mailchimp.length > 0 && mailchimp.every((manifest) => manifest.ready),
    }),
    exportSummary: Object.freeze({
      status: blocked.length === 0 ? "runtime-resumption-ready" : "runtime-resumption-review",
      blockedCount: blocked.length,
      firstBlockedJob: blocked[0]?.job ?? null,
      nextAction: blocked.length === 0 ? "resume-runtime-bundle" : blocked[0].nextAction,
    }),
    nextAction: blocked.length === 0 ? "resume-runtime-bundle" : blocked[0].nextAction,
  });
}

function createRuntimeExternalProviderStatusReceiptSummary(jobs) {
  const receipts = Object.freeze(Array.from(jobs ?? [])
    .filter((job) => job.handoff.status === "declared")
    .map((job) => job.externalProviderStatusReceipt));
  const blocked = receipts.filter((receipt) => !receipt.accepted);
  const mailchimp = receipts.filter((receipt) => receipt.mailchimp);
  const statusChannels = Object.freeze([...new Set(receipts
    .map((receipt) => receipt.sync.statusChannel)
    .filter(Boolean))].sort());
  const auditChannels = Object.freeze([...new Set(receipts
    .map((receipt) => receipt.sync.auditChannel)
    .filter(Boolean))].sort());

  return Object.freeze({
    schema: "aios.grammar.runtime-external-provider-status-receipts.v1",
    ready: blocked.length === 0,
    status: blocked.length === 0 ? "external-status-receipts-ready" : blocked[0].status,
    counters: Object.freeze({
      total: receipts.length,
      mailchimp: mailchimp.length,
      blocked: blocked.length,
      statusChannels: statusChannels.length,
      auditChannels: auditChannels.length,
      observable: receipts.filter((receipt) => receipt.validationSummary.statusReady).length,
    }),
    statusChannels,
    auditChannels,
    receipts: Object.freeze(receipts.map((receipt) => receipt.exportSummary)),
    blockedReceipts: Object.freeze(blocked.map((receipt) => Object.freeze({
      job: receipt.job,
      receiptId: receipt.receiptId,
      provider: receipt.provider,
      operation: receipt.operation,
      missing: receipt.validationSummary.missing,
      nextAction: receipt.nextAction,
    }))),
    controls: Object.freeze({
      canPersistAllReceipts: blocked.length === 0,
      canEmitAnyStatus: statusChannels.length > 0,
      canEmitAnyAudit: auditChannels.length > 0,
      canReplayAllReceipts: receipts.every((receipt) => receipt.controls.canReplayReceipt),
    }),
    exportSummary: Object.freeze({
      status: blocked.length === 0 ? "external-status-receipts-ready" : "external-status-receipts-review",
      blockedCount: blocked.length,
      firstBlockedJob: blocked[0]?.job ?? null,
      nextAction: blocked.length === 0
        ? "persist-runtime-external-status-receipts"
        : blocked[0].nextAction,
    }),
    nextAction: blocked.length === 0
      ? "persist-runtime-external-status-receipts"
      : blocked[0].nextAction,
  });
}

function createRuntimeRestartStatusReconciliation(jobs, diagnostics, runtimeResumptionManifest) {
  const jobEntries = Object.freeze(Array.from(jobs ?? []).map((job) => {
    const statusChannel = job.status.channel ?? job.status.auditChannel ?? null;
    const auditChannel = job.status.auditChannel ?? null;
    const manifest = job.resumptionManifest;
    const restartStatus = job.restartStatus;
    const expectedStatuses = Object.freeze([
      manifest.ready ? "resumption-ready" : manifest.status,
      restartStatus.restartSafe ? "restart-safe" : restartStatus.status,
      job.externalProviderService.accepted ? "accepted" : job.externalProviderService.handoffState.status,
      job.mailchimpOperatorGate.status,
    ].filter(Boolean));
    const observedStatuses = Object.freeze([
      restartStatus.status,
      manifest.status,
      job.externalProviderService.handoffState.status,
      job.mailchimpOperatorGate.status,
      job.clientExecutionIntent.status,
    ].filter(Boolean));
    const missingStatuses = Object.freeze(expectedStatuses.filter((status) => !observedStatuses.some((observed) => (
      observed === status || String(observed).includes(status) || String(status).includes(observed)
    ))));
    const missing = Object.freeze([
      manifest.ready ? null : manifest.blockedGates[0] ?? "resumption-manifest",
      restartStatus.restartSafe ? null : "restart-status",
      statusChannel ? null : "status-channel",
      auditChannel || !job.tenantPermissionBoundary.audit.required ? null : "audit-channel",
      job.clientExecutionIntent.accepted ? null : "client-execution-intent",
      job.externalProviderService.accepted ? null : "external-provider-service",
      job.mailchimpOperatorGate.accepted ? null : "mailchimp-operator-gate",
      missingStatuses.length === 0 ? null : "status-observation",
    ].filter(Boolean));
    const accepted = missing.length === 0;

    return Object.freeze({
      schema: "aios.grammar.restart-status-reconciliation.job.v1",
      job: job.name,
      accepted,
      status: accepted
        ? "restart-status-reconciled"
        : missing.includes("status-observation")
          ? "status-observation-review"
          : missing.includes("restart-status")
            ? restartStatus.status
            : manifest.status,
      provider: job.handoff.provider,
      operation: job.handoff.operation,
      mailchimp: job.handoff.mailchimp,
      stateKey: job.persistedState.stateKey,
      isolationKey: job.tenantPermissionBoundary.isolationKey,
      channels: Object.freeze({
        status: statusChannel,
        audit: auditChannel,
        degraded: job.status.degradedStatus,
      }),
      expectedStatuses,
      observedStatuses,
      missingStatuses,
      missing,
      commands: Object.freeze(job.persistedState.commandLedger.map((command) => Object.freeze({
        id: command.id,
        phase: command.phase,
        idempotent: command.idempotent,
        writesProvider: command.writesProvider,
        status: command.status,
      }))),
      controls: Object.freeze({
        canResume: accepted && manifest.controls.canResume,
        canReplay: accepted && manifest.controls.canReplay,
        canEmitStatus: Boolean(statusChannel),
        canExportAudit: Boolean(auditChannel),
        canHandoffProvider: accepted && job.externalProviderService.accepted,
      }),
      exportSummary: Object.freeze({
        job: job.name,
        status: accepted ? "restart-status-reconciled" : "restart-status-review",
        firstMissing: missing[0] ?? null,
        missingStatuses,
        nextAction: accepted
          ? "resume-runtime-job"
          : missing.includes("status-channel")
            ? "declare-status-channel"
            : missing.includes("audit-channel")
              ? "declare-audit-channel"
              : missing.includes("status-observation")
                ? "emit-restart-status-observation"
                : manifest.nextAction ?? restartStatus.nextAction,
      }),
      nextAction: accepted
        ? "resume-runtime-job"
        : missing.includes("status-channel")
          ? "declare-status-channel"
          : missing.includes("audit-channel")
            ? "declare-audit-channel"
            : missing.includes("status-observation")
              ? "emit-restart-status-observation"
              : manifest.nextAction ?? restartStatus.nextAction,
    });
  }));
  const blockingDiagnostics = Array.from(diagnostics ?? []).filter((diagnostic) => diagnostic.severity !== "warning");
  const blocked = jobEntries.filter((entry) => !entry.accepted);
  const mailchimp = jobEntries.filter((entry) => entry.mailchimp);
  const statusChannels = Object.freeze([...new Set(jobEntries.map((entry) => entry.channels.status).filter(Boolean))].sort());
  const auditChannels = Object.freeze([...new Set(jobEntries.map((entry) => entry.channels.audit).filter(Boolean))].sort());
  const firstBlocked = blocked[0] ?? null;
  const reconciliationId = stableContractId(
    "grammar-runtime-restart-status",
    runtimeResumptionManifest.status,
    jobEntries.length,
    blocked.length,
  );

  return Object.freeze({
    schema: "aios.grammar.runtime-restart-status-reconciliation.v1",
    reconciliationId,
    accepted: blocked.length === 0 && blockingDiagnostics.length === 0 && runtimeResumptionManifest.ready,
    status: blockingDiagnostics.length > 0
      ? "diagnostic-review"
      : blocked.length === 0 && runtimeResumptionManifest.ready
        ? "restart-status-reconciled"
        : firstBlocked?.status ?? runtimeResumptionManifest.status,
    counters: Object.freeze({
      total: jobEntries.length,
      mailchimp: mailchimp.length,
      reconciled: jobEntries.filter((entry) => entry.accepted).length,
      blocked: blocked.length,
      diagnostics: blockingDiagnostics.length,
      statusChannels: statusChannels.length,
      auditChannels: auditChannels.length,
    }),
    channels: Object.freeze({
      status: statusChannels,
      audit: auditChannels,
    }),
    jobs: Object.freeze(jobEntries.map((entry) => entry.exportSummary)),
    blockedJobs: Object.freeze(blocked.map((entry) => Object.freeze({
      job: entry.job,
      status: entry.status,
      firstMissing: entry.exportSummary.firstMissing,
      missingStatuses: entry.missingStatuses,
      nextAction: entry.nextAction,
    }))),
    validationSummary: Object.freeze({
      runtimeResumptionReady: runtimeResumptionManifest.ready,
      diagnosticsReady: blockingDiagnostics.length === 0,
      allJobsReconciled: blocked.length === 0,
      statusReady: statusChannels.length > 0 || jobEntries.length === 0,
      auditReady: auditChannels.length > 0 || jobEntries.every((entry) => !entry.missing.includes("audit-channel")),
    }),
    controls: Object.freeze({
      canResumeAll: blocked.length === 0 && runtimeResumptionManifest.ready,
      canReplayMailchimp: mailchimp.length > 0 && mailchimp.every((entry) => entry.controls.canReplay),
      canEmitStatus: statusChannels.length > 0,
      canExportAudit: auditChannels.length > 0,
    }),
    exportSummary: Object.freeze({
      reconciliationId,
      status: blocked.length === 0 && blockingDiagnostics.length === 0 && runtimeResumptionManifest.ready
        ? "restart-status-reconciled"
        : "restart-status-review",
      blockedCount: blocked.length,
      firstBlockedJob: firstBlocked?.job ?? null,
      nextAction: blockingDiagnostics.length > 0
        ? "fix-blocking-diagnostics"
        : firstBlocked?.nextAction ?? runtimeResumptionManifest.nextAction,
    }),
    nextAction: blockingDiagnostics.length > 0
      ? "fix-blocking-diagnostics"
      : firstBlocked?.nextAction ?? runtimeResumptionManifest.nextAction,
  });
}

function createRuntimeTenantBoundarySummary(jobs) {
  const boundaries = Object.freeze(Array.from(jobs ?? []).map((job) => job.tenantPermissionBoundary));
  const blocked = boundaries.filter((boundary) => !boundary.allowed);
  const auditBlocked = blocked.filter((boundary) => boundary.audit.status === "audit-channel-missing");
  const permissionBlocked = blocked.filter((boundary) => boundary.missingPermissions.length > 0 || boundary.capabilityFailures.length > 0);
  const scopeBlocked = blocked.filter((boundary) => !Object.values(boundary.scopeChecks).every((check) => check.ok));
  const isolationKeys = Object.freeze([...new Set(boundaries.map((boundary) => boundary.isolationKey))].sort());
  const providers = Object.freeze([...new Set(boundaries.map((boundary) => boundary.provider).filter(Boolean))].sort());
  const missingPermissions = Object.freeze([...new Set(boundaries
    .flatMap((boundary) => boundary.missingPermissions))]
    .sort());
  const firstBlocked = blocked[0] ?? null;

  return Object.freeze({
    schema: "aios.grammar.runtime-tenant-boundary-summary.v1",
    ready: blocked.length === 0,
    status: blocked.length === 0
      ? "tenant-boundaries-ready"
      : scopeBlocked.length > 0
        ? "scope-review"
        : permissionBlocked.length > 0
          ? "permission-review"
          : auditBlocked.length > 0
            ? "audit-review"
            : "tenant-boundary-review",
    counters: Object.freeze({
      total: boundaries.length,
      ready: boundaries.length - blocked.length,
      blocked: blocked.length,
      scopeBlocked: scopeBlocked.length,
      permissionBlocked: permissionBlocked.length,
      auditBlocked: auditBlocked.length,
      mailchimp: boundaries.filter((boundary) => boundary.provider === "mailchimp").length,
    }),
    isolationKeys,
    providers,
    missingPermissions,
    blockedJobs: Object.freeze(blocked.map((boundary) => Object.freeze({
      isolationKey: boundary.isolationKey,
      provider: boundary.provider,
      operation: boundary.operation,
      status: boundary.status,
      scope: boundary.scope,
      missingPermissions: boundary.missingPermissions,
      auditStatus: boundary.audit.status,
      nextAction: boundary.nextAction,
    }))),
    controls: Object.freeze({
      canHandoffRuntime: blocked.length === 0,
      canExportAudit: boundaries.some((boundary) => Boolean(boundary.audit.channel)),
      canRunMailchimp: boundaries
        .filter((boundary) => boundary.provider === "mailchimp")
        .every((boundary) => boundary.allowed),
    }),
    exportSummary: Object.freeze({
      status: blocked.length === 0 ? "tenant-boundaries-ready" : "tenant-boundaries-review",
      blockedCount: blocked.length,
      firstBlockedIsolationKey: firstBlocked?.isolationKey ?? null,
      firstBlockedStatus: firstBlocked?.status ?? null,
      nextAction: firstBlocked?.nextAction ?? "handoff-runtime",
    }),
    nextAction: firstBlocked?.nextAction ?? "handoff-runtime",
  });
}

function createClientRuntimeSummary(jobs) {
  const handoffs = Object.freeze(Array.from(jobs ?? []).map((job) => job.clientRuntime));
  const mailchimp = handoffs.filter((handoff) => handoff.mailchimp);
  const blocked = handoffs.filter((handoff) => !handoff.readiness.accepted);
  const mutating = mailchimp.filter((handoff) => handoff.mutatesProvider);
  const statusChannels = Object.freeze([...new Set(handoffs.flatMap((handoff) => (
    handoff.statusChannels.map((channel) => channel.channel)
  )))]);
  const restartSafeJobs = jobs.filter((job) => job.persistedState.restartSafe);
  const restartBlocked = jobs.filter((job) => !job.persistedState.restartSafe);
  const boundaryBlocked = jobs.filter((job) => !job.tenantPermissionBoundary.allowed);
  const intentBlocked = jobs.filter((job) => !job.clientExecutionIntent.accepted);

  return Object.freeze({
    schema: "aios.grammar.client-runtime-summary.v1",
    handoffCount: handoffs.length,
    mailchimpCount: mailchimp.length,
    mutatingMailchimpCount: mutating.length,
    statusChannels,
    restartSafe: handoffs.every((handoff) => handoff.restore.restartSafe) && restartBlocked.length === 0,
    tenantBoundaryReady: boundaryBlocked.length === 0,
    persistedStateKeys: Object.freeze(jobs.map((job) => job.persistedState.stateKey)),
    isolationKeys: Object.freeze(jobs.map((job) => job.tenantPermissionBoundary.isolationKey)),
    restartSafeJobCount: restartSafeJobs.length,
    executionIntentReady: intentBlocked.length === 0,
    ready: blocked.length === 0 && boundaryBlocked.length === 0 && intentBlocked.length === 0,
    blockedJobs: Object.freeze(blocked.map((handoff) => Object.freeze({
      job: handoff.job,
      missing: handoff.readiness.missing,
      nextAction: handoff.readiness.nextAction,
    }))),
    restartBlockedJobs: Object.freeze(restartBlocked.map((job) => Object.freeze({
      job: job.name,
      stateKey: job.persistedState.stateKey,
      missing: job.persistedState.missing,
      nextAction: job.persistedState.nextAction,
    }))),
    boundaryBlockedJobs: Object.freeze(boundaryBlocked.map((job) => Object.freeze({
      job: job.name,
      isolationKey: job.tenantPermissionBoundary.isolationKey,
      status: job.tenantPermissionBoundary.status,
      missingPermissions: job.tenantPermissionBoundary.missingPermissions,
      nextAction: job.tenantPermissionBoundary.nextAction,
    }))),
    executionIntentBlockedJobs: Object.freeze(intentBlocked.map((job) => Object.freeze({
      job: job.name,
      intentId: job.clientExecutionIntent.intentId,
      status: job.clientExecutionIntent.status,
      missing: job.clientExecutionIntent.validationSummary.missing,
      nextAction: job.clientExecutionIntent.nextAction,
    }))),
    nextAction: blocked.length === 0
      ? boundaryBlocked.length > 0
        ? boundaryBlocked[0].tenantPermissionBoundary.nextAction
        : intentBlocked.length > 0
          ? intentBlocked[0].clientExecutionIntent.nextAction
          : restartBlocked.length === 0 ? "handoff-client-runtime" : restartBlocked[0].persistedState.nextAction
      : blocked.some((handoff) => handoff.readiness.missing.includes("restart-safe-recovery"))
        ? "declare-recovery-contract"
        : blocked.some((handoff) => handoff.readiness.missing.includes("status-channel"))
          ? "declare-status-channel"
      : "complete-runtime-boundary",
  });
}

function countContractsByStatus(jobs, selector) {
  const counters = {};
  for (const job of jobs ?? []) {
    const status = selector(job) ?? "unknown";
    counters[status] = (counters[status] ?? 0) + 1;
  }

  return Object.freeze(Object.fromEntries(Object.entries(counters).sort(([left], [right]) => left.localeCompare(right))));
}

function diagnosticExportCounters(diagnostics) {
  const severity = { error: 0, warning: 0, info: 0 };
  const byCode = {};

  for (const diagnostic of diagnostics ?? []) {
    const level = diagnostic?.severity ?? "error";
    severity[level] = (severity[level] ?? 0) + 1;
    const code = diagnostic?.code ?? "GRAMMAR_UNKNOWN";
    byCode[code] = (byCode[code] ?? 0) + 1;
  }

  return Object.freeze({
    severity: Object.freeze(severity),
    byCode: Object.freeze(Object.fromEntries(Object.entries(byCode).sort(([left], [right]) => left.localeCompare(right)))),
  });
}

function createRuntimeExportTimeline(jobs, diagnostics, clientRuntime) {
  const blocking = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const mailchimpJobs = jobs.filter((job) => job.handoff.mailchimp);
  const boundaryBlocked = jobs.filter((job) => !job.tenantPermissionBoundary.allowed);
  const restartBlocked = jobs.filter((job) => !job.persistedState.restartSafe);

  return Object.freeze([
    Object.freeze({
      schema: "aios.grammar.runtime-export.timeline-event.v1",
      label: "parse",
      status: blocking.length === 0 ? "accepted" : "blocked",
      jobCount: jobs.length,
      diagnosticCount: diagnostics.length,
      nextAction: blocking.length === 0 ? "build-runtime-contracts" : "fix-blocking-diagnostics",
    }),
    Object.freeze({
      schema: "aios.grammar.runtime-export.timeline-event.v1",
      label: "mailchimp-handoff",
      status: mailchimpJobs.length === 0
        ? "not-required"
        : mailchimpJobs.every((job) => job.handoff.status === "declared")
          ? "declared"
          : "missing-adapter",
      jobCount: mailchimpJobs.length,
      mutatingCount: mailchimpJobs.filter((job) => job.handoff.mutatesProvider).length,
      nextAction: mailchimpJobs.every((job) => job.handoff.status === "declared")
        ? "verify-mailchimp-boundaries"
        : "declare-provider-adapter",
    }),
    Object.freeze({
      schema: "aios.grammar.runtime-export.timeline-event.v1",
      label: "tenant-boundary",
      status: boundaryBlocked.length === 0 ? "scoped" : "review",
      blockedCount: boundaryBlocked.length,
      nextAction: boundaryBlocked[0]?.tenantPermissionBoundary.nextAction ?? "persist-runtime-state",
    }),
    Object.freeze({
      schema: "aios.grammar.runtime-export.timeline-event.v1",
      label: "restart-status",
      status: restartBlocked.length === 0 ? "restart-safe" : "restart-review",
      blockedCount: restartBlocked.length,
      nextAction: restartBlocked[0]?.persistedState.nextAction ?? "prepare-client-runtime",
    }),
    Object.freeze({
      schema: "aios.grammar.runtime-export.timeline-event.v1",
      label: "client-runtime",
      status: clientRuntime.ready ? "ready" : "review",
      handoffCount: clientRuntime.handoffCount,
      nextAction: clientRuntime.nextAction,
    }),
  ]);
}

function createMailchimpPublishControls(mailchimpJobs, diagnostics, clientRuntime) {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const permissionBlocked = mailchimpJobs.filter((job) => job.tenantPermissionBoundary.missingPermissions.length > 0);
  const boundaryBlocked = mailchimpJobs.filter((job) => !job.tenantPermissionBoundary.allowed);
  const restartBlocked = mailchimpJobs.filter((job) => !job.persistedState.restartSafe);
  const statusBlocked = mailchimpJobs.filter((job) => !job.status.observable);
  const intentBlocked = mailchimpJobs.filter((job) => !job.clientExecutionIntent.accepted);
  const operatorBlocked = mailchimpJobs.filter((job) => !job.mailchimpOperatorGate.accepted);
  const lifecycleBlocked = mailchimpJobs.filter((job) => !job.mailchimpLifecycleControl.accepted);
  const mutatingWithoutIdempotency = mailchimpJobs.filter((job) => job.handoff.mutatesProvider && !job.recovery.idempotencyKey);
  const disabled = mailchimpJobs.length === 0;
  const acceptedJobs = mailchimpJobs.filter((job) => (
    job.ready
    && job.tenantPermissionBoundary.allowed
    && job.persistedState.restartSafe
    && job.status.observable
  ));
  const ready = !disabled
    && blockingDiagnostics.length === 0
    && permissionBlocked.length === 0
    && boundaryBlocked.length === 0
    && restartBlocked.length === 0
    && statusBlocked.length === 0
    && intentBlocked.length === 0
    && operatorBlocked.length === 0
    && lifecycleBlocked.length === 0
    && clientRuntime.ready;
  const missing = Object.freeze([
    disabled ? "mailchimp-job" : null,
    blockingDiagnostics.length > 0 ? "blocking-diagnostics" : null,
    permissionBlocked.length > 0 ? "mailchimp-permissions" : null,
    boundaryBlocked.length > 0 ? "tenant-boundary" : null,
    restartBlocked.length > 0 ? "restart-safe-state" : null,
    statusBlocked.length > 0 ? "status-channel" : null,
    intentBlocked.length > 0 ? "client-execution-intent" : null,
    operatorBlocked.length > 0 ? "mailchimp-operator-gate" : null,
    lifecycleBlocked.length > 0 ? "mailchimp-lifecycle-control" : null,
    !clientRuntime.ready ? "client-runtime-readiness" : null,
  ].filter(Boolean));
  const firstBlockedJob = permissionBlocked[0] ?? boundaryBlocked[0] ?? restartBlocked[0] ?? statusBlocked[0] ?? intentBlocked[0] ?? operatorBlocked[0] ?? lifecycleBlocked[0] ?? null;

  return Object.freeze({
    schema: "aios.grammar.mailchimp-publish-controls.v1",
    ready,
    enabled: !disabled,
    acceptedJobCount: acceptedJobs.length,
    missing,
    status: disabled
      ? "disabled"
      : ready
        ? "publish-ready"
        : permissionBlocked.length > 0
          ? "permission-review"
          : boundaryBlocked.length > 0
            ? "boundary-review"
            : restartBlocked.length > 0
              ? "restart-review"
              : statusBlocked.length > 0
                ? "status-review"
                : intentBlocked.length > 0
                  ? intentBlocked[0].clientExecutionIntent.status
                  : operatorBlocked.length > 0
                    ? operatorBlocked[0].mailchimpOperatorGate.status
                    : lifecycleBlocked.length > 0
                      ? lifecycleBlocked[0].mailchimpLifecycleControl.status
                : "client-runtime-review",
    controls: Object.freeze({
      canEnable: disabled,
      canDisable: !disabled,
      canAccept: !disabled && blockingDiagnostics.length === 0 && permissionBlocked.length === 0 && boundaryBlocked.length === 0,
      canSchedule: ready && mutatingWithoutIdempotency.length === 0 && operatorBlocked.length === 0 && lifecycleBlocked.length === 0,
      canPublish: ready,
      canPreview: !disabled && blockingDiagnostics.length === 0,
    }),
    schedule: Object.freeze({
      mode: ready ? "manual-approval" : "blocked",
      mutatingJobCount: mailchimpJobs.filter((job) => job.handoff.mutatesProvider).length,
      idempotentMutatingJobCount: mailchimpJobs.filter((job) => job.handoff.mutatesProvider && job.recovery.idempotencyKey).length,
      blockedMutatingJobs: Object.freeze(mutatingWithoutIdempotency.map((job) => Object.freeze({
        job: job.name,
        adapter: job.handoff.adapter,
        nextAction: "declare-idempotency-key",
      }))),
    }),
    preview: Object.freeze({
      jobs: Object.freeze(mailchimpJobs.map((job) => Object.freeze({
        job: job.name,
        adapter: job.handoff.adapter,
        operation: job.handoff.operation,
        mutatesProvider: job.handoff.mutatesProvider,
        ready: job.ready,
        statusChannel: job.status.channel,
        auditChannel: job.status.auditChannel,
        stateKey: job.persistedState.stateKey,
        isolationKey: job.tenantPermissionBoundary.isolationKey,
        executionIntentId: job.clientExecutionIntent.intentId,
        executionIntentStatus: job.clientExecutionIntent.status,
        operatorGateId: job.mailchimpOperatorGate.gateId,
        operatorGateStatus: job.mailchimpOperatorGate.status,
        operatorGateMode: job.mailchimpOperatorGate.mode,
        lifecycleControlId: job.mailchimpLifecycleControl.controlId,
        lifecycleControlStatus: job.mailchimpLifecycleControl.status,
        lifecycleControlMode: job.mailchimpLifecycleControl.schedule.mode,
        nextAction: job.ready ? "accept-mailchimp-runtime-preview" : job.clientRuntime.readiness.nextAction,
      }))),
      diagnostics: diagnosticExportCounters(diagnostics),
    }),
    nextAction: ready
      ? "publish-mailchimp-runtime-export"
      : disabled
        ? "add-mailchimp-handoff-job"
        : blockingDiagnostics.length > 0
          ? "fix-blocking-diagnostics"
          : firstBlockedJob?.tenantPermissionBoundary?.missingPermissions?.length > 0
            ? firstBlockedJob.tenantPermissionBoundary.nextAction
            : restartBlocked[0]?.persistedState.nextAction
              ?? statusBlocked[0]?.status.nextAction
              ?? intentBlocked[0]?.clientExecutionIntent.nextAction
              ?? operatorBlocked[0]?.mailchimpOperatorGate.nextAction
              ?? lifecycleBlocked[0]?.mailchimpLifecycleControl.nextAction
              ?? clientRuntime.nextAction,
  });
}

function createMailchimpPreviewAcceptanceReport(mailchimpJobs, diagnostics, clientRuntime, publishControls) {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const summaries = Object.freeze(mailchimpJobs.map((job) => {
    const service = job.externalProviderService;
    const boundaryReady = job.tenantPermissionBoundary.allowed;
    const restartReady = job.persistedState.restartSafe;
    const statusReady = job.status.observable;
    const providerReady = service.accepted;
    const operatorReady = job.mailchimpOperatorGate.accepted;
    const lifecycleReady = job.mailchimpLifecycleControl.accepted;
    const acceptanceReady = job.ready && boundaryReady && restartReady && statusReady && providerReady && operatorReady && lifecycleReady;
    const missing = Object.freeze([
      boundaryReady ? null : "tenant-boundary",
      job.tenantPermissionBoundary.missingPermissions.length > 0 ? "mailchimp-permissions" : null,
      restartReady ? null : "restart-safe-state",
      statusReady ? null : "status-channel",
      job.tenantPermissionBoundary.audit.status === "audit-ready" || !job.tenantPermissionBoundary.audit.required ? null : "audit-channel",
      providerReady ? null : "provider-service",
      operatorReady ? null : "mailchimp-operator-gate",
      lifecycleReady ? null : "mailchimp-lifecycle-control",
      job.handoff.mutatesProvider && !job.recovery.idempotencyKey ? "idempotency-key" : null,
    ].filter(Boolean));
    const nextStep = acceptanceReady
      ? "handoff-mailchimp-runtime"
      : missing.includes("tenant-boundary") || missing.includes("mailchimp-permissions")
        ? job.tenantPermissionBoundary.nextAction
        : missing.includes("restart-safe-state")
          ? job.persistedState.nextAction
          : missing.includes("status-channel")
            ? "declare-status-channel"
            : missing.includes("audit-channel")
              ? "declare-audit-channel"
              : missing.includes("idempotency-key")
                ? "declare-idempotency-key"
                : missing.includes("mailchimp-operator-gate")
                  ? job.mailchimpOperatorGate.nextAction
                  : missing.includes("mailchimp-lifecycle-control")
                    ? job.mailchimpLifecycleControl.nextAction
                : service.nextAction;

    return Object.freeze({
      schema: "aios.grammar.mailchimp-preview-acceptance.job.v1",
      job: job.name,
      adapter: job.handoff.adapter,
      operation: job.handoff.operation,
      mutatesProvider: job.handoff.mutatesProvider,
      accepted: acceptanceReady,
      status: acceptanceReady
        ? "accepted"
        : missing.includes("mailchimp-permissions")
          ? "permission-review"
          : missing.includes("tenant-boundary")
            ? "boundary-review"
            : missing.includes("restart-safe-state")
              ? "restart-review"
              : missing.includes("status-channel")
                ? "status-review"
                : missing.includes("audit-channel")
                  ? "audit-review"
                  : missing.includes("idempotency-key")
                    ? "idempotency-review"
                    : missing.includes("mailchimp-operator-gate")
                      ? job.mailchimpOperatorGate.status
                      : missing.includes("mailchimp-lifecycle-control")
                        ? job.mailchimpLifecycleControl.status
                    : service.handoffState.status,
      missing,
      validationSummary: Object.freeze({
        boundaryReady,
        permissionsReady: job.tenantPermissionBoundary.missingPermissions.length === 0,
        restartReady,
        statusReady,
        auditReady: job.tenantPermissionBoundary.audit.status === "audit-ready" || !job.tenantPermissionBoundary.audit.required,
        providerReady,
        operatorReady,
        lifecycleReady,
        clientReady: job.clientRuntime.readiness.accepted,
      }),
      preview: Object.freeze({
        stateKey: job.persistedState.stateKey,
        isolationKey: job.tenantPermissionBoundary.isolationKey,
        serviceKey: service.serviceKey,
        statusChannel: job.status.channel,
        auditChannel: job.status.auditChannel,
        requiredPermissions: job.handoff.requiredPermissions,
        missingPermissions: job.tenantPermissionBoundary.missingPermissions,
        operatorGateId: job.mailchimpOperatorGate.gateId,
        operatorGateMode: job.mailchimpOperatorGate.mode,
        operatorGateStatus: job.mailchimpOperatorGate.status,
        lifecycleControlId: job.mailchimpLifecycleControl.controlId,
        lifecycleControlMode: job.mailchimpLifecycleControl.schedule.mode,
        lifecycleControlStatus: job.mailchimpLifecycleControl.status,
      }),
      controls: Object.freeze({
        canPreview: blockingDiagnostics.length === 0,
        canAccept: blockingDiagnostics.length === 0 && boundaryReady && statusReady,
        canSchedule: acceptanceReady && (!job.handoff.mutatesProvider || Boolean(job.recovery.idempotencyKey)),
        canPublish: acceptanceReady && publishControls.ready,
      }),
      nextStep: Object.freeze({
        label: acceptanceReady ? "Mailchimp runtime handoff" : nextStep,
        action: nextStep,
        requiresOperator: !acceptanceReady,
        retryable: !acceptanceReady && (missing.includes("restart-safe-state") || missing.includes("provider-service")),
      }),
      nextAction: nextStep,
    });
  }));
  const accepted = summaries.filter((summary) => summary.accepted);
  const blocked = summaries.filter((summary) => !summary.accepted);
  const missing = Object.freeze([...new Set(blocked.flatMap((summary) => summary.missing))].sort());
  const firstBlocked = blocked[0] ?? null;

  return Object.freeze({
    schema: "aios.grammar.mailchimp-preview-acceptance.report.v1",
    ready: mailchimpJobs.length > 0
      && blockingDiagnostics.length === 0
      && blocked.length === 0
      && clientRuntime.ready
      && publishControls.ready,
    status: mailchimpJobs.length === 0
      ? "not-required"
      : blockingDiagnostics.length > 0
        ? "diagnostic-review"
        : blocked.length === 0 && publishControls.ready
          ? "accepted"
          : firstBlocked?.status ?? publishControls.status,
    acceptedJobCount: accepted.length,
    blockedJobCount: blocked.length,
    missing,
    validationSummary: Object.freeze({
      diagnosticsReady: blockingDiagnostics.length === 0,
      clientRuntimeReady: clientRuntime.ready,
      publishReady: publishControls.ready,
      allJobsAccepted: mailchimpJobs.length > 0 && blocked.length === 0,
    }),
    summaries,
    controls: Object.freeze({
      canPreview: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0,
      canAcceptAll: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0 && blocked.every((summary) => !summary.missing.includes("mailchimp-permissions")),
      canSchedule: publishControls.controls.canSchedule && blocked.length === 0,
      canPublish: publishControls.controls.canPublish && blocked.length === 0,
    }),
    nextStep: Object.freeze({
      label: blocked.length === 0 ? "Publish Mailchimp runtime export" : firstBlocked.nextStep.label,
      action: mailchimpJobs.length === 0
        ? "continue"
        : blockingDiagnostics.length > 0
          ? "fix-blocking-diagnostics"
          : firstBlocked?.nextAction ?? publishControls.nextAction,
      requiresOperator: mailchimpJobs.length > 0 && (blockingDiagnostics.length > 0 || blocked.length > 0),
      retryable: Boolean(firstBlocked?.nextStep.retryable),
    }),
    nextAction: mailchimpJobs.length === 0
      ? "continue"
      : blockingDiagnostics.length > 0
        ? "fix-blocking-diagnostics"
        : firstBlocked?.nextAction ?? publishControls.nextAction,
  });
}

function createMailchimpClientAdoptionPlan(mailchimpJobs, diagnostics, clientRuntime, previewAcceptance) {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const adoptionJobs = Object.freeze(mailchimpJobs.map((job) => {
    const provider = job.externalProviderService;
    const restartSafe = job.persistedState.restartSafe && provider.recovery.restartSafe;
    const boundaryReady = job.tenantPermissionBoundary.allowed;
    const statusReady = Boolean(job.status.channel || job.status.auditChannel);
    const auditReady = !job.tenantPermissionBoundary.audit.required || job.tenantPermissionBoundary.audit.status === "audit-ready";
    const accepted = job.ready
      && provider.accepted
      && restartSafe
      && boundaryReady
      && statusReady
      && auditReady
      && blockingDiagnostics.length === 0;
    const missing = Object.freeze([
      blockingDiagnostics.length > 0 ? "blocking-diagnostics" : null,
      boundaryReady ? null : "tenant-boundary",
      job.tenantPermissionBoundary.missingPermissions.length > 0 ? "mailchimp-permissions" : null,
      restartSafe ? null : "restart-safe-state",
      statusReady ? null : "status-channel",
      auditReady ? null : "audit-channel",
      provider.accepted ? null : "provider-service",
      job.handoff.mutatesProvider && !job.recovery.idempotencyKey ? "idempotency-key" : null,
    ].filter(Boolean));
    const adoptionKey = stableContractId(
      "mailchimp-client-adoption",
      job.persistedState.stateKey,
      provider.serviceKey,
      job.status.channel ?? job.status.auditChannel,
    );

    return Object.freeze({
      schema: "aios.grammar.mailchimp-client-adoption.job.v1",
      job: job.name,
      adoptionKey,
      adapter: job.handoff.adapter,
      operation: job.handoff.operation,
      accepted,
      status: accepted
        ? "adoption-ready"
        : missing.includes("blocking-diagnostics")
          ? "diagnostic-review"
          : missing.includes("tenant-boundary") || missing.includes("mailchimp-permissions")
            ? job.tenantPermissionBoundary.status
            : missing.includes("restart-safe-state")
              ? job.persistedState.statusMirror.restartStatus
              : missing.includes("status-channel")
                ? "status-review"
                : missing.includes("audit-channel")
                  ? "audit-review"
                  : missing.includes("idempotency-key")
                    ? "idempotency-review"
                    : provider.handoffState.status,
      missing,
      clientState: Object.freeze({
        workspace: job.clientRuntime.clientVisibleState.workspace,
        tenant: job.clientRuntime.clientVisibleState.tenant,
        role: job.clientRuntime.clientVisibleState.role,
        stateKey: job.persistedState.stateKey,
        serviceKey: provider.serviceKey,
        isolationKey: job.tenantPermissionBoundary.isolationKey,
        statusChannel: job.status.channel,
        auditChannel: job.status.auditChannel,
        idempotencyKey: job.recovery.idempotencyKey,
      }),
      workflow: Object.freeze({
        canPreview: blockingDiagnostics.length === 0,
        canAccept: blockingDiagnostics.length === 0 && boundaryReady && statusReady,
        canPersist: restartSafe,
        canHandoffClient: accepted,
      }),
      nextAction: accepted
        ? "handoff-mailchimp-client-runtime"
        : missing.includes("blocking-diagnostics")
          ? "fix-blocking-diagnostics"
          : missing.includes("tenant-boundary") || missing.includes("mailchimp-permissions")
            ? job.tenantPermissionBoundary.nextAction
            : missing.includes("restart-safe-state")
              ? job.persistedState.nextAction
              : missing.includes("status-channel")
                ? "declare-status-channel"
                : missing.includes("audit-channel")
                  ? "declare-audit-channel"
                  : missing.includes("idempotency-key")
                    ? "declare-idempotency-key"
                    : provider.nextAction,
    });
  }));
  const blocked = adoptionJobs.filter((job) => !job.accepted);
  const firstBlocked = blocked[0] ?? null;
  const missing = Object.freeze([...new Set(blocked.flatMap((job) => job.missing))].sort());
  const ready = mailchimpJobs.length > 0
    && blocked.length === 0
    && clientRuntime.ready
    && previewAcceptance.ready;

  return Object.freeze({
    schema: "aios.grammar.mailchimp-client-adoption.plan.v1",
    ready,
    status: mailchimpJobs.length === 0
      ? "not-required"
      : ready
        ? "ready-for-client-runtime"
        : firstBlocked?.status ?? previewAcceptance.status,
    acceptedJobCount: adoptionJobs.filter((job) => job.accepted).length,
    blockedJobCount: blocked.length,
    missing,
    jobs: adoptionJobs,
    validationSummary: Object.freeze({
      diagnosticsReady: blockingDiagnostics.length === 0,
      clientRuntimeReady: clientRuntime.ready,
      previewAccepted: previewAcceptance.ready,
      allJobsAccepted: mailchimpJobs.length > 0 && blocked.length === 0,
    }),
    controls: Object.freeze({
      canPreview: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0,
      canAccept: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0 && blocked.every((job) => !job.missing.includes("mailchimp-permissions")),
      canPersist: blocked.every((job) => !job.missing.includes("restart-safe-state")),
      canHandoffClient: ready,
    }),
    exportSummary: Object.freeze({
      status: ready ? "adoption-ready" : mailchimpJobs.length === 0 ? "not-required" : "review",
      acceptedJobCount: adoptionJobs.filter((job) => job.accepted).length,
      blockedJobCount: blocked.length,
      missing,
      nextAction: ready ? "handoff-mailchimp-client-runtime" : firstBlocked?.nextAction ?? previewAcceptance.nextAction,
    }),
    nextAction: ready ? "handoff-mailchimp-client-runtime" : firstBlocked?.nextAction ?? previewAcceptance.nextAction,
  });
}

function createMailchimpExternalHandoffManifest(mailchimpJobs, diagnostics, clientRuntime, publishControls, previewAcceptance, clientAdoption) {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const jobs = Object.freeze(mailchimpJobs.map((job) => {
    const service = job.externalProviderService;
    const preview = previewAcceptance.summaries.find((entry) => entry.job === job.name) ?? null;
    const adoption = clientAdoption.jobs.find((entry) => entry.job === job.name) ?? null;
    const statusChannel = job.status.channel ?? service.sync.statusChannel ?? null;
    const auditChannel = job.status.auditChannel ?? service.sync.auditChannel ?? null;
    const commandId = stableContractId(
      "mailchimp-external-handoff",
      job.persistedState.stateKey,
      service.serviceKey,
      statusChannel,
    );
    const statusCommandId = stableContractId(
      "mailchimp-external-status",
      job.persistedState.stateKey,
      service.serviceKey,
      auditChannel ?? statusChannel,
    );
    const restartReady = job.persistedState.restartSafe && service.recovery.restartSafe;
    const statusReady = Boolean(statusChannel || auditChannel);
    const auditReady = !job.tenantPermissionBoundary.audit.required || job.tenantPermissionBoundary.audit.status === "audit-ready";
    const accepted = blockingDiagnostics.length === 0
      && job.ready
      && service.accepted
      && restartReady
      && statusReady
      && auditReady
      && Boolean(preview?.accepted)
      && Boolean(adoption?.accepted);
    const missing = Object.freeze([
      blockingDiagnostics.length > 0 ? "blocking-diagnostics" : null,
      job.tenantPermissionBoundary.allowed ? null : "tenant-boundary",
      job.tenantPermissionBoundary.missingPermissions.length > 0 ? "mailchimp-permissions" : null,
      service.accepted ? null : "provider-service",
      restartReady ? null : "restart-safe-state",
      statusReady ? null : "status-channel",
      auditReady ? null : "audit-channel",
      preview?.accepted ? null : "preview-acceptance",
      adoption?.accepted ? null : "client-adoption",
      job.handoff.mutatesProvider && !job.recovery.idempotencyKey ? "idempotency-key" : null,
    ].filter(Boolean));

    return Object.freeze({
      schema: "aios.grammar.mailchimp-external-handoff-manifest.job.v1",
      job: job.name,
      adapter: job.handoff.adapter,
      operation: job.handoff.operation,
      accepted,
      status: accepted
        ? "manifest-ready"
        : missing.includes("blocking-diagnostics")
          ? "diagnostic-review"
          : missing.includes("tenant-boundary") || missing.includes("mailchimp-permissions")
            ? job.tenantPermissionBoundary.status
            : missing.includes("provider-service")
              ? service.handoffState.status
              : missing.includes("restart-safe-state")
                ? job.persistedState.statusMirror.restartStatus
                : missing.includes("status-channel")
                  ? "status-review"
                  : missing.includes("audit-channel")
                    ? "audit-review"
                    : missing.includes("idempotency-key")
                      ? "idempotency-review"
                      : "preview-review",
      missing,
      boundary: Object.freeze({
        workspace: job.clientRuntime.clientVisibleState.workspace,
        tenant: job.clientRuntime.clientVisibleState.tenant,
        role: job.clientRuntime.clientVisibleState.role,
        isolationKey: job.tenantPermissionBoundary.isolationKey,
      }),
      sync: Object.freeze({
        stateKey: job.persistedState.stateKey,
        serviceKey: service.serviceKey,
        statusChannel,
        auditChannel,
        checkpoint: service.sync.checkpoint,
        idempotencyKey: job.recovery.idempotencyKey,
      }),
      commands: Object.freeze([
        Object.freeze({
          id: commandId,
          kind: "mailchimp-external-handoff",
          idempotent: !job.handoff.mutatesProvider || Boolean(job.recovery.idempotencyKey),
          writesProvider: job.handoff.mutatesProvider,
          status: accepted ? "ready" : "blocked",
          nextAction: accepted ? "handoff-external-provider" : service.nextAction,
        }),
        Object.freeze({
          id: statusCommandId,
          kind: "mailchimp-status-observe",
          idempotent: true,
          writesProvider: false,
          status: statusReady ? "ready" : "blocked",
          nextAction: statusReady ? "emit-runtime-status" : "declare-status-channel",
        }),
      ]),
      controls: Object.freeze({
        canPreview: blockingDiagnostics.length === 0,
        canAccept: blockingDiagnostics.length === 0 && job.tenantPermissionBoundary.allowed && statusReady,
        canPersist: restartReady,
        canReplayCommands: restartReady && (!job.handoff.mutatesProvider || Boolean(job.recovery.idempotencyKey)),
        canHandoffProvider: accepted,
      }),
      nextAction: accepted
        ? "handoff-external-provider"
        : missing.includes("blocking-diagnostics")
          ? "fix-blocking-diagnostics"
          : missing.includes("tenant-boundary") || missing.includes("mailchimp-permissions")
            ? job.tenantPermissionBoundary.nextAction
            : missing.includes("provider-service")
              ? service.nextAction
              : missing.includes("restart-safe-state")
                ? job.persistedState.nextAction
                : missing.includes("status-channel")
                  ? "declare-status-channel"
                  : missing.includes("audit-channel")
                    ? "declare-audit-channel"
                    : missing.includes("idempotency-key")
                      ? "declare-idempotency-key"
                      : preview?.nextAction ?? clientAdoption.nextAction,
    });
  }));
  const blocked = jobs.filter((job) => !job.accepted);
  const firstBlocked = blocked[0] ?? null;
  const manifestId = stableContractId(
    "mailchimp-external-handoff-manifest",
    mailchimpJobs.length,
    publishControls.status,
    clientRuntime.ready ? "client-ready" : "client-review",
  );
  const ready = mailchimpJobs.length > 0
    && blocked.length === 0
    && clientRuntime.ready
    && publishControls.ready
    && previewAcceptance.ready
    && clientAdoption.ready;

  return Object.freeze({
    schema: "aios.grammar.mailchimp-external-handoff-manifest.v1",
    manifestId,
    ready,
    status: mailchimpJobs.length === 0
      ? "not-required"
      : ready
        ? "manifest-ready"
        : firstBlocked?.status ?? publishControls.status,
    acceptedJobCount: jobs.filter((job) => job.accepted).length,
    blockedJobCount: blocked.length,
    missing: Object.freeze([...new Set(blocked.flatMap((job) => job.missing))].sort()),
    jobs,
    validationSummary: Object.freeze({
      diagnosticsReady: blockingDiagnostics.length === 0,
      clientRuntimeReady: clientRuntime.ready,
      publishReady: publishControls.ready,
      previewAccepted: previewAcceptance.ready,
      clientAdoptionReady: clientAdoption.ready,
      allJobsAccepted: mailchimpJobs.length > 0 && blocked.length === 0,
    }),
    controls: Object.freeze({
      canPreview: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0,
      canAccept: jobs.length > 0 && jobs.every((job) => job.controls.canAccept),
      canPersist: jobs.length > 0 && jobs.every((job) => job.controls.canPersist),
      canReplayCommands: jobs.length > 0 && jobs.every((job) => job.controls.canReplayCommands),
      canHandoffProvider: ready,
      canPublish: ready && publishControls.controls.canPublish,
    }),
    exportSummary: Object.freeze({
      manifestId,
      status: ready ? "manifest-ready" : mailchimpJobs.length === 0 ? "not-required" : "manifest-review",
      acceptedJobCount: jobs.filter((job) => job.accepted).length,
      blockedJobCount: blocked.length,
      commandIds: Object.freeze(jobs.flatMap((job) => job.commands.map((command) => command.id))),
      nextAction: ready ? "publish-mailchimp-external-handoff-manifest" : firstBlocked?.nextAction ?? publishControls.nextAction,
    }),
    nextAction: ready ? "publish-mailchimp-external-handoff-manifest" : firstBlocked?.nextAction ?? publishControls.nextAction,
  });
}

function createMailchimpRuntimeLifecycleReport(mailchimpJobs, diagnostics, publishControls, previewAcceptance, clientAdoption, externalHandoffManifest) {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const mutatingJobs = mailchimpJobs.filter((job) => job.handoff.mutatesProvider);
  const statusChannels = Object.freeze([...new Set(mailchimpJobs
    .map((job) => job.status.channel ?? job.status.auditChannel)
    .filter(Boolean))].sort());
  const auditChannels = Object.freeze([...new Set(mailchimpJobs
    .map((job) => job.status.auditChannel)
    .filter(Boolean))].sort());
  const phaseInputs = Object.freeze([
    Object.freeze({
      label: "diagnostics",
      accepted: blockingDiagnostics.length === 0,
      status: blockingDiagnostics.length === 0 ? "clear" : "blocked",
      nextAction: blockingDiagnostics.length === 0 ? "continue" : "fix-blocking-diagnostics",
      count: blockingDiagnostics.length,
    }),
    Object.freeze({
      label: "publish-controls",
      accepted: publishControls.ready,
      status: publishControls.status,
      nextAction: publishControls.nextAction,
      count: publishControls.missing.length,
    }),
    Object.freeze({
      label: "preview-acceptance",
      accepted: previewAcceptance.ready,
      status: previewAcceptance.status,
      nextAction: previewAcceptance.nextAction,
      count: previewAcceptance.blockedJobCount,
    }),
    Object.freeze({
      label: "client-adoption",
      accepted: clientAdoption.ready,
      status: clientAdoption.status,
      nextAction: clientAdoption.nextAction,
      count: clientAdoption.blockedJobCount,
    }),
    Object.freeze({
      label: "external-handoff-manifest",
      accepted: externalHandoffManifest.ready,
      status: externalHandoffManifest.status,
      nextAction: externalHandoffManifest.nextAction,
      count: externalHandoffManifest.blockedJobCount,
    }),
  ]);
  const phases = Object.freeze(phaseInputs.map((phase, index) => Object.freeze({
    schema: "aios.grammar.mailchimp-runtime-lifecycle.phase.v1",
    index,
    label: phase.label,
    accepted: phase.accepted,
    status: phase.status,
    count: phase.count,
    nextAction: phase.nextAction,
  })));
  const blocked = phases.filter((phase) => !phase.accepted);
  const historySnapshots = Object.freeze(mailchimpJobs.map((job) => Object.freeze({
    schema: "aios.grammar.mailchimp-runtime-lifecycle.history.v1",
    job: job.name,
    stateKey: job.persistedState.stateKey,
    serviceKey: job.externalProviderService.serviceKey,
    isolationKey: job.tenantPermissionBoundary.isolationKey,
    adapter: job.handoff.adapter,
    operation: job.handoff.operation,
    mutatesProvider: job.handoff.mutatesProvider,
    restartStatus: job.restartStatus.status,
    providerStatus: job.externalProviderService.handoffState.status,
    executionIntentStatus: job.clientExecutionIntent.status,
    statusChannel: job.status.channel,
    auditChannel: job.status.auditChannel,
    nextAction: job.ready ? "continue" : job.clientExecutionIntent.nextAction,
  })));
  const reportId = stableContractId(
    "mailchimp-runtime-lifecycle",
    mailchimpJobs.length,
    externalHandoffManifest.manifestId ?? "manifest",
    statusChannels[0] ?? "status",
  );
  const ready = mailchimpJobs.length > 0 && blocked.length === 0;

  return Object.freeze({
    schema: "aios.grammar.mailchimp-runtime-lifecycle.report.v1",
    reportId,
    ready,
    status: mailchimpJobs.length === 0
      ? "not-required"
      : ready
        ? "lifecycle-ready"
        : blocked[0]?.status ?? "lifecycle-review",
    counters: Object.freeze({
      mailchimpJobs: mailchimpJobs.length,
      mutatingJobs: mutatingJobs.length,
      blockingDiagnostics: blockingDiagnostics.length,
      acceptedPhases: phases.length - blocked.length,
      blockedPhases: blocked.length,
      acceptedJobs: historySnapshots.filter((snapshot) => snapshot.executionIntentStatus === "execution-intent-ready").length,
      statusChannels: statusChannels.length,
      auditChannels: auditChannels.length,
    }),
    phases,
    historySnapshots,
    blockedPhases: Object.freeze(blocked.map((phase) => phase.label)),
    channels: Object.freeze({
      status: statusChannels,
      audit: auditChannels,
    }),
    controls: Object.freeze({
      canPreview: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0,
      canAccept: publishControls.controls.canAccept && previewAcceptance.controls.canAcceptAll,
      canSchedule: publishControls.controls.canSchedule && mutatingJobs.every((job) => Boolean(job.recovery.idempotencyKey)),
      canExportHistory: historySnapshots.length > 0,
      canPublish: ready && publishControls.controls.canPublish,
    }),
    exportSummary: Object.freeze({
      reportId,
      status: ready ? "mailchimp-lifecycle-ready" : mailchimpJobs.length === 0 ? "not-required" : "mailchimp-lifecycle-review",
      blockedPhases: Object.freeze(blocked.map((phase) => phase.label)),
      jobCount: mailchimpJobs.length,
      mutatingJobCount: mutatingJobs.length,
      nextAction: ready ? "publish-mailchimp-lifecycle-report" : blocked[0]?.nextAction ?? "add-mailchimp-handoff-job",
    }),
    nextAction: ready ? "publish-mailchimp-lifecycle-report" : blocked[0]?.nextAction ?? "add-mailchimp-handoff-job",
  });
}

function createMailchimpClientRuntimeAdoptionReceipt(mailchimpJobs, diagnostics, clientRuntime, clientAdoption, externalHandoffManifest) {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const receipts = Object.freeze(mailchimpJobs.map((job) => {
    const adoption = clientAdoption.jobs.find((entry) => entry.job === job.name) ?? null;
    const external = externalHandoffManifest.jobs.find((entry) => entry.job === job.name) ?? null;
    const statusChannel = job.status.channel ?? job.status.auditChannel ?? null;
    const auditChannel = job.status.auditChannel ?? statusChannel;
    const routeId = stableContractId(
      "mailchimp-client-runtime-adoption",
      job.persistedState.stateKey,
      job.externalProviderService.serviceKey,
      job.tenantPermissionBoundary.isolationKey,
      statusChannel,
    );
    const restartReady = job.persistedState.restartSafe && job.recovery.restartSafe;
    const boundaryReady = job.tenantPermissionBoundary.allowed;
    const statusReady = Boolean(statusChannel);
    const auditReady = !job.tenantPermissionBoundary.audit.required || job.tenantPermissionBoundary.audit.status === "audit-ready";
    const accepted = Boolean(adoption?.accepted)
      && Boolean(external?.accepted)
      && job.clientExecutionIntent.accepted
      && restartReady
      && boundaryReady
      && statusReady
      && auditReady
      && blockingDiagnostics.length === 0;
    const missing = Object.freeze([
      blockingDiagnostics.length > 0 ? "blocking-diagnostics" : null,
      adoption?.accepted ? null : "client-adoption-plan",
      external?.accepted ? null : "external-handoff-manifest",
      job.clientExecutionIntent.accepted ? null : "client-execution-intent",
      restartReady ? null : "restart-safe-state",
      boundaryReady ? null : "tenant-boundary",
      job.tenantPermissionBoundary.missingPermissions.length > 0 ? "mailchimp-permissions" : null,
      statusReady ? null : "status-channel",
      auditReady ? null : "audit-channel",
      job.handoff.mutatesProvider && !job.recovery.idempotencyKey ? "idempotency-key" : null,
    ].filter(Boolean));

    return Object.freeze({
      schema: "aios.grammar.mailchimp-client-runtime-adoption.receipt-job.v1",
      job: job.name,
      routeId,
      accepted,
      status: accepted
        ? "client-runtime-adoption-accepted"
        : missing.includes("client-adoption-plan")
          ? adoption?.status ?? clientAdoption.status
          : missing.includes("external-handoff-manifest")
            ? external?.status ?? externalHandoffManifest.status
            : missing.includes("client-execution-intent")
              ? job.clientExecutionIntent.status
              : missing.includes("restart-safe-state")
                ? job.persistedState.statusMirror.restartStatus
                : missing.includes("tenant-boundary") || missing.includes("mailchimp-permissions")
                  ? job.tenantPermissionBoundary.status
                  : missing.includes("status-channel")
                    ? "status-review"
                    : missing.includes("audit-channel")
                      ? "audit-review"
                      : "idempotency-review",
      missing,
      boundary: Object.freeze({
        workspace: job.clientRuntime.clientVisibleState.workspace,
        tenant: job.clientRuntime.clientVisibleState.tenant,
        role: job.clientRuntime.clientVisibleState.role,
        isolationKey: job.tenantPermissionBoundary.isolationKey,
      }),
      persistedState: Object.freeze({
        stateKey: job.persistedState.stateKey,
        serviceKey: job.externalProviderService.serviceKey,
        restoreInputs: job.persistedState.restoreInputs,
        restartSafe: restartReady,
        commandIds: Object.freeze([
          ...job.persistedState.commandLedger.map((command) => command.id),
          ...job.clientExecutionIntent.commands.map((command) => command.id),
        ]),
      }),
      sync: Object.freeze({
        statusChannel,
        auditChannel,
        idempotencyKey: job.recovery.idempotencyKey,
        executionIntentId: job.clientExecutionIntent.intentId,
      }),
      controls: Object.freeze({
        canPreview: blockingDiagnostics.length === 0,
        canPersist: restartReady,
        canReplay: restartReady && (!job.handoff.mutatesProvider || Boolean(job.recovery.idempotencyKey)),
        canHandoffClient: accepted,
        canEmitStatus: statusReady,
      }),
      nextAction: accepted
        ? "record-client-runtime-adoption"
        : missing.includes("blocking-diagnostics")
          ? "fix-blocking-diagnostics"
          : missing.includes("client-adoption-plan")
            ? adoption?.nextAction ?? clientAdoption.nextAction
            : missing.includes("external-handoff-manifest")
              ? external?.nextAction ?? externalHandoffManifest.nextAction
              : missing.includes("client-execution-intent")
                ? job.clientExecutionIntent.nextAction
                : missing.includes("restart-safe-state")
                  ? job.persistedState.nextAction
                  : missing.includes("tenant-boundary") || missing.includes("mailchimp-permissions")
                    ? job.tenantPermissionBoundary.nextAction
                    : missing.includes("status-channel")
                      ? "declare-status-channel"
                      : missing.includes("audit-channel")
                        ? "declare-audit-channel"
                        : "declare-idempotency-key",
    });
  }));
  const blocked = receipts.filter((receipt) => !receipt.accepted);
  const receiptId = stableContractId(
    "mailchimp-client-runtime-adoption-receipt",
    receipts.length,
    externalHandoffManifest.manifestId ?? "manifest",
    clientRuntime.ready ? "client-ready" : "client-review",
  );

  return Object.freeze({
    schema: "aios.grammar.mailchimp-client-runtime-adoption.receipt.v1",
    receiptId,
    ready: mailchimpJobs.length > 0 && blocked.length === 0 && clientRuntime.ready,
    status: mailchimpJobs.length === 0
      ? "not-required"
      : blocked.length === 0 && clientRuntime.ready
        ? "client-runtime-adoption-accepted"
        : blocked[0]?.status ?? "client-runtime-adoption-review",
    acceptedJobCount: receipts.length - blocked.length,
    blockedJobCount: blocked.length,
    missing: Object.freeze([...new Set(blocked.flatMap((receipt) => receipt.missing))].sort()),
    receipts,
    controls: Object.freeze({
      canPreview: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0,
      canPersist: receipts.length > 0 && receipts.every((receipt) => receipt.controls.canPersist),
      canReplay: receipts.length > 0 && receipts.every((receipt) => receipt.controls.canReplay),
      canHandoffClient: mailchimpJobs.length > 0 && blocked.length === 0 && clientRuntime.ready,
    }),
    exportSummary: Object.freeze({
      receiptId,
      status: mailchimpJobs.length === 0
        ? "not-required"
        : blocked.length === 0 && clientRuntime.ready
          ? "client-runtime-adoption-accepted"
          : "client-runtime-adoption-review",
      acceptedJobCount: receipts.length - blocked.length,
      blockedJobCount: blocked.length,
      nextAction: blocked.length === 0 && clientRuntime.ready
        ? "publish-client-runtime-adoption-receipt"
        : blocked[0]?.nextAction ?? clientRuntime.nextAction,
    }),
    nextAction: blocked.length === 0 && clientRuntime.ready
      ? "publish-client-runtime-adoption-receipt"
      : blocked[0]?.nextAction ?? clientRuntime.nextAction,
  });
}

function createMailchimpRuntimeExport(jobs, diagnostics, clientRuntime) {
  const mailchimpJobs = Object.freeze(jobs.filter((job) => job.handoff.mailchimp));
  const mutatingJobs = mailchimpJobs.filter((job) => job.handoff.mutatesProvider);
  const blockedJobs = mailchimpJobs.filter((job) => !job.ready || !job.tenantPermissionBoundary.allowed);
  const timeline = createRuntimeExportTimeline(jobs, diagnostics, clientRuntime);
  const publishControls = createMailchimpPublishControls(mailchimpJobs, diagnostics, clientRuntime);
  const previewAcceptance = createMailchimpPreviewAcceptanceReport(mailchimpJobs, diagnostics, clientRuntime, publishControls);
  const clientAdoption = createMailchimpClientAdoptionPlan(mailchimpJobs, diagnostics, clientRuntime, previewAcceptance);
  const externalHandoffManifest = createMailchimpExternalHandoffManifest(
    mailchimpJobs,
    diagnostics,
    clientRuntime,
    publishControls,
    previewAcceptance,
    clientAdoption,
  );
  const lifecycleReport = createMailchimpRuntimeLifecycleReport(
    mailchimpJobs,
    diagnostics,
    publishControls,
    previewAcceptance,
    clientAdoption,
    externalHandoffManifest,
  );
  const clientRuntimeAdoptionReceipt = createMailchimpClientRuntimeAdoptionReceipt(
    mailchimpJobs,
    diagnostics,
    clientRuntime,
    clientAdoption,
    externalHandoffManifest,
  );
  const statusChannels = Object.freeze([...new Set(mailchimpJobs.flatMap((job) => (
    job.clientRuntime.statusChannels.map((channel) => channel.channel)
  )))].sort());
  const auditChannels = Object.freeze([...new Set(mailchimpJobs.map((job) => job.status.auditChannel).filter(Boolean))].sort());
  const permissionGaps = Object.freeze(mailchimpJobs
    .filter((job) => job.tenantPermissionBoundary.missingPermissions.length > 0)
    .map((job) => Object.freeze({
      job: job.name,
      adapter: job.handoff.adapter,
      missingPermissions: job.tenantPermissionBoundary.missingPermissions,
      nextAction: job.tenantPermissionBoundary.nextAction,
    })));
  const restartGaps = Object.freeze(mailchimpJobs
    .filter((job) => !job.persistedState.restartSafe)
    .map((job) => Object.freeze({
      job: job.name,
      stateKey: job.persistedState.stateKey,
      missing: job.persistedState.missing,
      nextAction: job.persistedState.nextAction,
    })));
  const providerGaps = Object.freeze(mailchimpJobs
    .filter((job) => !job.externalProviderService.accepted)
    .map((job) => Object.freeze({
      job: job.name,
      serviceKey: job.externalProviderService.serviceKey,
      status: job.externalProviderService.handoffState.status,
      missing: job.externalProviderService.handoffState.missing,
      nextAction: job.externalProviderService.nextAction,
    })));
  const ready = blockedJobs.length === 0
    && diagnostics.every((diagnostic) => diagnostic.severity !== "error")
    && externalHandoffManifest.ready
    && clientRuntimeAdoptionReceipt.ready;

  return Object.freeze({
    schema: "aios.grammar.mailchimp-runtime-export.v1",
    ready,
    status: mailchimpJobs.length === 0
      ? "not-required"
      : ready
        ? "export-ready"
        : permissionGaps.length > 0
          ? "permission-review"
          : restartGaps.length > 0
            ? "restart-review"
            : "contract-review",
    counters: Object.freeze({
      jobs: jobs.length,
      mailchimpJobs: mailchimpJobs.length,
      mutatingMailchimpJobs: mutatingJobs.length,
      readyMailchimpJobs: mailchimpJobs.filter((job) => job.ready).length,
      diagnostics: diagnosticExportCounters(diagnostics),
      handoffStatus: countContractsByStatus(mailchimpJobs, (job) => job.handoff.status),
      boundaryStatus: countContractsByStatus(mailchimpJobs, (job) => job.tenantPermissionBoundary.status),
      restartStatus: countContractsByStatus(mailchimpJobs, (job) => job.restartStatus.status),
      providerServiceStatus: countContractsByStatus(mailchimpJobs, (job) => job.externalProviderService.handoffState.status),
    }),
    history: Object.freeze({
      timeline,
      persistedStateKeys: Object.freeze(mailchimpJobs.map((job) => job.persistedState.stateKey)),
      isolationKeys: Object.freeze(mailchimpJobs.map((job) => job.tenantPermissionBoundary.isolationKey)),
      serviceKeys: Object.freeze(mailchimpJobs.map((job) => job.externalProviderService.serviceKey)),
      statusChannels,
      auditChannels,
    }),
    publishControls,
    previewAcceptance,
    clientAdoption,
    externalHandoffManifest,
    lifecycleReport,
    clientRuntimeAdoptionReceipt,
    summaries: Object.freeze(mailchimpJobs.map((job) => Object.freeze({
      job: job.name,
      adapter: job.handoff.adapter,
      operation: job.handoff.operation,
      mutatesProvider: job.handoff.mutatesProvider,
      ready: job.ready,
      permissionStatus: job.tenantPermissionBoundary.status,
      restartStatus: job.restartStatus.status,
      stateKey: job.persistedState.stateKey,
      isolationKey: job.tenantPermissionBoundary.isolationKey,
      serviceKey: job.externalProviderService.serviceKey,
      providerStatus: job.externalProviderService.handoffState.status,
      nextAction: job.ready ? "handoff-mailchimp-runtime" : job.tenantPermissionBoundary.allowed ? job.persistedState.nextAction : job.tenantPermissionBoundary.nextAction,
    }))),
    gaps: Object.freeze({
      permissions: permissionGaps,
      restart: restartGaps,
      providerService: providerGaps,
      clientRuntime: clientRuntime.blockedJobs,
      boundary: clientRuntime.boundaryBlockedJobs,
    }),
    exportSummary: Object.freeze({
      status: mailchimpJobs.length === 0 ? "not-required" : ready ? "export-ready" : "review",
      mailchimpJobCount: mailchimpJobs.length,
      mutatingJobCount: mutatingJobs.length,
      statusChannels,
      serviceKeys: Object.freeze(mailchimpJobs.map((job) => job.externalProviderService.serviceKey)),
      publishStatus: publishControls.status,
      previewAcceptanceStatus: previewAcceptance.status,
      clientAdoptionStatus: clientAdoption.status,
      externalManifestStatus: externalHandoffManifest.status,
      externalManifestId: externalHandoffManifest.manifestId,
      lifecycleStatus: lifecycleReport.status,
      lifecycleReportId: lifecycleReport.reportId,
      clientRuntimeAdoptionStatus: clientRuntimeAdoptionReceipt.status,
      clientRuntimeAdoptionReceiptId: clientRuntimeAdoptionReceipt.receiptId,
      controls: publishControls.controls,
      nextAction: mailchimpJobs.length === 0
        ? "continue"
        : ready && publishControls.ready && previewAcceptance.ready && clientAdoption.ready && externalHandoffManifest.ready && lifecycleReport.ready && clientRuntimeAdoptionReceipt.ready
          ? "publish-mailchimp-runtime-export"
          : clientRuntimeAdoptionReceipt.nextAction ?? lifecycleReport.nextAction ?? externalHandoffManifest.nextAction ?? clientAdoption.nextAction ?? previewAcceptance.nextAction ?? publishControls.nextAction ?? permissionGaps[0]?.nextAction ?? restartGaps[0]?.nextAction ?? clientRuntime.nextAction,
    }),
    nextAction: mailchimpJobs.length === 0
      ? "continue"
      : ready && publishControls.ready && previewAcceptance.ready && clientAdoption.ready && externalHandoffManifest.ready && lifecycleReport.ready && clientRuntimeAdoptionReceipt.ready
        ? "publish-mailchimp-runtime-export"
        : clientRuntimeAdoptionReceipt.nextAction ?? lifecycleReport.nextAction ?? externalHandoffManifest.nextAction ?? clientAdoption.nextAction ?? previewAcceptance.nextAction ?? publishControls.nextAction ?? permissionGaps[0]?.nextAction ?? restartGaps[0]?.nextAction ?? clientRuntime.nextAction,
  });
}

function createMailchimpRuntimeWorkflowHandoff(jobs, diagnostics, clientRuntime, mailchimpRuntimeExport) {
  const mailchimpJobs = Object.freeze(jobs.filter((job) => job.handoff.mailchimp));
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const workflowJobs = Object.freeze(mailchimpJobs.map((job) => {
    const service = job.externalProviderService;
    const adoption = mailchimpRuntimeExport.clientAdoption.jobs.find((entry) => entry.job === job.name) ?? null;
    const preview = mailchimpRuntimeExport.previewAcceptance.summaries.find((entry) => entry.job === job.name) ?? null;
    const publishPreview = mailchimpRuntimeExport.publishControls.preview.jobs.find((entry) => entry.job === job.name) ?? null;
    const restartReady = job.persistedState.restartSafe && service.recovery.restartSafe;
    const statusReady = Boolean(job.status.channel || job.status.auditChannel);
    const auditReady = !job.tenantPermissionBoundary.audit.required || job.tenantPermissionBoundary.audit.status === "audit-ready";
    const accepted = Boolean(adoption?.accepted)
      && Boolean(preview?.accepted)
      && job.ready
      && restartReady
      && statusReady
      && auditReady
      && blockingDiagnostics.length === 0;
    const missing = Object.freeze([
      blockingDiagnostics.length > 0 ? "blocking-diagnostics" : null,
      job.tenantPermissionBoundary.allowed ? null : "tenant-boundary",
      job.tenantPermissionBoundary.missingPermissions.length > 0 ? "mailchimp-permissions" : null,
      preview?.accepted ? null : "preview-acceptance",
      adoption?.accepted ? null : "client-adoption",
      service.accepted ? null : "provider-service",
      restartReady ? null : "restart-safe-state",
      statusReady ? null : "status-channel",
      auditReady ? null : "audit-channel",
      job.handoff.mutatesProvider && !job.recovery.idempotencyKey ? "idempotency-key" : null,
    ].filter(Boolean));
    const workflowKey = stableContractId(
      "mailchimp-runtime-workflow",
      job.persistedState.stateKey,
      service.serviceKey,
      job.tenantPermissionBoundary.isolationKey,
    );

    return Object.freeze({
      schema: "aios.grammar.mailchimp-runtime-workflow.job.v1",
      job: job.name,
      workflowKey,
      adapter: job.handoff.adapter,
      operation: job.handoff.operation,
      mutatesProvider: job.handoff.mutatesProvider,
      accepted,
      status: accepted
        ? "workflow-ready"
        : missing.includes("blocking-diagnostics")
          ? "diagnostic-review"
          : missing.includes("tenant-boundary") || missing.includes("mailchimp-permissions")
            ? job.tenantPermissionBoundary.status
            : missing.includes("preview-acceptance")
              ? preview?.status ?? "preview-review"
              : missing.includes("client-adoption")
                ? adoption?.status ?? "adoption-review"
                : missing.includes("provider-service")
                  ? service.handoffState.status
                  : missing.includes("restart-safe-state")
                    ? job.persistedState.statusMirror.restartStatus
                    : missing.includes("status-channel")
                      ? "status-review"
                      : missing.includes("audit-channel")
                        ? "audit-review"
                        : "idempotency-review",
      missing,
      clientState: Object.freeze({
        workspace: job.clientRuntime.clientVisibleState.workspace,
        tenant: job.clientRuntime.clientVisibleState.tenant,
        role: job.clientRuntime.clientVisibleState.role,
        stateKey: job.persistedState.stateKey,
        serviceKey: service.serviceKey,
        isolationKey: job.tenantPermissionBoundary.isolationKey,
        workflowKey,
        statusChannel: job.status.channel,
        auditChannel: job.status.auditChannel,
        idempotencyKey: job.recovery.idempotencyKey,
        restoreInputs: job.persistedState.restoreInputs,
        commandLedger: job.persistedState.commandLedger,
      }),
      preview: Object.freeze({
        publish: publishPreview ?? null,
        acceptance: preview
          ? Object.freeze({
              status: preview.status,
              accepted: preview.accepted,
              validationSummary: preview.validationSummary,
              nextStep: preview.nextStep,
            })
          : null,
        adoption: adoption
          ? Object.freeze({
              status: adoption.status,
              accepted: adoption.accepted,
              workflow: adoption.workflow,
              nextAction: adoption.nextAction,
            })
          : null,
      }),
      controls: Object.freeze({
        canPreview: blockingDiagnostics.length === 0,
        canAccept: blockingDiagnostics.length === 0 && job.tenantPermissionBoundary.allowed && statusReady,
        canPersist: restartReady,
        canReplayCommands: restartReady && job.persistedState.commandLedger.every((command) => command.idempotent || !command.writesProvider),
        canHandoffClient: accepted,
        canPublish: accepted && mailchimpRuntimeExport.publishControls.ready,
      }),
      nextAction: accepted
        ? "handoff-mailchimp-workflow"
        : missing.includes("blocking-diagnostics")
          ? "fix-blocking-diagnostics"
          : missing.includes("tenant-boundary") || missing.includes("mailchimp-permissions")
            ? job.tenantPermissionBoundary.nextAction
            : missing.includes("preview-acceptance")
              ? preview?.nextAction ?? mailchimpRuntimeExport.previewAcceptance.nextAction
              : missing.includes("client-adoption")
                ? adoption?.nextAction ?? mailchimpRuntimeExport.clientAdoption.nextAction
                : missing.includes("provider-service")
                  ? service.nextAction
                  : missing.includes("restart-safe-state")
                    ? job.persistedState.nextAction
                    : missing.includes("status-channel")
                      ? "declare-status-channel"
                      : missing.includes("audit-channel")
                        ? "declare-audit-channel"
                        : "declare-idempotency-key",
    });
  }));
  const blocked = workflowJobs.filter((job) => !job.accepted);
  const firstBlocked = blocked[0] ?? null;
  const ready = mailchimpJobs.length > 0
    && blocked.length === 0
    && clientRuntime.ready
    && mailchimpRuntimeExport.publishControls.ready
    && mailchimpRuntimeExport.previewAcceptance.ready
    && mailchimpRuntimeExport.clientAdoption.ready
    && mailchimpRuntimeExport.externalHandoffManifest.ready;

  return Object.freeze({
    schema: "aios.grammar.mailchimp-runtime-workflow-handoff.v1",
    ready,
    status: mailchimpJobs.length === 0
      ? "not-required"
      : ready
        ? "workflow-ready"
        : firstBlocked?.status ?? mailchimpRuntimeExport.status,
    acceptedJobCount: workflowJobs.filter((job) => job.accepted).length,
    blockedJobCount: blocked.length,
    missing: Object.freeze([...new Set(blocked.flatMap((job) => job.missing))].sort()),
    jobs: workflowJobs,
    validationSummary: Object.freeze({
      diagnosticsReady: blockingDiagnostics.length === 0,
      clientRuntimeReady: clientRuntime.ready,
      publishReady: mailchimpRuntimeExport.publishControls.ready,
      previewAccepted: mailchimpRuntimeExport.previewAcceptance.ready,
      clientAdoptionReady: mailchimpRuntimeExport.clientAdoption.ready,
      externalHandoffManifestReady: mailchimpRuntimeExport.externalHandoffManifest.ready,
      allJobsAccepted: mailchimpJobs.length > 0 && blocked.length === 0,
    }),
    controls: Object.freeze({
      canPreview: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0,
      canAccept: workflowJobs.length > 0 && workflowJobs.every((job) => job.controls.canAccept),
      canPersist: workflowJobs.length > 0 && workflowJobs.every((job) => job.controls.canPersist),
      canReplayCommands: workflowJobs.length > 0 && workflowJobs.every((job) => job.controls.canReplayCommands),
      canHandoffClient: ready,
      canPublish: ready && mailchimpRuntimeExport.publishControls.controls.canPublish,
    }),
    exportSummary: Object.freeze({
      status: ready ? "workflow-ready" : mailchimpJobs.length === 0 ? "not-required" : "workflow-review",
      acceptedJobCount: workflowJobs.filter((job) => job.accepted).length,
      blockedJobCount: blocked.length,
      nextAction: ready ? "handoff-mailchimp-client-workflow" : firstBlocked?.nextAction ?? mailchimpRuntimeExport.nextAction,
    }),
    nextAction: ready ? "handoff-mailchimp-client-workflow" : firstBlocked?.nextAction ?? mailchimpRuntimeExport.nextAction,
  });
}

function mailchimpLaunchPhase(label, accepted, status, nextAction, details = {}) {
  return Object.freeze({
    schema: "aios.grammar.mailchimp-launch.phase.v1",
    label,
    accepted: Boolean(accepted),
    status,
    nextAction,
    details: Object.freeze(details),
  });
}

function createMailchimpClientLaunchPacket(jobs, diagnostics, clientRuntime, mailchimpRuntimeExport, mailchimpWorkflowHandoff) {
  const mailchimpJobs = Object.freeze(jobs.filter((job) => job.handoff.mailchimp));
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const publish = mailchimpRuntimeExport.publishControls;
  const preview = mailchimpRuntimeExport.previewAcceptance;
  const adoption = mailchimpRuntimeExport.clientAdoption;
  const external = mailchimpRuntimeExport.externalHandoffManifest;
  const phases = Object.freeze([
    mailchimpLaunchPhase("diagnostics", blockingDiagnostics.length === 0, blockingDiagnostics.length === 0 ? "clear" : "blocked", blockingDiagnostics.length === 0 ? "continue" : "fix-blocking-diagnostics", {
      blockingCount: blockingDiagnostics.length,
      diagnosticCount: diagnostics.length,
    }),
    mailchimpLaunchPhase("publish-preview", publish.ready, publish.status, publish.nextAction, {
      missing: publish.missing,
      controls: publish.controls,
    }),
    mailchimpLaunchPhase("preview-acceptance", preview.ready, preview.status, preview.nextAction, {
      missing: preview.missing,
      acceptedJobCount: preview.acceptedJobCount,
      blockedJobCount: preview.blockedJobCount,
    }),
    mailchimpLaunchPhase("client-adoption", adoption.ready, adoption.status, adoption.nextAction, {
      missing: adoption.missing,
      acceptedJobCount: adoption.acceptedJobCount,
      blockedJobCount: adoption.blockedJobCount,
    }),
    mailchimpLaunchPhase("external-handoff", external.ready, external.status, external.nextAction, {
      manifestId: external.manifestId,
      acceptedJobCount: external.acceptedJobCount,
      blockedJobCount: external.blockedJobCount,
    }),
    mailchimpLaunchPhase("workflow-handoff", mailchimpWorkflowHandoff.ready, mailchimpWorkflowHandoff.status, mailchimpWorkflowHandoff.nextAction, {
      acceptedJobCount: mailchimpWorkflowHandoff.acceptedJobCount,
      blockedJobCount: mailchimpWorkflowHandoff.blockedJobCount,
      missing: mailchimpWorkflowHandoff.missing,
    }),
    mailchimpLaunchPhase("client-runtime", clientRuntime.ready, clientRuntime.ready ? "ready" : "review", clientRuntime.nextAction, {
      handoffCount: clientRuntime.handoffCount,
      blockedJobs: clientRuntime.blockedJobs.map((job) => job.job),
    }),
  ]);
  const blocker = phases.find((phase) => !phase.accepted) ?? null;
  const ready = mailchimpJobs.length > 0 && !blocker;
  const missing = Object.freeze([...new Set(phases
    .filter((phase) => !phase.accepted)
    .flatMap((phase) => [
      phase.label,
      ...(Array.isArray(phase.details?.missing) ? phase.details.missing : []),
    ]))].sort());
  const launchId = stableContractId(
    "mailchimp-client-launch",
    mailchimpJobs.length,
    external.manifestId ?? "manifest",
    clientRuntime.statusChannels[0] ?? "status",
  );
  const routeJobs = Object.freeze(mailchimpJobs.map((job) => {
    const workflow = mailchimpWorkflowHandoff.jobs.find((entry) => entry.job === job.name) ?? null;
    const previewJob = preview.summaries.find((entry) => entry.job === job.name) ?? null;
    const adoptionJob = adoption.jobs.find((entry) => entry.job === job.name) ?? null;
    const externalJob = external.jobs.find((entry) => entry.job === job.name) ?? null;
    const accepted = Boolean(workflow?.accepted && previewJob?.accepted && adoptionJob?.accepted && externalJob?.accepted);

    return Object.freeze({
      schema: "aios.grammar.mailchimp-launch.job.v1",
      job: job.name,
      adapter: job.handoff.adapter,
      operation: job.handoff.operation,
      accepted,
      status: accepted
        ? "launch-ready"
        : workflow?.status ?? previewJob?.status ?? adoptionJob?.status ?? externalJob?.status ?? "review",
      boundary: Object.freeze({
        workspace: job.clientRuntime.clientVisibleState.workspace,
        tenant: job.clientRuntime.clientVisibleState.tenant,
        role: job.clientRuntime.clientVisibleState.role,
        isolationKey: job.tenantPermissionBoundary.isolationKey,
      }),
      sync: Object.freeze({
        stateKey: job.persistedState.stateKey,
        serviceKey: job.externalProviderService.serviceKey,
        workflowKey: workflow?.workflowKey ?? null,
        statusChannel: job.status.channel,
        auditChannel: job.status.auditChannel,
        idempotencyKey: job.recovery.idempotencyKey,
      }),
      preview: Object.freeze({
        acceptanceStatus: previewJob?.status ?? null,
        adoptionStatus: adoptionJob?.status ?? null,
        externalStatus: externalJob?.status ?? null,
        workflowStatus: workflow?.status ?? null,
      }),
      controls: Object.freeze({
        canPreview: Boolean(workflow?.controls.canPreview ?? preview.controls.canPreview),
        canAccept: Boolean(workflow?.controls.canAccept ?? preview.controls.canAcceptAll),
        canPersist: Boolean(workflow?.controls.canPersist ?? adoption.controls.canPersist),
        canHandoffClient: accepted,
      }),
      nextAction: accepted
        ? "launch-mailchimp-client-job"
        : workflow?.nextAction ?? previewJob?.nextAction ?? adoptionJob?.nextAction ?? externalJob?.nextAction ?? mailchimpRuntimeExport.nextAction,
    });
  }));

  return Object.freeze({
    schema: "aios.grammar.mailchimp-client-launch.packet.v1",
    launchId,
    ready,
    status: mailchimpJobs.length === 0
      ? "not-required"
      : ready
        ? "launch-ready"
        : blocker.status,
    headline: mailchimpJobs.length === 0
      ? "No Mailchimp runtime jobs were declared."
      : ready
        ? "Mailchimp runtime is ready for client launch."
        : `Mailchimp runtime is waiting on ${blocker.nextAction}.`,
    phases,
    jobs: routeJobs,
    missing,
    validationSummary: Object.freeze({
      diagnosticsReady: blockingDiagnostics.length === 0,
      publishReady: publish.ready,
      previewAccepted: preview.ready,
      clientAdoptionReady: adoption.ready,
      externalHandoffReady: external.ready,
      workflowReady: mailchimpWorkflowHandoff.ready,
      clientRuntimeReady: clientRuntime.ready,
      allJobsReady: mailchimpJobs.length > 0 && routeJobs.every((job) => job.accepted),
      missing,
    }),
    routeContract: Object.freeze({
      method: "POST",
      action: ready ? "launch-mailchimp-client-runtime" : blocker?.nextAction ?? "continue",
      idempotencyKey: `${launchId}:route`,
      requiresOperator: !ready && Boolean(blocker && ["preview-acceptance", "publish-preview", "client-adoption"].includes(blocker.label)),
      retryable: !ready && Boolean(blocker && ["diagnostics", "client-adoption", "workflow-handoff"].includes(blocker.label)),
    }),
    controls: Object.freeze({
      canPreview: mailchimpJobs.length > 0 && phases.every((phase) => phase.label === "diagnostics" ? phase.accepted : true),
      canAccept: routeJobs.length > 0 && routeJobs.every((job) => job.controls.canAccept),
      canPersist: routeJobs.length > 0 && routeJobs.every((job) => job.controls.canPersist),
      canEmitStatus: clientRuntime.statusChannels.length > 0,
      canLaunchClient: ready,
    }),
    exportSummary: Object.freeze({
      launchId,
      status: ready ? "mailchimp-client-launch-ready" : mailchimpJobs.length === 0 ? "not-required" : "mailchimp-client-launch-review",
      jobCount: mailchimpJobs.length,
      blockedPhase: blocker?.label ?? null,
      missing,
      nextAction: ready ? "launch-mailchimp-client-runtime" : blocker?.nextAction ?? "continue",
    }),
    nextAction: ready ? "launch-mailchimp-client-runtime" : blocker?.nextAction ?? "continue",
  });
}

function createRuntimeRestartRunbook(jobs, diagnostics, clientRuntime, mailchimpRuntimeExport) {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const restartBlocked = jobs.filter((job) => !job.persistedState.restartSafe);
  const providerBlocked = jobs.filter((job) => job.handoff.mailchimp && !job.externalProviderService.accepted);
  const boundaryBlocked = jobs.filter((job) => !job.tenantPermissionBoundary.allowed);
  const restartable = blockingDiagnostics.length === 0
    && restartBlocked.length === 0
    && boundaryBlocked.length === 0
    && providerBlocked.length === 0;
  const steps = Object.freeze([
    Object.freeze({
      schema: "aios.grammar.restart-runbook.step.v1",
      label: "diagnostics",
      status: blockingDiagnostics.length === 0 ? "clear" : "blocked",
      accepted: blockingDiagnostics.length === 0,
      count: blockingDiagnostics.length,
      nextAction: blockingDiagnostics.length === 0 ? "continue" : "fix-blocking-diagnostics",
    }),
    Object.freeze({
      schema: "aios.grammar.restart-runbook.step.v1",
      label: "tenant-boundary",
      status: boundaryBlocked.length === 0 ? "scoped" : "review",
      accepted: boundaryBlocked.length === 0,
      count: boundaryBlocked.length,
      nextAction: boundaryBlocked[0]?.tenantPermissionBoundary.nextAction ?? "continue",
    }),
    Object.freeze({
      schema: "aios.grammar.restart-runbook.step.v1",
      label: "persisted-state",
      status: restartBlocked.length === 0 ? "restart-safe" : "review",
      accepted: restartBlocked.length === 0,
      count: restartBlocked.length,
      nextAction: restartBlocked[0]?.persistedState.nextAction ?? "continue",
    }),
    Object.freeze({
      schema: "aios.grammar.restart-runbook.step.v1",
      label: "provider-service",
      status: providerBlocked.length === 0 ? "accepted" : "review",
      accepted: providerBlocked.length === 0,
      count: providerBlocked.length,
      nextAction: providerBlocked[0]?.externalProviderService.nextAction ?? "continue",
    }),
    Object.freeze({
      schema: "aios.grammar.restart-runbook.step.v1",
      label: "client-runtime",
      status: clientRuntime.ready ? "ready" : "review",
      accepted: clientRuntime.ready,
      count: clientRuntime.blockedJobs.length,
      nextAction: clientRuntime.nextAction,
    }),
  ]);
  const firstBlocked = steps.find((step) => !step.accepted) ?? null;

  return Object.freeze({
    schema: "aios.grammar.runtime-restart-runbook.v1",
    restartable,
    status: restartable
      ? "restart-ready"
      : firstBlocked?.status ?? "review",
    steps,
    jobStates: Object.freeze(jobs.map((job) => Object.freeze({
      job: job.name,
      stateKey: job.persistedState.stateKey,
      serviceKey: job.externalProviderService.serviceKey,
      isolationKey: job.tenantPermissionBoundary.isolationKey,
      restartStatus: job.restartStatus.status,
      providerStatus: job.externalProviderService.handoffState.status,
      statusChannel: job.status.channel,
      auditChannel: job.status.auditChannel,
      restoreInputs: job.persistedState.restoreInputs,
      commandLedger: job.persistedState.commandLedger,
      nextAction: job.restartStatus.nextAction,
    }))),
    mailchimp: Object.freeze({
      required: mailchimpRuntimeExport.status !== "not-required",
      status: mailchimpRuntimeExport.status,
      publishStatus: mailchimpRuntimeExport.publishControls.status,
      adoptionStatus: mailchimpRuntimeExport.clientAdoption.status,
      nextAction: mailchimpRuntimeExport.nextAction,
    }),
    controls: Object.freeze({
      canRestore: restartable,
      canReplayCommands: restartBlocked.length === 0,
      canHandoffProvider: providerBlocked.length === 0,
      canEmitStatus: jobs.every((job) => job.status.observable),
    }),
    exportSummary: Object.freeze({
      status: restartable ? "restart-ready" : "restart-review",
      jobCount: jobs.length,
      blockedStep: firstBlocked?.label ?? null,
      nextAction: restartable ? "restore-runtime-state" : firstBlocked?.nextAction ?? "review-runtime-restart",
    }),
    nextAction: restartable ? "restore-runtime-state" : firstBlocked?.nextAction ?? "review-runtime-restart",
  });
}

function createRuntimeActionQueueItem(source, status, accepted, nextAction, details = {}) {
  const blocked = details.blocked === true
    || accepted === false
    || String(status).includes("blocked")
    || String(status).includes("review")
    || String(status).includes("missing");
  const severity = blocked
    ? String(status).includes("permission") || String(status).includes("boundary") ? "error" : "warning"
    : "info";

  return Object.freeze({
    schema: "aios.grammar.runtime-action-queue.item.v1",
    id: stableContractId("runtime-action", source, status, nextAction, details.index ?? 0),
    source,
    status,
    accepted: Boolean(accepted) && !blocked,
    blocked,
    severity,
    nextAction,
    counters: Object.freeze(details.counters ?? {}),
    references: Object.freeze(details.references ?? {}),
    controls: Object.freeze({
      canContinue: !blocked,
      canRetry: Boolean(details.retryable) && blocked,
      canExport: Boolean(details.canExport),
      canAudit: Boolean(details.auditChannel),
    }),
  });
}

function runtimeActionPriority(item) {
  if (item.blocked && item.severity === "error") {
    return 0;
  }

  if (item.blocked) {
    return 1;
  }

  if (!item.accepted) {
    return 2;
  }

  return 3;
}

function createRuntimeActionQueue(
  jobs,
  diagnostics,
  clientRuntime,
  mailchimpRuntimeExport,
  mailchimpWorkflowHandoff,
  mailchimpClientLaunch,
  restartRunbook,
  runtimeResumptionManifest,
) {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const mailchimpJobs = jobs.filter((job) => job.handoff.mailchimp);
  const boundaryBlocked = jobs.filter((job) => !job.tenantPermissionBoundary.allowed);
  const restartBlocked = jobs.filter((job) => !job.persistedState.restartSafe);
  const providerBlocked = mailchimpJobs.filter((job) => !job.externalProviderService.accepted);
  const auditChannels = Object.freeze([...new Set(jobs.map((job) => job.status.auditChannel).filter(Boolean))].sort());
  const items = Object.freeze([
    createRuntimeActionQueueItem(
      "grammar-diagnostics",
      blockingDiagnostics.length === 0 ? "clear" : "blocked",
      blockingDiagnostics.length === 0,
      blockingDiagnostics.length === 0 ? "continue" : "fix-blocking-diagnostics",
      {
        index: 0,
        counters: {
          blocking: blockingDiagnostics.length,
          total: diagnostics.length,
        },
        canExport: diagnostics.length === 0 || auditChannels.length > 0,
      },
    ),
    createRuntimeActionQueueItem(
      "tenant-permission-boundary",
      boundaryBlocked.length === 0 ? "scoped" : boundaryBlocked[0].tenantPermissionBoundary.status,
      boundaryBlocked.length === 0,
      boundaryBlocked[0]?.tenantPermissionBoundary.nextAction ?? "continue",
      {
        index: 1,
        counters: {
          blocked: boundaryBlocked.length,
          permissionGaps: boundaryBlocked.reduce((total, job) => total + job.tenantPermissionBoundary.missingPermissions.length, 0),
        },
        references: {
          isolationKeys: Object.freeze(boundaryBlocked.map((job) => job.tenantPermissionBoundary.isolationKey)),
        },
        auditChannel: auditChannels[0] ?? null,
      },
    ),
    createRuntimeActionQueueItem(
      "persisted-restart-state",
      restartBlocked.length === 0 ? "restart-safe" : restartBlocked[0].persistedState.statusMirror.restartStatus,
      restartBlocked.length === 0,
      restartBlocked[0]?.persistedState.nextAction ?? "continue",
      {
        index: 2,
        retryable: true,
        counters: {
          blocked: restartBlocked.length,
          stateCount: jobs.length,
        },
        references: {
          stateKeys: Object.freeze(restartBlocked.map((job) => job.persistedState.stateKey)),
        },
      },
    ),
    createRuntimeActionQueueItem(
      "mailchimp-runtime-export",
      mailchimpRuntimeExport.status,
      mailchimpRuntimeExport.ready || mailchimpRuntimeExport.status === "not-required",
      mailchimpRuntimeExport.nextAction,
      {
        index: 3,
        counters: {
          mailchimpJobs: mailchimpJobs.length,
          providerBlocked: providerBlocked.length,
          mutating: mailchimpJobs.filter((job) => job.handoff.mutatesProvider).length,
        },
        references: {
          serviceKeys: mailchimpRuntimeExport.history.serviceKeys,
        },
        canExport: mailchimpRuntimeExport.publishControls.controls.canPreview,
        auditChannel: auditChannels[0] ?? null,
      },
    ),
    createRuntimeActionQueueItem(
      "mailchimp-workflow-handoff",
      mailchimpWorkflowHandoff.status,
      mailchimpWorkflowHandoff.ready || mailchimpWorkflowHandoff.status === "not-required",
      mailchimpWorkflowHandoff.nextAction,
      {
        index: 4,
        counters: {
          accepted: mailchimpWorkflowHandoff.acceptedJobCount,
          blocked: mailchimpWorkflowHandoff.blockedJobCount,
        },
        canExport: mailchimpWorkflowHandoff.controls.canPreview,
      },
    ),
    createRuntimeActionQueueItem(
      "mailchimp-client-launch",
      mailchimpClientLaunch.status,
      mailchimpClientLaunch.ready || mailchimpClientLaunch.status === "not-required",
      mailchimpClientLaunch.nextAction,
      {
        index: 5,
        retryable: mailchimpClientLaunch.routeContract.retryable,
        counters: {
          jobs: mailchimpClientLaunch.jobs.length,
          blockedPhases: mailchimpClientLaunch.phases.filter((phase) => !phase.accepted).length,
        },
        references: {
          launchId: mailchimpClientLaunch.launchId,
          missing: mailchimpClientLaunch.missing,
        },
        canExport: mailchimpClientLaunch.controls.canPreview,
        auditChannel: auditChannels[0] ?? null,
      },
    ),
    createRuntimeActionQueueItem(
      "runtime-restart-runbook",
      restartRunbook.status,
      restartRunbook.restartable,
      restartRunbook.nextAction,
      {
        index: 6,
        retryable: true,
        counters: {
          steps: restartRunbook.steps.length,
          blockedSteps: restartRunbook.steps.filter((step) => !step.accepted).length,
        },
        canExport: true,
      },
    ),
    createRuntimeActionQueueItem(
      "client-runtime",
      clientRuntime.ready ? "ready" : "review",
      clientRuntime.ready,
      clientRuntime.nextAction,
      {
        index: 7,
        counters: {
          handoffs: clientRuntime.handoffCount,
          blocked: clientRuntime.blockedJobs.length,
        },
        references: {
          statusChannels: clientRuntime.statusChannels,
        },
      },
    ),
    createRuntimeActionQueueItem(
      "runtime-resumption-manifest",
      runtimeResumptionManifest.status,
      runtimeResumptionManifest.ready,
      runtimeResumptionManifest.nextAction,
      {
        index: 8,
        retryable: true,
        counters: runtimeResumptionManifest.counters,
        references: {
          manifests: Object.freeze(runtimeResumptionManifest.manifests.map((manifest) => manifest.manifestId)),
        },
        canExport: true,
        auditChannel: runtimeResumptionManifest.auditChannels[0] ?? null,
      },
    ),
  ].sort((left, right) => runtimeActionPriority(left) - runtimeActionPriority(right)
    || left.source.localeCompare(right.source)));
  const blocked = items.filter((item) => item.blocked);
  const first = blocked[0] ?? items[0] ?? null;

  return Object.freeze({
    schema: "aios.grammar.runtime-action-queue.v1",
    ready: blocked.length === 0,
    status: blocked.length === 0 ? "ready" : first.status,
    counters: Object.freeze({
      total: items.length,
      blocked: blocked.length,
      retryable: items.filter((item) => item.controls.canRetry).length,
      exportable: items.filter((item) => item.controls.canExport).length,
    }),
    items,
    controls: Object.freeze({
      canContinue: blocked.length === 0,
      canRetry: items.some((item) => item.controls.canRetry),
      canExport: items.some((item) => item.controls.canExport),
      canAudit: auditChannels.length > 0,
    }),
    exportSummary: Object.freeze({
      status: blocked.length === 0 ? "runtime-action-ready" : "runtime-action-review",
      blockedCount: blocked.length,
      firstBlocked: blocked[0]?.source ?? null,
      nextAction: blocked.length === 0 ? "handoff-client-runtime" : first.nextAction,
    }),
    nextAction: blocked.length === 0 ? "handoff-client-runtime" : first.nextAction,
  });
}

function createMailchimpDiagnostics(contract) {
  if (!contract.handoff.mailchimp) {
    return Object.freeze([]);
  }

  const diagnostics = [];
  const hasStatus = contract.status.observable;
  const hasRecovery = contract.recovery.restartSafe;
  const granted = new Set(contract.tenantPermissionBoundary.grantedPermissions);

  for (const permission of contract.handoff.requiredPermissions) {
    if (!granted.has(permission)) {
      diagnostics.push(createDiagnostic(
        "GRAMMAR_MAILCHIMP_PERMISSION",
        `Mailchimp handoff '${contract.handoff.adapter}' requires '${permission}' in role permissions.`,
        contract.location ?? { line: 1, column: 1, offset: 0 },
      ));
    }
  }

  if (!hasRecovery) {
    diagnostics.push(createDiagnostic(
      "GRAMMAR_MAILCHIMP_RECOVERY",
      `Mailchimp handoff '${contract.handoff.adapter}' mutates provider state without restart-safe recovery.`,
      contract.location ?? { line: 1, column: 1, offset: 0 },
      "warning",
    ));
  }

  if (!hasStatus) {
    diagnostics.push(createDiagnostic(
      "GRAMMAR_MAILCHIMP_STATUS",
      `Mailchimp handoff '${contract.handoff.adapter}' should emit status or audit updates.`,
      contract.location ?? { line: 1, column: 1, offset: 0 },
      "warning",
    ));
  }

  if (!contract.tenantPermissionBoundary.allowed) {
    diagnostics.push(createDiagnostic(
      "GRAMMAR_MAILCHIMP_TENANT_BOUNDARY",
      `Mailchimp handoff '${contract.handoff.adapter}' is not isolated for tenant handoff: ${contract.tenantPermissionBoundary.nextAction}.`,
      contract.location ?? { line: 1, column: 1, offset: 0 },
      contract.tenantPermissionBoundary.status === "permission-review" ? "error" : "warning",
    ));
  }

  return Object.freeze(diagnostics);
}

function createCompiledRuntimeExportManifest(jobs, diagnostics, clientRuntime, mailchimpRuntimeExport, runtimeResumptionManifest, runtimeActionQueue) {
  const mailchimpJobs = jobs.filter((job) => job.handoff.mailchimp);
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const providerBlocked = mailchimpJobs.filter((job) => !job.externalProviderService.accepted);
  const intentBlocked = mailchimpJobs.filter((job) => !job.clientExecutionIntent.accepted);
  const restartBlocked = mailchimpJobs.filter((job) => !job.persistedState.restartSafe);
  const resumptionBlocked = runtimeResumptionManifest.blockedJobs ?? Object.freeze([]);
  const gates = Object.freeze([
    Object.freeze({
      schema: "aios.grammar.compiled-runtime-export.gate.v1",
      label: "diagnostics",
      accepted: blockingDiagnostics.length === 0,
      status: blockingDiagnostics.length === 0 ? "accepted" : "blocked",
      count: blockingDiagnostics.length,
      nextAction: blockingDiagnostics.length === 0 ? "continue" : "fix-blocking-diagnostics",
    }),
    Object.freeze({
      schema: "aios.grammar.compiled-runtime-export.gate.v1",
      label: "client-runtime",
      accepted: clientRuntime.ready,
      status: clientRuntime.ready ? "ready" : "review",
      count: clientRuntime.blockedJobs.length,
      nextAction: clientRuntime.ready ? "continue" : clientRuntime.nextAction,
    }),
    Object.freeze({
      schema: "aios.grammar.compiled-runtime-export.gate.v1",
      label: "mailchimp-runtime-export",
      accepted: mailchimpJobs.length === 0 || mailchimpRuntimeExport.ready,
      status: mailchimpJobs.length === 0 ? "not-required" : mailchimpRuntimeExport.status,
      count: mailchimpRuntimeExport.blockedJobCount ?? 0,
      nextAction: mailchimpJobs.length === 0 ? "continue" : mailchimpRuntimeExport.nextAction,
    }),
    Object.freeze({
      schema: "aios.grammar.compiled-runtime-export.gate.v1",
      label: "provider-service",
      accepted: providerBlocked.length === 0,
      status: providerBlocked.length === 0 ? "accepted" : providerBlocked[0].externalProviderService.handoffState.status,
      count: providerBlocked.length,
      nextAction: providerBlocked[0]?.externalProviderService.nextAction ?? "continue",
    }),
    Object.freeze({
      schema: "aios.grammar.compiled-runtime-export.gate.v1",
      label: "execution-intent",
      accepted: intentBlocked.length === 0,
      status: intentBlocked.length === 0 ? "accepted" : intentBlocked[0].clientExecutionIntent.status,
      count: intentBlocked.length,
      nextAction: intentBlocked[0]?.clientExecutionIntent.nextAction ?? "continue",
    }),
    Object.freeze({
      schema: "aios.grammar.compiled-runtime-export.gate.v1",
      label: "restart-state",
      accepted: restartBlocked.length === 0 && runtimeResumptionManifest.ready,
      status: restartBlocked.length === 0 ? runtimeResumptionManifest.status : restartBlocked[0].persistedState.statusMirror.restartStatus,
      count: restartBlocked.length + resumptionBlocked.length,
      nextAction: restartBlocked[0]?.persistedState.nextAction ?? runtimeResumptionManifest.nextAction,
    }),
  ]);
  const blocked = gates.filter((gate) => !gate.accepted);
  const exportId = stableContractId(
    "compiled-runtime-export",
    mailchimpJobs.length > 0 ? "mailchimp" : "runtime",
    jobs.length,
    clientRuntime.statusChannels[0] ?? "status",
    runtimeResumptionManifest.exportSummary.status,
  );
  const timeline = Object.freeze(gates.map((gate, index) => Object.freeze({
    schema: "aios.grammar.compiled-runtime-export.timeline-event.v1",
    index,
    label: gate.label,
    status: gate.status,
    accepted: gate.accepted,
    count: gate.count,
    nextAction: gate.nextAction,
  })));

  return Object.freeze({
    schema: "aios.grammar.compiled-runtime-export-manifest.v1",
    exportId,
    ready: blocked.length === 0,
    status: blocked.length === 0 ? "compiled-runtime-export-ready" : blocked[0].status,
    provider: mailchimpJobs.length > 0 ? "mailchimp" : "runtime",
    counters: Object.freeze({
      jobs: jobs.length,
      mailchimpJobs: mailchimpJobs.length,
      diagnostics: diagnostics.length,
      blockingDiagnostics: blockingDiagnostics.length,
      blockedGates: blocked.length,
      restartSafeJobs: jobs.filter((job) => job.persistedState.restartSafe).length,
      providerAcceptedJobs: mailchimpJobs.filter((job) => job.externalProviderService.accepted).length,
    }),
    gates,
    timeline,
    blockedGates: Object.freeze(blocked.map((gate) => gate.label)),
    reports: Object.freeze({
      clientRuntime: Object.freeze({
        ready: clientRuntime.ready,
        handoffCount: clientRuntime.handoffCount,
        nextAction: clientRuntime.nextAction,
      }),
      mailchimpRuntimeExport: mailchimpRuntimeExport.exportSummary,
      runtimeResumption: runtimeResumptionManifest.exportSummary,
      runtimeActionQueue: runtimeActionQueue.exportSummary,
    }),
    controls: Object.freeze({
      canExport: blocked.length === 0,
      canPreview: blockingDiagnostics.length === 0,
      canEmitStatus: clientRuntime.statusChannels.length > 0,
      canResumeRuntime: runtimeResumptionManifest.ready,
      canRunNextAction: runtimeActionQueue.ready,
    }),
    exportSummary: Object.freeze({
      exportId,
      status: blocked.length === 0 ? "compiled-runtime-export-ready" : "compiled-runtime-export-review",
      blockedCount: blocked.length,
      firstBlocked: blocked[0]?.label ?? null,
      nextAction: blocked.length === 0 ? "publish-compiled-runtime-export" : blocked[0].nextAction,
    }),
    nextAction: blocked.length === 0 ? "publish-compiled-runtime-export" : blocked[0].nextAction,
  });
}

function createRuntimeOperationalPacket(
  jobs,
  diagnostics,
  clientRuntime,
  mailchimpRuntimeExport,
  mailchimpWorkflowHandoff,
  mailchimpClientLaunch,
  restartRunbook,
  runtimeResumptionManifest,
  runtimeActionQueue,
  compiledRuntimeExportManifest,
) {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const mailchimpJobs = jobs.filter((job) => job.handoff.mailchimp);
  const entries = Object.freeze([
    Object.freeze({
      schema: "aios.grammar.runtime-operational-packet.entry.v1",
      id: stableContractId("runtime-ops", "diagnostics", blockingDiagnostics.length),
      source: "diagnostics",
      status: blockingDiagnostics.length === 0 ? "clear" : "blocked",
      accepted: blockingDiagnostics.length === 0,
      blocked: blockingDiagnostics.length > 0,
      severity: blockingDiagnostics.length > 0 ? "error" : "info",
      nextAction: blockingDiagnostics.length === 0 ? "continue" : "fix-blocking-diagnostics",
      references: Object.freeze({
        diagnosticCount: diagnostics.length,
        blockingCount: blockingDiagnostics.length,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.runtime-operational-packet.entry.v1",
      id: stableContractId("runtime-ops", "client-runtime", clientRuntime.ready),
      source: "client-runtime",
      status: clientRuntime.ready ? "ready" : "review",
      accepted: clientRuntime.ready,
      blocked: !clientRuntime.ready,
      severity: clientRuntime.tenantBoundaryReady ? "warning" : "error",
      nextAction: clientRuntime.nextAction,
      references: Object.freeze({
        handoffCount: clientRuntime.handoffCount,
        blockedJobs: clientRuntime.blockedJobs.map((job) => job.job),
        statusChannels: clientRuntime.statusChannels,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.runtime-operational-packet.entry.v1",
      id: stableContractId("runtime-ops", "mailchimp-runtime-export", mailchimpRuntimeExport.status),
      source: "mailchimp-runtime-export",
      status: mailchimpRuntimeExport.status,
      accepted: mailchimpRuntimeExport.ready || mailchimpRuntimeExport.status === "not-required",
      blocked: mailchimpRuntimeExport.status !== "not-required" && !mailchimpRuntimeExport.ready,
      severity: mailchimpRuntimeExport.status.includes("permission") ? "error" : "warning",
      nextAction: mailchimpRuntimeExport.nextAction,
      references: Object.freeze({
        mailchimpJobs: mailchimpJobs.length,
        blockedJobCount: mailchimpRuntimeExport.blockedJobCount ?? 0,
        serviceKeys: mailchimpRuntimeExport.history?.serviceKeys ?? Object.freeze([]),
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.runtime-operational-packet.entry.v1",
      id: stableContractId("runtime-ops", "mailchimp-launch", mailchimpClientLaunch.status),
      source: "mailchimp-client-launch",
      status: mailchimpClientLaunch.status,
      accepted: mailchimpClientLaunch.ready || mailchimpClientLaunch.status === "not-required",
      blocked: mailchimpClientLaunch.status !== "not-required" && !mailchimpClientLaunch.ready,
      severity: mailchimpClientLaunch.status.includes("boundary") ? "error" : "warning",
      nextAction: mailchimpClientLaunch.nextAction,
      references: Object.freeze({
        launchId: mailchimpClientLaunch.launchId,
        blockedCount: mailchimpClientLaunch.phases.filter((phase) => !phase.accepted).length,
        missing: mailchimpClientLaunch.missing,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.runtime-operational-packet.entry.v1",
      id: stableContractId("runtime-ops", "restart-runbook", restartRunbook.status),
      source: "restart-runbook",
      status: restartRunbook.status,
      accepted: restartRunbook.restartable,
      blocked: !restartRunbook.restartable,
      severity: restartRunbook.status.includes("boundary") ? "error" : "warning",
      nextAction: restartRunbook.nextAction,
      references: Object.freeze({
        blockedCount: restartRunbook.steps.filter((step) => !step.accepted).length,
        firstBlocked: restartRunbook.exportSummary.blockedStep,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.runtime-operational-packet.entry.v1",
      id: stableContractId("runtime-ops", "resumption", runtimeResumptionManifest.status),
      source: "runtime-resumption",
      status: runtimeResumptionManifest.status,
      accepted: runtimeResumptionManifest.ready,
      blocked: !runtimeResumptionManifest.ready,
      severity: runtimeResumptionManifest.status.includes("permission") ? "error" : "warning",
      nextAction: runtimeResumptionManifest.nextAction,
      references: Object.freeze({
        blockedJobs: runtimeResumptionManifest.blockedJobs.map((job) => job.job),
        statusChannels: runtimeResumptionManifest.statusChannels,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.runtime-operational-packet.entry.v1",
      id: stableContractId("runtime-ops", "runtime-action-queue", runtimeActionQueue.status),
      source: "runtime-action-queue",
      status: runtimeActionQueue.status,
      accepted: runtimeActionQueue.ready,
      blocked: !runtimeActionQueue.ready,
      severity: runtimeActionQueue.counters?.blocked > 0 ? "warning" : "info",
      nextAction: runtimeActionQueue.nextAction,
      references: Object.freeze({
        blockedCount: runtimeActionQueue.counters?.blocked ?? 0,
        retryableCount: runtimeActionQueue.counters?.retryable ?? 0,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.runtime-operational-packet.entry.v1",
      id: stableContractId("runtime-ops", "compiled-export", compiledRuntimeExportManifest.status),
      source: "compiled-runtime-export",
      status: compiledRuntimeExportManifest.status,
      accepted: compiledRuntimeExportManifest.ready,
      blocked: !compiledRuntimeExportManifest.ready,
      severity: compiledRuntimeExportManifest.status.includes("boundary") ? "error" : "warning",
      nextAction: compiledRuntimeExportManifest.nextAction,
      references: Object.freeze({
        exportId: compiledRuntimeExportManifest.exportId,
        blockedGates: compiledRuntimeExportManifest.blockedGates,
      }),
    }),
  ]);
  const blocked = entries.filter((entry) => entry.blocked);
  const retryable = entries.filter((entry) => (
    entry.source === "restart-runbook"
    || entry.source === "runtime-resumption"
    || entry.source === "runtime-action-queue"
  ) && entry.blocked);
  const auditChannels = Object.freeze([...new Set([
    ...clientRuntime.statusChannels,
    ...jobs.map((job) => job.status.auditChannel).filter(Boolean),
  ])].sort());
  const firstBlocked = blocked
    .slice()
    .sort((left, right) => (
      (left.severity === "error" ? 0 : 1) - (right.severity === "error" ? 0 : 1)
    ))[0] ?? null;

  return Object.freeze({
    schema: "aios.grammar.runtime-operational-packet.v1",
    packetId: stableContractId(
      "runtime-operations",
      mailchimpJobs.length > 0 ? "mailchimp" : "runtime",
      jobs.length,
      blocked.length,
      compiledRuntimeExportManifest.exportId,
    ),
    ready: blocked.length === 0,
    status: blocked.length === 0 ? "runtime-operations-ready" : firstBlocked.status,
    entries,
    counters: Object.freeze({
      jobs: jobs.length,
      mailchimpJobs: mailchimpJobs.length,
      total: entries.length,
      blocked: blocked.length,
      retryable: retryable.length,
      diagnostics: diagnostics.length,
    }),
    audit: Object.freeze({
      channels: auditChannels,
      required: blocked.length > 0 || mailchimpJobs.length > 0,
      status: auditChannels.length > 0
        ? "audit-ready"
        : blocked.length > 0 || mailchimpJobs.length > 0
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    recovery: Object.freeze({
      retryable: retryable.length > 0,
      restartReady: runtimeResumptionManifest.ready && restartRunbook.restartable,
      nextRetryAction: retryable[0]?.nextAction ?? null,
    }),
    exportSummary: Object.freeze({
      status: blocked.length === 0 ? "runtime-operations-ready" : "runtime-operations-review",
      firstBlocked: firstBlocked?.source ?? null,
      blockedCount: blocked.length,
      retryableCount: retryable.length,
      nextAction: firstBlocked?.nextAction ?? "publish-compiled-runtime-export",
    }),
    nextAction: firstBlocked?.nextAction ?? "publish-compiled-runtime-export",
  });
}

function runtimeLaunchGateItem(label, accepted, status, nextAction, details = {}) {
  return Object.freeze({
    schema: "aios.grammar.client-launch-gate.item.v1",
    label,
    accepted: Boolean(accepted),
    status,
    nextAction,
    details: Object.freeze(details),
  });
}

function firstRuntimeLaunchBlocker(items) {
  return Array.from(items ?? []).find((item) => !item.accepted) ?? null;
}

function createCompiledClientLaunchGate(
  jobs,
  diagnostics,
  clientRuntime,
  mailchimpClientLaunch,
  runtimeOperationalPacket,
  compiledRuntimeExportManifest,
) {
  const blockingDiagnostics = Array.from(diagnostics ?? []).filter((diagnostic) => diagnostic.severity !== "warning");
  const mailchimpJobs = Array.from(jobs ?? []).filter((job) => job.handoff.mailchimp);
  const acceptedJobs = Array.from(jobs ?? []).filter((job) => job.ready);
  const statusChannels = Object.freeze([...new Set([
    ...Array.from(clientRuntime.statusChannels ?? []),
    ...Array.from(jobs ?? []).map((job) => job.status.channel).filter(Boolean),
  ])].sort());
  const auditChannels = Object.freeze([...new Set([
    ...Array.from(jobs ?? []).map((job) => job.status.auditChannel).filter(Boolean),
    mailchimpClientLaunch?.sync?.auditChannel,
    runtimeOperationalPacket?.audit?.channels?.[0],
  ].filter(Boolean))].sort());
  const boundaryBlocked = Object.freeze(Array.from(jobs ?? [])
    .filter((job) => !job.tenantPermissionBoundary.allowed)
    .map((job) => Object.freeze({
      job: job.name,
      status: job.tenantPermissionBoundary.status,
      nextAction: job.tenantPermissionBoundary.nextAction,
    })));
  const restartBlocked = Object.freeze(Array.from(jobs ?? [])
    .filter((job) => !job.resumptionManifest.ready)
    .map((job) => Object.freeze({
      job: job.name,
      status: job.resumptionManifest.status,
      blockedGates: job.resumptionManifest.blockedGates,
      nextAction: job.resumptionManifest.nextAction,
    })));
  const intentBlocked = Object.freeze(Array.from(jobs ?? [])
    .filter((job) => !job.clientExecutionIntent.accepted)
    .map((job) => Object.freeze({
      job: job.name,
      status: job.clientExecutionIntent.status,
      missing: job.clientExecutionIntent.validationSummary.missing,
      nextAction: job.clientExecutionIntent.nextAction,
    })));
  const items = Object.freeze([
    runtimeLaunchGateItem("diagnostics", blockingDiagnostics.length === 0, blockingDiagnostics.length === 0 ? "clear" : "blocked", blockingDiagnostics.length === 0 ? "continue" : "fix-blocking-diagnostics", {
      blockingCount: blockingDiagnostics.length,
      warningCount: Array.from(diagnostics ?? []).length - blockingDiagnostics.length,
    }),
    runtimeLaunchGateItem("tenant-boundaries", boundaryBlocked.length === 0, boundaryBlocked.length === 0 ? "tenant-boundaries-ready" : boundaryBlocked[0].status, boundaryBlocked[0]?.nextAction ?? "continue", {
      blockedJobs: boundaryBlocked,
    }),
    runtimeLaunchGateItem("client-runtime", clientRuntime.ready, clientRuntime.ready ? "client-runtime-ready" : "client-runtime-review", clientRuntime.nextAction, {
      handoffCount: clientRuntime.handoffCount,
      blockedJobs: clientRuntime.blockedJobs,
      intentBlockedJobs: clientRuntime.executionIntentBlockedJobs,
    }),
    runtimeLaunchGateItem("runtime-resumption", restartBlocked.length === 0, restartBlocked.length === 0 ? "resumption-ready" : restartBlocked[0].status, restartBlocked[0]?.nextAction ?? "continue", {
      blockedJobs: restartBlocked,
    }),
    runtimeLaunchGateItem("compiled-export", compiledRuntimeExportManifest.ready, compiledRuntimeExportManifest.status, compiledRuntimeExportManifest.nextAction, {
      exportId: compiledRuntimeExportManifest.exportId,
      blockedGates: compiledRuntimeExportManifest.blockedGates,
    }),
    runtimeLaunchGateItem("runtime-operations", runtimeOperationalPacket.ready, runtimeOperationalPacket.status, runtimeOperationalPacket.nextAction, {
      packetId: runtimeOperationalPacket.packetId,
      blockedCount: runtimeOperationalPacket.counters.blocked,
      retryableCount: runtimeOperationalPacket.counters.retryable,
    }),
    runtimeLaunchGateItem("mailchimp-client-launch", mailchimpJobs.length === 0 || mailchimpClientLaunch.ready, mailchimpJobs.length === 0 ? "not-required" : mailchimpClientLaunch.status, mailchimpJobs.length === 0 ? "continue" : mailchimpClientLaunch.nextAction, {
      jobCount: mailchimpJobs.length,
      launchId: mailchimpClientLaunch.launchId,
      blockedPhase: mailchimpClientLaunch.blockedPhase?.label ?? null,
    }),
    runtimeLaunchGateItem("status-observability", statusChannels.length > 0, statusChannels.length > 0 ? "status-ready" : "status-review", statusChannels.length > 0 ? "continue" : "declare-status-channel", {
      statusChannels,
      auditChannels,
    }),
  ]);
  const blocker = firstRuntimeLaunchBlocker(items);
  const accepted = !blocker && intentBlocked.length === 0;
  const launchGateId = stableContractId(
    "compiled-client-launch-gate",
    mailchimpJobs.length > 0 ? "mailchimp" : "runtime",
    jobs.length,
    acceptedJobs.length,
    compiledRuntimeExportManifest.exportId,
  );
  const missing = Object.freeze([...new Set([
    ...items.filter((item) => !item.accepted).map((item) => item.label),
    ...intentBlocked.flatMap((entry) => entry.missing),
  ])].sort());

  return Object.freeze({
    schema: "aios.grammar.compiled-client-launch-gate.v1",
    launchGateId,
    accepted,
    ready: accepted,
    status: accepted ? "client-launch-ready" : blocker?.status ?? "client-launch-review",
    jobs: Object.freeze({
      total: jobs.length,
      ready: acceptedJobs.length,
      mailchimp: mailchimpJobs.length,
      blockedBoundary: boundaryBlocked.length,
      blockedRestart: restartBlocked.length,
      blockedIntent: intentBlocked.length,
    }),
    channels: Object.freeze({
      status: statusChannels,
      audit: auditChannels,
    }),
    checklist: items,
    blocker: blocker
      ? Object.freeze({
          label: blocker.label,
          status: blocker.status,
          nextAction: blocker.nextAction,
        })
      : null,
    validationSummary: Object.freeze({
      diagnosticsReady: blockingDiagnostics.length === 0,
      tenantBoundariesReady: boundaryBlocked.length === 0,
      clientRuntimeReady: clientRuntime.ready,
      resumptionReady: restartBlocked.length === 0,
      compiledExportReady: compiledRuntimeExportManifest.ready,
      runtimeOperationsReady: runtimeOperationalPacket.ready,
      mailchimpLaunchReady: mailchimpJobs.length === 0 || mailchimpClientLaunch.ready,
      statusReady: statusChannels.length > 0,
      missing,
    }),
    controls: Object.freeze({
      canPreview: jobs.length > 0 && blockingDiagnostics.length === 0,
      canAccept: mailchimpJobs.length === 0 || mailchimpClientLaunch.controls.canAcceptPreview,
      canPersist: compiledRuntimeExportManifest.controls.canPersistRuntimeState,
      canResume: runtimeOperationalPacket.recovery.restartReady,
      canEmitStatus: statusChannels.length > 0,
      canLaunchClient: accepted,
      canRetry: !accepted && runtimeOperationalPacket.recovery.retryable,
    }),
    routeContract: Object.freeze({
      method: "POST",
      action: accepted ? "launch-compiled-client-runtime" : blocker?.nextAction ?? "review-client-launch",
      idempotencyKey: `${launchGateId}:launch`,
      requiresOperator: !accepted && (
        blocker?.label === "mailchimp-client-launch"
        || blocker?.label === "status-observability"
        || missing.includes("preview-acceptance")
      ),
      retryable: !accepted && runtimeOperationalPacket.recovery.retryable,
    }),
    exportSummary: Object.freeze({
      launchGateId,
      status: accepted ? "client-launch-ready" : "client-launch-review",
      blockedGate: blocker?.label ?? null,
      missing,
      nextAction: accepted ? "launch-compiled-client-runtime" : blocker?.nextAction ?? "review-client-launch",
    }),
    nextAction: accepted ? "launch-compiled-client-runtime" : blocker?.nextAction ?? "review-client-launch",
  });
}

function createCompiledMailchimpExportHistory(
  jobs,
  diagnostics,
  mailchimpRuntimeExport,
  mailchimpWorkflowHandoff,
  mailchimpClientLaunch,
  compiledRuntimeExportManifest,
  runtimeOperationalPacket,
) {
  const mailchimpJobs = Object.freeze(Array.from(jobs ?? []).filter((job) => job.handoff.mailchimp));
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const acceptedJobs = mailchimpJobs.filter((job) => job.ready && job.externalProviderService.accepted);
  const blockedJobs = mailchimpJobs.filter((job) => !job.ready || !job.externalProviderService.accepted);
  const operations = Object.freeze([...new Set(mailchimpJobs.map((job) => job.handoff.operation).filter(Boolean))].sort());
  const statusChannels = Object.freeze([...new Set(mailchimpJobs
    .map((job) => job.status.channel ?? job.status.auditChannel)
    .filter(Boolean))].sort());
  const auditChannels = Object.freeze([...new Set(mailchimpJobs
    .map((job) => job.status.auditChannel)
    .filter(Boolean))].sort());
  const permissionGaps = Object.freeze([...new Set(mailchimpJobs
    .flatMap((job) => job.tenantPermissionBoundary.missingPermissions))]
    .sort());
  const stages = Object.freeze([
    Object.freeze({
      schema: "aios.grammar.mailchimp-export-history.stage.v1",
      label: "contracts",
      accepted: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0 && blockedJobs.length === 0,
      status: mailchimpJobs.length === 0
        ? "not-required"
        : blockingDiagnostics.length > 0
          ? "diagnostic-review"
          : blockedJobs.length === 0 ? "accepted" : "contract-review",
      nextAction: blockingDiagnostics.length > 0
        ? "fix-blocking-diagnostics"
        : blockedJobs[0]?.nextAction ?? "continue",
    }),
    Object.freeze({
      schema: "aios.grammar.mailchimp-export-history.stage.v1",
      label: "runtime-export",
      accepted: mailchimpRuntimeExport.ready,
      status: mailchimpRuntimeExport.exportSummary.status,
      nextAction: mailchimpRuntimeExport.nextAction,
    }),
    Object.freeze({
      schema: "aios.grammar.mailchimp-export-history.stage.v1",
      label: "workflow-handoff",
      accepted: mailchimpWorkflowHandoff.ready,
      status: mailchimpWorkflowHandoff.exportSummary.status,
      nextAction: mailchimpWorkflowHandoff.nextAction,
    }),
    Object.freeze({
      schema: "aios.grammar.mailchimp-export-history.stage.v1",
      label: "client-launch",
      accepted: mailchimpClientLaunch.ready || mailchimpClientLaunch.status === "not-required",
      status: mailchimpClientLaunch.exportSummary.status,
      nextAction: mailchimpClientLaunch.nextAction,
    }),
    Object.freeze({
      schema: "aios.grammar.mailchimp-export-history.stage.v1",
      label: "compiled-export",
      accepted: compiledRuntimeExportManifest.ready,
      status: compiledRuntimeExportManifest.exportSummary.status,
      nextAction: compiledRuntimeExportManifest.nextAction,
    }),
    Object.freeze({
      schema: "aios.grammar.mailchimp-export-history.stage.v1",
      label: "runtime-operations",
      accepted: runtimeOperationalPacket.ready,
      status: runtimeOperationalPacket.exportSummary.status,
      nextAction: runtimeOperationalPacket.nextAction,
    }),
  ]);
  const blocker = stages.find((stage) => !stage.accepted) ?? null;
  const accepted = mailchimpJobs.length > 0 && !blocker;
  const exportId = stableContractId(
    "compiled-mailchimp-export-history",
    mailchimpJobs.length,
    operations.join(".") || "none",
    compiledRuntimeExportManifest.exportId,
  );

  return Object.freeze({
    schema: "aios.grammar.compiled-mailchimp-export-history.v1",
    exportId,
    accepted,
    ready: accepted,
    status: mailchimpJobs.length === 0
      ? "not-required"
      : accepted
        ? "mailchimp-export-history-ready"
        : blocker?.status ?? "mailchimp-export-history-review",
    operations,
    channels: Object.freeze({
      status: statusChannels,
      audit: auditChannels,
    }),
    counters: Object.freeze({
      jobs: mailchimpJobs.length,
      acceptedJobs: acceptedJobs.length,
      blockedJobs: blockedJobs.length,
      mutatingJobs: mailchimpJobs.filter((job) => job.handoff.mutatesProvider).length,
      diagnostics: diagnostics.length,
      blockingDiagnostics: blockingDiagnostics.length,
      permissionGaps: permissionGaps.length,
      stages: stages.length,
      blockedStages: stages.filter((stage) => !stage.accepted).length,
    }),
    jobSnapshots: Object.freeze(mailchimpJobs.map((job) => Object.freeze({
      job: job.name,
      adapter: job.handoff.adapter,
      operation: job.handoff.operation,
      ready: job.ready,
      serviceKey: job.externalProviderService.serviceKey,
      stateKey: job.persistedState.stateKey,
      isolationKey: job.tenantPermissionBoundary.isolationKey,
      statusChannel: job.status.channel,
      auditChannel: job.status.auditChannel,
      missingPermissions: job.tenantPermissionBoundary.missingPermissions,
      nextAction: job.ready ? "continue" : job.nextAction ?? job.externalProviderService.nextAction,
    }))),
    timeline: stages,
    validationSummary: Object.freeze({
      diagnosticsReady: blockingDiagnostics.length === 0,
      contractsReady: blockedJobs.length === 0,
      runtimeExportReady: mailchimpRuntimeExport.ready,
      workflowReady: mailchimpWorkflowHandoff.ready,
      clientLaunchReady: mailchimpClientLaunch.ready || mailchimpClientLaunch.status === "not-required",
      compiledExportReady: compiledRuntimeExportManifest.ready,
      operationsReady: runtimeOperationalPacket.ready,
      permissionGaps,
      blockedStage: blocker?.label ?? null,
    }),
    controls: Object.freeze({
      canPreview: mailchimpJobs.length > 0,
      canAccept: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0 && permissionGaps.length === 0,
      canExportHistory: accepted,
      canEmitStatus: statusChannels.length > 0,
      canExportAudit: auditChannels.length > 0,
      canReplayOperations: runtimeOperationalPacket.recovery.restartReady,
    }),
    exportSummary: Object.freeze({
      exportId,
      status: accepted ? "compiled-mailchimp-export-history-ready" : mailchimpJobs.length === 0 ? "not-required" : "compiled-mailchimp-export-history-review",
      jobCount: mailchimpJobs.length,
      blockedStage: blocker?.label ?? null,
      operations,
      nextAction: accepted ? "publish-compiled-mailchimp-export-history" : blocker?.nextAction ?? "review-mailchimp-export-history",
    }),
    nextAction: accepted ? "publish-compiled-mailchimp-export-history" : blocker?.nextAction ?? "review-mailchimp-export-history",
  });
}

function compiledWorkflowStage(label, artifact, accepted, nextAction, references = {}) {
  return Object.freeze({
    schema: "aios.grammar.compiled-workflow-handoff.stage.v1",
    label,
    status: artifact?.exportSummary?.status ?? artifact?.status ?? (accepted ? "ready" : "review"),
    accepted: Boolean(accepted),
    nextAction: accepted ? "continue" : nextAction ?? artifact?.nextAction ?? "review-compiled-workflow-stage",
    references: Object.freeze(references),
  });
}

function createCompiledMailchimpWorkflowManifest(
  jobs,
  diagnostics,
  clientRuntime,
  mailchimpRuntimeExport,
  mailchimpWorkflowHandoff,
  mailchimpClientLaunch,
  compiledRuntimeExportManifest,
  runtimeOperationalPacket,
  compiledClientLaunchGate,
  compiledMailchimpExportHistory,
) {
  const mailchimpJobs = Object.freeze(Array.from(jobs ?? []).filter((job) => job.handoff.mailchimp));
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const jobRoutes = Object.freeze(mailchimpJobs.map((job) => {
    const boundaryReady = job.tenantPermissionBoundary.allowed;
    const providerReady = job.externalProviderService.accepted;
    const clientReady = job.clientRuntime.readiness.accepted;
    const executionReady = job.clientExecutionIntent.accepted;
    const restartReady = job.persistedState.restartSafe && job.resumptionManifest.ready;
    const operatorReady = job.mailchimpOperatorGate.accepted;
    const auditReady = job.tenantPermissionBoundary.audit.status === "audit-ready" || !job.tenantPermissionBoundary.audit.required;
    const statusReady = job.status.observable;
    const idempotencyReady = !job.handoff.mutatesProvider || Boolean(job.recovery.idempotencyKey);
    const missing = Object.freeze([
      boundaryReady ? null : "tenant-boundary",
      job.tenantPermissionBoundary.missingPermissions.length > 0 ? "mailchimp-permissions" : null,
      providerReady ? null : "provider-service",
      clientReady ? null : "client-runtime",
      executionReady ? null : "execution-intent",
      restartReady ? null : "restart-safe-state",
      operatorReady ? null : "operator-gate",
      auditReady ? null : "audit-channel",
      statusReady ? null : "status-channel",
      idempotencyReady ? null : "idempotency-key",
    ].filter(Boolean));
    const accepted = missing.length === 0 && job.ready;
    const blocked = missing[0] ?? null;

    return Object.freeze({
      schema: "aios.grammar.compiled-mailchimp-workflow.job-route.v1",
      job: job.name,
      adapter: job.handoff.adapter,
      provider: job.handoff.provider,
      operation: job.handoff.operation,
      mutatesProvider: job.handoff.mutatesProvider,
      accepted,
      status: accepted
        ? "workflow-route-ready"
        : blocked === "tenant-boundary" || blocked === "mailchimp-permissions"
          ? job.tenantPermissionBoundary.status
          : blocked === "provider-service"
            ? job.externalProviderService.handoffState.status
            : blocked === "client-runtime"
              ? job.clientRuntime.readiness.status
              : blocked === "execution-intent"
                ? job.clientExecutionIntent.status
                : blocked === "restart-safe-state"
                  ? job.resumptionManifest.status
                  : blocked === "operator-gate"
                    ? job.mailchimpOperatorGate.status
                    : blocked === "audit-channel"
                      ? "audit-review"
                      : blocked === "status-channel"
                        ? "status-review"
                        : "idempotency-review",
      boundary: Object.freeze({
        workspace: job.tenantPermissionBoundary.scope.workspace,
        tenant: job.tenantPermissionBoundary.scope.tenant,
        role: job.tenantPermissionBoundary.scope.role,
        isolationKey: job.tenantPermissionBoundary.isolationKey,
      }),
      sync: Object.freeze({
        serviceKey: job.externalProviderService.serviceKey,
        stateKey: job.persistedState.stateKey,
        executionIntentId: job.clientExecutionIntent.intentId,
        resumptionManifestId: job.resumptionManifest.manifestId,
        operatorGateId: job.mailchimpOperatorGate.gateId,
        statusChannel: job.status.channel,
        auditChannel: job.status.auditChannel,
      }),
      validationSummary: Object.freeze({
        boundaryReady,
        permissionsReady: job.tenantPermissionBoundary.missingPermissions.length === 0,
        providerReady,
        clientReady,
        executionReady,
        restartReady,
        operatorReady,
        auditReady,
        statusReady,
        idempotencyReady,
        missing,
      }),
      preview: Object.freeze({
        parameters: job.handoff.parameters,
        requiredPermissions: job.handoff.requiredPermissions,
        missingPermissions: job.tenantPermissionBoundary.missingPermissions,
        statusChannels: statusChannelsForClient(job.status),
        commands: job.clientExecutionIntent.commands,
        restartCommandLedger: job.persistedState.commandLedger,
      }),
      controls: Object.freeze({
        canPreview: Boolean(job.handoff.adapter) && blockingDiagnostics.length === 0,
        canAccept: boundaryReady && providerReady && statusReady && auditReady,
        canPersist: restartReady,
        canReplay: restartReady && idempotencyReady,
        canLaunchClient: accepted,
        canEmitStatus: statusReady,
        canExportAudit: Boolean(job.status.auditChannel),
      }),
      nextStep: Object.freeze({
        label: accepted ? "Mailchimp client workflow" : blocked ?? "mailchimp-workflow",
        action: accepted
          ? "launch-mailchimp-client-workflow"
          : blocked === "tenant-boundary" || blocked === "mailchimp-permissions"
            ? job.tenantPermissionBoundary.nextAction
            : blocked === "provider-service"
              ? job.externalProviderService.nextAction
              : blocked === "client-runtime"
                ? job.clientRuntime.readiness.nextAction
                : blocked === "execution-intent"
                  ? job.clientExecutionIntent.nextAction
                  : blocked === "restart-safe-state"
                    ? job.resumptionManifest.nextAction
                    : blocked === "operator-gate"
                      ? job.mailchimpOperatorGate.nextAction
                      : blocked === "audit-channel"
                        ? "declare-audit-channel"
                        : blocked === "status-channel"
                          ? "declare-status-channel"
                          : "declare-idempotency-key",
        requiresOperator: !accepted,
        retryable: !accepted && ["restart-safe-state", "provider-service", "client-runtime"].includes(blocked),
      }),
      nextAction: accepted
        ? "launch-mailchimp-client-workflow"
        : blocked === "tenant-boundary" || blocked === "mailchimp-permissions"
          ? job.tenantPermissionBoundary.nextAction
          : blocked === "provider-service"
            ? job.externalProviderService.nextAction
            : blocked === "client-runtime"
              ? job.clientRuntime.readiness.nextAction
              : blocked === "execution-intent"
                ? job.clientExecutionIntent.nextAction
                : blocked === "restart-safe-state"
                  ? job.resumptionManifest.nextAction
                  : blocked === "operator-gate"
                    ? job.mailchimpOperatorGate.nextAction
                    : blocked === "audit-channel"
                      ? "declare-audit-channel"
                      : blocked === "status-channel"
                        ? "declare-status-channel"
                        : "declare-idempotency-key",
    });
  }));
  const blockedRoutes = jobRoutes.filter((route) => !route.accepted);
  const stages = Object.freeze([
    compiledWorkflowStage("diagnostics", { status: blockingDiagnostics.length === 0 ? "diagnostics-ready" : "diagnostic-review" }, blockingDiagnostics.length === 0, "fix-blocking-diagnostics", {
      blockingCount: blockingDiagnostics.length,
    }),
    compiledWorkflowStage("client-runtime", clientRuntime, clientRuntime.ready, clientRuntime.nextAction, {
      readyJobs: clientRuntime.readyJobs,
      blockedJobs: clientRuntime.blockedJobs,
    }),
    compiledWorkflowStage("mailchimp-runtime-export", mailchimpRuntimeExport, mailchimpRuntimeExport.ready || mailchimpRuntimeExport.status === "not-required", mailchimpRuntimeExport.nextAction, {
      exportId: mailchimpRuntimeExport.exportId,
    }),
    compiledWorkflowStage("workflow-handoff", mailchimpWorkflowHandoff, mailchimpWorkflowHandoff.ready || mailchimpWorkflowHandoff.status === "not-required", mailchimpWorkflowHandoff.nextAction, {
      workflowId: mailchimpWorkflowHandoff.workflowId,
    }),
    compiledWorkflowStage("client-launch", mailchimpClientLaunch, mailchimpClientLaunch.ready || mailchimpClientLaunch.status === "not-required", mailchimpClientLaunch.nextAction, {
      launchId: mailchimpClientLaunch.launchId,
    }),
    compiledWorkflowStage("runtime-export-manifest", compiledRuntimeExportManifest, compiledRuntimeExportManifest.ready, compiledRuntimeExportManifest.nextAction, {
      manifestId: compiledRuntimeExportManifest.manifestId,
    }),
    compiledWorkflowStage("runtime-operations", runtimeOperationalPacket, runtimeOperationalPacket.ready, runtimeOperationalPacket.nextAction, {
      packetId: runtimeOperationalPacket.packetId,
    }),
    compiledWorkflowStage("client-launch-gate", compiledClientLaunchGate, compiledClientLaunchGate.ready || compiledClientLaunchGate.status === "not-required", compiledClientLaunchGate.nextAction, {
      gateId: compiledClientLaunchGate.gateId,
    }),
    compiledWorkflowStage("export-history", compiledMailchimpExportHistory, compiledMailchimpExportHistory.ready || compiledMailchimpExportHistory.status === "not-required", compiledMailchimpExportHistory.nextAction, {
      exportId: compiledMailchimpExportHistory.exportId,
    }),
    compiledWorkflowStage("job-routes", { status: blockedRoutes.length === 0 ? "job-routes-ready" : "job-route-review" }, blockedRoutes.length === 0, blockedRoutes[0]?.nextAction ?? "review-mailchimp-job-routes", {
      total: jobRoutes.length,
      blocked: blockedRoutes.length,
    }),
  ]);
  const blocker = stages.find((stage) => !stage.accepted) ?? null;
  const missing = Object.freeze([...new Set([
    ...blockedRoutes.flatMap((route) => route.validationSummary.missing),
    blocker?.label,
  ].filter(Boolean))].sort());
  const accepted = mailchimpJobs.length > 0 && !blocker && missing.length === 0;
  const manifestId = stableContractId(
    "compiled-mailchimp-workflow",
    mailchimpJobs.length,
    jobRoutes.map((route) => route.operation).join(".") || "none",
    compiledRuntimeExportManifest.exportSummary.manifestId,
  );

  return Object.freeze({
    schema: "aios.grammar.compiled-mailchimp-workflow.manifest.v1",
    manifestId,
    accepted,
    ready: accepted,
    status: mailchimpJobs.length === 0
      ? "not-required"
      : accepted
        ? "compiled-mailchimp-workflow-ready"
        : blocker?.status ?? "compiled-mailchimp-workflow-review",
    stages,
    jobRoutes,
    validationSummary: Object.freeze({
      diagnosticsReady: blockingDiagnostics.length === 0,
      clientRuntimeReady: clientRuntime.ready,
      runtimeExportReady: mailchimpRuntimeExport.ready || mailchimpRuntimeExport.status === "not-required",
      workflowHandoffReady: mailchimpWorkflowHandoff.ready || mailchimpWorkflowHandoff.status === "not-required",
      clientLaunchReady: mailchimpClientLaunch.ready || mailchimpClientLaunch.status === "not-required",
      compiledExportReady: compiledRuntimeExportManifest.ready,
      operationsReady: runtimeOperationalPacket.ready,
      launchGateReady: compiledClientLaunchGate.ready || compiledClientLaunchGate.status === "not-required",
      exportHistoryReady: compiledMailchimpExportHistory.ready || compiledMailchimpExportHistory.status === "not-required",
      jobRoutesReady: blockedRoutes.length === 0,
      blockedStage: blocker?.label ?? null,
      missing,
    }),
    controls: Object.freeze({
      canPreview: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0,
      canAccept: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0 && blockedRoutes.length === 0,
      canPersist: jobRoutes.every((route) => route.controls.canPersist),
      canReplay: jobRoutes.every((route) => route.controls.canReplay),
      canLaunchClient: accepted,
      canEmitStatus: jobRoutes.some((route) => route.controls.canEmitStatus),
      canExportAudit: jobRoutes.some((route) => route.controls.canExportAudit),
    }),
    nextStep: Object.freeze({
      label: accepted ? "compiled-mailchimp-workflow" : blocker?.label ?? "compiled-mailchimp-workflow",
      action: accepted ? "launch-compiled-mailchimp-workflow" : blocker?.nextAction ?? "review-compiled-mailchimp-workflow",
      requiresOperator: !accepted,
      retryable: !accepted && ["runtime-operations", "job-routes"].includes(blocker?.label),
    }),
    exportSummary: Object.freeze({
      manifestId,
      status: accepted ? "compiled-mailchimp-workflow-ready" : mailchimpJobs.length === 0 ? "not-required" : "compiled-mailchimp-workflow-review",
      jobCount: mailchimpJobs.length,
      blockedJobCount: blockedRoutes.length,
      blockedStage: blocker?.label ?? null,
      missing,
      nextAction: accepted ? "launch-compiled-mailchimp-workflow" : blocker?.nextAction ?? "review-compiled-mailchimp-workflow",
    }),
    nextAction: accepted ? "launch-compiled-mailchimp-workflow" : blocker?.nextAction ?? "review-compiled-mailchimp-workflow",
  });
}

function releaseReportStage(label, artifact, accepted, nextAction, references = {}) {
  return Object.freeze({
    schema: "aios.grammar.mailchimp-release-report.stage.v1",
    label,
    accepted: Boolean(accepted),
    status: artifact?.exportSummary?.status ?? artifact?.status ?? (accepted ? "accepted" : "review"),
    nextAction,
    references: Object.freeze(references),
  });
}

function createCompiledMailchimpReleaseReport(
  jobs,
  diagnostics,
  clientRuntime,
  mailchimpRuntimeExport,
  mailchimpWorkflowHandoff,
  mailchimpClientLaunch,
  runtimeResumptionManifest,
  runtimeRestartStatusReconciliation,
  runtimeActionQueue,
  compiledRuntimeExportManifest,
  runtimeOperationalPacket,
  compiledClientLaunchGate,
  compiledMailchimpExportHistory,
  compiledMailchimpWorkflowManifest,
) {
  const mailchimpJobs = Object.freeze(Array.from(jobs ?? []).filter((job) => job.handoff.mailchimp));
  const blockingDiagnostics = Object.freeze(Array.from(diagnostics ?? []).filter((diagnostic) => diagnostic.severity !== "warning"));
  const readyJobs = Object.freeze(mailchimpJobs.filter((job) => job.ready && job.externalProviderService.accepted));
  const blockedJobs = Object.freeze(mailchimpJobs
    .filter((job) => !job.ready || !job.externalProviderService.accepted || !job.clientExecutionIntent.accepted)
    .map((job) => Object.freeze({
      job: job.name,
      operation: job.handoff.operation,
      status: !job.ready
        ? job.tenantPermissionBoundary.status
        : !job.externalProviderService.accepted
          ? job.externalProviderService.status
          : !job.clientExecutionIntent.accepted
            ? job.clientExecutionIntent.status
            : "review",
      missing: Object.freeze([
        ...Array.from(job.tenantPermissionBoundary.missingPermissions ?? []),
        ...Array.from(job.externalProviderService.validationSummary?.missing ?? []),
        ...Array.from(job.clientExecutionIntent.validationSummary?.missing ?? []),
      ].filter((value, index, values) => values.indexOf(value) === index).sort()),
      nextAction: !job.ready
        ? job.tenantPermissionBoundary.nextAction
        : !job.externalProviderService.accepted
          ? job.externalProviderService.nextAction
          : !job.clientExecutionIntent.accepted
            ? job.clientExecutionIntent.nextAction
            : "review-mailchimp-job",
    })));
  const stages = Object.freeze([
    releaseReportStage("diagnostics", { status: blockingDiagnostics.length === 0 ? "clear" : "blocked" }, blockingDiagnostics.length === 0, blockingDiagnostics.length === 0 ? "continue" : "fix-blocking-diagnostics", {
      diagnosticCount: diagnostics.length,
      blockingCount: blockingDiagnostics.length,
    }),
    releaseReportStage("client-runtime", clientRuntime, clientRuntime.ready, clientRuntime.nextAction, {
      handoffCount: clientRuntime.handoffCount,
      blockedJobs: clientRuntime.blockedJobs,
    }),
    releaseReportStage("runtime-export", mailchimpRuntimeExport, mailchimpRuntimeExport.ready || mailchimpRuntimeExport.status === "not-required", mailchimpRuntimeExport.nextAction, {
      exportId: mailchimpRuntimeExport.exportId,
      blockedJobCount: mailchimpRuntimeExport.blockedJobCount ?? 0,
    }),
    releaseReportStage("workflow-handoff", mailchimpWorkflowHandoff, mailchimpWorkflowHandoff.ready || mailchimpWorkflowHandoff.status === "not-required", mailchimpWorkflowHandoff.nextAction, {
      workflowId: mailchimpWorkflowHandoff.workflowId,
    }),
    releaseReportStage("client-launch", mailchimpClientLaunch, mailchimpClientLaunch.ready || mailchimpClientLaunch.status === "not-required", mailchimpClientLaunch.nextAction, {
      launchId: mailchimpClientLaunch.launchId,
      blockedPhase: mailchimpClientLaunch.blockedPhase?.label ?? null,
    }),
    releaseReportStage("runtime-resumption", runtimeResumptionManifest, runtimeResumptionManifest.ready, runtimeResumptionManifest.nextAction, {
      manifestId: runtimeResumptionManifest.manifestId,
      blockedJobs: runtimeResumptionManifest.blockedJobs,
    }),
    releaseReportStage("restart-status", runtimeRestartStatusReconciliation, runtimeRestartStatusReconciliation.accepted, runtimeRestartStatusReconciliation.nextAction, {
      reconciliationId: runtimeRestartStatusReconciliation.reconciliationId,
    }),
    releaseReportStage("action-queue", runtimeActionQueue, runtimeActionQueue.ready, runtimeActionQueue.nextAction, {
      queueId: runtimeActionQueue.queueId,
      blockedCount: runtimeActionQueue.counters?.blocked ?? 0,
    }),
    releaseReportStage("compiled-export", compiledRuntimeExportManifest, compiledRuntimeExportManifest.ready, compiledRuntimeExportManifest.nextAction, {
      exportId: compiledRuntimeExportManifest.exportId,
      blockedGates: compiledRuntimeExportManifest.blockedGates,
    }),
    releaseReportStage("runtime-operations", runtimeOperationalPacket, runtimeOperationalPacket.ready, runtimeOperationalPacket.nextAction, {
      packetId: runtimeOperationalPacket.packetId,
      blockedCount: runtimeOperationalPacket.counters.blocked,
    }),
    releaseReportStage("client-launch-gate", compiledClientLaunchGate, compiledClientLaunchGate.ready || compiledClientLaunchGate.status === "not-required", compiledClientLaunchGate.nextAction, {
      launchGateId: compiledClientLaunchGate.launchGateId,
      blockedGate: compiledClientLaunchGate.blocker?.label ?? null,
    }),
    releaseReportStage("export-history", compiledMailchimpExportHistory, compiledMailchimpExportHistory.ready || compiledMailchimpExportHistory.status === "not-required", compiledMailchimpExportHistory.nextAction, {
      exportId: compiledMailchimpExportHistory.exportId,
    }),
    releaseReportStage("workflow-manifest", compiledMailchimpWorkflowManifest, compiledMailchimpWorkflowManifest.ready || compiledMailchimpWorkflowManifest.status === "not-required", compiledMailchimpWorkflowManifest.nextAction, {
      manifestId: compiledMailchimpWorkflowManifest.manifestId,
    }),
  ]);
  const blocker = stages.find((stage) => !stage.accepted) ?? null;
  const statusChannels = Object.freeze([...new Set([
    ...Array.from(clientRuntime.statusChannels ?? []),
    ...mailchimpJobs.map((job) => job.status.channel).filter(Boolean),
  ])].sort());
  const auditChannels = Object.freeze([...new Set(mailchimpJobs
    .map((job) => job.status.auditChannel)
    .filter(Boolean))].sort());
  const operations = Object.freeze([...new Set(mailchimpJobs.map((job) => job.handoff.operation).filter(Boolean))].sort());
  const missing = Object.freeze([...new Set([
    ...blockedJobs.flatMap((job) => job.missing),
    ...stages.filter((stage) => !stage.accepted).map((stage) => stage.label),
  ].filter(Boolean))].sort());
  const accepted = mailchimpJobs.length > 0 && !blocker && blockedJobs.length === 0 && missing.length === 0;
  const reportId = stableContractId(
    "compiled-mailchimp-release-report",
    mailchimpJobs.length,
    operations.join(".") || "none",
    compiledRuntimeExportManifest.exportId,
    compiledClientLaunchGate.launchGateId,
  );

  return Object.freeze({
    schema: "aios.grammar.compiled-mailchimp-release-report.v1",
    reportId,
    accepted,
    ready: accepted,
    status: mailchimpJobs.length === 0
      ? "not-required"
      : accepted
        ? "mailchimp-release-ready"
        : blocker?.status ?? blockedJobs[0]?.status ?? "mailchimp-release-review",
    provider: "mailchimp",
    operations,
    counters: Object.freeze({
      jobs: mailchimpJobs.length,
      readyJobs: readyJobs.length,
      blockedJobs: blockedJobs.length,
      diagnostics: diagnostics.length,
      blockingDiagnostics: blockingDiagnostics.length,
      stages: stages.length,
      blockedStages: stages.filter((stage) => !stage.accepted).length,
      statusChannels: statusChannels.length,
      auditChannels: auditChannels.length,
    }),
    channels: Object.freeze({
      status: statusChannels,
      audit: auditChannels,
    }),
    stages,
    blockedJobs,
    timeline: Object.freeze(stages.map((stage, index) => Object.freeze({
      schema: "aios.grammar.mailchimp-release-report.timeline-event.v1",
      index,
      label: stage.label,
      status: stage.status,
      accepted: stage.accepted,
      nextAction: stage.nextAction,
    }))),
    validationSummary: Object.freeze({
      diagnosticsReady: blockingDiagnostics.length === 0,
      jobsReady: blockedJobs.length === 0,
      clientRuntimeReady: clientRuntime.ready,
      compiledExportReady: compiledRuntimeExportManifest.ready,
      operationsReady: runtimeOperationalPacket.ready,
      launchGateReady: compiledClientLaunchGate.ready || compiledClientLaunchGate.status === "not-required",
      workflowReady: compiledMailchimpWorkflowManifest.ready || compiledMailchimpWorkflowManifest.status === "not-required",
      blockedStage: blocker?.label ?? null,
      missing,
    }),
    controls: Object.freeze({
      canPreview: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0,
      canAcceptRelease: accepted,
      canExportReport: mailchimpJobs.length > 0,
      canEmitStatus: statusChannels.length > 0,
      canExportAudit: auditChannels.length > 0,
      canReplay: runtimeResumptionManifest.ready && runtimeOperationalPacket.recovery.restartReady,
    }),
    exportSummary: Object.freeze({
      reportId,
      status: mailchimpJobs.length === 0 ? "not-required" : accepted ? "mailchimp-release-ready" : "mailchimp-release-review",
      jobCount: mailchimpJobs.length,
      blockedJobCount: blockedJobs.length,
      blockedStage: blocker?.label ?? null,
      missing,
      nextAction: accepted ? "publish-mailchimp-release-report" : blocker?.nextAction ?? blockedJobs[0]?.nextAction ?? "review-mailchimp-release",
    }),
    nextAction: accepted ? "publish-mailchimp-release-report" : blocker?.nextAction ?? blockedJobs[0]?.nextAction ?? "review-mailchimp-release",
  });
}

function createCompiledRouteReadinessContract(
  jobs,
  diagnostics,
  clientRuntime,
  mailchimpClientLaunch,
  runtimeExternalProviderStatusReceipts,
  runtimeRestartStatusReconciliation,
  runtimeActionQueue,
  compiledRuntimeExportManifest,
  runtimeOperationalPacket,
  compiledClientLaunchGate,
  compiledMailchimpWorkflowManifest,
  compiledMailchimpReleaseReport,
) {
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const mailchimpJobs = jobs.filter((job) => job.handoff.mailchimp);
  const statusChannels = Object.freeze([...new Set(jobs
    .map((job) => job.status.channel ?? job.status.auditChannel)
    .filter(Boolean))].sort());
  const auditChannels = Object.freeze([...new Set(jobs
    .map((job) => job.status.auditChannel)
    .filter(Boolean))].sort());
  const routeId = stableContractId(
    "compiled-route-readiness",
    mailchimpJobs.length > 0 ? "mailchimp" : "runtime",
    jobs.length,
    statusChannels.join("|"),
    auditChannels.join("|"),
  );
  const stages = Object.freeze([
    Object.freeze({
      schema: "aios.grammar.route-readiness.stage.v1",
      label: "diagnostics",
      accepted: blockingDiagnostics.length === 0,
      status: blockingDiagnostics.length === 0 ? "clear" : "blocked",
      nextAction: blockingDiagnostics.length === 0 ? "continue" : "fix-blocking-diagnostics",
      references: Object.freeze({
        blocking: blockingDiagnostics.length,
        total: diagnostics.length,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.route-readiness.stage.v1",
      label: "client-runtime",
      accepted: clientRuntime.ready,
      status: clientRuntime.ready ? "ready" : "review",
      nextAction: clientRuntime.nextAction,
      references: Object.freeze({
        handoffCount: clientRuntime.handoffCount,
        blockedJobs: clientRuntime.blockedJobs,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.route-readiness.stage.v1",
      label: "mailchimp-client-launch",
      accepted: mailchimpClientLaunch.ready || mailchimpClientLaunch.status === "not-required",
      status: mailchimpClientLaunch.status,
      nextAction: mailchimpClientLaunch.nextAction,
      references: Object.freeze({
        launchId: mailchimpClientLaunch.launchId,
        missing: mailchimpClientLaunch.missing,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.route-readiness.stage.v1",
      label: "runtime-export",
      accepted: compiledRuntimeExportManifest.ready || compiledRuntimeExportManifest.status === "not-required",
      status: compiledRuntimeExportManifest.status,
      nextAction: compiledRuntimeExportManifest.nextAction,
      references: Object.freeze({
        exportId: compiledRuntimeExportManifest.exportId,
        blockedGates: compiledRuntimeExportManifest.blockedGates,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.route-readiness.stage.v1",
      label: "operational-packet",
      accepted: runtimeOperationalPacket.ready,
      status: runtimeOperationalPacket.status,
      nextAction: runtimeOperationalPacket.nextAction,
      references: Object.freeze({
        packetId: runtimeOperationalPacket.packetId,
        firstBlocked: runtimeOperationalPacket.exportSummary.firstBlocked,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.route-readiness.stage.v1",
      label: "client-launch-gate",
      accepted: compiledClientLaunchGate.ready || compiledClientLaunchGate.status === "not-required",
      status: compiledClientLaunchGate.status,
      nextAction: compiledClientLaunchGate.nextAction,
      references: Object.freeze({
        launchGateId: compiledClientLaunchGate.launchGateId,
        missing: compiledClientLaunchGate.validationSummary.missing,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.route-readiness.stage.v1",
      label: "workflow-manifest",
      accepted: compiledMailchimpWorkflowManifest.ready || compiledMailchimpWorkflowManifest.status === "not-required",
      status: compiledMailchimpWorkflowManifest.status,
      nextAction: compiledMailchimpWorkflowManifest.nextAction,
      references: Object.freeze({
        manifestId: compiledMailchimpWorkflowManifest.manifestId,
        missing: compiledMailchimpWorkflowManifest.validationSummary.missing,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.route-readiness.stage.v1",
      label: "release-report",
      accepted: compiledMailchimpReleaseReport.ready || compiledMailchimpReleaseReport.status === "not-required",
      status: compiledMailchimpReleaseReport.status,
      nextAction: compiledMailchimpReleaseReport.nextAction,
      references: Object.freeze({
        reportId: compiledMailchimpReleaseReport.reportId,
        missing: compiledMailchimpReleaseReport.validationSummary.missing,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.route-readiness.stage.v1",
      label: "external-status-receipts",
      accepted: runtimeExternalProviderStatusReceipts.ready,
      status: runtimeExternalProviderStatusReceipts.status,
      nextAction: runtimeExternalProviderStatusReceipts.nextAction,
      references: Object.freeze({
        receipts: runtimeExternalProviderStatusReceipts.receipts,
        blockedReceipts: runtimeExternalProviderStatusReceipts.blockedReceipts,
      }),
    }),
    Object.freeze({
      schema: "aios.grammar.route-readiness.stage.v1",
      label: "restart-status-reconciliation",
      accepted: runtimeRestartStatusReconciliation.accepted,
      status: runtimeRestartStatusReconciliation.status,
      nextAction: runtimeRestartStatusReconciliation.nextAction,
      references: Object.freeze({
        reconciliationId: runtimeRestartStatusReconciliation.reconciliationId,
        blockedJobs: runtimeRestartStatusReconciliation.blockedJobs,
      }),
    }),
  ]);
  const blocker = stages.find((stage) => !stage.accepted) ?? null;
  const missing = Object.freeze([...new Set([
    ...stages.filter((stage) => !stage.accepted).map((stage) => stage.label),
    ...Array.from(compiledClientLaunchGate.validationSummary.missing ?? []),
    ...Array.from(compiledMailchimpWorkflowManifest.validationSummary.missing ?? []),
    ...Array.from(compiledMailchimpReleaseReport.validationSummary.missing ?? []),
    ...Array.from(runtimeRestartStatusReconciliation.blockedJobs ?? []).map((entry) => entry.firstMissing ?? entry.status),
  ].filter(Boolean))].sort());
  const accepted = !blocker && missing.length === 0;

  return Object.freeze({
    schema: "aios.grammar.compiled-route-readiness.contract.v1",
    routeId,
    accepted,
    status: accepted ? "compiled-route-ready" : blocker?.status ?? "compiled-route-review",
    jobCount: jobs.length,
    mailchimpJobCount: mailchimpJobs.length,
    statusChannels,
    auditChannels,
    stages,
    validationSummary: Object.freeze({
      diagnosticsReady: blockingDiagnostics.length === 0,
      clientRuntimeReady: clientRuntime.ready,
      launchReady: mailchimpClientLaunch.ready || mailchimpClientLaunch.status === "not-required",
      exportReady: compiledRuntimeExportManifest.ready || compiledRuntimeExportManifest.status === "not-required",
      operationalReady: runtimeOperationalPacket.ready,
      clientGateReady: compiledClientLaunchGate.ready || compiledClientLaunchGate.status === "not-required",
      workflowReady: compiledMailchimpWorkflowManifest.ready || compiledMailchimpWorkflowManifest.status === "not-required",
      releaseReady: compiledMailchimpReleaseReport.ready || compiledMailchimpReleaseReport.status === "not-required",
      statusReceiptsReady: runtimeExternalProviderStatusReceipts.ready,
      restartStatusReady: runtimeRestartStatusReconciliation.accepted,
      blockedStage: blocker?.label ?? null,
      missing,
    }),
    controls: Object.freeze({
      canPreviewRoute: mailchimpJobs.length > 0 && blockingDiagnostics.length === 0,
      canAcceptRelease: compiledMailchimpReleaseReport.controls.canAcceptRelease,
      canLaunchClient: accepted && compiledClientLaunchGate.controls.canLaunchClient,
      canEmitStatus: statusChannels.length > 0,
      canExportAudit: auditChannels.length > 0,
      canReplay: runtimeOperationalPacket.recovery.restartReady && runtimeRestartStatusReconciliation.controls.canReplayMailchimp,
    }),
    actionQueue: runtimeActionQueue.exportSummary,
    nextStep: Object.freeze({
      label: accepted ? "compiled-route" : blocker?.label ?? "compiled-route",
      action: accepted ? "launch-compiled-client-route" : blocker?.nextAction ?? runtimeActionQueue.nextAction,
      requiresOperator: !accepted && ["release-report", "client-launch-gate", "mailchimp-client-launch"].includes(blocker?.label),
      retryable: !accepted && ["external-status-receipts", "restart-status-reconciliation", "operational-packet"].includes(blocker?.label),
    }),
    exportSummary: Object.freeze({
      routeId,
      status: accepted ? "compiled-route-ready" : "compiled-route-review",
      blockedStage: blocker?.label ?? null,
      missing,
      nextAction: accepted ? "launch-compiled-client-route" : blocker?.nextAction ?? runtimeActionQueue.nextAction,
    }),
    nextAction: accepted ? "launch-compiled-client-route" : blocker?.nextAction ?? runtimeActionQueue.nextAction,
  });
}

export function compileGrammarContracts(source, options = {}) {
  const program = parse(source, options);
  const jobs = Object.freeze(Array.from(program.body ?? []).map(createJobContract));
  const mailchimpDiagnostics = Object.freeze(jobs.flatMap(createMailchimpDiagnostics));
  const diagnostics = Object.freeze([...program.diagnostics, ...mailchimpDiagnostics]);
  const blocking = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const runtimeTenantBoundary = createRuntimeTenantBoundarySummary(jobs);
  const clientRuntime = createClientRuntimeSummary(jobs);
  const mailchimpRuntimeExport = createMailchimpRuntimeExport(jobs, diagnostics, clientRuntime);
  const mailchimpWorkflowHandoff = createMailchimpRuntimeWorkflowHandoff(jobs, diagnostics, clientRuntime, mailchimpRuntimeExport);
  const mailchimpClientLaunch = createMailchimpClientLaunchPacket(
    jobs,
    diagnostics,
    clientRuntime,
    mailchimpRuntimeExport,
    mailchimpWorkflowHandoff,
  );
  const restartRunbook = createRuntimeRestartRunbook(jobs, diagnostics, clientRuntime, mailchimpRuntimeExport);
  const runtimeResumptionManifest = createRuntimeResumptionManifestSummary(jobs);
  const runtimeExternalProviderStatusReceipts = createRuntimeExternalProviderStatusReceiptSummary(jobs);
  const runtimeRestartStatusReconciliation = createRuntimeRestartStatusReconciliation(
    jobs,
    diagnostics,
    runtimeResumptionManifest,
  );
  const runtimeActionQueue = createRuntimeActionQueue(
    jobs,
    diagnostics,
    clientRuntime,
    mailchimpRuntimeExport,
    mailchimpWorkflowHandoff,
    mailchimpClientLaunch,
    restartRunbook,
    runtimeResumptionManifest,
  );
  const compiledRuntimeExportManifest = createCompiledRuntimeExportManifest(
    jobs,
    diagnostics,
    clientRuntime,
    mailchimpRuntimeExport,
    runtimeResumptionManifest,
    runtimeActionQueue,
  );
  const runtimeOperationalPacket = createRuntimeOperationalPacket(
    jobs,
    diagnostics,
    clientRuntime,
    mailchimpRuntimeExport,
    mailchimpWorkflowHandoff,
    mailchimpClientLaunch,
    restartRunbook,
    runtimeResumptionManifest,
    runtimeActionQueue,
    compiledRuntimeExportManifest,
  );
  const compiledClientLaunchGate = createCompiledClientLaunchGate(
    jobs,
    diagnostics,
    clientRuntime,
    mailchimpClientLaunch,
    runtimeOperationalPacket,
    compiledRuntimeExportManifest,
  );
  const compiledMailchimpExportHistory = createCompiledMailchimpExportHistory(
    jobs,
    diagnostics,
    mailchimpRuntimeExport,
    mailchimpWorkflowHandoff,
    mailchimpClientLaunch,
    compiledRuntimeExportManifest,
    runtimeOperationalPacket,
  );
  const compiledMailchimpWorkflowManifest = createCompiledMailchimpWorkflowManifest(
    jobs,
    diagnostics,
    clientRuntime,
    mailchimpRuntimeExport,
    mailchimpWorkflowHandoff,
    mailchimpClientLaunch,
    compiledRuntimeExportManifest,
    runtimeOperationalPacket,
    compiledClientLaunchGate,
    compiledMailchimpExportHistory,
  );
  const compiledMailchimpReleaseReport = createCompiledMailchimpReleaseReport(
    jobs,
    diagnostics,
    clientRuntime,
    mailchimpRuntimeExport,
    mailchimpWorkflowHandoff,
    mailchimpClientLaunch,
    runtimeResumptionManifest,
    runtimeRestartStatusReconciliation,
    runtimeActionQueue,
    compiledRuntimeExportManifest,
    runtimeOperationalPacket,
    compiledClientLaunchGate,
    compiledMailchimpExportHistory,
    compiledMailchimpWorkflowManifest,
  );
  const compiledRouteReadiness = createCompiledRouteReadinessContract(
    jobs,
    diagnostics,
    clientRuntime,
    mailchimpClientLaunch,
    runtimeExternalProviderStatusReceipts,
    runtimeRestartStatusReconciliation,
    runtimeActionQueue,
    compiledRuntimeExportManifest,
    runtimeOperationalPacket,
    compiledClientLaunchGate,
    compiledMailchimpWorkflowManifest,
    compiledMailchimpReleaseReport,
  );

  return Object.freeze({
    schema: "aios.grammar.contract.bundle.v1",
    ok: blocking.length === 0 && jobs.every((job) => job.ready || job.handoff.status !== "declared"),
    status: blocking.length === 0
      ? jobs.every((job) => job.ready) ? "ready" : "review"
      : "blocked",
    jobs,
    runtimeTenantBoundary,
    clientRuntime,
    mailchimpRuntimeExport,
    mailchimpWorkflowHandoff,
    mailchimpClientLaunch,
    restartRunbook,
    runtimeResumptionManifest,
    runtimeExternalProviderStatusReceipts,
    runtimeRestartStatusReconciliation,
    runtimeActionQueue,
    compiledRuntimeExportManifest,
    runtimeOperationalPacket,
    compiledClientLaunchGate,
    compiledMailchimpExportHistory,
    compiledMailchimpWorkflowManifest,
    compiledMailchimpReleaseReport,
    compiledRouteReadiness,
    diagnostics,
    parser: Object.freeze({
      health: program.health,
      analytics: program.analytics,
      boundary: program.boundary,
    }),
    nextAction: blocking.length > 0
      ? "fix-blocking-diagnostics"
      : !runtimeTenantBoundary.ready
        ? runtimeTenantBoundary.nextAction
      : jobs.every((job) => job.ready)
        ? clientRuntime.ready
          ? mailchimpClientLaunch.ready || mailchimpClientLaunch.status === "not-required"
            ? compiledMailchimpExportHistory.ready || compiledMailchimpExportHistory.status === "not-required"
              ? compiledMailchimpWorkflowManifest.ready || compiledMailchimpWorkflowManifest.status === "not-required"
                ? compiledMailchimpReleaseReport.ready || compiledMailchimpReleaseReport.status === "not-required"
                  ? !runtimeExternalProviderStatusReceipts.ready
                    ? runtimeExternalProviderStatusReceipts.nextAction
                    : !runtimeRestartStatusReconciliation.accepted
                      ? runtimeRestartStatusReconciliation.nextAction
                      : compiledRouteReadiness.nextAction
                  : compiledMailchimpReleaseReport.nextAction
                : compiledMailchimpWorkflowManifest.nextAction
              : compiledMailchimpExportHistory.nextAction
            : mailchimpClientLaunch.nextAction
          : clientRuntime.nextAction
        : runtimeOperationalPacket.nextAction ?? runtimeActionQueue.nextAction ?? "review-contract-gaps",
  });
}

export function grammarCoreSelfCheck() {
  const source = `
    job syncAudience {
      workspace "local";
      tenant "demo";
      role "operator" permissions ["mailchimp.read", "mailchimp.write"];
      capability mailchimp scope read;
      memory sync.ledger as ledger;
      verify truth "mailchimp.adapter";
      handoff adapter mailchimp.syncAudience with { list: "primary" };
      status emits "mailchimp.status";
      idempotency key "audience-sync-primary";
      recover from "ledger";
    }
  `;
  const compiled = compileGrammarContracts(source, { workspace: "local", tenant: "demo", role: "operator" });

  return Object.freeze({
    ok: compiled.status === "ready" || compiled.status === "review",
    status: compiled.status,
    jobCount: compiled.jobs.length,
    clientRuntime: compiled.clientRuntime.nextAction,
    mailchimpLifecycleControl: compiled.jobs[0]?.mailchimpLifecycleControl?.status ?? "not-required",
    mailchimpRuntimeExport: compiled.mailchimpRuntimeExport.exportSummary.status,
    mailchimpWorkflowHandoff: compiled.mailchimpWorkflowHandoff.exportSummary.status,
    mailchimpClientLaunch: compiled.mailchimpClientLaunch.exportSummary.status,
    restartRunbook: compiled.restartRunbook.exportSummary.status,
    runtimeResumptionManifest: compiled.runtimeResumptionManifest.exportSummary.status,
    runtimeExternalProviderStatusReceipts: compiled.runtimeExternalProviderStatusReceipts.exportSummary.status,
    runtimeRestartStatusReconciliation: compiled.runtimeRestartStatusReconciliation.exportSummary.status,
    runtimeActionQueue: compiled.runtimeActionQueue.exportSummary.status,
    compiledRuntimeExportManifest: compiled.compiledRuntimeExportManifest.exportSummary.status,
    runtimeOperationalPacket: compiled.runtimeOperationalPacket.exportSummary.status,
    compiledClientLaunchGate: compiled.compiledClientLaunchGate.exportSummary.status,
    compiledMailchimpExportHistory: compiled.compiledMailchimpExportHistory.exportSummary.status,
    compiledMailchimpWorkflowManifest: compiled.compiledMailchimpWorkflowManifest.exportSummary.status,
    compiledMailchimpReleaseReport: compiled.compiledMailchimpReleaseReport.exportSummary.status,
    compiledRouteReadiness: compiled.compiledRouteReadiness.exportSummary.status,
    nextAction: compiled.nextAction,
  });
}
