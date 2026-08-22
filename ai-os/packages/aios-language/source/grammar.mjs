import { parse } from "./parser.mjs";
import { analyzePermissionBoundary } from "./tokens.mjs";

export const AIOS_GRAMMAR_VERSION = "2026.07.mailchimp-slice.v1";

export const AIOS_LANGUAGE_GRAMMAR = Object.freeze({
  program: "jobDeclaration* EOF",
  jobDeclaration: "job Identifier { jobClause* }",
  jobClause: [
    "workspace Literal ;",
    "tenant Literal ;",
    "role Literal (permissions ArrayExpression)? ;",
    "capability QualifiedName (scope Literal)? ;",
    "memory QualifiedName (as Identifier)? ;",
    "verify truth Literal (minConfidence Number)? ;",
    "handoff adapter QualifiedName (with ObjectExpression)? ;",
    "status emits Literal ;",
    "on error rollback Literal ;",
    "idempotency key Literal ;",
    "recover from Literal ;",
    "retry max Number backoff Literal ;",
    "degraded status Literal ;",
    "audit emits Literal ;",
  ],
});

export const MAILCHIMP_JOB_EXAMPLE = `job syncCampaignAudience {
  workspace "mailchimp-prod";
  tenant "tenant:acme";
  role marketing.ops permissions ["mailchimp.audience.write"];
  capability mailchimp.audience.write scope "audience:contacts";
  memory campaign.contacts as contacts;
  verify truth "crm_export" minConfidence 0.92;
  handoff adapter mailchimp.audience with { audienceId: "primary", mergeField: "EMAIL" };
  status emits "campaign-audience-sync";
  idempotency key "campaign-audience-sync:primary";
  recover from "audience-import-checkpoint";
  retry max 3 backoff "exponential";
  degraded status "manual-review";
  audit emits "mailchimp-audience-audit";
  on error rollback "audience-import";
}`;

function literalToValue(node) {
  if (!node) {
    return null;
  }

  if (node.type === "ObjectExpression") {
    return Object.fromEntries(node.entries.map((entry) => [entry.key, literalToValue(entry.value)]));
  }

  if (node.type === "ArrayExpression") {
    return node.entries.map((entry) => literalToValue(entry));
  }

  return node.value;
}

function clausesByType(job) {
  return job.clauses.reduce((grouped, clause) => {
    const existing = grouped.get(clause.type) ?? [];
    existing.push(clause);
    grouped.set(clause.type, existing);
    return grouped;
  }, new Map());
}

function firstClause(grouped, type) {
  return (grouped.get(type) ?? [])[0] ?? null;
}

function isMailchimpJob(grouped) {
  return (grouped.get("CapabilityClause") ?? []).some((clause) => String(clause.name ?? "").startsWith("mailchimp."))
    || (grouped.get("HandoffClause") ?? []).some((clause) => String(clause.adapter ?? "").startsWith("mailchimp."));
}

function clauseValues(grouped, type, property) {
  return (grouped.get(type) ?? [])
    .map((clause) => clause[property])
    .filter((value) => value !== null && value !== undefined && value !== "");
}

function validateScopedString(job, value, code, label, diagnostics) {
  if (typeof value !== "string" || value.trim() === "") {
    diagnostics.push({
      code,
      message: `Job '${job.name}' must declare a non-empty ${label}.`,
      severity: "error",
    });
    return;
  }

  if (value.includes("..") || value.startsWith("/")) {
    diagnostics.push({
      code: `${code}_BOUNDARY`,
      message: `Job '${job.name}' ${label} must stay inside the local AI OS namespace.`,
      severity: "error",
    });
  }
}

function diagnosticWithJob(job, diagnostic, codePrefix = "GRAMMAR") {
  const suffix = String(diagnostic.code ?? "PERMISSION").replace(/^PERMISSION_/, "");
  return Object.freeze({
    code: `${codePrefix}_${suffix}`,
    message: `Job '${job.name}' ${diagnostic.message}`,
    severity: diagnostic.severity,
  });
}

