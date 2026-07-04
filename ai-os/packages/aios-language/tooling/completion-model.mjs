export const COMPLETION_MODEL_VERSION = "aios-language.completion-model.v1";

export const CONTRACT_KEYWORDS = Object.freeze([
  "job",
  "capability",
  "memory",
  "verifier",
  "claim",
  "adapter",
  "recovery",
  "status",
]);

export const STATUS_HANDOFF_STATES = Object.freeze([
  "queued",
  "running",
  "blocked",
  "recovering",
  "verified",
  "failed",
]);

export const LIFECYCLE_COMMANDS = Object.freeze([
  "prepare",
  "enable",
  "disable",
  "schedule",
  "sync",
  "verify",
  "recover",
]);

export const LIFECYCLE_SETTINGS_FIELDS = Object.freeze([
  "enabled",
  "audience",
  "provider",
  "service",
  "sync",
  "schedule",
  "timezone",
  "cadence",
  "cursor",
  "externalId",
  "lastSync",
  "nextAction",
]);

export const SCHEDULING_CONTROL_FIELDS = Object.freeze([
  "enabled",
  "cadence",
  "timezone",
  "window",
  "retry",
  "nextRun",
]);

export const BOOLEAN_CONTROL_VALUES = Object.freeze(["true", "false"]);

export const CLIENT_RUNTIME_HANDOFF_FIELDS = Object.freeze([
  "handoffId",
  "provider",
  "service",
  "state",
  "sync",
  "externalStatusField",
  "externalStatusValue",
  "idempotencyKey",
  "restartToken",
  "nextAction",
]);

export const CLAUSE_SNIPPETS = Object.freeze({
  job: "job <name> {\n  status: queued\n  capability: <capability-name>\n}",
  capability: "capability <name> {\n  requires: operator-approval\n}",
  memory: "memory <name> {\n  mount: workspace\n  access: read\n}",
  verifier: "verifier <name> {\n  expects: claim.<name>\n}",
  claim: "claim <name> {\n  source: verifier.<name>\n}",
  adapter: "adapter <name> {\n  provider: mailchimp\n  service: campaign-sync\n  enabled: true\n  handoff: status\n  sync: pending\n}",
  recovery: "recovery <name> {\n  from: blocked\n  to: recovering\n}",
  status: "status: queued",
  enabled: "enabled: true",
  schedule: "schedule: manual",
  nextAction: "nextAction: configure-settings",
});

const CONTEXT_TRIGGERS = Object.freeze({
  "job.": ["status", "capability", "memory", "verifier", "claim", "adapter", "recovery"],
  "capability.": ["requires", "scope", "reason"],
  "memory.": ["mount", "access", "retention"],
  "verifier.": ["expects", "evidence", "timeout"],
  "claim.": ["source", "truthBoundary", "confidence"],
  "adapter.": ["provider", "service", "enabled", "handoff", "sync", "schedule", "timezone", "nextAction", "recovery", "status"],
  "recovery.": ["from", "to", "strategy"],
  "status:": STATUS_HANDOFF_STATES,
  "enabled:": BOOLEAN_CONTROL_VALUES,
  "schedule:": ["manual", "hourly", "daily", "paused"],
  "sync:": ["pending", "ready", "active", "paused", "needs-settings", "failed"],
  "service:": ["campaign-sync", "external-sync"],
});

export const PROVIDER_SERVICE_CONTRACTS = Object.freeze({
  mailchimp: Object.freeze({
    service: "campaign-sync",
    requiredAdapterFields: Object.freeze(["provider", "service", "handoff", "sync", "audience"]),
    syncMetadataFields: Object.freeze(["audience", "cursor", "externalId", "lastSync"]),
    capabilityScopes: Object.freeze(["campaigns:read", "campaigns:write", "audiences:read"]),
    readySyncStates: Object.freeze(["ready", "active"]),
    restartSafeSyncStates: Object.freeze(["ready", "paused", "failed"]),
    externalStatusField: "externalId",
  }),
  generic: Object.freeze({
    service: "external-sync",
    requiredAdapterFields: Object.freeze(["provider", "service", "handoff", "sync"]),
    syncMetadataFields: Object.freeze(["cursor", "externalId", "lastSync"]),
    capabilityScopes: Object.freeze(["external:read"]),
    readySyncStates: Object.freeze(["ready", "active"]),
    restartSafeSyncStates: Object.freeze(["ready", "paused", "failed"]),
    externalStatusField: "externalId",
  }),
});

