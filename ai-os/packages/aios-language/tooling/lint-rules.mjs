import {
  COMPLETION_MODEL_VERSION,
  BOOLEAN_CONTROL_VALUES,
  CONTRACT_KEYWORDS,
  LIFECYCLE_COMMANDS,
  STATUS_HANDOFF_STATES,
  buildCompletionPreviewContract,
  buildLifecycleControlState,
  buildProviderServiceContractState,
  normalizeCompletionSource,
  tokenizeAiosSource,
} from "./completion-model.mjs";

export const LINT_RULES_VERSION = "aios-language.lint-rules.v1";

export const LINT_RULE_IDS = Object.freeze({
  missingJob: "aios/missing-job-contract",
  missingStatus: "aios/missing-status-handoff",
  unknownStatus: "aios/unknown-status-handoff",
  recoveryTransition: "aios/recovery-transition-required",
  verifierClaim: "aios/verifier-claim-pair",
  capabilityBinding: "aios/capability-binding-required",
  providerContract: "aios/provider-contract-required",
  invalidControlValue: "aios/invalid-lifecycle-control-value",
  disabledHandoff: "aios/disabled-provider-handoff",
  nextActionMismatch: "aios/next-action-mismatch",
  providerCapabilityNegotiation: "aios/provider-capability-negotiation",
  providerSyncMetadata: "aios/provider-sync-metadata",
  providerRestartHandoff: "aios/provider-restart-handoff",
  clientRuntimeAdoption: "aios/client-runtime-adoption",
  clientPreviewAcceptance: "aios/client-preview-acceptance",
  clientRuntimePersistence: "aios/client-runtime-persistence",
  clientRuntimeIdempotency: "aios/client-runtime-idempotency",
});

const SEVERITY = Object.freeze({
  error: "error",
  warning: "warning",
});

function diagnostic(ruleId, severity, message, line = 1, data = {}) {
  return Object.freeze({
    ruleId,
    severity,
    message,
    line,
    data,
    source: LINT_RULES_VERSION,
  });
}

