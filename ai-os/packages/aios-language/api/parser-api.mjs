import { parse, parseHealth, summarizeParse } from "../source/parser.mjs";
import { createDiagnosticEnvelope } from "./diagnostics-api.mjs";

function text(value, fallback = "") {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function freezeArray(values = []) {
  return Object.freeze(Array.isArray(values) ? values.map((value) => Object.freeze(value)) : []);
}

function clauseValue(clause, keys = []) {
  for (const key of keys) {
    if (clause?.[key] != null && clause[key] !== "") return clause[key];
  }
  return null;
}

function objectFromEntries(entries = []) {
  const object = {};
  for (const entry of entries) {
    if (!entry?.key) continue;
    object[entry.key] = literalValue(entry.value);
  }
  return Object.freeze(object);
}

function literalValue(node) {
  if (!node || typeof node !== "object") return node;
  if (node.type === "ArrayExpression") return Object.freeze((node.entries ?? []).map(literalValue));
  if (node.type === "ObjectExpression") return objectFromEntries(node.entries);
  return node.value;
}

function normalizeJobClauses(job = {}) {
  const clauses = job.clauses ?? [];
  const capabilities = [];
  const memory = [];
  const handoffs = [];
  const statuses = [];
  const recoveries = [];
  const retries = [];
  const audits = [];
  const verifiers = [];

  for (const clause of clauses) {
    if (clause.type === "CapabilityClause") {
      capabilities.push(Object.freeze({ name: clause.name, scope: clause.scope ?? "use" }));
    } else if (clause.type === "MemoryClause") {
      memory.push(Object.freeze({ name: clause.name, alias: clause.alias ?? clause.name }));
    } else if (clause.type === "HandoffClause") {
      handoffs.push(Object.freeze({ adapter: clause.adapter, parameters: literalValue(clause.parameters) ?? Object.freeze({}) }));
    } else if (clause.type === "StatusClause" || clause.type === "DegradedClause") {
      statuses.push(Object.freeze({ type: clause.type, channel: clause.channel ?? clause.status }));
    } else if (clause.type === "RecoverClause" || clause.type === "RollbackClause") {
      recoveries.push(Object.freeze({ type: clause.type, checkpoint: clause.checkpoint ?? clause.target }));
    } else if (clause.type === "RetryClause") {
      retries.push(Object.freeze({ maxAttempts: Number(clause.maxAttempts) || 0, backoff: text(clause.backoff, "none") }));
    } else if (clause.type === "AuditClause") {
      audits.push(Object.freeze({ channel: clause.channel }));
    } else if (clause.type === "VerifyClause") {
      verifiers.push(Object.freeze({ boundary: clause.boundary, minConfidence: clause.minConfidence }));
    }
  }

  return Object.freeze({
    job: text(job.name, "anonymous"),
    capabilities: freezeArray(capabilities),
    memory: freezeArray(memory),
    handoffs: freezeArray(handoffs),
    statuses: freezeArray(statuses),
    recovery: Object.freeze({
      checkpoints: freezeArray(recoveries),
      retries: freezeArray(retries),
      restartSafe: recoveries.length > 0 || handoffs.length === 0,
    }),
    audit: freezeArray(audits),
    verifier: freezeArray(verifiers),
    clauseCount: clauses.length,
    location: job.location ?? null,
  });
}

function normalizeParserBoundaryScope(options = {}) {
  const tenantId = text(options.tenantId ?? options.tenant ?? options.orgId, "default-tenant");
  const workspaceId = text(options.workspaceId ?? options.workspace ?? options.projectId, "default-workspace");
  const role = text(options.role ?? options.actorRole, "operator");
  const requestedScopes = new Set([
    ...((Array.isArray(options.scopes) ? options.scopes : String(options.scopes ?? "").split(",")) ?? [])
      .map((scope) => text(scope))
      .filter(Boolean),
  ]);
  const roleScopes = {
    viewer: ["parse:read", "audit:read"],
    operator: ["parse:read", "parse:preview", "audit:read", "handoff:prepare"],
    maintainer: ["parse:read", "parse:preview", "audit:read", "handoff:prepare", "handoff:resume", "capability:negotiate"],
  };
  const allowed = roleScopes[role] ?? roleScopes.operator;

  return Object.freeze({
    tenantId,
    workspaceId,
    role,
    requestedScopes: Object.freeze([...requestedScopes].sort()),
    allowedScopes: Object.freeze([...new Set(allowed)].sort()),
    missingScopes: Object.freeze([...requestedScopes].filter((scope) => !allowed.includes(scope)).sort()),
    auditChannel: text(options.auditChannel, `${tenantId}:${workspaceId}:parser`),
  });
}

function buildMailchimpStatusEnvelope(job, handoff, boundaryScope, providerContract) {
  const params = handoff.parameters ?? {};
  const operation = String(handoff.adapter ?? "").split(".").at(1) || "sync";
  const cursor = text(params.cursor ?? providerContract?.syncMetadata?.cursor, "none");
  const audience = text(params.audience ?? params.list ?? providerContract?.syncMetadata?.audience, "unscoped-audience");
  const restartSafe = Boolean(job.recovery.restartSafe && cursor !== "none");
  const idempotencyKey = [
    boundaryScope.tenantId,
    boundaryScope.workspaceId,
    job.job,
    handoff.adapter,
    audience,
    cursor,
  ].map((part) => String(part).replace(/\s+/g, "-")).join(":");

  return Object.freeze({
    provider: "mailchimp",
    operation,
    adapter: handoff.adapter,
    tenantId: boundaryScope.tenantId,
    workspaceId: boundaryScope.workspaceId,
    job: job.job,
    audience,
    cursor,
    restartSafe,
    status: restartSafe ? "ready-to-resume" : "needs-checkpoint",
    command: restartSafe ? "resume-mailchimp-handoff" : "collect-mailchimp-checkpoint",
    idempotencyKey,
    audit: Object.freeze({
      channel: boundaryScope.auditChannel,
      role: boundaryScope.role,
      allowed: boundaryScope.missingScopes.length === 0,
      missingScopes: boundaryScope.missingScopes,
    }),
  });
}

function createClientWorkflowState(jobs = [], diagnostics, options = {}) {
  const boundaryScope = normalizeParserBoundaryScope(options);
  const mailchimpJobs = jobs.filter((job) => job.handoffs.some((handoff) => String(handoff.adapter ?? "").startsWith("mailchimp.")));
  const requiredState = new Set();
  const operations = new Set();
  const pendingRecovery = [];
  const statusEnvelopes = [];
  const providerContract = diagnostics.providerContracts?.mailchimp ?? null;

  for (const job of mailchimpJobs) {
    for (const handoff of job.handoffs) {
      if (!String(handoff.adapter ?? "").startsWith("mailchimp.")) continue;
      operations.add(handoff.adapter);
      const params = handoff.parameters ?? {};
      if (params.list || params.audience || params.segment) requiredState.add("audience-selection");
      if (params.cursor || params.since) requiredState.add("sync-cursor");
      statusEnvelopes.push(buildMailchimpStatusEnvelope(job, handoff, boundaryScope, providerContract));
    }
    for (const memory of job.memory) {
      requiredState.add(memory.alias ?? memory.name);
    }
    if (!job.recovery.restartSafe) {
      pendingRecovery.push(Object.freeze({
        job: job.job,
        reason: "missing-recovery-checkpoint",
        nextAction: "add-recover-or-rollback-clause",
      }));
    }
  }

  for (const state of providerContract?.externalState ?? []) requiredState.add(state);

  const scopeBlocked = boundaryScope.missingScopes.length > 0;
  const blocked = diagnostics.status.state === "blocked" || scopeBlocked;
  const recoveryReady = pendingRecovery.length === 0;
  const restartSafe = statusEnvelopes.length === 0 || statusEnvelopes.every((item) => item.restartSafe);

  return Object.freeze({
    protocol: "aios.language.parser.client-workflow.v1",
    provider: "mailchimp",
    detected: mailchimpJobs.length > 0 || providerContract != null,
    state: blocked
      ? "blocked"
      : recoveryReady
        ? "ready-for-ast-lowering"
        : "needs-recovery-design",
    runtimeData: Object.freeze({
      operations: Object.freeze([...operations].sort()),
      requiredExternalState: Object.freeze([...requiredState].sort()),
      statusEnvelopes: freezeArray(statusEnvelopes),
      syncMetadata: Object.freeze({
        requiresLedger: providerContract?.syncMetadata?.requiresLedger === true || requiredState.has("ledger"),
        requiresCheckpoint: providerContract?.syncMetadata?.requiresCheckpoint === true || pendingRecovery.length > 0 || !restartSafe,
        restartSafe: recoveryReady && restartSafe,
      }),
    }),
    boundary: Object.freeze({
      tenantId: boundaryScope.tenantId,
      workspaceId: boundaryScope.workspaceId,
      role: boundaryScope.role,
      auditChannel: boundaryScope.auditChannel,
      allowedScopes: boundaryScope.allowedScopes,
      requestedScopes: boundaryScope.requestedScopes,
      missingScopes: boundaryScope.missingScopes,
      isolated: boundaryScope.tenantId !== "default-tenant" && boundaryScope.workspaceId !== "default-workspace",
    }),
    handoff: Object.freeze({
      nextAction: blocked
        ? scopeBlocked
          ? "request-parser-scope"
          : diagnostics.status.nextAction
        : recoveryReady
          ? restartSafe
            ? "build-mailchimp-ast-preview"
            : "collect-mailchimp-checkpoint"
          : "collect-mailchimp-recovery-checkpoint",
      pendingRecovery: freezeArray(pendingRecovery),
      clientControls: Object.freeze({
        enabled: Object.freeze(blocked ? ["inspectParseDiagnostics"] : ["inspectParseDiagnostics", "previewAst", "inspectHandoffStatus"]),
        disabled: Object.freeze(recoveryReady && !blocked && restartSafe ? [] : ["compile"]),
      }),
    }),
  });
}

export function parseLanguageSource(source = "", options = {}) {
  const program = parse(source, options);
  const diagnostics = createDiagnosticEnvelope(program.diagnostics, options);
  const jobs = freezeArray((program.body ?? []).map(normalizeJobClauses));
  const mailchimpHandoffs = jobs.flatMap((job) => (
    job.handoffs.filter((handoff) => String(handoff.adapter ?? "").startsWith("mailchimp."))
      .map((handoff) => Object.freeze({ job: job.job, adapter: handoff.adapter, restartSafe: job.recovery.restartSafe }))
  ));
  const clientWorkflow = createClientWorkflowState(jobs, diagnostics, options);

  return Object.freeze({
    protocol: "aios.language.parser.v1",
    type: program.type,
    sourceName: text(options.sourceName ?? options.fileName, "inline.aios"),
    jobs,
    diagnostics,
    health: program.health,
    analytics: program.analytics,
    boundary: program.boundary,
    tokenSnapshot: program.tokenSnapshot,
    adapterStatus: Object.freeze({
      mailchimpDetected: mailchimpHandoffs.length > 0,
      handoffs: freezeArray(mailchimpHandoffs),
      clientWorkflow,
      externalState: clientWorkflow.runtimeData.requiredExternalState,
      statusEnvelopes: clientWorkflow.runtimeData.statusEnvelopes,
      boundary: clientWorkflow.boundary,
      nextAction: diagnostics.status.state === "blocked"
        ? diagnostics.status.nextAction
        : mailchimpHandoffs.some((handoff) => !handoff.restartSafe)
          ? "add-recovery-checkpoint"
          : clientWorkflow.handoff.nextAction,
    }),
  });
}

export function parserApiHealth(source = "", options = {}) {
  const health = parseHealth(source, options);
  const summary = summarizeParse(source, options);

  return Object.freeze({
    protocol: "aios.language.parser.health.v1",
    ok: health.health?.ok === true,
    health: health.health,
    diagnostics: createDiagnosticEnvelope(health.diagnostics, options),
    summary,
  });
}

export function assertParserApiReady() {
  const parsed = parseLanguageSource("job mailchimp { recover from \"checkpoint\"; handoff adapter mailchimp.sync; status emits \"queued\"; }");
  return Object.freeze({
    ok: parsed.jobs.length === 1
      && parsed.adapterStatus.mailchimpDetected === true
      && parsed.adapterStatus.clientWorkflow.state === "ready-for-ast-lowering",
    protocol: parsed.protocol,
  });
}
