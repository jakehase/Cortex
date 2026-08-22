export function createSourceMap(source = "", fileName = "inline.aios") {
  const text = String(source);
  const lineStarts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lineStarts.push(index + 1);
    }
  }

  return Object.freeze({
    fileName,
    source: text,
    lineStarts: Object.freeze(lineStarts),
  });
}

export function positionAt(sourceMap, offset = 0) {
  const safeOffset = clampOffset(sourceMap, offset);
  let low = 0;
  let high = sourceMap.lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = sourceMap.lineStarts[mid];
    const next = sourceMap.lineStarts[mid + 1] ?? Infinity;

    if (safeOffset < start) {
      high = mid - 1;
    } else if (safeOffset >= next) {
      low = mid + 1;
    } else {
      return Object.freeze({
        line: mid + 1,
        column: safeOffset - start + 1,
        offset: safeOffset,
      });
    }
  }

  return Object.freeze({ line: 1, column: 1, offset: safeOffset });
}

export function offsetAt(sourceMap, position = {}) {
  const line = Math.max(1, Math.trunc(position.line ?? 1));
  const column = Math.max(1, Math.trunc(position.column ?? 1));
  const lineStart = sourceMap.lineStarts[line - 1] ?? sourceMap.source.length;
  const lineEnd = sourceMap.lineStarts[line] === undefined
    ? sourceMap.source.length
    : Math.max(lineStart, sourceMap.lineStarts[line] - 1);

  return Math.min(lineStart + column - 1, lineEnd);
}

export function rangeFromOffsets(sourceMap, startOffset = 0, endOffset = startOffset) {
  const start = clampOffset(sourceMap, startOffset);
  const end = clampOffset(sourceMap, Math.max(start, endOffset));

  return Object.freeze({
    fileName: sourceMap.fileName,
    start: positionAt(sourceMap, start),
    end: positionAt(sourceMap, end),
  });
}

export function mapNodeRange(sourceMap, node = {}) {
  return rangeFromOffsets(sourceMap, node.start ?? 0, node.end ?? node.start ?? 0);
}

export function createGeneratedSourceMap(sourceMap, entries = []) {
  const mappings = entries
    .filter((entry) => entry && entry.generated)
    .map((entry) => Object.freeze({
      generated: normalizeGeneratedRange(entry.generated),
      original: entry.original
        ? rangeFromOffsets(sourceMap, entry.original.start ?? 0, entry.original.end ?? entry.original.start ?? 0)
        : null,
      symbol: entry.symbol ?? null,
      kind: entry.kind ?? "unknown",
      handoff: entry.handoff ? normalizeHandoffState(entry.handoff) : null,
    }));

  return Object.freeze({
    fileName: sourceMap.fileName,
    mappings: Object.freeze(mappings),
    providers: summarizeProviderContracts(mappings),
  });
}