function stableSegment(value, fallback) {
  const normalized = String(value ?? fallback ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || String(fallback ?? "unknown");
}

function createStateIdentity(job, workspace, tenant, idempotencyKey) {
  return Object.freeze({
    schema: "aios.mailchimp.state.identity.v1",
    job: stableSegment(job.name, "job"),
    workspace: stableSegment(workspace, "workspace"),
    tenant: stableSegment(tenant, "tenant"),
    idempotencyKey: stableSegment(idempotencyKey, `${job.name}:missing-idempotency`),
    stateKey: [
      "local",
      "aios",
      "mailchimp",
      stableSegment(workspace, "workspace"),
      stableSegment(tenant, "tenant"),
      stableSegment(job.name, "job"),
      stableSegment(idempotencyKey, "idempotency"),
    ].join("/"),
  });
}

function createRestartStatusSemantics(statusChannels, degradedClause, retryClause) {
  const channels = statusChannels.length > 0
    ? statusChannels.map((entry) => entry.channel)
    : ["aios-runtime-status"];
  const lifecycle = ["queued", "running", "checkpointed", "verifying", "permissioned", "handed-off", "completed"];
  const failureStates = ["failed", "recovering", "rolled-back"];

  return Object.freeze({
    schema: "aios.restart.status.v1",
    channels: Object.freeze(channels),
    stableStates: Object.freeze([...lifecycle, ...failureStates, degradedClause ? "degraded" : null].filter(Boolean)),
    terminalStates: Object.freeze(["completed", "rolled-back", degradedClause ? "degraded" : null].filter(Boolean)),
    restartTransitions: Object.freeze({
      queued: "running",
      running: "recovering",
      checkpointed: "recovering",
      verifying: "recovering",
      permissioned: "recovering",
      "handed-off": retryClause?.maxAttempts > 0 ? "recovering" : "failed",
      failed: degradedClause ? "degraded" : "rolled-back",
    }),
    degradedStatus: degradedClause?.status ?? null,
    idempotentEmits: true,
  });
}

function createPersistedStateContract(job, grouped, context) {
  const identity = createStateIdentity(job, context.workspace, context.tenant, context.idempotencyKey);
  const recover = firstClause(grouped, "RecoverClause")?.checkpoint ?? null;
  const rollbackTargets = (grouped.get("RollbackClause") ?? []).map((clause) => clause.target);
  const truthBoundaries = (grouped.get("VerifyClause") ?? []).map((clause) => clause.boundary);
  const auditChannels = (grouped.get("AuditClause") ?? []).map((clause) => clause.channel);
  const memoryAliases = (grouped.get("MemoryClause") ?? []).map((clause) => clause.alias ?? clause.name);

  return Object.freeze({
    schema: "aios.mailchimp.persisted-state.v1",
    identity,
    localOnly: true,
    externalWrites: false,
    checkpoint: recover,
    restartSafe: Boolean(context.idempotencyKey && recover),
    fields: Object.freeze({
      phase: "string",
      attempts: "integer",
      lastStatus: "string",
      lastTruthBoundary: "string|null",
      adapterReceipt: "object|null",
      rollbackReceipt: "object|null",
    }),
    indexes: Object.freeze({
      idempotency: identity.idempotencyKey,
      tenant: identity.tenant,
      workspace: identity.workspace,
    }),
    restorePlan: Object.freeze({
      readBeforeHandoff: true,
      resumeFromCheckpoint: recover,
      verifyBeforeReplay: truthBoundaries,
      rollbackTargets: Object.freeze(rollbackTargets),
      memoryAliases: Object.freeze(memoryAliases),
    }),
    audit: Object.freeze({
      channels: Object.freeze(auditChannels),
      records: Object.freeze(["state.restore", "state.checkpoint", "adapter.handoff", "rollback.result"]),
    }),
  });
}

function createRuntimeCommandPlan(descriptor, statusSemantics) {
  const adapter = descriptor.runtime.handoff[0]?.adapter ?? null;
  const state = descriptor.runtime.persistedState;
  const idempotencyKey = descriptor.requestContext.idempotencyKey;

  return Object.freeze([
    Object.freeze({
      command: "state.restore",
      idempotencyKey: `${idempotencyKey}:restore`,
      localStateKey: state.identity.stateKey,
      statusOnSuccess: state.checkpoint ? "checkpointed" : "queued",
      statusOnFailure: "failed",
      externalWrites: false,
    }),
    Object.freeze({
      command: "truth.verify",
      idempotencyKey: `${idempotencyKey}:verify`,
      truthBoundaries: Object.freeze(descriptor.contracts.truthBoundaries),
      statusOnSuccess: "verifying",
      statusOnFailure: statusSemantics.restartTransitions.failed,
      externalWrites: false,
    }),
    Object.freeze({
      command: "permission.assert",
      idempotencyKey: `${idempotencyKey}:permission`,
      boundary: descriptor.contracts.permissionBoundary?.boundaryId ?? null,
      required: Object.freeze(descriptor.contracts.permissionBoundary?.required ?? []),
      granted: Object.freeze(descriptor.contracts.permissionBoundary?.granted ?? []),
      statusOnSuccess: "permissioned",
      statusOnFailure: "failed",
      externalWrites: false,
    }),
    Object.freeze({
      command: "adapter.handoff",
      idempotencyKey: `${idempotencyKey}:handoff`,
      adapter,
      capabilities: Object.freeze(descriptor.capabilities.map((capability) => capability.name)),
      statusOnSuccess: "handed-off",
      statusOnFailure: descriptor.runtime.retryPolicy.maxAttempts > 0 ? "recovering" : "failed",
      externalWrites: true,
    }),
    Object.freeze({
      command: "state.checkpoint",
      idempotencyKey: `${idempotencyKey}:checkpoint`,
      localStateKey: state.identity.stateKey,
      statusOnSuccess: "completed",
      statusOnFailure: "recovering",
      externalWrites: false,
    }),
  ]);
}

function createMailchimpPermissionBoundary(job, grouped, context, capabilities) {
  const required = capabilities
    .map((capability) => capability.name)
    .filter((name) => String(name ?? "").startsWith("mailchimp."));
  const declared = Array.from(context.permissions ?? []);
  const analysis = analyzePermissionBoundary(required, declared, {
    expectedPrefix: "mailchimp",
    position: job.location ?? { line: 1, column: 1, offset: 0 },
  });
  const workspace = stableSegment(context.workspace, "workspace");
  const tenant = stableSegment(context.tenant, "tenant");
  const role = stableSegment(context.role, "role");
  const boundaryId = ["mailchimp", workspace, tenant, role].join(":");
  const auditChannels = (grouped.get("AuditClause") ?? []).map((clause) => clause.channel);

  return Object.freeze({
    schema: "aios.mailchimp.permission-boundary.v1",
    boundaryId,
    workspace: context.workspace,
    tenant: context.tenant,
    role: context.role,
    expectedPrefix: analysis.expectedPrefix,
    status: analysis.status,
    ok: analysis.ok,
    leastPrivilege: analysis.leastPrivilege,
    required: analysis.required,
    declared: analysis.declared,
    granted: analysis.granted,
    missing: analysis.missing,
    unused: analysis.unused,
    retryable: analysis.retryable,
    degradedModeAllowed: analysis.degradedModeAllowed,
    nextAction: analysis.nextAction,
    diagnostics: analysis.diagnostics,
    auditHandoff: Object.freeze({
      schema: "aios.mailchimp.permission-audit-handoff.v1",
      channel: auditChannels[0] ?? null,
      requiredRecordFields: Object.freeze([
        "job",
        "workspace",
        "tenant",
        "role",
        "required",
        "granted",
        "missing",
        "unused",
        "decision",
      ]),
      decision: analysis.ok ? "allow-handoff" : "block-handoff",
      localOnly: true,
      externalWrites: false,
    }),
  });
}

function validateJob(job) {
  const grouped = clausesByType(job);
  const diagnostics = [];
  const mailchimpJob = isMailchimpJob(grouped);

  if (!job.name) {
    diagnostics.push({ code: "GRAMMAR_JOB_NAME_REQUIRED", message: "Job declarations require a name.", severity: "error" });
  }

  if (!grouped.has("CapabilityClause")) {
    diagnostics.push({ code: "GRAMMAR_CAPABILITY_REQUIRED", message: `Job '${job.name}' must declare at least one capability.`, severity: "error" });
  }

  if (!grouped.has("HandoffClause")) {
    diagnostics.push({ code: "GRAMMAR_HANDOFF_REQUIRED", message: `Job '${job.name}' must declare a runtime adapter handoff.`, severity: "error" });
  }

  if (!grouped.has("VerifyClause")) {
    diagnostics.push({ code: "GRAMMAR_TRUTH_REQUIRED", message: `Job '${job.name}' must declare a truth boundary verifier.`, severity: "error" });
  }

  if (mailchimpJob && !grouped.has("WorkspaceClause")) {
    diagnostics.push({ code: "GRAMMAR_WORKSPACE_REQUIRED", message: `Mailchimp job '${job.name}' must declare a workspace boundary.`, severity: "error" });
  }

  if (mailchimpJob && !grouped.has("TenantClause")) {
    diagnostics.push({ code: "GRAMMAR_TENANT_REQUIRED", message: `Mailchimp job '${job.name}' must declare a tenant boundary.`, severity: "error" });
  }

  if (mailchimpJob && !grouped.has("RoleClause")) {
    diagnostics.push({ code: "GRAMMAR_ROLE_REQUIRED", message: `Mailchimp job '${job.name}' must declare a role and permissions.`, severity: "error" });
  }

  if (mailchimpJob && !grouped.has("IdempotencyClause")) {
    diagnostics.push({ code: "GRAMMAR_IDEMPOTENCY_REQUIRED", message: `Mailchimp job '${job.name}' must declare an idempotency key for restart-safe handoff.`, severity: "error" });
  }

  if (mailchimpJob && !grouped.has("AuditClause")) {
    diagnostics.push({ code: "GRAMMAR_AUDIT_REQUIRED", message: `Mailchimp job '${job.name}' must declare an audit channel.`, severity: "error" });
  }

  for (const workspace of clauseValues(grouped, "WorkspaceClause", "workspace")) {
    validateScopedString(job, workspace, "GRAMMAR_WORKSPACE_INVALID", "workspace", diagnostics);
  }

  for (const tenant of clauseValues(grouped, "TenantClause", "tenant")) {
    validateScopedString(job, tenant, "GRAMMAR_TENANT_INVALID", "tenant", diagnostics);
  }

  for (const clause of grouped.get("VerifyClause") ?? []) {
    if (typeof clause.minConfidence === "number" && (clause.minConfidence < 0 || clause.minConfidence > 1)) {
      diagnostics.push({
        code: "GRAMMAR_CONFIDENCE_RANGE",
        message: `Job '${job.name}' verifier confidence must be between 0 and 1.`,
        severity: "error",
      });
    }
  }

  for (const clause of grouped.get("RoleClause") ?? []) {
    const permissions = literalToValue(clause.permissions);
    const missingCapabilities = (grouped.get("CapabilityClause") ?? [])
      .map((capability) => capability.name)
      .filter((capability) => !permissions.includes(capability));

    if (permissions.length === 0) {
      diagnostics.push({
        code: "GRAMMAR_PERMISSION_REQUIRED",
        message: `Job '${job.name}' role must declare at least one permission.`,
        severity: "error",
      });
    }

    for (const capability of missingCapabilities) {
      diagnostics.push({
        code: "GRAMMAR_PERMISSION_MISSING_CAPABILITY",
        message: `Job '${job.name}' role permissions must include capability '${capability}'.`,
        severity: "error",
      });
    }

    if (mailchimpJob) {
      const permissionBoundary = analyzePermissionBoundary(
        (grouped.get("CapabilityClause") ?? []).map((capability) => capability.name),
        permissions,
        {
          expectedPrefix: "mailchimp",
          position: job.location ?? { line: 1, column: 1, offset: 0 },
        },
      );
      diagnostics.push(...permissionBoundary.diagnostics.map((diagnostic) => diagnosticWithJob(job, diagnostic)));
    }
  }

  for (const clause of grouped.get("RetryClause") ?? []) {
    if (!Number.isInteger(clause.maxAttempts) || clause.maxAttempts < 0 || clause.maxAttempts > 10) {
      diagnostics.push({
        code: "GRAMMAR_RETRY_RANGE",
        message: `Job '${job.name}' retry max must be an integer between 0 and 10.`,
        severity: "error",
      });
    }

    if (!["none", "linear", "exponential"].includes(clause.backoff)) {
      diagnostics.push({
        code: "GRAMMAR_RETRY_BACKOFF",
        message: `Job '${job.name}' retry backoff must be 'none', 'linear', or 'exponential'.`,
        severity: "error",
      });
    }
  }

  if (grouped.has("RecoverClause") && !grouped.has("RollbackClause")) {
    diagnostics.push({
      code: "GRAMMAR_RECOVER_WITHOUT_ROLLBACK",
      message: `Job '${job.name}' recovery checkpoint should pair with rollback semantics.`,
      severity: "warning",
    });
  }

  return diagnostics;
}

function compileJob(job) {
  const grouped = clausesByType(job);
  const capabilities = (grouped.get("CapabilityClause") ?? []).map((clause) => ({
    name: clause.name,
    scope: clause.scope,
  }));
  const memory = (grouped.get("MemoryClause") ?? []).map((clause) => ({
    source: clause.name,
    alias: clause.alias,
    access: "read",
  }));
  const verifier = (grouped.get("VerifyClause") ?? []).map((clause) => ({
    truthBoundary: clause.boundary,
    minConfidence: clause.minConfidence ?? 1,
    reportMode: "truth-boundary",
  }));
  const handoff = (grouped.get("HandoffClause") ?? []).map((clause) => ({
    adapter: clause.adapter,
    parameters: literalToValue(clause.parameters),
  }));
  const workspace = firstClause(grouped, "WorkspaceClause")?.workspace ?? null;
  const tenant = firstClause(grouped, "TenantClause")?.tenant ?? null;
  const roleClause = firstClause(grouped, "RoleClause");
  const idempotency = firstClause(grouped, "IdempotencyClause")?.key ?? null;
  const recover = firstClause(grouped, "RecoverClause")?.checkpoint ?? null;
  const retryClause = firstClause(grouped, "RetryClause");
  const degradedClause = firstClause(grouped, "DegradedClause");
  const audit = (grouped.get("AuditClause") ?? []).map((clause) => ({
    channel: clause.channel,
    mode: "append-only",
    includes: ["job", "workspace", "tenant", "idempotencyKey", "truthBoundary"],
  }));
  const status = (grouped.get("StatusClause") ?? []).map((clause) => ({
    channel: clause.channel,
    lifecycle: ["queued", "running", "verified", "permissioned", "handed-off", "completed", "failed", "recovering", "degraded"],
  }));
  const rollback = (grouped.get("RollbackClause") ?? []).map((clause) => ({
    on: "error",
    target: clause.target,
    semantics: "compensating-action",
  }));
  const context = {
    workspace,
    tenant,
    role: roleClause?.role ?? null,
    permissions: roleClause ? literalToValue(roleClause.permissions) : [],
    idempotencyKey: idempotency,
  };
  const retryPolicy = {
    maxAttempts: retryClause?.maxAttempts ?? 0,
    backoff: retryClause?.backoff ?? "none",
  };
  const statusSemantics = createRestartStatusSemantics(status, degradedClause, retryPolicy);
  const persistedState = createPersistedStateContract(job, grouped, context);
  const permissionBoundary = createMailchimpPermissionBoundary(job, grouped, context, capabilities);

  const descriptor = {
    kind: "kernel.jobDescriptor",
    apiVersion: AIOS_GRAMMAR_VERSION,
    name: job.name,
    requestContext: context,
    capabilities,
    memory,
    verifier,
    runtime: {
      handoff,
      status,
      rollback,
      audit,
      retryPolicy,
      recovery: {
        checkpoint: recover,
        restartSafe: Boolean(idempotency && recover),
        rollbackTargets: rollback.map((entry) => entry.target),
      },
      degradedMode: {
        enabled: Boolean(degradedClause),
        status: degradedClause?.status ?? null,
      },
      statusSemantics,
      persistedState,
      permissionBoundary,
    },
    contracts: {
      localOnly: true,
      externalWriteBoundary: handoff.map((entry) => entry.adapter),
      truthBoundaries: verifier.map((entry) => entry.truthBoundary),
      tenantIsolation: {
        workspace,
        tenant,
        enforced: Boolean(workspace && tenant),
      },
      permissionBoundary,
      idempotentHandoff: Boolean(idempotency),
      auditChannels: audit.map((entry) => entry.channel),
    },
    sourceLocation: job.location,
  };

  return {
    ...descriptor,
    runtime: {
      ...descriptor.runtime,
      commands: createRuntimeCommandPlan(descriptor, statusSemantics),
    },
  };
}

export function parseAiosSource(source, options = {}) {
  return parse(source, options);
}

export function validateAiosProgram(program) {
  const diagnostics = [...(program?.diagnostics ?? [])];

  for (const job of program?.body ?? []) {
    diagnostics.push(...validateJob(job));
  }

  return Object.freeze({
    ok: diagnostics.filter((diagnostic) => diagnostic.severity !== "warning").length === 0,
    diagnostics: Object.freeze(diagnostics),
  });
}

export function compileAiosProgram(program) {
  const validation = validateAiosProgram(program);
  const descriptors = validation.ok ? program.body.map(compileJob) : [];

  return Object.freeze({
    ok: validation.ok,
    diagnostics: validation.diagnostics,
    descriptors: Object.freeze(descriptors),
    analytics: program?.analytics ?? null,
  });
}

export function compileAiosSource(source, options = {}) {
  return compileAiosProgram(parseAiosSource(source, options));
}

export function describeTruthBoundaries(source, options = {}) {
  const compiled = compileAiosSource(source, options);
  return Object.freeze({
    ok: compiled.ok,
    diagnostics: compiled.diagnostics,
    reports: Object.freeze(compiled.descriptors.map((descriptor) => ({
      job: descriptor.name,
      truthBoundaries: descriptor.contracts.truthBoundaries,
      verifier: descriptor.verifier,
      externalWriteBoundary: descriptor.contracts.externalWriteBoundary,
    }))),
  });
}

export function planMailchimpRuntimeHandoff(source, options = {}) {
  const compiled = compileAiosSource(source, options);
  return Object.freeze({
    ok: compiled.ok,
    diagnostics: compiled.diagnostics,
    handoffs: Object.freeze(compiled.descriptors.map((descriptor) => Object.freeze({
      job: descriptor.name,
      adapter: descriptor.runtime.handoff[0]?.adapter ?? null,
      workspace: descriptor.requestContext.workspace,
      tenant: descriptor.requestContext.tenant,
      idempotencyKey: descriptor.requestContext.idempotencyKey,
      permissions: Object.freeze(descriptor.requestContext.permissions),
      retryPolicy: Object.freeze(descriptor.runtime.retryPolicy),
      recovery: Object.freeze(descriptor.runtime.recovery),
      persistedState: descriptor.runtime.persistedState,
      permissionBoundary: descriptor.runtime.permissionBoundary,
      statusSemantics: descriptor.runtime.statusSemantics,
      commands: descriptor.runtime.commands,
      degradedMode: Object.freeze(descriptor.runtime.degradedMode),
      auditChannels: Object.freeze(descriptor.contracts.auditChannels),
      userVisibleStatusChannels: Object.freeze(descriptor.runtime.status.map((entry) => entry.channel)),
    }))),
  });
}

export function describeMailchimpTenantPermissionBoundaries(source, options = {}) {
  const compiled = compileAiosSource(source, options);
  return Object.freeze({
    ok: compiled.ok,
    diagnostics: compiled.diagnostics,
    boundaries: Object.freeze(compiled.descriptors.map((descriptor) => Object.freeze({
      job: descriptor.name,
      workspace: descriptor.requestContext.workspace,
      tenant: descriptor.requestContext.tenant,
      role: descriptor.requestContext.role,
      boundaryId: descriptor.runtime.permissionBoundary.boundaryId,
      status: descriptor.runtime.permissionBoundary.status,
      required: descriptor.runtime.permissionBoundary.required,
      granted: descriptor.runtime.permissionBoundary.granted,
      missing: descriptor.runtime.permissionBoundary.missing,
      unused: descriptor.runtime.permissionBoundary.unused,
      leastPrivilege: descriptor.runtime.permissionBoundary.leastPrivilege,
      nextAction: descriptor.runtime.permissionBoundary.nextAction,
      auditHandoff: descriptor.runtime.permissionBoundary.auditHandoff,
    }))),
  });
}

export function planMailchimpRecoveryState(source, options = {}) {
  const compiled = compileAiosSource(source, options);
  return Object.freeze({
    ok: compiled.ok,
    diagnostics: compiled.diagnostics,
    analytics: compiled.analytics,
    recoveryStates: Object.freeze(compiled.descriptors.map((descriptor) => Object.freeze({
      job: descriptor.name,
      workspace: descriptor.requestContext.workspace,
      tenant: descriptor.requestContext.tenant,
      stateKey: descriptor.runtime.persistedState.identity.stateKey,
      restartSafe: descriptor.runtime.persistedState.restartSafe,
      checkpoint: descriptor.runtime.persistedState.checkpoint,
      restorePlan: descriptor.runtime.persistedState.restorePlan,
      statusSemantics: descriptor.runtime.statusSemantics,
      commands: descriptor.runtime.commands.map((command) => Object.freeze({
        command: command.command,
        idempotencyKey: command.idempotencyKey,
        statusOnSuccess: command.statusOnSuccess,
        statusOnFailure: command.statusOnFailure,
        externalWrites: command.externalWrites,
      })),
    }))),
  });
}
