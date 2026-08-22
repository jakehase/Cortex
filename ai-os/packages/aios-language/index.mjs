import { createCompileResult } from "./api/compile-result.mjs";
import { createRuntimeResult } from "./api/runtime-result.mjs";
import { classifyTruthClaim } from "./api/truth-boundary.mjs";

// Canonical AIOS v1 entrypoint. The legacy directive parser below remains exported
// for compatibility, but new runtime adoption must use compileCanonicalAiosSource.
export * from "./canonical.mjs";
export * from "./governance/version-freeze.mjs";
export * from "./runtime/provider-read-compute.mjs";
export * from "./api/compile-result.mjs";
export * from "./api/runtime-result.mjs";
export * from "./api/truth-boundary.mjs";

const DIRECTIVE_PATTERN = /^([a-z][a-z0-9-]*)\s*(.*)$/i;

function cleanText(value) {
  return String(value ?? "").trim();
}

function hashSource(source) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function parseDirective(line, lineNumber) {
  const match = line.match(DIRECTIVE_PATTERN);
  if (!match) {
    return { type: "invalid", lineNumber, raw: line, diagnostic: `Cannot parse directive on line ${lineNumber}.` };
  }
  return { type: match[1].toLowerCase(), value: cleanText(match[2]), lineNumber, raw: line };
}

function parseWords(value) {
  return cleanText(value).split(/\s+/).map(cleanText).filter(Boolean);
}

function parseKeyValues(value) {
  const params = {};
  for (const token of parseWords(value)) {
    const [key, ...rest] = token.split("=");
    if (!key || rest.length === 0) continue;
    params[key] = rest.join("=");
  }
  return params;
}

function parseList(value) {
  return parseWords(value).flatMap((word) => word.split(",")).map(cleanText).filter(Boolean);
}

function mergeList(target, key, values) {
  target[key] = [...(target[key] ?? []), ...values];
}

function closeJob(ast, currentJob) {
  if (!currentJob) return;
  ast.jobs.push(currentJob);
}