export function createProviderContractState(descriptor = {}, options = {}) {
  const steps = descriptor.steps ?? [];
  const capabilities = descriptor.capabilities ?? [];
  const providerNames = new Set();
  const adapters = [];
  const providerCapabilities = new Map();

  for (const step of steps) {
    const adapter = String(step.adapter ?? "");
    const provider = providerFromAdapter(adapter);
    providerNames.add(provider);
    adapters.push(Object.freeze({
      step: step.id ?? "step",
      adapter,
      provider,
      operation: operationFromAdapter(adapter),
      input: Object.freeze({ ...(step.input ?? {}) }),
      reads: Object.freeze(step.reads ?? []),
      writes: Object.freeze(step.writes ?? []),
      recovery: step.recovery ?? "halt",
    }));
  }

  const negotiatedCapabilities = capabilities.map((capability) => Object.freeze({
    name: capability.name,
    provider: providerFromCapability(capability.name),
    scope: capability.scope,
    boundary: capability.boundary ?? "internal",
    handoff: capability.boundary === "external" ? "adapterRequired" : "localRuntime",
  }));

  for (const capability of negotiatedCapabilities) {
    const current = providerCapabilities.get(capability.provider) ?? {
      read: false,
      write: false,
      external: false,
      names: [],
    };
    current.read = current.read || capability.scope === "read";
    current.write = current.write || capability.scope === "write";
    current.external = current.external || capability.boundary === "external";
    current.names.push(capability.name);
    providerCapabilities.set(capability.provider, current);
  }

  const providerContracts = [...providerNames]
    .sort()
    .map((provider) => createProviderServiceContract(provider, {
      adapters: adapters.filter((adapter) => adapter.provider === provider),
      capabilities: providerCapabilities.get(provider),
      service: options.service ?? descriptor.sourceName ?? descriptor.id ?? "aios",
    }));
  const mailchimp = createMailchimpHandoffState(descriptor, adapters, negotiatedCapabilities);

  return Object.freeze({
    service: options.service ?? descriptor.sourceName ?? descriptor.id ?? "aios",
    providers: Object.freeze([...providerNames].sort()),
    adapters: Object.freeze(adapters),
    capabilities: Object.freeze(negotiatedCapabilities),
    providerContracts: Object.freeze(providerContracts),
    externalHandoff: Object.freeze({
      required: providerContracts.some((contract) => contract.external),
      providers: Object.freeze(providerContracts
        .filter((contract) => contract.external)
        .map((contract) => contract.provider)),
      stages: Object.freeze(providerContracts
        .filter((contract) => contract.external)
        .flatMap((contract) => contract.handoffStages)),
    }),
    mailchimp,
    sync: Object.freeze({
      mode: options.syncMode ?? inferSyncMode(adapters),
      external: negotiatedCapabilities.some((capability) => capability.boundary === "external"),
      memoryWrites: Object.freeze([...new Set(steps.flatMap((step) => step.writes ?? []))].sort()),
    }),
  });
}

export function summarizeProviderContracts(mappings = []) {
  const providers = new Map();

  for (const mapping of mappings) {
    const handoff = mapping.handoff;
    if (!handoff) continue;

    for (const provider of handoff.providers ?? []) {
      const current = providers.get(provider) ?? {
        provider,
        symbols: new Set(),
        adapters: new Set(),
        external: false,
      };
      current.symbols.add(mapping.symbol);
      for (const adapter of handoff.adapters ?? []) {
        if (adapter.adapter) current.adapters.add(adapter.adapter);
      }
      current.external = current.external || Boolean(handoff.sync?.external);
      providers.set(provider, current);
    }
  }

  return Object.freeze([...providers.values()]
    .sort((left, right) => left.provider.localeCompare(right.provider))
    .map((entry) => Object.freeze({
      provider: entry.provider,
      symbols: Object.freeze([...entry.symbols].filter(Boolean).sort()),
      adapters: Object.freeze([...entry.adapters].sort()),
      external: entry.external,
    })));
}

export function createMailchimpPreviewContract(handoff = {}) {
  const mailchimp = handoff.mailchimp ?? {};
  const providerContract = (handoff.providerContracts ?? [])
    .find((contract) => contract.provider === "mailchimp") ?? null;

  if (!mailchimp.detected && !providerContract) {
    return Object.freeze({
      detected: false,
      provider: "mailchimp",
      ready: true,
      actions: Object.freeze([]),
      dataBoundary: null,
      syncContract: null,
    });
  }

  const missing = mailchimp.missing ?? Object.freeze([]);
  const requiredActions = [];
  if (missing.includes("audienceList")) requiredActions.push("select-audience-list");
  if (missing.includes("campaignTemplate")) requiredActions.push("select-campaign-template");
  if (missing.includes("persistentSyncLedger")) requiredActions.push("choose-sync-ledger");
  if (missing.includes("restartSafeCheckpoint")) requiredActions.push("add-restart-safe-checkpoint");
  if (missing.includes("adapterTruthBoundary")) requiredActions.push("confirm-adapter-truth-boundary");

  return Object.freeze({
    detected: true,
    provider: "mailchimp",
    ready: missing.length === 0,
    audienceList: mailchimp.audienceList ?? null,
    campaignTemplate: mailchimp.campaignTemplate ?? null,
    operations: mailchimp.operations ?? Object.freeze([]),
    actions: Object.freeze(requiredActions),
    dataBoundary: Object.freeze({
      service: providerContract?.service ?? handoff.service ?? "aios",
      external: providerContract?.external ?? true,
      requiredScopes: providerContract?.requiredScopes ?? Object.freeze([]),
      syncMode: handoff.sync?.mode ?? "none",
      memoryWrites: handoff.sync?.memoryWrites ?? Object.freeze([]),
    }),
    syncContract: mailchimp.syncContract ?? createEmptyMailchimpSyncContract(),
  });
}

