import { lowerAstToKernelJobDescriptors, parseAiosSource } from "../source/ast.mjs";
import { createDiagnosticEnvelope } from "./diagnostics-api.mjs";

function text(value, fallback = "") {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function freezeArray(values = []) {
  return Object.freeze(Array.isArray(values) ? values.map((value) => Object.freeze(value)) : []);
}

function providerFromAdapter(adapter = "") {
  return text(adapter).split(".")[0] || "runtime";
}

function operationFromAdapter(adapter = "") {
  const parts = text(adapter).split(".");
  return parts.length > 1 ? parts.slice(1).join(".") : parts[0] || "run";
}

function normalizeKernelContract(descriptor = {}) {
  const mailchimp = descriptor.handoff?.mailchimp ?? { detected: false };
  const recovery = mailchimp.syncContract?.recovery ?? null;

  return Object.freeze({
    id: descriptor.id,
    sourceName: descriptor.sourceName,
    capabilities: freezeArray((descriptor.capabilities ?? []).map((capability) => ({
      name: capability.name,
      scope: capability.scope,
      boundary: capability.boundary,
    }))),
    memory: freezeArray((descriptor.memory ?? []).map((memory) => ({
      name: memory.name,
      mode: memory.mode,
      retention: memory.retention,
    }))),
    steps: freezeArray((descriptor.steps ?? []).map((step) => ({
      id: step.id,
      adapter: step.adapter,
      provider: providerFromAdapter(step.adapter),
      operation: operationFromAdapter(step.adapter),
      reads: step.reads ?? Object.freeze([]),
      writes: step.writes ?? Object.freeze([]),
      status: step.status,
      recovery: step.recovery,
    }))),
    verifier: Object.freeze({
      contracts: Object.freeze(descriptor.verifier?.contracts ?? []),
      truthBoundaries: freezeArray(descriptor.verifier?.truthBoundaries ?? []),
    }),
    rollback: Object.freeze(descriptor.rollback ?? { strategy: "halt", target: null }),
    handoff: Object.freeze({
      providers: Object.freeze(descriptor.handoff?.providers ?? []),
      adapters: Object.freeze(descriptor.handoff?.adapters ?? []),
      external: descriptor.handoff?.sync?.external === true,
      mailchimp: mailchimp.detected
        ? Object.freeze({
            ready: mailchimp.ready !== false,
            operations: Object.freeze(mailchimp.operations ?? []),
            missing: Object.freeze(mailchimp.missing ?? []),
            restartSafe: mailchimp.syncContract?.restartSafe === true,
            recovery,
          })
        : null,
    }),
    lifecycle: descriptor.lifecycleControls ?? Object.freeze({}),
    exportState: descriptor.exportState ?? Object.freeze({ ready: false }),
  });
}

function summarizeProviderPreview(contracts = [], diagnostics) {
  const mailchimpContracts = contracts.filter((contract) => contract.handoff.mailchimp);
  const operations = new Set();
  const capabilities = new Set();
  const externalState = new Set();

  for (const contract of mailchimpContracts) {
    for (const operation of contract.handoff.mailchimp?.operations ?? []) operations.add(operation);
    for (const capability of contract.capabilities ?? []) {
      if (String(capability.name ?? "").startsWith("mailchimp.")) capabilities.add(capability.name);
    }
    for (const memory of contract.memory ?? []) {
      if (memory.retention === "persistent" || memory.mode === "persistent") externalState.add(memory.name);
    }
  }

  const diagnosticProvider = diagnostics.providerContracts?.mailchimp ?? null;
  for (const state of diagnosticProvider?.externalState ?? []) externalState.add(state);
  for (const capability of diagnosticProvider?.capabilities ?? []) capabilities.add(capability);

  return Object.freeze({
    protocol: "aios.language.ast.provider-preview.v1",
    provider: "mailchimp",
    detected: mailchimpContracts.length > 0 || diagnosticProvider != null,
    operations: Object.freeze([...operations].sort()),
    capabilities: Object.freeze([...capabilities].sort()),
    externalState: Object.freeze([...externalState].sort()),
    syncMetadata: Object.freeze({
      requiresLedger: diagnosticProvider?.syncMetadata.requiresLedger === true
        || mailchimpContracts.some((contract) => contract.handoff.mailchimp?.restartSafe === true),
      requiresCheckpoint: diagnosticProvider?.syncMetadata.requiresCheckpoint === true
        || mailchimpContracts.some((contract) => contract.handoff.mailchimp?.recovery != null),
      restartSafe: mailchimpContracts.length === 0
        ? diagnosticProvider?.syncMetadata.restartSafe !== false
        : mailchimpContracts.every((contract) => contract.handoff.mailchimp?.restartSafe === true),
    }),
    negotiation: Object.freeze({
      required: diagnosticProvider?.negotiation.required === true
        || mailchimpContracts.some((contract) => contract.handoff.mailchimp?.ready === false),
      modes: Object.freeze(diagnosticProvider?.negotiation.modes ?? []),
    }),
  });
}

function createAcceptanceContract(preview, diagnostics, contracts = []) {
  const missing = new Set();
  for (const contract of contracts) {
    for (const item of contract.handoff.mailchimp?.missing ?? []) missing.add(item);
  }
  if (preview.syncMetadata.requiresLedger && preview.externalState.length === 0) missing.add("sync-ledger");
  if (preview.syncMetadata.requiresCheckpoint && !preview.syncMetadata.restartSafe) missing.add("restart-checkpoint");

  const ready = diagnostics.status.state !== "blocked"
    && (!preview.detected || (preview.syncMetadata.restartSafe && missing.size === 0));

  return Object.freeze({
    protocol: "aios.language.ast.acceptance.v1",
    required: preview.detected,
    ready,
    accepted: ready && preview.negotiation.required !== true,
    gates: Object.freeze({
      diagnosticsClear: diagnostics.status.state !== "blocked",
      restartSafe: preview.syncMetadata.restartSafe,
      externalStateMapped: missing.size === 0,
      providerNegotiated: preview.negotiation.required !== true,
    }),
    missing: Object.freeze([...missing].sort()),
    nextAction: diagnostics.status.state === "blocked"
      ? diagnostics.status.nextAction
      : missing.size > 0
        ? "map-mailchimp-external-state"
        : preview.negotiation.required
          ? "accept-mailchimp-provider-contract"
          : "compile-runtime-handoff",
  });
}

function createValidationSummary(diagnostics, contracts = [], acceptance) {
  const contractCount = contracts.length;
  const mailchimpCount = contracts.filter((contract) => contract.handoff.mailchimp).length;

  return Object.freeze({
    protocol: "aios.language.ast.validation-summary.v1",
    ok: diagnostics.summary.ok && acceptance.ready,
    diagnostics: diagnostics.summary.counts,
    contracts: Object.freeze({
      total: contractCount,
      mailchimp: mailchimpCount,
      exportReady: contracts.filter((contract) => contract.exportState.ready === true).length,
    }),
    readiness: Object.freeze({
      previewReady: acceptance.ready,
      acceptanceRequired: acceptance.required,
      providerNegotiationPending: acceptance.gates.providerNegotiated === false,
    }),
    nextSteps: Object.freeze([
      acceptance.nextAction,
      ...(acceptance.ready ? ["review-generated-kernel-contracts"] : ["resolve-preview-readiness"]),
    ]),
  });
}

function createClientRuntimeState(providerPreview, acceptance, diagnostics, contracts = []) {
  const diagnosticPreview = diagnostics.preview ?? Object.freeze({});
  const providerReadiness = diagnosticPreview.readiness ?? Object.freeze({});
  const commandEnabled = new Set(diagnosticPreview.commandControls?.enabled ?? []);
  const commandDisabled = new Set(diagnosticPreview.commandControls?.disabled ?? []);
  const routeParams = new Set(["sourceName"]);
  const persistedState = new Set(providerPreview.externalState ?? []);
  const capabilityScopes = new Map();

  for (const contract of contracts) {
    routeParams.add("descriptorId");
    for (const capability of contract.capabilities ?? []) {
      const provider = providerFromAdapter(capability.name);
      if (provider !== "mailchimp") continue;
      const scopes = capabilityScopes.get(capability.name) ?? new Set();
      scopes.add(capability.scope ?? "use");
      capabilityScopes.set(capability.name, scopes);
    }
    for (const memory of contract.memory ?? []) {
      if (memory.retention === "persistent" || memory.mode === "persistent") persistedState.add(memory.name);
    }
  }

  if (providerPreview.detected) {
    routeParams.add("provider");
    if (providerPreview.syncMetadata.requiresLedger) routeParams.add("ledgerKey");
    if (providerPreview.syncMetadata.requiresCheckpoint) routeParams.add("checkpointRef");
  }

  const blockedBy = [
    ...(diagnostics.status.state === "blocked" ? ["diagnostics"] : []),
    ...(acceptance.gates.restartSafe ? [] : ["restart-safety"]),
    ...(acceptance.gates.externalStateMapped ? [] : ["external-state"]),
    ...(acceptance.gates.providerNegotiated ? [] : ["provider-acceptance"]),
  ];

  const workflowState = diagnostics.status.state === "blocked"
    ? "blocked"
    : blockedBy.length > 0
      ? "needs-user-action"
      : acceptance.accepted
        ? "ready-for-compile"
        : "ready-for-acceptance";

  return Object.freeze({
    protocol: "aios.language.ast.client-runtime.v1",
    provider: providerPreview.provider,
    detected: providerPreview.detected,
    state: workflowState,
    routeHandoff: Object.freeze({
      route: providerPreview.detected ? "mailchimp.runtime.preview" : "runtime.preview",
      params: Object.freeze([...routeParams].sort()),
      statusCode: workflowState === "blocked" ? 409 : workflowState === "needs-user-action" ? 422 : 200,
      cacheKeyParts: Object.freeze([
        diagnostics.sourceName,
        providerPreview.provider,
        diagnostics.status.state,
        acceptance.nextAction,
      ].filter(Boolean)),
    }),
    persistedState: Object.freeze({
      required: Object.freeze([...persistedState].sort()),
      restartSafe: providerPreview.syncMetadata.restartSafe === true,
      missing: acceptance.missing,
    }),
    capabilities: freezeArray([...capabilityScopes.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, scopes]) => ({
      name,
      scopes: Object.freeze([...scopes].sort()),
      accepted: acceptance.gates.providerNegotiated === true,
    }))),
    ui: Object.freeze({
      title: diagnosticPreview.title ?? (providerPreview.detected ? "Mailchimp runtime handoff" : "AI OS runtime handoff"),
      primaryAction: diagnosticPreview.nextSteps?.[0] ?? Object.freeze({
        id: acceptance.nextAction,
        label: acceptance.nextAction,
        enabled: diagnostics.status.state !== "blocked",
        reason: "Continue runtime handoff.",
        requiredData: Object.freeze([]),
      }),
      blockedBy: Object.freeze(blockedBy),
      enabledCommands: Object.freeze([...commandEnabled, ...(acceptance.ready ? ["compileRuntimeHandoff"] : [])]
        .filter((value, index, list) => value && list.indexOf(value) === index)
        .sort()),
      disabledCommands: Object.freeze([...commandDisabled, ...(acceptance.ready ? [] : ["compileRuntimeHandoff"])]
        .filter((value, index, list) => value && list.indexOf(value) === index)
        .sort()),
    }),
    acceptance: Object.freeze({
      required: acceptance.required,
      accepted: acceptance.accepted,
      ready: acceptance.ready,
      providerReady: providerReadiness.ready === true,
      nextAction: acceptance.nextAction,
    }),
  });
}

