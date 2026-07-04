import { compileAiosSource } from "../source/ast.mjs";
import { buildAstContract, extractKernelContracts } from "./ast-api.mjs";
import { createDiagnosticEnvelope } from "./diagnostics-api.mjs";

function text(value, fallback = "") {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function freezeArray(values = []) {
  return Object.freeze(Array.isArray(values) ? values.map((value) => Object.freeze(value)) : []);
}

function createRuntimeHandoffPlan(astContract = {}, compileResult = {}) {
  const kernel = extractKernelContracts(astContract);
  const plans = (kernel.contracts ?? []).map((contract) => {
    const mailchimp = contract.adapterHandoff?.mailchimp;
    const lifecycle = contract.lifecycle ?? {};
    const commandControls = lifecycle.commandControls ?? {};

    return Object.freeze({
      descriptorId: contract.id,
      provider: mailchimp ? "mailchimp" : "runtime",
      exportReady: astContract.status?.exportReady === true && lifecycle.state !== "blocked",
      acceptanceRequired: lifecycle.settings?.acceptanceRequired === true,
      restartSafe: mailchimp ? mailchimp.restartSafe === true : true,
      nextAction: lifecycle.nextAction?.id
        ?? (mailchimp?.restartSafe === false ? "refresh-mailchimp-checkpoint" : "handoff-runtime-adapter"),
      enabledCommands: Object.freeze(commandControls.enabled ?? []),
      disabledCommands: Object.freeze(commandControls.disabled ?? []),
      recovery: Object.freeze({
        mode: mailchimp?.restartSafe === false ? "provider-sync-checkpoint" : "runtime-retry",
        details: mailchimp?.recovery ?? compileResult.recoveryPlan?.find?.((plan) => plan.jobId === contract.id) ?? null,
      }),
    });
  });

  return Object.freeze({
    protocol: "aios.language.runtime-handoff.v1",
    exportReady: plans.length > 0 && plans.every((plan) => plan.exportReady && plan.restartSafe),
    plans: freezeArray(plans),
  });
}

function stableId(value = "") {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function providerAccepted(provider, options = {}) {
  const accepted = options.acceptedProviderContracts ?? options.acceptedProviders ?? [];
  return options.acceptProviderContract === true
    || options[`${provider}Accepted`] === true
    || (Array.isArray(accepted) && accepted.includes(provider));
}

function normalizeList(value = []) {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => text(item)).filter(Boolean).sort());
  const single = text(value);
  return Object.freeze(single ? [single] : []);
}