export function compactRange(range) {
  if (!range) return "unknown";
  const file = range.fileName ? `${range.fileName}:` : "";
  const start = `${range.start.line}:${range.start.column}`;
  const end = `${range.end.line}:${range.end.column}`;

  return `${file}${start}-${end}`;
}

export function linePreview(sourceMap, range, contextColumns = 80) {
  if (!range?.start) return "";
  const lineIndex = range.start.line - 1;
  const lineStart = sourceMap.lineStarts[lineIndex] ?? 0;
  const nextLineStart = sourceMap.lineStarts[lineIndex + 1] ?? sourceMap.source.length;
  const rawLine = sourceMap.source.slice(lineStart, nextLineStart).replace(/\r?\n$/, "");
  const column = Math.max(1, range.start.column);
  const left = Math.max(0, column - 1 - Math.floor(contextColumns / 2));
  const right = Math.min(rawLine.length, left + contextColumns);
  const prefix = left > 0 ? "..." : "";
  const suffix = right < rawLine.length ? "..." : "";

  return `${prefix}${rawLine.slice(left, right)}${suffix}`;
}

function normalizeGeneratedRange(generated) {
  return Object.freeze({
    startLine: Math.max(1, Math.trunc(generated.startLine ?? 1)),
    startColumn: Math.max(1, Math.trunc(generated.startColumn ?? 1)),
    endLine: Math.max(1, Math.trunc(generated.endLine ?? generated.startLine ?? 1)),
    endColumn: Math.max(1, Math.trunc(generated.endColumn ?? generated.startColumn ?? 1)),
  });
}

function normalizeHandoffState(handoff) {
  return Object.freeze({
    service: handoff.service ?? "aios",
    providers: Object.freeze([...(handoff.providers ?? [])].sort()),
    adapters: Object.freeze((handoff.adapters ?? []).map((adapter) => Object.freeze({ ...adapter }))),
    capabilities: Object.freeze((handoff.capabilities ?? []).map((capability) => Object.freeze({ ...capability }))),
    providerContracts: Object.freeze((handoff.providerContracts ?? []).map((contract) => Object.freeze({
      ...contract,
      requiredScopes: Object.freeze([...(contract.requiredScopes ?? [])].sort()),
      memoryWrites: Object.freeze([...(contract.memoryWrites ?? [])].sort()),
      handoffStages: Object.freeze([...(contract.handoffStages ?? [])]),
    }))),
    externalHandoff: Object.freeze({
      required: Boolean(handoff.externalHandoff?.required),
      providers: Object.freeze([...(handoff.externalHandoff?.providers ?? [])].sort()),
      stages: Object.freeze([...(handoff.externalHandoff?.stages ?? [])]),
    }),
    mailchimp: createMailchimpPreviewContract(handoff),
    sync: Object.freeze({
      mode: handoff.sync?.mode ?? "none",
      external: Boolean(handoff.sync?.external),
      memoryWrites: Object.freeze([...(handoff.sync?.memoryWrites ?? [])].sort()),
    }),
  });
}

function providerFromAdapter(adapter) {
  const [provider] = String(adapter || "runtime").split(".");
  return provider || "runtime";
}

function operationFromAdapter(adapter) {
  const parts = String(adapter || "").split(".");
  return parts.length > 1 ? parts.slice(1).join(".") : parts[0] || "run";
}

function providerFromCapability(capabilityName) {
  const [provider] = String(capabilityName || "runtime").split(".");
  return provider || "runtime";
}