function collectClauses(source) {
  const clauses = [];
  const pattern = /\b(job|capability|memory|verifier|claim|adapter|recovery)\s+([A-Za-z0-9_.-]+)?\s*\{([^}]*)\}/gms;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const body = match[3] ?? "";
    const fields = {};

    for (const field of body.matchAll(/\b([A-Za-z][A-Za-z0-9_.-]*)\s*:\s*([^\n#]+)/g)) {
      fields[field[1]] = field[2].trim();
    }

    clauses.push({
      type: match[1],
      name: match[2] ?? "",
      body,
      fields,
      line: source.slice(0, match.index).split("\n").length,
    });
  }

  return clauses;
}

function hasKeyword(source, keyword) {
  return new RegExp(`\\b${keyword}\\b`).test(source);
}

function normalizeField(value, fallback = "") {
  return String(value ?? fallback).trim().toLowerCase();
}

function expectedServiceForProvider(provider) {
  if (provider === "mailchimp") {
    return "campaign-sync";
  }

  if (provider === "generic") {
    return "external-sync";
  }

  return "";
}

export function buildProviderHandoffState(source = "", options = {}) {
  const normalized = normalizeCompletionSource(source);
  const clauses = collectClauses(normalized);
  const adapters = clauses.filter((clause) => clause.type === "adapter");
  const jobs = clauses.filter((clause) => clause.type === "job");
  const lifecycle = buildLifecycleControlState(normalized, options);
  const providerContracts = buildProviderServiceContractState(normalized, options);
  const adapterStates = adapters.map((adapter) => {
    const provider = normalizeField(adapter.fields.provider, options.provider);
    const service = normalizeField(adapter.fields.service, options.service);
    const enabled = normalizeField(adapter.fields.enabled, "true");
    const sync = normalizeField(adapter.fields.sync, "pending");
    const schedule = normalizeField(adapter.fields.schedule, "manual");
    const expectedService = expectedServiceForProvider(provider);
    const serviceContract = providerContracts.providers.find((item) => item.name === adapter.name)
      ?? providerContracts.providers.find((item) => item.provider === provider)
      ?? null;
    const missing = [
      provider ? null : "provider",
      service ? null : "service",
      adapter.fields.handoff ? null : "handoff",
    ].filter(Boolean);

    return Object.freeze({
      name: adapter.name,
      line: adapter.line,
      provider,
      service,
      expectedService,
      enabled,
      sync,
      schedule,
      handoff: normalizeField(adapter.fields.handoff, ""),
      nextAction: normalizeField(adapter.fields.nextAction, lifecycle.nextAction),
      missing,
      contract: serviceContract
        ? Object.freeze({
          requiredAdapterFields: serviceContract.requiredAdapterFields,
          missingAdapterFields: serviceContract.missingAdapterFields,
          syncMetadata: serviceContract.syncMetadata,
          missingSyncMetadata: serviceContract.missingSyncMetadata,
          requiredScopes: serviceContract.requiredScopes,
          acceptedScopes: serviceContract.acceptedScopes,
          missingScopes: serviceContract.missingScopes,
          negotiation: serviceContract.negotiation,
          externalHandoff: serviceContract.externalHandoff,
        })
        : null,
      ready: missing.length === 0
        && enabled !== "false"
        && (!expectedService || service === expectedService),
    });
  });

  return Object.freeze({
    version: LINT_RULES_VERSION,
    completionModelVersion: COMPLETION_MODEL_VERSION,
    lifecycle,
    providerContracts,
    adapters: Object.freeze(adapterStates),
    providerCount: new Set(adapterStates.map((adapter) => adapter.provider).filter(Boolean)).size,
    hasProviderBackedJob: jobs.some((job) => Boolean(job.fields.adapter || job.fields.capability))
      && adapterStates.some((adapter) => adapter.ready),
  });
}

function buildClientRuntimeAdoptionState(source, options, providerHandoff) {
  const preview = buildCompletionPreviewContract(source, options);
  const handoff = preview.clientRuntimeHandoff;
  const adapterReadiness = providerHandoff.adapters.map((adapter) => {
    const previewProvider = preview.providers.find((provider) => provider.provider === adapter.provider)
      ?? preview.providers.find((provider) => provider.title === adapter.name)
      ?? null;
    const runtimeProvider = handoff.providers.find((provider) => provider.provider === adapter.provider)
      ?? handoff.providers.find((provider) => provider.name === adapter.name)
      ?? null;
    const clientState = adapter.ready && previewProvider?.readiness === "resume-ready"
      ? "adoptable"
      : adapter.ready
        ? "contract-ready"
        : adapter.enabled === "false"
          ? "disabled"
          : "needs-repair";

    return Object.freeze({
      adapter: adapter.name,
      provider: adapter.provider,
      service: adapter.service,
      line: adapter.line,
      clientState,
      handoffReady: adapter.ready,
      previewReadiness: previewProvider?.readiness ?? "missing-preview",
      missing: Object.freeze([
        ...adapter.missing.map((field) => `adapter.${field}`),
        ...(adapter.contract?.missingAdapterFields ?? []).map((field) => `contract.${field}`),
        ...(adapter.contract?.missingSyncMetadata ?? []).map((field) => `sync.${field}`),
        ...(adapter.contract?.missingScopes ?? []).map((scope) => `scope.${scope}`),
      ]),
      externalHandoff: adapter.contract?.externalHandoff ?? null,
      runtimeHandoff: runtimeProvider,
      nextAction: previewProvider?.nextAction ?? adapter.nextAction,
    });
  });
  const adoptionReady = preview.validationSummary.readyForAcceptance
    && adapterReadiness.length > 0
    && adapterReadiness.every((adapter) => adapter.clientState === "adoptable" || adapter.clientState === "contract-ready");
  const runtimeDataContract = Object.freeze({
    protocol: "aios.language.mailchimp-client-runtime-contract.v1",
    source: LINT_RULES_VERSION,
    previewProtocol: preview.protocol,
    completionAcceptanceProtocol: preview.acceptance.protocol,
    adoptionReady,
    previewState: preview.state,
    acceptance: preview.acceptance,
    clientRuntimeHandoff: handoff,
    providerCount: adapterReadiness.length,
    resumableHandoffs: providerHandoff.providerContracts.resumableHandoffs,
    requiredClientFields: Object.freeze([
      "provider",
      "service",
      "enabled",
      "sync",
      "nextAction",
      "externalHandoff",
      "idempotencyKey",
      "restartToken",
      "persistence",
    ]),
  });
  const persistedState = Object.freeze({
    protocol: "aios.language.mailchimp-client-runtime-persisted-state.v1",
    state: handoff.state,
    accepted: handoff.accepted,
    persistenceKey: handoff.persistence.key,
    writeMode: handoff.persistence.writeMode,
    idempotent: handoff.persistence.idempotent,
    restartSafe: handoff.persistence.restartSafe,
    clientRequestIdempotencyKey: handoff.clientRequest.idempotencyKey,
    providerSnapshots: Object.freeze(handoff.providers.map((provider) => Object.freeze({
      provider: provider.provider,
      service: provider.service,
      handoffId: provider.handoffId,
      idempotencyKey: provider.idempotencyKey,
      restartToken: provider.restartToken,
      state: provider.state,
      sync: provider.sync,
      accepted: provider.accepted,
      publishable: provider.publishable,
      externalStatusField: provider.externalStatusField,
      externalStatusValue: provider.externalStatusValue,
      nextAction: provider.nextAction,
    }))),
    recoveryCommands: Object.freeze(handoff.providers.map((provider) => Object.freeze({
      id: `recover-${provider.provider || provider.name || "provider"}-handoff`,
      command: "aios.mailchimp.clientRuntime.recoverHandoff",
      enabled: provider.state !== "blocked" && Boolean(provider.restartToken || provider.externalStatusValue),
      idempotencyKey: provider.idempotencyKey,
      restartToken: provider.restartToken,
      nextAction: provider.nextAction,
    }))),
  });
  const handoffSteps = Object.freeze([
    ...preview.nextSteps.map((step, index) => Object.freeze({
      ordinal: index + 1,
      id: step.id,
      command: step.command,
      fields: step.fields,
      nextAction: step.nextAction,
      source: "completion-preview",
    })),
    ...(adoptionReady
      ? [Object.freeze({
        ordinal: preview.nextSteps.length + 1,
        id: "publish-client-runtime-handoff",
        command: "aios.mailchimp.clientRuntime.publishHandoff",
        fields: Object.freeze(["clientRuntimeHandoff", "persistence", "idempotencyKey", "nextAction"]),
        nextAction: preview.acceptance.nextAction,
        source: "lint-runtime-adoption",
      })]
      : []),
  ]);

  return Object.freeze({
    protocol: "aios.language.mailchimp-client-runtime-adoption.v1",
    state: adoptionReady
      ? "adoptable"
      : preview.state === "disabled"
        ? "disabled"
        : adapterReadiness.length === 0
          ? "needs-adapter"
          : "needs-repair",
    adoptionReady,
    preview,
    adapters: Object.freeze(adapterReadiness),
    runtimeDataContract,
    persistedState,
    handoffSteps,
    nextAction: adoptionReady
      ? "publish-client-runtime-handoff"
      : handoffSteps[0]?.nextAction || preview.acceptance.nextAction,
  });
}

export function lintAiosSource(source = "", options = {}) {
  const normalized = normalizeCompletionSource(source);
  const diagnostics = [];
  const clauses = collectClauses(normalized);
  const jobs = clauses.filter((clause) => clause.type === "job");
  const claims = clauses.filter((clause) => clause.type === "claim");
  const verifiers = clauses.filter((clause) => clause.type === "verifier");
  const capabilities = clauses.filter((clause) => clause.type === "capability");
  const recoveries = clauses.filter((clause) => clause.type === "recovery");
  const providerHandoff = buildProviderHandoffState(normalized, options);
  const clientRuntimeAdoption = buildClientRuntimeAdoptionState(normalized, options, providerHandoff);

  if (jobs.length === 0) {
    diagnostics.push(diagnostic(
      LINT_RULE_IDS.missingJob,
      SEVERITY.error,
      "source must declare at least one job contract for kernel scheduling",
    ));
  }

  for (const job of jobs) {
    if (!job.fields.status) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.missingStatus,
        SEVERITY.error,
        `job ${job.name || "<anonymous>"} must declare a status handoff state`,
        job.line,
        { job: job.name },
      ));
    } else if (!STATUS_HANDOFF_STATES.includes(job.fields.status)) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.unknownStatus,
        SEVERITY.error,
        `job ${job.name || "<anonymous>"} uses unsupported status handoff "${job.fields.status}"`,
        job.line,
        { status: job.fields.status, allowed: [...STATUS_HANDOFF_STATES] },
      ));
    }

    if (!job.fields.capability && capabilities.length === 0) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.capabilityBinding,
        SEVERITY.warning,
        `job ${job.name || "<anonymous>"} has no capability binding`,
        job.line,
        { job: job.name },
      ));
    }
  }

  for (const recovery of recoveries) {
    if (!recovery.fields.from || !recovery.fields.to) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.recoveryTransition,
        SEVERITY.error,
        `recovery ${recovery.name || "<anonymous>"} must declare from/to status transitions`,
        recovery.line,
        { recovery: recovery.name },
      ));
      continue;
    }

    for (const fieldName of ["from", "to"]) {
      if (!STATUS_HANDOFF_STATES.includes(recovery.fields[fieldName])) {
        diagnostics.push(diagnostic(
          LINT_RULE_IDS.unknownStatus,
          SEVERITY.error,
          `recovery ${recovery.name || "<anonymous>"} uses unsupported ${fieldName} status "${recovery.fields[fieldName]}"`,
          recovery.line,
          { status: recovery.fields[fieldName], allowed: [...STATUS_HANDOFF_STATES] },
        ));
      }
    }
  }

  for (const adapter of providerHandoff.adapters) {
    if (adapter.missing.length > 0) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.providerContract,
        SEVERITY.error,
        `adapter ${adapter.name || "<anonymous>"} must declare provider/service/handoff for external sync handoff`,
        adapter.line,
        { adapter: adapter.name, missing: adapter.missing },
      ));
    }

    if (adapter.provider === "mailchimp" && adapter.expectedService && adapter.service !== adapter.expectedService) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.providerContract,
        SEVERITY.error,
        `adapter ${adapter.name || "<anonymous>"} must use service "${adapter.expectedService}" for Mailchimp sync`,
        adapter.line,
        { adapter: adapter.name, provider: adapter.provider, service: adapter.service },
      ));
    }

    if (adapter.enabled && !BOOLEAN_CONTROL_VALUES.includes(adapter.enabled)) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.invalidControlValue,
        SEVERITY.error,
        `adapter ${adapter.name || "<anonymous>"} enabled must be true or false`,
        adapter.line,
        { adapter: adapter.name, enabled: adapter.enabled, allowed: [...BOOLEAN_CONTROL_VALUES] },
      ));
    }

    if (adapter.sync && !["pending", "ready", "active", "paused", "needs-settings", "failed"].includes(adapter.sync)) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.invalidControlValue,
        SEVERITY.error,
        `adapter ${adapter.name || "<anonymous>"} uses unsupported sync state "${adapter.sync}"`,
        adapter.line,
        { adapter: adapter.name, sync: adapter.sync },
      ));
    }

    if (adapter.enabled === "false" && adapter.sync === "active") {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.disabledHandoff,
        SEVERITY.error,
        `adapter ${adapter.name || "<anonymous>"} cannot keep active sync while disabled`,
        adapter.line,
        { adapter: adapter.name, enabled: adapter.enabled, sync: adapter.sync },
      ));
    }

    if (adapter.nextAction && !LIFECYCLE_COMMANDS.includes(adapter.nextAction)) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.nextActionMismatch,
        SEVERITY.warning,
        `adapter ${adapter.name || "<anonymous>"} nextAction "${adapter.nextAction}" is not a known lifecycle command`,
        adapter.line,
        { adapter: adapter.name, nextAction: adapter.nextAction, allowed: [...LIFECYCLE_COMMANDS] },
      ));
    }

    if (adapter.contract?.missingAdapterFields.length > 0) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.providerContract,
        SEVERITY.error,
        `adapter ${adapter.name || "<anonymous>"} is missing provider contract fields: ${adapter.contract.missingAdapterFields.join(", ")}`,
        adapter.line,
        { adapter: adapter.name, missing: adapter.contract.missingAdapterFields },
      ));
    }

    if (adapter.contract?.negotiation.serviceMatched === false) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.providerContract,
        SEVERITY.error,
        `adapter ${adapter.name || "<anonymous>"} service does not match negotiated ${adapter.provider} contract`,
        adapter.line,
        {
          adapter: adapter.name,
          provider: adapter.provider,
          service: adapter.service,
          expectedService: adapter.expectedService,
        },
      ));
    }

    if (adapter.contract?.missingScopes.length > 0) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.providerCapabilityNegotiation,
        SEVERITY.warning,
        `adapter ${adapter.name || "<anonymous>"} has incomplete ${adapter.provider} capability scope negotiation`,
        adapter.line,
        {
          adapter: adapter.name,
          provider: adapter.provider,
          missingScopes: adapter.contract.missingScopes,
          acceptedScopes: adapter.contract.acceptedScopes,
        },
      ));
    }

    if (adapter.provider === "mailchimp" && adapter.contract?.missingSyncMetadata.length > 0) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.providerSyncMetadata,
        SEVERITY.warning,
        `adapter ${adapter.name || "<anonymous>"} should declare Mailchimp sync metadata for restart-safe handoff`,
        adapter.line,
        {
          adapter: adapter.name,
          missingSyncMetadata: adapter.contract.missingSyncMetadata,
          syncMetadata: adapter.contract.syncMetadata,
        },
      ));
    }

    if (adapter.contract && adapter.sync !== "pending" && !adapter.contract.externalHandoff.canResume) {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.providerRestartHandoff,
        SEVERITY.warning,
        `adapter ${adapter.name || "<anonymous>"} cannot resume external handoff from current sync metadata`,
        adapter.line,
        {
          adapter: adapter.name,
          sync: adapter.sync,
          restartSafe: adapter.contract.externalHandoff.restartSafe,
          statusField: adapter.contract.externalHandoff.statusField,
        },
      ));
    }
  }

  for (const adapter of clientRuntimeAdoption.adapters) {
    if (adapter.clientState === "needs-repair") {
      diagnostics.push(diagnostic(
        LINT_RULE_IDS.clientRuntimeAdoption,
        SEVERITY.warning,
        `adapter ${adapter.adapter || "<anonymous>"} is not ready for client runtime adoption`,
        adapter.line,
        {
          adapter: adapter.adapter,
          provider: adapter.provider,
          missing: adapter.missing,
          previewReadiness: adapter.previewReadiness,
          nextAction: adapter.nextAction,
        },
      ));
    }
  }

  if (!clientRuntimeAdoption.runtimeDataContract.adoptionReady && clientRuntimeAdoption.preview.acceptance.acceptable === false) {
    diagnostics.push(diagnostic(
      LINT_RULE_IDS.clientPreviewAcceptance,
      SEVERITY.warning,
      "completion preview cannot be accepted by route clients until lifecycle and provider handoff are ready",
      clauses[0]?.line ?? 1,
      {
        previewState: clientRuntimeAdoption.preview.state,
        blocking: clientRuntimeAdoption.preview.validationSummary.blocking,
        warnings: clientRuntimeAdoption.preview.validationSummary.warnings,
        nextAction: clientRuntimeAdoption.nextAction,
      },
    ));
  }

  if (clientRuntimeAdoption.persistedState.providerSnapshots.some((provider) => provider.publishable && !provider.idempotencyKey)) {
    diagnostics.push(diagnostic(
      LINT_RULE_IDS.clientRuntimeIdempotency,
      SEVERITY.error,
      "client runtime handoff must expose idempotency keys for every publishable provider",
      clauses[0]?.line ?? 1,
      {
        persistenceKey: clientRuntimeAdoption.persistedState.persistenceKey,
        providers: clientRuntimeAdoption.persistedState.providerSnapshots
          .filter((provider) => provider.publishable && !provider.idempotencyKey)
          .map((provider) => provider.provider),
      },
    ));
  }

  if (
    clientRuntimeAdoption.runtimeDataContract.adoptionReady
    && clientRuntimeAdoption.persistedState.writeMode !== "commit"
    && clientRuntimeAdoption.preview.acceptance.mode === "accept"
  ) {
    diagnostics.push(diagnostic(
      LINT_RULE_IDS.clientRuntimePersistence,
      SEVERITY.warning,
      "accepted client runtime handoff should persist in commit mode before route adoption",
      clauses[0]?.line ?? 1,
      {
        state: clientRuntimeAdoption.persistedState.state,
        writeMode: clientRuntimeAdoption.persistedState.writeMode,
        nextAction: clientRuntimeAdoption.nextAction,
      },
    ));
  }

  if (
    clientRuntimeAdoption.persistedState.state === "accepted"
    && !clientRuntimeAdoption.persistedState.restartSafe
  ) {
    diagnostics.push(diagnostic(
      LINT_RULE_IDS.clientRuntimePersistence,
      SEVERITY.warning,
      "accepted client runtime handoff should be restart-safe before external status publication",
      clauses[0]?.line ?? 1,
      {
        persistenceKey: clientRuntimeAdoption.persistedState.persistenceKey,
        recoveryCommands: clientRuntimeAdoption.persistedState.recoveryCommands
          .filter((command) => command.enabled)
          .map((command) => command.id),
      },
    ));
  }

  if (verifiers.length > 0 && claims.length === 0) {
    diagnostics.push(diagnostic(
      LINT_RULE_IDS.verifierClaim,
      SEVERITY.warning,
      "verifier clauses should be paired with at least one claim clause for truth-boundary evidence",
      verifiers[0].line,
      { verifiers: verifiers.map((clause) => clause.name).filter(Boolean) },
    ));
  }

  const unknownRoots = tokenizeAiosSource(normalized)
    .filter((token) => CONTRACT_KEYWORDS.includes(token.value) === false)
    .filter((token) => /^[A-Za-z][A-Za-z0-9_.-]*$/.test(token.value))
    .filter((token) => !hasKeyword(normalized, `${token.value}:`));

  return Object.freeze({
    version: LINT_RULES_VERSION,
    completionModelVersion: COMPLETION_MODEL_VERSION,
    ok: diagnostics.every((item) => item.severity !== SEVERITY.error),
    diagnostics,
    summary: Object.freeze({
      clauses: clauses.length,
      jobs: jobs.length,
      capabilities: capabilities.length,
      memories: clauses.filter((clause) => clause.type === "memory").length,
      verifiers: verifiers.length,
      claims: claims.length,
      recoveries: recoveries.length,
      unknownIdentifierCount: unknownRoots.length,
      providers: providerHandoff.providerCount,
      handoffReady: providerHandoff.adapters.filter((adapter) => adapter.ready).length,
      negotiatedProviders: providerHandoff.providerContracts.providers
        .filter((provider) => provider.negotiation.ready).length,
      resumableHandoffs: providerHandoff.providerContracts.resumableHandoffs,
      clientRuntimeState: clientRuntimeAdoption.state,
      clientRuntimeAdoptionReady: clientRuntimeAdoption.adoptionReady,
      clientHandoffSteps: clientRuntimeAdoption.handoffSteps.length,
      clientRuntimePersistedState: clientRuntimeAdoption.persistedState.state,
      clientRuntimeRestartSafe: clientRuntimeAdoption.persistedState.restartSafe,
    }),
    providerHandoff,
    clientRuntimeAdoption,
    options: Object.freeze({
      profile: options.profile ?? "kernel-contract",
    }),
  });
}