function createBoundaryContract(astContract = {}, handoffPlan = {}, options = {}) {
  const tenantId = text(options.tenantId ?? options.tenant ?? options.orgId, "local-tenant");
  const workspaceId = text(options.workspaceId ?? options.workspace ?? options.projectId, "default-workspace");
  const actorId = text(options.actorId ?? options.userId ?? options.principalId, "system");
  const role = text(options.role ?? options.actorRole, "developer");
  const allowedProviders = normalizeList(options.allowedProviders ?? options.providers ?? ["runtime", "mailchimp"]);
  const deniedProviders = normalizeList(options.deniedProviders);
  const acceptedProviders = normalizeList(options.acceptedProviderContracts ?? options.acceptedProviders);
  const routeProvider = astContract.preview?.provider?.provider ?? "runtime";
  const clientRuntime = astContract.preview?.clientRuntime ?? Object.freeze({});
  const routeHandoff = clientRuntime.routeHandoff ?? Object.freeze({});
  const providerPlans = (handoffPlan.plans ?? []).map((plan) => plan.provider);
  const providerSet = new Set(providerPlans.length > 0 ? providerPlans : [routeProvider]);
  const rolesAllowedToExport = new Set(["owner", "admin", "developer", "operator"]);
  const violations = [];

  if (!rolesAllowedToExport.has(role)) {
    violations.push(Object.freeze({
      code: "AIOS_BOUNDARY_ROLE",
      message: `Role ${role} cannot export runtime handoff commands.`,
      nextAction: "request-runtime-export-role",
    }));
  }

  if (!tenantId || tenantId === "public") {
    violations.push(Object.freeze({
      code: "AIOS_BOUNDARY_TENANT",
      message: "Runtime handoff requires a scoped tenant.",
      nextAction: "select-tenant-scope",
    }));
  }

  if (!workspaceId || workspaceId === "public") {
    violations.push(Object.freeze({
      code: "AIOS_BOUNDARY_WORKSPACE",
      message: "Runtime handoff requires a scoped workspace.",
      nextAction: "select-workspace-scope",
    }));
  }

  for (const provider of providerSet) {
    if (!allowedProviders.includes(provider)) {
      violations.push(Object.freeze({
        code: "AIOS_BOUNDARY_PROVIDER",
        provider,
        message: `${provider} is not allowed in this workspace boundary.`,
        nextAction: "allow-provider-for-workspace",
      }));
    }
    if (deniedProviders.includes(provider)) {
      violations.push(Object.freeze({
        code: "AIOS_BOUNDARY_PROVIDER_DENIED",
        provider,
        message: `${provider} is denied by this workspace boundary.`,
        nextAction: "choose-approved-provider",
      }));
    }
  }

  const mailchimpAcceptanceRequired = (handoffPlan.plans ?? []).some((plan) => (
    plan.provider === "mailchimp" && plan.acceptanceRequired === true
  )) || astContract.preview?.acceptance?.required === true;

  if (mailchimpAcceptanceRequired && !acceptedProviders.includes("mailchimp") && options.acceptProviderContract !== true) {
    violations.push(Object.freeze({
      code: "AIOS_BOUNDARY_PROVIDER_ACCEPTANCE",
      provider: "mailchimp",
      message: "Mailchimp provider contract must be accepted inside the active workspace boundary.",
      nextAction: "accept-mailchimp-provider-contract",
    }));
  }

  const ok = violations.length === 0;

  return Object.freeze({
    protocol: "aios.language.compiler.boundary.v1",
    ok,
    state: ok ? "ready" : "blocked",
    tenantId,
    workspaceId,
    actor: Object.freeze({ id: actorId, role }),
    providers: Object.freeze({
      requested: Object.freeze([...providerSet].sort()),
      allowed: allowedProviders,
      denied: deniedProviders,
      accepted: acceptedProviders,
    }),
    routeHandoff: Object.freeze({
      route: routeHandoff.route ?? "runtime.preview",
      params: routeHandoff.params ?? Object.freeze([]),
      cacheKey: stableId([
        tenantId,
        workspaceId,
        actorId,
        routeHandoff.route ?? "runtime.preview",
        ...(routeHandoff.cacheKeyParts ?? []),
      ].join(":")),
    }),
    audit: Object.freeze({
      event: ok ? "runtime-handoff-boundary-ready" : "runtime-handoff-boundary-blocked",
      subject: `${tenantId}/${workspaceId}`,
      actorId,
      providers: Object.freeze([...providerSet].sort()),
      violations: freezeArray(violations),
    }),
    commandControls: Object.freeze({
      enabled: Object.freeze(ok ? ["exportRuntimeHandoff", "persistRuntimeState"] : ["inspectBoundary"]),
      disabled: Object.freeze(ok ? [] : ["exportRuntimeHandoff", "dispatchProviderHandoff"]),
    }),
    nextAction: ok ? "persist-runtime-state" : violations[0]?.nextAction ?? "inspect-boundary",
  });
}