function createProviderServiceContract(provider, context = {}) {
  const adapters = context.adapters ?? [];
  const capabilities = context.capabilities ?? {};
  const operations = [...new Set(adapters.map((adapter) => adapter.operation).filter(Boolean))].sort();
  const requiredScopes = [
    capabilities.read ? "read" : null,
    capabilities.write ? "write" : null,
  ].filter(Boolean);
  const memoryWrites = [...new Set(adapters.flatMap((adapter) => adapter.writes ?? []))].sort();
  const external = Boolean(capabilities.external || provider === "mailchimp");

  return Object.freeze({
    provider,
    service: context.service ?? "aios",
    external,
    operations: Object.freeze(operations),
    requiredScopes: Object.freeze(requiredScopes),
    capabilityNames: Object.freeze([...(capabilities.names ?? [])].sort()),
    memoryWrites: Object.freeze(memoryWrites),
    handoffStages: Object.freeze(external
      ? ["preview", "accept", "schedule", "observe"]
      : ["compile", "schedule"]),
    negotiation: Object.freeze({
      status: requiredScopes.length > 0 || adapters.length > 0 ? "ready" : "implicit",
      requiresCredential: external,
      adapterCount: adapters.length,
    }),
  });
}

function createMailchimpHandoffState(descriptor, adapters, capabilities) {
  const mailchimpAdapters = adapters.filter((adapter) => adapter.provider === "mailchimp");
  const mailchimpCapabilities = capabilities.filter((capability) => capability.provider === "mailchimp");
  const detected = mailchimpAdapters.length > 0 || mailchimpCapabilities.length > 0;

  if (!detected) {
    return Object.freeze({
      detected: false,
      missing: Object.freeze([]),
      operations: Object.freeze([]),
    });
  }

  const argsByOperation = new Map();
  for (const step of descriptor.steps ?? []) {
    if (providerFromAdapter(step.adapter) !== "mailchimp") continue;
    argsByOperation.set(operationFromAdapter(step.adapter), step.input ?? {});
  }

  const operations = [...new Set(mailchimpAdapters.map((adapter) => adapter.operation))].sort();
  const syncContract = createMailchimpSyncContract(descriptor, mailchimpAdapters, operations);
  const writesPersistentLedger = (descriptor.memory ?? []).some((memory) => (
    memory.mode === "persistent"
    && mailchimpAdapters.some((adapter) => adapter.writes.includes(memory.name))
  ));
  const hasAdapterTruth = (descriptor.verifier?.truthBoundaries ?? [])
    .some((boundary) => boundary.source === "adapter" || boundary.name.toLowerCase().includes("mailchimp"));
  const audienceList = argsByOperation.get("fetchAudience")?.list
    ?? argsByOperation.get("syncAudience")?.list
    ?? null;
  const campaignTemplate = argsByOperation.get("upsertCampaign")?.template
    ?? argsByOperation.get("createCampaign")?.template
    ?? null;
  const missing = [];

  if (operations.some((operation) => operation.toLowerCase().includes("audience")) && !audienceList) {
    missing.push("audienceList");
  }
  if (operations.some((operation) => operation.toLowerCase().includes("campaign")) && !campaignTemplate) {
    missing.push("campaignTemplate");
  }
  if (mailchimpAdapters.some((adapter) => adapter.writes.length > 0) && !writesPersistentLedger) {
    missing.push("persistentSyncLedger");
  }
  if (!syncContract.restartSafe) {
    missing.push("restartSafeCheckpoint");
  }
  if (!hasAdapterTruth) missing.push("adapterTruthBoundary");

  return Object.freeze({
    detected: true,
    ready: missing.length === 0,
    operations: Object.freeze(operations),
    audienceList,
    campaignTemplate,
    syncContract,
    missing: Object.freeze(missing),
  });
}

function createMailchimpSyncContract(descriptor, mailchimpAdapters, operations) {
  const statefulOperations = operations.filter((operation) => isMailchimpStatefulOperation(operation));
  const persistentMemoryNames = new Set((descriptor.memory ?? [])
    .filter((memory) => memory.mode === "persistent")
    .map((memory) => memory.name));
  const checkpoints = mailchimpAdapters
    .map((adapter) => createMailchimpCheckpoint(adapter, persistentMemoryNames))
    .filter(Boolean);
  const writeAdapters = mailchimpAdapters.filter((adapter) => adapter.writes.length > 0);
  const restartSafe = writeAdapters.length === 0 || writeAdapters.every((adapter) => (
    adapter.writes.some((name) => persistentMemoryNames.has(name))
    && Boolean(createIdempotencyKey(adapter))
  ));
  const commandPlan = createMailchimpCommandPlan({
    descriptor,
    statefulOperations,
    checkpoints,
    restartSafe,
  });

  return Object.freeze({
    mode: statefulOperations.length > 0 ? "restartSafeSync" : "readOnlyPreview",
    restartSafe,
    ledgerMemory: Object.freeze([...persistentMemoryNames].sort()),
    statefulOperations: Object.freeze(statefulOperations),
    checkpoints: Object.freeze(checkpoints),
    commandPlan,
    recovery: Object.freeze({
      strategy: descriptor.rollback?.strategy ?? "halt",
      target: descriptor.rollback?.target ?? checkpoints.find((checkpoint) => checkpoint.persistent)?.memory ?? null,
      rollbackRequired: statefulOperations.length > 0,
    }),
  });
}