export function parseAiosSource(source, options = {}) {
  const text = String(source ?? "");
  const ast = {
    version: "aios-language.ast.v1",
    sourceName: cleanText(options.sourceName) || "inline.aios",
    jobs: [],
    diagnostics: [],
  };
  let currentJob = null;

  text.split(/\r?\n/).forEach((rawLine, offset) => {
    const lineNumber = offset + 1;
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) return;

    const directive = parseDirective(line, lineNumber);
    if (directive.type === "invalid") {
      ast.diagnostics.push({ severity: "error", code: "AIOS_PARSE_DIRECTIVE", message: directive.diagnostic, path: `$.lines[${lineNumber}]` });
      return;
    }

    if (directive.type === "job") {
      closeJob(ast, currentJob);
      currentJob = {
        type: "JobDeclaration",
        name: directive.value || `job-${ast.jobs.length + 1}`,
        lineNumber,
        adapter: "local",
        action: "run",
        params: {},
        capabilities: [],
        memory: { reads: [], writes: [], scopes: [], localOnly: true },
        verifiers: [],
        truthClaims: [],
        requestContract: {
          channel: "client",
          workflow: "default",
          tenantId: "local",
          workspaceId: "default",
        },
        accessPolicy: {
          roles: [],
          permissions: [],
          audit: {},
          boundaryMode: "local-only",
        },
        clientState: {
          visibleFields: [],
          hiddenFields: [],
          persistedKeys: [],
        },
        persistedState: {
          commands: [],
          checkpoints: [],
        },
        workflowHandoff: {},
        operationalHealth: {
          checks: [],
          retry: {},
        },
        recovery: { retryLimit: 0, statusOnFailure: "needs-operator" },
        rollback: { required: true, action: null },
      };
      return;
    }

    if (!currentJob) {
      ast.diagnostics.push({ severity: "error", code: "AIOS_DIRECTIVE_OUTSIDE_JOB", message: `${directive.type} directive must appear after a job directive.`, path: `$.lines[${lineNumber}]` });
      return;
    }

    if (directive.type === "adapter") currentJob.adapter = directive.value || "local";
    else if (directive.type === "action") currentJob.action = directive.value || "run";
    else if (directive.type === "param") currentJob.params = { ...currentJob.params, ...parseKeyValues(directive.value) };
    else if (directive.type === "capability") {
      const [name, ...rest] = parseWords(directive.value);
      currentJob.capabilities.push({ name, mode: rest[0] || "use", target: rest.slice(1).join(" ") || null });
    } else if (directive.type === "memory") {
      const [mode, ...items] = parseWords(directive.value);
      if (mode === "read") currentJob.memory.reads.push(...items);
      else if (mode === "write") currentJob.memory.writes.push(...items);
      else if (mode === "scope") currentJob.memory.scopes.push(...items);
      else if (mode === "external") currentJob.memory.localOnly = false;
    } else if (directive.type === "request") {
      const params = parseKeyValues(directive.value);
      currentJob.requestContract = { ...currentJob.requestContract, ...params };
    } else if (directive.type === "tenant") {
      currentJob.requestContract.tenantId = directive.value || currentJob.requestContract.tenantId;
    } else if (directive.type === "workspace") {
      currentJob.requestContract.workspaceId = directive.value || currentJob.requestContract.workspaceId;
      if (directive.value) currentJob.memory.scopes.push(directive.value);
    } else if (directive.type === "client") {
      const params = parseKeyValues(directive.value);
      const visible = parseList(params.visible);
      const hidden = parseList(params.hidden);
      const persist = parseList(params.persist);
      currentJob.clientState = {
        ...currentJob.clientState,
        statusLabel: params.status || currentJob.clientState.statusLabel,
        handoffLabel: params.handoff || currentJob.clientState.handoffLabel,
      };
      mergeList(currentJob.clientState, "visibleFields", visible);
      mergeList(currentJob.clientState, "hiddenFields", hidden);
      mergeList(currentJob.clientState, "persistedKeys", persist);
    } else if (directive.type === "persist") {
      const params = parseKeyValues(directive.value);
      currentJob.persistedState = {
        ...currentJob.persistedState,
        snapshotKey: params.snapshot || params.key || currentJob.persistedState.snapshotKey,
        restartToken: params.restart || params.token || currentJob.persistedState.restartToken,
        resumeMode: params.mode || currentJob.persistedState.resumeMode,
        statusOnRestart: params.status || params.statusOnRestart || currentJob.persistedState.statusOnRestart,
        resumeCursor: params.cursor || params.resumeCursor || currentJob.persistedState.resumeCursor,
        restartSafe: params.restartSafe === "false" ? false : currentJob.persistedState.restartSafe,
      };
    } else if (directive.type === "checkpoint") {
      const params = parseKeyValues(directive.value);
      currentJob.persistedState.checkpoints.push({
        key: params.key || params.id || directive.value,
        status: params.status,
        required: params.required === "false" ? false : true,
        commandId: params.command || params.commandId,
      });
    } else if (directive.type === "command") {
      const params = parseKeyValues(directive.value);
      currentJob.persistedState.commands.push({
        id: params.id,
        name: params.name || params.run || directive.value,
        idempotencyKey: params.idempotency,
        checkpoint: params.checkpoint,
        replayable: params.replayable === "false" ? false : true,
        rollbackAction: params.rollback,
        status: params.status,
      });
    } else if (directive.type === "handoff") {
      const params = parseKeyValues(directive.value);
      currentJob.workflowHandoff = {
        ...currentJob.workflowHandoff,
        title: params.title || currentJob.workflowHandoff.title,
        nextAction: params.next || params.action || currentJob.workflowHandoff.nextAction,
        userMessage: params.message || currentJob.workflowHandoff.userMessage,
        statusUrl: params.statusUrl || currentJob.workflowHandoff.statusUrl,
      };
    } else if (directive.type === "role") {
      const params = parseKeyValues(directive.value);
      const roles = parseList(params.name || params.names || directive.value);
      mergeList(currentJob.accessPolicy, "roles", roles);
      if (params.default) currentJob.accessPolicy.defaultRole = params.default;
    } else if (directive.type === "permission") {
      const params = parseKeyValues(directive.value);
      const permissions = parseList(params.name || params.names || params.allow || directive.value);
      mergeList(currentJob.accessPolicy, "permissions", permissions);
      if (params.mode) currentJob.accessPolicy.boundaryMode = params.mode;
    } else if (directive.type === "boundary") {
      const params = parseKeyValues(directive.value);
      currentJob.accessPolicy = {
        ...currentJob.accessPolicy,
        boundaryMode: params.mode || directive.value || currentJob.accessPolicy.boundaryMode,
        tenantIsolation: params.tenantIsolation === "false" ? false : currentJob.accessPolicy.tenantIsolation,
        workspaceIsolation: params.workspaceIsolation === "false" ? false : currentJob.accessPolicy.workspaceIsolation,
      };
    } else if (directive.type === "audit") {
      const params = parseKeyValues(directive.value);
      currentJob.accessPolicy = {
        ...currentJob.accessPolicy,
        audit: {
          ...currentJob.accessPolicy.audit,
          required: params.required === "false" ? false : true,
          handoff: params.handoff || params.target || currentJob.accessPolicy.audit?.handoff,
          evidence: params.evidence || currentJob.accessPolicy.audit?.evidence,
        },
      };
    } else if (directive.type === "health") {
      const params = parseKeyValues(directive.value);
      currentJob.operationalHealth = {
        ...currentJob.operationalHealth,
        status: params.status || currentJob.operationalHealth.status,
        failureState: params.failure || params.failureState || currentJob.operationalHealth.failureState,
        degradedMode: params.degraded === "true" || currentJob.operationalHealth.degradedMode,
        retry: {
          ...currentJob.operationalHealth.retry,
          maxAttempts: params.retry ?? currentJob.operationalHealth.retry.maxAttempts,
          backoffMs: params.backoffMs ?? currentJob.operationalHealth.retry.backoffMs,
        },
      };
      if (params.check || params.message) {
        currentJob.operationalHealth.checks.push({
          name: params.check,
          status: params.status,
          message: params.message,
        });
      }
    } else if (directive.type === "verify") currentJob.verifiers.push(directive.value);
    else if (directive.type === "truth") {
      const [level, ...claimWords] = parseWords(directive.value);
      currentJob.truthClaims.push(classifyTruthClaim(claimWords.join(" "), { level }));
    } else if (directive.type === "recover") {
      const params = parseKeyValues(directive.value);
      currentJob.recovery = {
        retryLimit: Number.isFinite(Number(params.retry)) ? Math.max(0, Math.trunc(Number(params.retry))) : currentJob.recovery.retryLimit,
        statusOnFailure: params.status || currentJob.recovery.statusOnFailure,
      };
    } else if (directive.type === "rollback") {
      currentJob.rollback = { required: directive.value !== "none", action: directive.value || null };
    } else {
      ast.diagnostics.push({ severity: "warning", code: "AIOS_UNKNOWN_DIRECTIVE", message: `Unknown directive "${directive.type}" ignored.`, path: `$.lines[${lineNumber}]` });
    }
  });

  closeJob(ast, currentJob);
  return ast;
}