export function assertAiosLintClean(source = "", options = {}) {
  const result = lintAiosSource(source, options);

  if (result.ok) {
    return result;
  }

  const first = result.diagnostics.find((item) => item.severity === SEVERITY.error) ?? result.diagnostics[0];
  const error = new Error(`${first.ruleId}: ${first.message}`);
  error.diagnostics = result.diagnostics;
  error.lintResult = result;
  throw error;
}

export function selfCheckLintRules() {
  const valid = lintAiosSource("job demo {\n  status: queued\n  capability: mailchimp\n}\ncapability mailchimp {\n  requires: operator-approval\n  scope: campaigns:read,campaigns:write,audiences:read\n}\nadapter mailchimp {\n  provider: mailchimp\n  service: campaign-sync\n  enabled: true\n  handoff: status\n  sync: ready\n  audience: primary-audience\n  externalId: mc-campaign-001\n  cursor: campaign-page-1\n  lastSync: 2026-01-01T00:00:00Z\n}");
  const invalid = lintAiosSource("job demo {\n  status: unknown\n}\nrecovery retry {\n  from: blocked\n}\nadapter mailchimp {\n  provider: mailchimp\n  service: list-sync\n  enabled: maybe\n  handoff: status\n}");

  return Object.freeze({
    ok: valid.ok && !invalid.ok,
    validDiagnostics: valid.diagnostics.length,
    invalidDiagnostics: invalid.diagnostics.length,
    providerCount: valid.summary.providers,
    negotiatedProviders: valid.summary.negotiatedProviders,
    resumableHandoffs: valid.summary.resumableHandoffs,
    clientRuntimeState: valid.summary.clientRuntimeState,
    clientRuntimeAdoptionReady: valid.summary.clientRuntimeAdoptionReady,
    version: LINT_RULES_VERSION,
  });
}