export function normalizeCompletionSource(source = "") {
  return String(source).replace(/\r\n?/g, "\n");
}

export function tokenizeAiosSource(source = "") {
  const normalized = normalizeCompletionSource(source);
  const tokens = [];
  const matcher = /[A-Za-z_][A-Za-z0-9_.-]*|[{}:[\],]/g;
  let match;

  while ((match = matcher.exec(normalized)) !== null) {
    tokens.push({
      value: match[0],
      offset: match.index,
      line: normalized.slice(0, match.index).split("\n").length,
    });
  }

  return tokens;
}

export function detectCompletionContext(source = "", cursorOffset = source.length) {
  const normalized = normalizeCompletionSource(source);
  const boundedOffset = Math.max(0, Math.min(Number(cursorOffset) || 0, normalized.length));
  const prefix = normalized.slice(0, boundedOffset);
  const tail = prefix.slice(-80).toLowerCase();
  const openClause = [...prefix.matchAll(/\b(job|capability|memory|verifier|claim|adapter|recovery)\b[^{]*\{?/g)]
    .at(-1)?.[1] ?? null;

  for (const [trigger, values] of Object.entries(CONTEXT_TRIGGERS)) {
    if (tail.endsWith(trigger)) {
      return {
        kind: "member",
        trigger,
        clause: trigger.slice(0, -1),
        values: [...values],
      };
    }
  }

  if (/\bstatus\s*:\s*[A-Za-z-]*$/i.test(tail)) {
    return {
      kind: "status",
      trigger: "status:",
      clause: openClause,
      values: [...STATUS_HANDOFF_STATES],
    };
  }

  if (/\benabled\s*:\s*[A-Za-z-]*$/i.test(tail)) {
    return {
      kind: "control-value",
      trigger: "enabled:",
      clause: openClause,
      values: [...BOOLEAN_CONTROL_VALUES],
    };
  }

  if (/\bschedule\s*:\s*[A-Za-z-]*$/i.test(tail)) {
    return {
      kind: "control-value",
      trigger: "schedule:",
      clause: openClause,
      values: [...CONTEXT_TRIGGERS["schedule:"]],
    };
  }

  if (/\bsync\s*:\s*[A-Za-z-]*$/i.test(tail)) {
    return {
      kind: "control-value",
      trigger: "sync:",
      clause: openClause,
      values: [...CONTEXT_TRIGGERS["sync:"]],
    };
  }

  if (openClause) {
    return {
      kind: "clause-body",
      trigger: openClause,
      clause: openClause,
      values: [...(CONTEXT_TRIGGERS[`${openClause}.`] ?? [])],
    };
  }

  return {
    kind: "root",
    trigger: "",
    clause: null,
    values: [...CONTRACT_KEYWORDS],
  };
}

function completionItem(label, detail, insertText = label, rank = 50) {
  return Object.freeze({
    label,
    detail,
    insertText,
    rank,
    source: COMPLETION_MODEL_VERSION,
  });
}

function collectContractBlocks(source) {
  const normalized = normalizeCompletionSource(source);
  const blocks = [];
  const pattern = /\b(job|capability|memory|verifier|claim|adapter|recovery)\s+([A-Za-z0-9_.-]+)?\s*\{([^}]*)\}/gms;
  let match;

  while ((match = pattern.exec(normalized)) !== null) {
    const fields = {};
    const body = match[3] ?? "";

    for (const field of body.matchAll(/\b([A-Za-z][A-Za-z0-9_.-]*)\s*:\s*([^\n#]+)/g)) {
      fields[field[1]] = field[2].trim();
    }

    blocks.push(Object.freeze({
      type: match[1],
      name: match[2] ?? "",
      fields: Object.freeze(fields),
      line: normalized.slice(0, match.index).split("\n").length,
    }));
  }

  return blocks;
}

function normalizeControlValue(value, fallback = "") {
  return String(value ?? fallback).trim().toLowerCase();
}

function normalizeProviderValue(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function collectDelimitedValues(value) {
  return String(value ?? "")
    .split(/[,\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function providerContractFor(provider, service = "") {
  const normalizedProvider = normalizeControlValue(provider);
  const known = PROVIDER_SERVICE_CONTRACTS[normalizedProvider];

  if (known) {
    return known;
  }

  if (service) {
    return Object.freeze({
      service,
      requiredAdapterFields: Object.freeze(["provider", "service", "handoff", "sync"]),
      syncMetadataFields: Object.freeze(["cursor", "externalId", "lastSync"]),
      capabilityScopes: Object.freeze([]),
      readySyncStates: Object.freeze(["ready", "active"]),
      restartSafeSyncStates: Object.freeze(["ready", "paused", "failed"]),
      externalStatusField: "externalId",
    });
  }

  return null;
}

function lifecycleActionForState({ enabled, schedule, status, sync, missingSettings }) {
  if (missingSettings.length > 0) {
    return "configure-settings";
  }

  if (enabled === "false") {
    return "enable";
  }

  if (schedule === "paused" || sync === "paused") {
    return "schedule";
  }

  if (status === "blocked" || status === "failed" || sync === "failed") {
    return "recover";
  }

  if (status === "verified" && sync === "ready") {
    return "sync";
  }

  if (status === "running" || sync === "active") {
    return "verify";
  }

  return "prepare";
}

export function buildLifecycleControlState(source = "", options = {}) {
  const blocks = collectContractBlocks(source);
  const jobs = blocks.filter((block) => block.type === "job");
  const adapters = blocks.filter((block) => block.type === "adapter");
  const primaryJob = jobs[0] ?? null;
  const primaryAdapter = adapters[0] ?? null;
  const fields = Object.freeze({
    enabled: normalizeControlValue(primaryAdapter?.fields.enabled, "true"),
    schedule: normalizeControlValue(primaryAdapter?.fields.schedule, "manual"),
    status: normalizeControlValue(primaryJob?.fields.status, "queued"),
    sync: normalizeControlValue(primaryAdapter?.fields.sync, "pending"),
    provider: normalizeControlValue(primaryAdapter?.fields.provider, options.provider ?? ""),
    service: normalizeControlValue(primaryAdapter?.fields.service, options.service ?? ""),
    timezone: String(primaryAdapter?.fields.timezone ?? options.timezone ?? "UTC"),
  });
  const missingSettings = [
    fields.provider ? null : "provider",
    fields.service ? null : "service",
    fields.schedule === "manual" || fields.timezone ? null : "timezone",
  ].filter(Boolean);
  const nextAction = lifecycleActionForState({ ...fields, missingSettings });

  return Object.freeze({
    version: COMPLETION_MODEL_VERSION,
    commands: [...LIFECYCLE_COMMANDS],
    settingsFields: [...LIFECYCLE_SETTINGS_FIELDS],
    schedulingFields: [...SCHEDULING_CONTROL_FIELDS],
    controls: fields,
    missingSettings,
    nextAction,
    enabled: fields.enabled !== "false",
    handoffReady: missingSettings.length === 0 && fields.enabled !== "false",
    sourceShape: Object.freeze({
      jobs: jobs.length,
      adapters: adapters.length,
      hasRecovery: blocks.some((block) => block.type === "recovery"),
    }),
  });
}

export function buildProviderServiceContractState(source = "", options = {}) {
  const blocks = collectContractBlocks(source);
  const adapters = blocks.filter((block) => block.type === "adapter");
  const capabilities = blocks.filter((block) => block.type === "capability");
  const lifecycle = buildLifecycleControlState(source, options);
  const providerStates = adapters.map((adapter) => {
    const provider = normalizeControlValue(adapter.fields.provider, options.provider ?? "");
    const service = normalizeControlValue(adapter.fields.service, options.service ?? "");
    const contract = providerContractFor(provider, service);
    const requiredAdapterFields = contract ? [...contract.requiredAdapterFields] : ["provider", "service", "handoff", "sync"];
    const missingAdapterFields = requiredAdapterFields.filter((field) => !normalizeProviderValue(adapter.fields[field]));
    const syncMetadataFields = contract ? [...contract.syncMetadataFields] : [];
    const syncMetadata = Object.freeze(Object.fromEntries(syncMetadataFields.map((field) => [
      field,
      normalizeProviderValue(adapter.fields[field]),
    ])));
    const missingSyncMetadata = syncMetadataFields.filter((field) => !syncMetadata[field]);
    const declaredScopes = new Set(capabilities.flatMap((capability) => [
      ...collectDelimitedValues(capability.fields.scope),
      ...collectDelimitedValues(capability.fields.scopes),
      ...collectDelimitedValues(capability.fields.requires),
    ]));
    const requiredScopes = contract ? [...contract.capabilityScopes] : [];
    const acceptedScopes = requiredScopes.filter((scope) => declaredScopes.has(scope));
    const missingScopes = requiredScopes.filter((scope) => !declaredScopes.has(scope));
    const sync = normalizeControlValue(adapter.fields.sync, lifecycle.controls.sync);
    const restartSafe = Boolean(contract?.restartSafeSyncStates.includes(sync));
    const externalStatusValue = contract
      ? normalizeProviderValue(adapter.fields[contract.externalStatusField])
      : normalizeProviderValue(adapter.fields.externalId);

    return Object.freeze({
      name: adapter.name,
      line: adapter.line,
      provider,
      service,
      expectedService: contract?.service ?? "",
      requiredAdapterFields: Object.freeze(requiredAdapterFields),
      missingAdapterFields: Object.freeze(missingAdapterFields),
      syncMetadata,
      missingSyncMetadata: Object.freeze(missingSyncMetadata),
      requiredScopes: Object.freeze(requiredScopes),
      acceptedScopes: Object.freeze(acceptedScopes),
      missingScopes: Object.freeze(missingScopes),
      negotiation: Object.freeze({
        ready: missingAdapterFields.length === 0
          && (!contract?.service || service === contract.service)
          && missingScopes.length === 0,
        serviceMatched: !contract?.service || service === contract.service,
        capabilityCoverage: requiredScopes.length === 0
          ? 1
          : acceptedScopes.length / requiredScopes.length,
      }),
      externalHandoff: Object.freeze({
        state: sync,
        restartSafe,
        statusField: contract?.externalStatusField ?? "externalId",
        statusValue: externalStatusValue,
        canResume: restartSafe && Boolean(externalStatusValue || sync === "ready"),
      }),
    });
  });

  return Object.freeze({
    version: COMPLETION_MODEL_VERSION,
    lifecycle,
    providers: Object.freeze(providerStates),
    negotiationReady: providerStates.every((provider) => provider.negotiation.ready),
    resumableHandoffs: providerStates.filter((provider) => provider.externalHandoff.canResume).length,
  });
}

function createValidationSummary(lifecycle, providerContracts, context, suggestions) {
  const providerCount = providerContracts.providers.length;
  const blocking = [];
  const warnings = [];

  if (lifecycle.sourceShape.jobs === 0) {
    blocking.push("job-contract-missing");
  }

  if (lifecycle.sourceShape.adapters === 0) {
    blocking.push("adapter-contract-missing");
  }

  if (lifecycle.missingSettings.length > 0) {
    warnings.push("lifecycle-settings-incomplete");
  }

  if (providerCount > 0 && !providerContracts.negotiationReady) {
    warnings.push("provider-negotiation-incomplete");
  }

  if (providerContracts.providers.some((provider) => provider.missingSyncMetadata.length > 0)) {
    warnings.push("sync-metadata-incomplete");
  }

  if (context.kind === "root" && suggestions.some((item) => item.label === lifecycle.nextAction)) {
    warnings.push("next-action-suggested");
  }

  return Object.freeze({
    protocol: "aios.language.mailchimp-completion-validation-summary.v1",
    ok: blocking.length === 0,
    readyForAcceptance: blocking.length === 0 && providerContracts.negotiationReady && lifecycle.handoffReady,
    blocking: Object.freeze(blocking),
    warnings: Object.freeze(warnings),
    counts: Object.freeze({
      suggestions: suggestions.length,
      providers: providerCount,
      negotiatedProviders: providerContracts.providers.filter((provider) => provider.negotiation.ready).length,
      resumableHandoffs: providerContracts.resumableHandoffs,
      missingSettings: lifecycle.missingSettings.length,
    }),
  });
}

function createProviderPreviewCard(provider) {
  const missing = [
    ...provider.missingAdapterFields.map((field) => `adapter.${field}`),
    ...provider.missingSyncMetadata.map((field) => `sync.${field}`),
    ...provider.missingScopes.map((scope) => `capability.${scope}`),
  ];
  const readiness = provider.negotiation.ready
    ? provider.externalHandoff.canResume
      ? "resume-ready"
      : "contract-ready"
    : "needs-contract";

  return Object.freeze({
    kind: "provider-service",
    title: provider.provider || provider.name || "external provider",
    provider: provider.provider,
    service: provider.service,
    readiness,
    serviceMatched: provider.negotiation.serviceMatched,
    capabilityCoverage: provider.negotiation.capabilityCoverage,
    missing: Object.freeze(missing),
    externalHandoff: provider.externalHandoff,
    nextAction: missing.length > 0
      ? "configure-settings"
      : provider.externalHandoff.canResume
        ? "sync"
        : "verify",
  });
}

function createClientRuntimeHandoff(previewState, lifecycle, providerContracts, validationSummary, options = {}) {
  const accepted = options.accept === true || normalizeControlValue(options.mode) === "accept";
  const requestedClient = normalizeProviderValue(options.clientId ?? options.client ?? "route-client");
  const providerEntries = providerContracts.providers.map((provider, index) => {
    const ready = provider.negotiation.ready && lifecycle.handoffReady;
    const handoffState = provider.externalHandoff.canResume
      ? "resumable"
      : ready
        ? "ready"
        : "blocked";
    const handoffId = stableRuntimeId([
      provider.provider || "provider",
      provider.service || provider.expectedService || "service",
      provider.externalHandoff.statusValue || provider.name || index,
      lifecycle.controls.sync,
    ]);
    const missing = Object.freeze([
      ...provider.missingAdapterFields.map((field) => `adapter.${field}`),
      ...provider.missingSyncMetadata.map((field) => `sync.${field}`),
      ...provider.missingScopes.map((scope) => `capability.${scope}`),
    ]);

    return Object.freeze({
      handoffId,
      provider: provider.provider,
      service: provider.service || provider.expectedService,
      name: provider.name,
      state: handoffState,
      sync: provider.externalHandoff.state,
      accepted: accepted && validationSummary.readyForAcceptance && ready,
      publishable: validationSummary.readyForAcceptance && ready,
      externalStatusField: provider.externalHandoff.statusField,
      externalStatusValue: provider.externalHandoff.statusValue,
      idempotencyKey: stableRuntimeId([
        "mailchimp-client-runtime",
        requestedClient,
        handoffId,
        provider.externalHandoff.state,
      ]),
      restartToken: provider.externalHandoff.canResume
        ? stableRuntimeId(["resume", handoffId, provider.externalHandoff.statusValue || provider.externalHandoff.state])
        : "",
      missing,
      nextAction: missing.length > 0
        ? "configure-settings"
        : provider.externalHandoff.canResume
          ? "sync"
          : lifecycle.nextAction,
    });
  });
  const publishableProviders = providerEntries.filter((entry) => entry.publishable);
  const blockedProviders = providerEntries.filter((entry) => !entry.publishable);
  const state = providerEntries.length === 0
    ? "needs-provider"
    : validationSummary.readyForAcceptance && blockedProviders.length === 0
      ? accepted ? "accepted" : "ready"
      : previewState === "disabled"
        ? "disabled"
        : "blocked";
  const nextAction = state === "accepted"
    ? "publish-client-runtime-handoff"
    : state === "ready"
      ? "accept-completion-handoff"
      : blockedProviders[0]?.nextAction || "configure-settings";

  return Object.freeze({
    protocol: "aios.language.mailchimp-client-runtime-handoff.v1",
    state,
    accepted: state === "accepted",
    clientId: requestedClient,
    providerCount: providerEntries.length,
    publishableProviderCount: publishableProviders.length,
    blockedProviderCount: blockedProviders.length,
    fields: CLIENT_RUNTIME_HANDOFF_FIELDS,
    providers: Object.freeze(providerEntries),
    persistence: Object.freeze({
      key: stableRuntimeId([
        "mailchimp-runtime-handoff",
        requestedClient,
        providerEntries.map((entry) => entry.handoffId).join("|"),
      ]),
      idempotent: true,
      restartSafe: providerEntries.length > 0 && providerEntries.every((entry) => entry.restartToken || entry.state === "ready"),
      writeMode: state === "accepted" ? "commit" : "preview",
    }),
    clientRequest: Object.freeze({
      command: "aios.mailchimp.clientRuntime.acceptHandoff",
      method: "POST",
      bodyFields: Object.freeze(["clientId", "providers", "persistence", "nextAction"]),
      idempotencyKey: stableRuntimeId([
        "mailchimp-client-request",
        requestedClient,
        state,
        publishableProviders.map((entry) => entry.idempotencyKey).join("|"),
      ]),
    }),
    nextAction,
  });
}

function stableRuntimeId(parts) {
  const source = parts.map((part) => normalizeProviderValue(part)).join(":");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `handoff-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildCompletionPreviewContract(source = "", options = {}) {
  const normalized = normalizeCompletionSource(source);
  const cursorOffset = options.cursorOffset ?? normalized.length;
  const context = detectCompletionContext(normalized, cursorOffset);
  const lifecycle = buildLifecycleControlState(normalized, options);
  const providerContracts = buildProviderServiceContractState(normalized, options);
  const candidateValues = context.values.map((value, index) => Object.freeze({
    label: value,
    insertText: CLAUSE_SNIPPETS[value] ?? value,
    rank: (context.kind === "root" ? 10 : 20) + index,
    detail: describeCompletion(value, context),
  }));
  const providerCards = providerContracts.providers.map(createProviderPreviewCard);
  const primaryProvider = providerCards[0] ?? null;
  const previewState = lifecycle.enabled === false
    ? "disabled"
    : providerContracts.providers.length === 0
      ? "needs-adapter"
      : providerContracts.negotiationReady && lifecycle.handoffReady
        ? "ready"
        : "needs-settings";
  const nextSteps = Object.freeze([
    ...(lifecycle.missingSettings.length > 0
      ? [Object.freeze({
        id: "fill-lifecycle-settings",
        label: "Complete adapter lifecycle settings",
        command: "aios.mailchimp.completion.configureSettings",
        fields: Object.freeze(lifecycle.missingSettings),
        nextAction: "configure-settings",
      })]
      : []),
    ...providerCards
      .filter((card) => card.missing.length > 0)
      .map((card) => Object.freeze({
        id: `repair-${card.provider || "provider"}-contract`,
        label: `Repair ${card.provider || "provider"} service contract`,
        command: "aios.mailchimp.completion.repairProviderContract",
        fields: card.missing,
        nextAction: card.nextAction,
      })),
    ...(providerContracts.negotiationReady && lifecycle.handoffReady
      ? [Object.freeze({
        id: "accept-completion-handoff",
        label: "Accept completion handoff",
        command: "aios.mailchimp.completion.accept",
        fields: Object.freeze([]),
        nextAction: lifecycle.nextAction,
      })]
      : []),
  ]);
  const validationSummary = createValidationSummary(lifecycle, providerContracts, context, candidateValues);
  const clientRuntimeHandoff = createClientRuntimeHandoff(
    previewState,
    lifecycle,
    providerContracts,
    validationSummary,
    options,
  );

  return Object.freeze({
    protocol: "aios.language.mailchimp-completion-preview.v1",
    state: previewState,
    cursorOffset,
    context,
    candidateValues: Object.freeze(candidateValues),
    lifecycle: Object.freeze({
      enabled: lifecycle.enabled,
      nextAction: lifecycle.nextAction,
      controls: lifecycle.controls,
      missingSettings: lifecycle.missingSettings,
    }),
    providers: Object.freeze(providerCards),
    primaryProvider,
    validationSummary,
    acceptance: Object.freeze({
      protocol: "aios.language.mailchimp-completion-acceptance.v1",
      acceptable: validationSummary.readyForAcceptance,
      mode: options.accept === true ? "accept" : "preview",
      selectedLabel: cleanAcceptedLabel(options.acceptLabel ?? options.selectedLabel, candidateValues),
      command: "aios.mailchimp.completion.accept",
      handoffId: clientRuntimeHandoff.providers[0]?.handoffId ?? "",
      clientRequest: clientRuntimeHandoff.clientRequest,
      persistence: clientRuntimeHandoff.persistence,
      nextAction: validationSummary.readyForAcceptance
        ? clientRuntimeHandoff.nextAction
        : nextSteps[0]?.nextAction || "configure-settings",
    }),
    clientRuntimeHandoff,
    nextSteps,
  });
}

export function buildClientRuntimeHandoffContract(source = "", options = {}) {
  return buildCompletionPreviewContract(source, options).clientRuntimeHandoff;
}

function cleanAcceptedLabel(value, candidates) {
  const label = normalizeProviderValue(value);
  if (!label) return "";
  return candidates.some((candidate) => candidate.label === label) ? label : "";
}

export function buildCompletionModel(source = "", options = {}) {
  const cursorOffset = options.cursorOffset ?? normalizeCompletionSource(source).length;
  const context = detectCompletionContext(source, cursorOffset);
  const tokens = tokenizeAiosSource(source);
  const seen = new Set(tokens.map((token) => token.value.toLowerCase()));
  const baseRank = context.kind === "root" ? 10 : 20;
  const lifecycle = buildLifecycleControlState(source, options);
  const providerContracts = buildProviderServiceContractState(source, options);

  const suggestions = context.values.map((value, index) => {
    const keywordSnippet = CLAUSE_SNIPPETS[value];
    const insertText = keywordSnippet ?? value;
    const seenPenalty = seen.has(value.toLowerCase()) ? 25 : 0;

    return completionItem(
      value,
      describeCompletion(value, context),
      insertText,
      baseRank + index + seenPenalty,
    );
  });

  if (context.kind === "clause-body" && context.clause !== "status") {
    suggestions.push(
      completionItem("status", "adapter handoff state for this clause", "status: queued", baseRank + 1),
    );

    if (context.clause === "adapter") {
      for (const [offset, field] of LIFECYCLE_SETTINGS_FIELDS.entries()) {
        suggestions.push(completionItem(
          field,
          describeCompletion(field, context),
          CLAUSE_SNIPPETS[field] ?? `${field}: `,
          baseRank + 5 + offset,
        ));
      }
    }
  }

  if (context.kind === "root" && lifecycle.nextAction) {
    suggestions.push(completionItem(
      lifecycle.nextAction,
      "next lifecycle command for adapter handoff",
      lifecycle.nextAction,
      5,
    ));
  }

  if (context.kind === "clause-body" && context.clause === "adapter") {
    const provider = providerContracts.providers[0];
    const missingFields = provider?.missingAdapterFields ?? [];
    const metadataFields = provider?.missingSyncMetadata ?? [];

    for (const [offset, field] of [...missingFields, ...metadataFields].entries()) {
      suggestions.push(completionItem(
        field,
        `required ${provider?.provider || "provider"} handoff metadata`,
        `${field}: `,
        baseRank + 2 + offset,
      ));
    }
  }
  const sortedSuggestions = suggestions.sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label));
  const preview = buildCompletionPreviewContract(source, options);

  return Object.freeze({
    version: COMPLETION_MODEL_VERSION,
    context,
    tokens,
    suggestions: sortedSuggestions,
    recoveryStatusStates: [...STATUS_HANDOFF_STATES],
    lifecycle,
    providerContracts,
    preview,
    acceptance: preview.acceptance,
    clientRuntimeHandoff: preview.clientRuntimeHandoff,
    readiness: Object.freeze({
      state: preview.state,
      readyForAcceptance: preview.validationSummary.readyForAcceptance,
      providerNegotiationReady: providerContracts.negotiationReady,
      handoffReady: lifecycle.handoffReady,
      clientRuntimeState: preview.clientRuntimeHandoff.state,
      restartSafe: preview.clientRuntimeHandoff.persistence.restartSafe,
      nextAction: preview.acceptance.nextAction,
    }),
    validationSummary: preview.validationSummary,
    nextSteps: preview.nextSteps,
  });
}

export function completeAiosSource(source = "", options = {}) {
  return buildCompletionModel(source, options).suggestions;
}

export function describeCompletion(label, context = {}) {
  if (STATUS_HANDOFF_STATES.includes(label)) {
    return `adapter recovery/status handoff state: ${label}`;
  }

  if (LIFECYCLE_COMMANDS.includes(label)) {
    return `AI OS lifecycle command: ${label}`;
  }

  if (LIFECYCLE_SETTINGS_FIELDS.includes(label) || SCHEDULING_CONTROL_FIELDS.includes(label)) {
    return `adapter lifecycle control field for ${context.clause ?? "workflow"} handoff`;
  }

  if (BOOLEAN_CONTROL_VALUES.includes(label)) {
    return `boolean lifecycle control value: ${label}`;
  }

  if (CONTRACT_KEYWORDS.includes(label)) {
    return `AI OS ${label} contract clause`;
  }

  return `${context.clause ?? "AI OS"} field`;
}

export function selfCheckCompletionModel() {
  const root = buildCompletionModel("");
  const status = buildCompletionModel("job demo {\n  status: ");
  const adapter = buildCompletionModel("job demo {\n  status: verified\n}\ncapability mailchimp {\n  scope: campaigns:read,campaigns:write,audiences:read\n}\nadapter mailchimp {\n  provider: mailchimp\n  service: campaign-sync\n  enabled: true\n  handoff: status\n  sync: ready\n  audience: primary\n  externalId: mc-123\n}");

  return Object.freeze({
    ok: root.suggestions.some((item) => item.label === "job")
      && status.suggestions.every((item) => STATUS_HANDOFF_STATES.includes(item.label))
      && adapter.lifecycle.nextAction === "sync"
      && adapter.providerContracts.negotiationReady
      && adapter.providerContracts.resumableHandoffs === 1
      && adapter.preview.validationSummary.readyForAcceptance
      && adapter.acceptance.nextAction === "sync",
    rootSuggestionCount: root.suggestions.length,
    statusSuggestionCount: status.suggestions.length,
    lifecycleNextAction: adapter.lifecycle.nextAction,
    providerNegotiationReady: adapter.providerContracts.negotiationReady,
    previewState: adapter.preview.state,
    acceptanceNextAction: adapter.acceptance.nextAction,
    version: COMPLETION_MODEL_VERSION,
  });
}