function createMailchimpCheckpoint(adapter, persistentMemoryNames) {
  if (!adapter || adapter.provider !== "mailchimp") return null;
  const writeTargets = adapter.writes ?? Object.freeze([]);
  const ledger = writeTargets.find((name) => persistentMemoryNames.has(name)) ?? null;
  const idempotencyKey = createIdempotencyKey(adapter);

  return Object.freeze({
    step: adapter.step,
    operation: adapter.operation,
    memory: ledger ?? writeTargets[0] ?? null,
    persistent: Boolean(ledger),
    idempotencyKey,
    statusPath: ledger
      ? `${ledger}.${adapter.step}.status`
      : null,
    resumeTokenPath: ledger
      ? `${ledger}.${adapter.step}.cursor`
      : null,
  });
}

function createIdempotencyKey(adapter) {
  const input = adapter.input ?? {};
  const explicit = input.idempotencyKey ?? input.idempotency ?? input.requestId ?? null;
  if (explicit) return String(explicit);
  if (!isMailchimpStatefulOperation(adapter.operation)) return `${adapter.step}:read-only`;
  const stableTarget = input.template ?? input.campaignId ?? input.list ?? input.audience ?? null;
  return stableTarget ? `${adapter.operation}:${stableTarget}` : null;
}

function createMailchimpCommandPlan(state) {
  const commands = ["previewMailchimpHandoff", "inspectMailchimpSyncState"];
  const disabled = [];

  if (state.restartSafe) {
    commands.push("acceptMailchimpHandoff");
    if (state.statefulOperations.length > 0) {
      commands.push("scheduleMailchimpSync");
      commands.push("resumeMailchimpSync");
    }
  } else {
    disabled.push("acceptMailchimpHandoff", "scheduleMailchimpSync", "resumeMailchimpSync");
  }

  return Object.freeze({
    id: `${state.descriptor.id}:mailchimp-sync`,
    enabled: Object.freeze(commands),
    disabled: Object.freeze(disabled),
    nextAction: state.restartSafe
      ? state.statefulOperations.length > 0
        ? "accept-and-schedule-mailchimp-sync"
        : "accept-mailchimp-read-preview"
      : "add-mailchimp-restart-checkpoint",
    checkpointCount: state.checkpoints.length,
  });
}

function createEmptyMailchimpSyncContract() {
  return Object.freeze({
    mode: "none",
    restartSafe: true,
    ledgerMemory: Object.freeze([]),
    statefulOperations: Object.freeze([]),
    checkpoints: Object.freeze([]),
    commandPlan: Object.freeze({
      id: "mailchimp-sync",
      enabled: Object.freeze([]),
      disabled: Object.freeze([]),
      nextAction: "none",
      checkpointCount: 0,
    }),
    recovery: Object.freeze({
      strategy: "halt",
      target: null,
      rollbackRequired: false,
    }),
  });
}

function isMailchimpStatefulOperation(operation) {
  return /^(upsert|create|update|schedule|sync)/i.test(String(operation ?? ""));
}

function inferSyncMode(adapters) {
  if (adapters.some((adapter) => adapter.writes.length > 0)) return "stateful";
  if (adapters.length > 0) return "readOnly";
  return "none";
}

function clampOffset(sourceMap, offset) {
  const numeric = Number.isFinite(offset) ? Math.trunc(offset) : 0;
  return Math.max(0, Math.min(sourceMap.source.length, numeric));
}
