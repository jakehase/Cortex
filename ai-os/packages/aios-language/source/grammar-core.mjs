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
  const externalProviderService = createExternalProviderServiceContract(
    job,
    handoff,
    recovery,
    status,
    tenantPermissionBoundary,
    persistedState,
  );
  const restartStatus = createRestartStatusHandoff(job, persistedState);

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
    restartStatus,
    claim,
    clientRuntime,
    ready: claim.accepted
      && handoff.status === "declared"
      && persistedState.restartSafe
      && tenantPermissionBoundary.allowed
      && (!handoff.mailchimp || externalProviderService.accepted),
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
    ready: blocked.length === 0 && boundaryBlocked.length === 0,
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
    nextAction: blocked.length === 0
      ? boundaryBlocked.length > 0
        ? boundaryBlocked[0].tenantPermissionBoundary.nextAction
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
    && clientRuntime.ready;
  const missing = Object.freeze([
    disabled ? "mailchimp-job" : null,
    blockingDiagnostics.length > 0 ? "blocking-diagnostics" : null,
    permissionBlocked.length > 0 ? "mailchimp-permissions" : null,
    boundaryBlocked.length > 0 ? "tenant-boundary" : null,
    restartBlocked.length > 0 ? "restart-safe-state" : null,
    statusBlocked.length > 0 ? "status-channel" : null,
    !clientRuntime.ready ? "client-runtime-readiness" : null,
  ].filter(Boolean));
  const firstBlockedJob = permissionBlocked[0] ?? boundaryBlocked[0] ?? restartBlocked[0] ?? statusBlocked[0] ?? null;

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
                : "client-runtime-review",
    controls: Object.freeze({
      canEnable: disabled,
      canDisable: !disabled,
      canAccept: !disabled && blockingDiagnostics.length === 0 && permissionBlocked.length === 0 && boundaryBlocked.length === 0,
      canSchedule: ready && mutatingWithoutIdempotency.length === 0,
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
    const acceptanceReady = job.ready && boundaryReady && restartReady && statusReady && providerReady;
    const missing = Object.freeze([
      boundaryReady ? null : "tenant-boundary",
      job.tenantPermissionBoundary.missingPermissions.length > 0 ? "mailchimp-permissions" : null,
      restartReady ? null : "restart-safe-state",
      statusReady ? null : "status-channel",
      job.tenantPermissionBoundary.audit.status === "audit-ready" || !job.tenantPermissionBoundary.audit.required ? null : "audit-channel",
      providerReady ? null : "provider-service",
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
                    : service.handoffState.status,
      missing,
      validationSummary: Object.freeze({
        boundaryReady,
        permissionsReady: job.tenantPermissionBoundary.missingPermissions.length === 0,
        restartReady,
        statusReady,
        auditReady: job.tenantPermissionBoundary.audit.status === "audit-ready" || !job.tenantPermissionBoundary.audit.required,
        providerReady,
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

function createMailchimpRuntimeExport(jobs, diagnostics, clientRuntime) {
  const mailchimpJobs = Object.freeze(jobs.filter((job) => job.handoff.mailchimp));
  const mutatingJobs = mailchimpJobs.filter((job) => job.handoff.mutatesProvider);
  const blockedJobs = mailchimpJobs.filter((job) => !job.ready || !job.tenantPermissionBoundary.allowed);
  const timeline = createRuntimeExportTimeline(jobs, diagnostics, clientRuntime);
  const publishControls = createMailchimpPublishControls(mailchimpJobs, diagnostics, clientRuntime);
  const previewAcceptance = createMailchimpPreviewAcceptanceReport(mailchimpJobs, diagnostics, clientRuntime, publishControls);
  const clientAdoption = createMailchimpClientAdoptionPlan(mailchimpJobs, diagnostics, clientRuntime, previewAcceptance);
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
  const ready = blockedJobs.length === 0 && diagnostics.every((diagnostic) => diagnostic.severity === "warning");

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
      controls: publishControls.controls,
      nextAction: mailchimpJobs.length === 0
        ? "continue"
        : ready && publishControls.ready && previewAcceptance.ready && clientAdoption.ready
          ? "publish-mailchimp-runtime-export"
          : clientAdoption.nextAction ?? previewAcceptance.nextAction ?? publishControls.nextAction ?? permissionGaps[0]?.nextAction ?? restartGaps[0]?.nextAction ?? clientRuntime.nextAction,
    }),
    nextAction: mailchimpJobs.length === 0
      ? "continue"
      : ready && publishControls.ready && previewAcceptance.ready && clientAdoption.ready
        ? "publish-mailchimp-runtime-export"
        : clientAdoption.nextAction ?? previewAcceptance.nextAction ?? publishControls.nextAction ?? permissionGaps[0]?.nextAction ?? restartGaps[0]?.nextAction ?? clientRuntime.nextAction,
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
    && mailchimpRuntimeExport.clientAdoption.ready;

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

function createMailchimpDiagnostics(contract) {
  if (!contract.handoff.mailchimp) {
    return Object.freeze([]);
  }

  const diagnostics = [];
  const hasStatus = contract.status.observable;
  const hasRecovery = contract.recovery.restartSafe;
  const granted = new Set(contract.capabilities.flatMap((capability) => capability.permissionBoundary.granted));

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

export function compileGrammarContracts(source, options = {}) {
  const program = parse(source, options);
  const jobs = Object.freeze(Array.from(program.body ?? []).map(createJobContract));
  const mailchimpDiagnostics = Object.freeze(jobs.flatMap(createMailchimpDiagnostics));
  const diagnostics = Object.freeze([...program.diagnostics, ...mailchimpDiagnostics]);
  const blocking = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const clientRuntime = createClientRuntimeSummary(jobs);
  const mailchimpRuntimeExport = createMailchimpRuntimeExport(jobs, diagnostics, clientRuntime);
  const mailchimpWorkflowHandoff = createMailchimpRuntimeWorkflowHandoff(jobs, diagnostics, clientRuntime, mailchimpRuntimeExport);
  const restartRunbook = createRuntimeRestartRunbook(jobs, diagnostics, clientRuntime, mailchimpRuntimeExport);

  return Object.freeze({
    schema: "aios.grammar.contract.bundle.v1",
    ok: blocking.length === 0 && jobs.every((job) => job.ready || job.handoff.status !== "declared"),
    status: blocking.length === 0
      ? jobs.every((job) => job.ready) ? "ready" : "review"
      : "blocked",
    jobs,
    clientRuntime,
    mailchimpRuntimeExport,
    mailchimpWorkflowHandoff,
    restartRunbook,
    diagnostics,
    parser: Object.freeze({
      health: program.health,
      analytics: program.analytics,
      boundary: program.boundary,
    }),
    nextAction: blocking.length > 0
      ? "fix-blocking-diagnostics"
      : jobs.every((job) => job.ready)
      ? clientRuntime.ready ? "handoff-client-runtime" : clientRuntime.nextAction
      : "review-contract-gaps",
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
    mailchimpRuntimeExport: compiled.mailchimpRuntimeExport.exportSummary.status,
    mailchimpWorkflowHandoff: compiled.mailchimpWorkflowHandoff.exportSummary.status,
    restartRunbook: compiled.restartRunbook.exportSummary.status,
    nextAction: compiled.nextAction,
  });
}