function createPersistenceContract(astContract = {}, handoffPlan = {}, compileResult = {}, options = {}) {
  const sourceName = text(options.sourceName ?? options.fileName, astContract.sourceName ?? "inline.aios");
  const sourceHash = text(compileResult.sourceHash, stableId(sourceName));
  const boundary = options.boundaryContract ?? createBoundaryContract(astContract, handoffPlan, options);
  const records = (handoffPlan.plans ?? []).map((plan) => {
    const checkpointId = `${sourceHash}:${plan.descriptorId}:${plan.provider}`;
    const restartState = plan.restartSafe ? "restart-ready" : "checkpoint-required";
    const accepted = plan.acceptanceRequired !== true || providerAccepted(plan.provider, options);

    return Object.freeze({
      descriptorId: plan.descriptorId,
      provider: plan.provider,
      key: checkpointId,
      state: restartState,
      idempotencyKey: stableId(`${checkpointId}:idempotency`),
      checkpointRef: stableId(`${checkpointId}:checkpoint`),
      acceptanceRequired: plan.acceptanceRequired,
      accepted,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      boundaryKey: boundary.routeHandoff.cacheKey,
      exportReady: plan.exportReady && plan.restartSafe && boundary.ok,
      recoveryMode: plan.recovery.mode,
    });
  });

  const pending = records.filter((record) => record.state !== "restart-ready" || !record.accepted);

  return Object.freeze({
    protocol: "aios.language.compiler.persistence.v1",
    sourceName,
    sourceHash,
    restartSafe: pending.length === 0,
    records: freezeArray(records),
    pending: freezeArray(pending),
    ledger: Object.freeze({
      namespace: `${boundary.tenantId}:${boundary.workspaceId}:${text(options.namespace, "runtime")}`,
      writeMode: "upsert-by-idempotency-key",
      keys: Object.freeze(records.map((record) => record.idempotencyKey).sort()),
    }),
    boundary: Object.freeze({
      ok: boundary.ok,
      key: boundary.routeHandoff.cacheKey,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
    }),
  });
}

function createIdempotentCommandContract(handoffPlan = {}, persistence = {}, boundary = {}) {
  const commands = [];
  const boundaryOk = boundary.ok !== false;

  for (const record of persistence.records ?? []) {
    const plan = (handoffPlan.plans ?? []).find((candidate) => candidate.descriptorId === record.descriptorId);
    const enabled = boundaryOk && record.exportReady && record.accepted === true;
    commands.push(Object.freeze({
      id: `handoff:${record.provider}:${record.descriptorId}`,
      provider: record.provider,
      descriptorId: record.descriptorId,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      boundaryKey: record.boundaryKey,
      idempotencyKey: record.idempotencyKey,
      checkpointRef: record.checkpointRef,
      enabled,
      restartSafe: record.state === "restart-ready",
      allowedRetries: record.state === "restart-ready" ? 3 : 0,
      blockedBy: Object.freeze([
        ...(boundaryOk ? [] : ["workspace-boundary"]),
        ...(record.acceptanceRequired && record.accepted !== true ? ["provider-acceptance-pending"] : []),
        ...(record.state !== "restart-ready" ? ["restart-checkpoint"] : []),
        ...(plan?.exportReady === false ? ["runtime-export"] : []),
      ]),
      nextAction: enabled
        ? "dispatch-provider-handoff"
        : !boundaryOk
          ? boundary.nextAction ?? "inspect-boundary"
          : record.acceptanceRequired && record.accepted !== true
          ? "accept-provider-contract"
          : record.state !== "restart-ready"
            ? "persist-restart-checkpoint"
            : "complete-runtime-export",
    }));
  }

  return Object.freeze({
    protocol: "aios.language.compiler.commands.v1",
    idempotent: true,
    commands: freezeArray(commands),
    enabled: Object.freeze(commands.filter((command) => command.enabled).map((command) => command.id)),
    disabled: Object.freeze(commands.filter((command) => !command.enabled).map((command) => command.id)),
  });
}

function createRestartStatus(status, persistence, commands) {
  const blockedCommands = commands.commands.filter((command) => !command.enabled);
  const state = status.state === "blocked"
    ? "blocked"
    : persistence.restartSafe && blockedCommands.length === 0
      ? "restart-safe"
      : "awaiting-persistence";

  return Object.freeze({
    protocol: "aios.language.compiler.restart-status.v1",
    state,
    restartSafe: state === "restart-safe",
    exportReady: status.exportReady && state === "restart-safe",
    pendingKeys: Object.freeze(persistence.pending.map((record) => record.key)),
    nextAction: state === "blocked"
      ? status.nextAction
      : state === "awaiting-persistence"
        ? blockedCommands[0]?.nextAction ?? "persist-runtime-state"
        : "handoff-runtime-adapter",
  });
}