function createAstStatus(diagnostics, lowered) {
  const blockedContracts = lowered.contracts.filter((contract) => contract.exportState.ready !== true);
  const mailchimpContracts = lowered.contracts.filter((contract) => contract.handoff.mailchimp);
  const needsRecovery = mailchimpContracts.some((contract) => contract.handoff.mailchimp?.restartSafe === false);
  const acceptanceReady = lowered.acceptance?.ready !== false;

  return Object.freeze({
    protocol: "aios.language.ast.status.v1",
    state: diagnostics.status.state === "blocked"
      ? "blocked"
      : blockedContracts.length > 0
        ? "review"
        : "ready",
    exportReady: diagnostics.status.state !== "blocked" && blockedContracts.length === 0,
    adapterRecoveryReady: !needsRecovery && acceptanceReady,
    nextAction: diagnostics.status.state === "blocked"
      ? diagnostics.status.nextAction
      : needsRecovery
        ? "add-mailchimp-restart-checkpoint"
        : !acceptanceReady
          ? lowered.acceptance?.nextAction ?? "complete-provider-acceptance"
        : blockedContracts.length > 0
          ? "complete-runtime-contracts"
          : "compile-runtime-handoff",
  });
}

export function buildAstContract(sourceOrAst = "", options = {}) {
  const parsed = typeof sourceOrAst === "string"
    ? parseAiosSource(sourceOrAst, options)
    : Object.freeze({
        ast: sourceOrAst,
        diagnostics: Object.freeze([]),
        summary: Object.freeze({ ok: true }),
        sourceMap: options.sourceMap ?? null,
      });
  const diagnostics = createDiagnosticEnvelope(parsed.diagnostics ?? [], options);
  const lowered = diagnostics.summary.ok
    ? lowerAstToKernelJobDescriptors(parsed.ast, { ...options, sourceMap: parsed.sourceMap })
    : { descriptors: Object.freeze([]), analytics: null, exportSummary: null, historySnapshot: null };
  const contracts = freezeArray((lowered.descriptors ?? []).map(normalizeKernelContract));
  const providerPreview = summarizeProviderPreview(contracts, diagnostics);
  const acceptance = createAcceptanceContract(providerPreview, diagnostics, contracts);
  const validationSummary = createValidationSummary(diagnostics, contracts, acceptance);
  const clientRuntime = createClientRuntimeState(providerPreview, acceptance, diagnostics, contracts);
  const status = createAstStatus(diagnostics, { ...lowered, contracts, acceptance });

  return Object.freeze({
    protocol: "aios.language.ast.contract.v1",
    sourceName: text(options.sourceName ?? options.fileName, "inline.aios"),
    ast: parsed.ast,
    diagnostics,
    contracts,
    status,
    preview: Object.freeze({
      protocol: "aios.language.ast.preview.v1",
      provider: providerPreview,
      acceptance,
      validationSummary,
      clientRuntime,
      userVisible: Object.freeze({
        title: providerPreview.detected ? "Mailchimp runtime handoff" : "AI OS runtime handoff",
        state: status.state,
        nextAction: acceptance.nextAction,
        externalState: providerPreview.externalState,
        primaryAction: clientRuntime.ui.primaryAction,
        route: clientRuntime.routeHandoff,
      }),
    }),
    analytics: lowered.analytics ?? null,
    exportSummary: lowered.exportSummary ?? null,
    historySnapshot: lowered.historySnapshot ?? null,
    generatedMap: lowered.generatedMap ?? null,
  });
}