export function lowerAstToKernelJobs(ast) {
  return (ast?.jobs ?? []).map((job, index) => ({
    id: `aios-${index + 1}-${job.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "job"}`,
    name: job.name,
    adapter: job.adapter,
    action: job.action,
    params: job.params,
    capabilities: job.capabilities,
    memory: job.memory,
    verifierContracts: job.verifiers,
    truthBoundary: { claims: job.truthClaims },
    requestContract: {
      ...job.requestContract,
      workflow: job.requestContract.workflow === "default" ? job.name : job.requestContract.workflow,
    },
    accessPolicy: job.accessPolicy,
    clientState: job.clientState,
    persistedState: job.persistedState,
    workflowHandoff: job.workflowHandoff,
    operationalHealth: job.operationalHealth,
    recovery: job.recovery,
    rollback: job.rollback,
  }));
}

export function compileAiosSource(source, options = {}) {
  const ast = parseAiosSource(source, options);
  return createCompileResult({
    target: options.target,
    sourceHash: hashSource(String(source ?? "")),
    ast,
    jobs: lowerAstToKernelJobs(ast),
    diagnostics: ast.diagnostics,
    truthBoundary: options.truthBoundary,
  });
}

export function handoffToRuntimeAdapter(compileResult, adapterReceipt = {}) {
  const job = compileResult?.jobs?.[0];
  return createRuntimeResult({
    compileResult,
    jobId: job?.id,
    adapterReceipt: {
      adapter: adapterReceipt.adapter ?? job?.adapter,
      status: adapterReceipt.status ?? "accepted",
      receiptId: adapterReceipt.receiptId,
      externalWrite: adapterReceipt.externalWrite,
      externalReferences: adapterReceipt.externalReferences,
      tenantId: adapterReceipt.tenantId,
      workspaceId: adapterReceipt.workspaceId,
      role: adapterReceipt.role,
      permissions: adapterReceipt.permissions,
    },
    runtimeScope: adapterReceipt.runtimeScope,
    auditHandoff: adapterReceipt.auditHandoff,
    outputs: adapterReceipt.outputs,
    errors: adapterReceipt.errors,
    rollback: adapterReceipt.rollback ?? compileResult?.recoveryPlan?.[0]?.rollback,
    persistence: {
      commandOutcomes: adapterReceipt.commandOutcomes ?? adapterReceipt.commands,
      resumeCursor: adapterReceipt.resumeCursor,
      restartToken: adapterReceipt.restartToken ?? job?.persistedState?.restartToken,
    },
    operationalHealth: adapterReceipt.operationalHealth,
    truthBoundary: adapterReceipt.truthBoundary,
  });
}