function createCompileStatus(diagnostics, astContract, handoffPlan, boundary) {
  const state = diagnostics.status.state === "blocked"
    ? "blocked"
    : astContract.status?.state === "blocked"
      ? "blocked"
      : boundary.ok === false
        ? "blocked"
      : handoffPlan.exportReady
        ? "ready"
        : "review";

  return Object.freeze({
    protocol: "aios.language.compiler.status.v1",
    state,
    exportReady: state === "ready",
    nextAction: state === "blocked"
      ? boundary.ok === false
        ? boundary.nextAction
        : "resolve-compile-diagnostics"
      : state === "review"
        ? "complete-runtime-handoff"
        : "export-kernel-job-contracts",
    recovery: Object.freeze({
      available: handoffPlan.plans.some((plan) => plan.restartSafe === false || plan.recovery.mode !== "runtime-retry"),
      plans: freezeArray(handoffPlan.plans.map((plan) => ({
        descriptorId: plan.descriptorId,
        mode: plan.recovery.mode,
        restartSafe: plan.restartSafe,
      }))),
    }),
  });
}

export function compileLanguageSource(source = "", options = {}) {
  const astContract = buildAstContract(source, options);
  const compileResult = compileAiosSource(source, options);
  const diagnostics = createDiagnosticEnvelope([
    ...(astContract.diagnostics?.diagnostics ?? []),
    ...(compileResult.diagnostics ?? []),
  ], options);
  const handoffPlan = createRuntimeHandoffPlan(astContract, compileResult);
  const boundary = createBoundaryContract(astContract, handoffPlan, options);
  const status = createCompileStatus(diagnostics, astContract, handoffPlan, boundary);
  const persistence = createPersistenceContract(astContract, handoffPlan, compileResult, { ...options, boundaryContract: boundary });
  const commands = createIdempotentCommandContract(handoffPlan, persistence, boundary);
  const restartStatus = createRestartStatus(status, persistence, commands);

  return Object.freeze({
    protocol: "aios.language.compiler.v1",
    sourceName: text(options.sourceName ?? options.fileName, "inline.aios"),
    sourceHash: compileResult.sourceHash ?? null,
    status,
    restartStatus,
    diagnostics,
    ast: astContract.ast,
    kernel: extractKernelContracts(astContract),
    handoffPlan,
    boundary,
    persistence,
    commands,
    compileResult,
  });
}

export function compileMailchimpLanguageSlice(source = "", options = {}) {
  const compiled = compileLanguageSource(source, { ...options, namespace: options.namespace ?? "mailchimp" });
  const mailchimpPlans = compiled.handoffPlan.plans.filter((plan) => plan.provider === "mailchimp");

  return Object.freeze({
    protocol: "aios.language.compiler.mailchimp.v1",
    exportReady: compiled.status.exportReady
      && compiled.restartStatus.exportReady
      && mailchimpPlans.every((plan) => plan.restartSafe),
    status: compiled.status,
    restartStatus: compiled.restartStatus,
    diagnostics: compiled.diagnostics,
    sourceHash: compiled.sourceHash,
    mailchimp: Object.freeze({
      detected: mailchimpPlans.length > 0,
      plans: freezeArray(mailchimpPlans),
      requiresAcceptance: mailchimpPlans.some((plan) => plan.acceptanceRequired),
      recoveryReady: mailchimpPlans.every((plan) => plan.restartSafe),
      boundary: compiled.boundary,
      persistedState: Object.freeze({
        restartSafe: compiled.persistence.restartSafe,
        records: freezeArray(compiled.persistence.records.filter((record) => record.provider === "mailchimp")),
        commands: freezeArray(compiled.commands.commands.filter((command) => command.provider === "mailchimp")),
      }),
    }),
    kernel: compiled.kernel,
  });
}

export function assertCompilerApiReady() {
  const source = [
    "job syncMailchimp {",
    "capability mailchimp.contacts: read @external;",
    "memory ledger: persistent;",
    "step sync uses mailchimp.fetchAudience(list: \"primary\") writes [ledger] recover ledger;",
    "verify ledger exists;",
    "truth mailchimpApi: source=\"adapter\", confidence=\"reported\";",
    "}",
  ].join("\n");
  const compiled = compileMailchimpLanguageSlice(source, { acceptedProviderContracts: ["mailchimp"] });

  return Object.freeze({
    ok: compiled.mailchimp.detected === true
      && compiled.mailchimp.recoveryReady === true
      && compiled.mailchimp.persistedState.restartSafe === true,
    protocol: compiled.protocol,
  });
}