export function extractKernelContracts(astContract = {}) {
  return Object.freeze({
    protocol: "aios.language.kernel-contracts.v1",
    sourceName: astContract.sourceName ?? "inline.aios",
    exportReady: astContract.status?.exportReady === true,
    acceptance: astContract.preview?.acceptance ?? null,
    clientRuntime: astContract.preview?.clientRuntime ?? null,
    contracts: freezeArray((astContract.contracts ?? []).map((contract) => ({
      id: contract.id,
      capabilities: contract.capabilities,
      memory: contract.memory,
      verifier: contract.verifier,
      adapterHandoff: contract.handoff,
      lifecycle: contract.lifecycle,
    }))),
  });
}

export function assertAstApiReady() {
  const source = [
    "job syncMailchimp {",
    "capability mailchimp.contacts: read @external;",
    "memory ledger: persistent;",
    "step sync uses mailchimp.fetchAudience(list: \"primary\") writes [ledger] recover ledger;",
    "verify ledger exists;",
    "truth mailchimpApi: source=\"adapter\", confidence=\"reported\";",
    "}",
  ].join("\n");
  const contract = buildAstContract(source, { namespace: "selfcheck" });

  return Object.freeze({
    ok: contract.contracts.length === 1 && contract.contracts[0].handoff.mailchimp?.restartSafe === true,
    protocol: contract.protocol,
    previewReady: contract.preview.acceptance.ready,
  });
}