export const MAILCHIMP_CAMPAIGN_EXAMPLE = [
  "job sync-mailchimp-campaign",
  "adapter mailchimp",
  "action campaign.draft",
  "tenant local",
  "workspace marketing",
  "request channel=mailchimp-ui workflow=campaign-draft clientRequestId=req-mailchimp-001 idempotencyKey=campaign-draft-001",
  "role name=mailchimp-operator,mailchimp-runtime default=mailchimp-runtime",
  "permission allow=mailchimp.campaigns,status:timeline.write mode=local-only",
  "boundary mode=tenant-workspace tenantIsolation=true workspaceIsolation=true",
  "audit required=true handoff=mailchimp-audit-log evidence=runtime-receipt",
  "client status=Drafting handoff=MailchimpDraft visible=subject,audience persist=campaignDraft,mailchimpReceipt",
  "persist snapshot=aios:local:marketing:campaign-draft-001 restart=campaign-draft-001:restart mode=idempotent-replay status=queued",
  "checkpoint key=campaign-draft-001:checkpoint:draft status=pending required=true",
  "command name=mailchimp.campaign.draft idempotency=campaign-draft-001:draft checkpoint=campaign-draft-001:checkpoint:draft replayable=true rollback=mailchimp.campaign.deleteDraft",
  "handoff title=MailchimpDraft next=review-campaign message=draft-ready",
  "health status=healthy check=mailchimp-api retry=2 backoffMs=500",
  "capability mailchimp.campaigns write local-audience",
  "capability status:timeline.write use local-status",
  "memory read localAudience",
  "memory write campaignDraft",
  "memory scope marketing",
  "param audience=localAudience campaignType=regular",
  "truth declared campaign content is supplied by local memory",
  "verify campaignDraft.subject exists",
  "recover retry=1 status=needs-operator",
  "rollback delete-draft",
].join("\n");
