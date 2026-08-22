const SEVERITY_ORDER = Object.freeze({ error: 3, warning: 2, info: 1 });
const KNOWN_SEVERITIES = new Set(Object.keys(SEVERITY_ORDER));
const RECOVERY_DIAGNOSTIC_CODES = new Set([
  "AIOS_MAILCHIMP_IDEMPOTENCY",
  "AIOS_MAILCHIMP_RESTART_CHECKPOINT",
  "AIOS_MAILCHIMP_SYNC_LEDGER",
  "PARSE_RECOVERY",
]);
const PROVIDER_DIAGNOSTIC_HINTS = Object.freeze({
  AIOS_MAILCHIMP_IDEMPOTENCY: Object.freeze({
    provider: "mailchimp",
    service: "marketing-sync",
    capability: "mailchimp.sync.idempotency",
    externalState: "idempotency-key-ledger",
    syncMetadata: Object.freeze({ requiresLedger: true, requiresCheckpoint: false }),
    negotiation: Object.freeze({ required: true, mode: "idempotent-write" }),
  }),
  AIOS_MAILCHIMP_RESTART_CHECKPOINT: Object.freeze({
    provider: "mailchimp",
    service: "marketing-sync",
    capability: "mailchimp.sync.restart",
    externalState: "restart-checkpoint",
    syncMetadata: Object.freeze({ requiresLedger: false, requiresCheckpoint: true }),
    negotiation: Object.freeze({ required: true, mode: "checkpoint-resume" }),
  }),
  AIOS_MAILCHIMP_SYNC_LEDGER: Object.freeze({
    provider: "mailchimp",
    service: "marketing-sync",
    capability: "mailchimp.sync.ledger",
    externalState: "sync-ledger",
    syncMetadata: Object.freeze({ requiresLedger: true, requiresCheckpoint: true }),
    negotiation: Object.freeze({ required: true, mode: "ledger-confirmation" }),
  }),
});

function text(value, fallback = "") {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function freezeArray(values = []) {
  return Object.freeze(Array.isArray(values) ? values.map((value) => Object.freeze(value)) : []);
}

function normalizeSeverity(value) {
  const severity = text(value, "error").toLowerCase();
  return KNOWN_SEVERITIES.has(severity) ? severity : "error";
}

function normalizeRange(range = null) {
  if (!range || typeof range !== "object") return null;
  const start = range.start ?? {};
  const end = range.end ?? {};
  return Object.freeze({
    start: Object.freeze({
      line: Number.isFinite(Number(start.line)) ? Number(start.line) : 1,
      column: Number.isFinite(Number(start.column)) ? Number(start.column) : 1,
      offset: Number.isFinite(Number(start.offset)) ? Number(start.offset) : 0,
    }),
    end: Object.freeze({
      line: Number.isFinite(Number(end.line)) ? Number(end.line) : Number(start.line ?? 1),
      column: Number.isFinite(Number(end.column)) ? Number(end.column) : Number(start.column ?? 1),
      offset: Number.isFinite(Number(end.offset)) ? Number(end.offset) : Number(start.offset ?? 0),
    }),
  });
}

function inferProviderHint(diagnostic = {}) {
  const codeHint = PROVIDER_DIAGNOSTIC_HINTS[text(diagnostic.code)];
  if (codeHint) return codeHint;

  const provider = text(diagnostic.provider);
  if (provider) {
    return Object.freeze({
      provider,
      service: text(diagnostic.service, `${provider}-adapter`),
      capability: text(diagnostic.capability, `${provider}.runtime`),
      externalState: text(diagnostic.externalState, `${provider}-handoff-state`),
      syncMetadata: Object.freeze({
        requiresLedger: diagnostic.requiresLedger === true,
        requiresCheckpoint: diagnostic.requiresCheckpoint === true,
      }),
      negotiation: Object.freeze({
        required: diagnostic.negotiationRequired !== false,
        mode: text(diagnostic.negotiationMode, "adapter-contract"),
      }),
    });
  }

  return null;
}

function normalizeProviderContract(diagnostic = {}) {
  const hint = inferProviderHint(diagnostic);
  if (!hint) return null;

  return Object.freeze({
    provider: hint.provider,
    service: hint.service,
    capability: hint.capability,
    externalState: hint.externalState,
    syncMetadata: Object.freeze({
      requiresLedger: hint.syncMetadata?.requiresLedger === true,
      requiresCheckpoint: hint.syncMetadata?.requiresCheckpoint === true,
    }),
    negotiation: Object.freeze({
      required: hint.negotiation?.required === true,
      mode: text(hint.negotiation?.mode, "adapter-contract"),
    }),
  });
}

export function normalizeLanguageDiagnostic(diagnostic = {}, index = 0) {
  const severity = normalizeSeverity(diagnostic.severity);
  const code = text(diagnostic.code, "AIOS_UNKNOWN");
  const range = normalizeRange(diagnostic.range);
  const line = diagnostic.line ?? range?.start.line ?? null;
  const column = diagnostic.column ?? range?.start.column ?? null;
  const providerContract = normalizeProviderContract({ ...diagnostic, code });

  return Object.freeze({
    id: `${code}:${line ?? "unknown"}:${column ?? "unknown"}:${index}`,
    code,
    severity,
    message: text(diagnostic.message, "Unspecified AI OS diagnostic"),
    hint: text(diagnostic.hint) || null,
    path: text(diagnostic.path, "$"),
    range,
    preview: text(diagnostic.preview),
    line,
    column,
    recoverable: severity !== "error" || RECOVERY_DIAGNOSTIC_CODES.has(code),
    providerContract,
  });
}

function createProviderContractSummary(diagnostics = []) {
  const providers = new Map();

  for (const diagnostic of diagnostics) {
    const contract = diagnostic.providerContract;
    if (!contract) continue;

    const existing = providers.get(contract.provider) ?? {
      provider: contract.provider,
      services: new Set(),
      capabilities: new Set(),
      externalState: new Set(),
      negotiationModes: new Set(),
      requiresLedger: false,
      requiresCheckpoint: false,
      diagnostics: [],
    };

    existing.services.add(contract.service);
    existing.capabilities.add(contract.capability);
    existing.externalState.add(contract.externalState);
    existing.negotiationModes.add(contract.negotiation.mode);
    existing.requiresLedger = existing.requiresLedger || contract.syncMetadata.requiresLedger;
    existing.requiresCheckpoint = existing.requiresCheckpoint || contract.syncMetadata.requiresCheckpoint;
    existing.diagnostics.push(diagnostic.code);
    providers.set(contract.provider, existing);
  }

  const contracts = [...providers.values()].sort((left, right) => left.provider.localeCompare(right.provider)).map((provider) => Object.freeze({
    provider: provider.provider,
    services: Object.freeze([...provider.services].sort()),
    capabilities: Object.freeze([...provider.capabilities].sort()),
    externalState: Object.freeze([...provider.externalState].sort()),
    syncMetadata: Object.freeze({
      requiresLedger: provider.requiresLedger,
      requiresCheckpoint: provider.requiresCheckpoint,
      restartSafe: provider.requiresLedger && provider.requiresCheckpoint,
    }),
    negotiation: Object.freeze({
      required: provider.negotiationModes.size > 0,
      modes: Object.freeze([...provider.negotiationModes].sort()),
    }),
    diagnosticCodes: Object.freeze([...new Set(provider.diagnostics)].sort()),
  }));

  return Object.freeze({
    protocol: "aios.language.provider-contracts.v1",
    detected: contracts.length > 0,
    contracts: Object.freeze(contracts),
    mailchimp: contracts.find((contract) => contract.provider === "mailchimp") ?? null,
  });
}

export function summarizeLanguageDiagnostics(diagnostics = []) {
  const normalized = Object.freeze(diagnostics.map(normalizeLanguageDiagnostic));
  const counts = { error: 0, warning: 0, info: 0 };
  const codes = {};
  const blocking = [];
  const recoverable = [];

  for (const diagnostic of normalized) {
    counts[diagnostic.severity] += 1;
    codes[diagnostic.code] = (codes[diagnostic.code] ?? 0) + 1;
    if (diagnostic.severity === "error") blocking.push(diagnostic);
    if (diagnostic.recoverable) recoverable.push(diagnostic);
  }

  const worstSeverity = blocking.length > 0
    ? "error"
    : counts.warning > 0
      ? "warning"
      : counts.info > 0
        ? "info"
        : "info";

  return Object.freeze({
    ok: blocking.length === 0,
    worstSeverity,
    counts: Object.freeze(counts),
    codes: Object.freeze(Object.fromEntries(Object.entries(codes).sort(([left], [right]) => left.localeCompare(right)))),
    blocking: Object.freeze(blocking),
    recoverable: Object.freeze(recoverable),
    providerContracts: createProviderContractSummary(normalized),
    diagnostics: normalized,
  });
}

export function createDiagnosticStatus(summary = summarizeLanguageDiagnostics()) {
  const state = summary.counts.error > 0
    ? "blocked"
    : summary.counts.warning > 0
      ? "review"
      : "ready";
  const firstBlocking = summary.blocking[0] ?? null;
  const hasRecoveryHints = summary.recoverable.length > 0;

  return Object.freeze({
    protocol: "aios.language.diagnostics.status.v1",
    state,
    exportReady: state !== "blocked",
    adapterHandoffAllowed: state === "ready",
    nextAction: state === "blocked"
      ? "resolve-blocking-diagnostics"
      : state === "review"
        ? "review-language-warnings"
        : "compile-kernel-contracts",
    recovery: Object.freeze({
      available: hasRecoveryHints && state !== "ready",
      mode: firstBlocking?.recoverable ? "recover-from-checkpoint" : hasRecoveryHints ? "guided-review" : "none",
      diagnosticCodes: Object.freeze(summary.recoverable.map((diagnostic) => diagnostic.code)),
    }),
    providerContracts: summary.providerContracts,
    externalHandoff: Object.freeze({
      required: summary.providerContracts.detected,
      state: summary.providerContracts.mailchimp?.syncMetadata.restartSafe === false
        ? "needs-provider-negotiation"
        : summary.providerContracts.detected
          ? "ready-for-provider-handoff"
          : "local-only",
      providers: Object.freeze(summary.providerContracts.contracts.map((contract) => contract.provider)),
    }),
    commandControls: Object.freeze({
      enabled: Object.freeze(state === "blocked" ? ["inspectDiagnostics"] : ["inspectDiagnostics", "compile"]),
      disabled: Object.freeze(state === "blocked" ? ["compile", "exportRuntimeHandoff"] : []),
    }),
  });
}

function createDiagnosticPreviewAction(summary, status, provider = null) {
  if (status.state === "blocked") {
    return Object.freeze({
      id: "resolve-blocking-diagnostics",
      label: "Resolve blocking diagnostics",
      enabled: true,
      reason: summary.blocking[0]?.message ?? "Compilation is blocked by diagnostics.",
      requiredData: Object.freeze(["diagnostic-code", "source-location"]),
    });
  }

  if (provider?.syncMetadata?.restartSafe === false) {
    return Object.freeze({
      id: "complete-provider-restart-contract",
      label: "Complete provider restart contract",
      enabled: true,
      reason: "Mailchimp handoff needs ledger and checkpoint state before export.",
      requiredData: Object.freeze([
        ...(provider.syncMetadata.requiresLedger ? ["sync-ledger"] : []),
        ...(provider.syncMetadata.requiresCheckpoint ? ["restart-checkpoint"] : []),
      ]),
    });
  }

  if (provider?.negotiation?.required === true) {
    return Object.freeze({
      id: "accept-provider-contract",
      label: "Accept provider contract",
      enabled: true,
      reason: "Mailchimp adapter contract requires explicit acceptance before handoff.",
      requiredData: Object.freeze(["provider", "negotiation-mode"]),
    });
  }

  if (status.state === "review") {
    return Object.freeze({
      id: "review-language-warnings",
      label: "Review language warnings",
      enabled: true,
      reason: "Warnings are recoverable but should be reviewed before runtime export.",
      requiredData: Object.freeze(["diagnostic-summary"]),
    });
  }

  return Object.freeze({
    id: "compile-kernel-contracts",
    label: "Compile kernel contracts",
    enabled: true,
    reason: "Diagnostics are ready for kernel contract compilation.",
    requiredData: Object.freeze(["source-name"]),
  });
}

function createProviderReadiness(provider = null, status) {
  if (!provider) {
    return Object.freeze({
      provider: "local",
      detected: false,
      state: status.state === "blocked" ? "blocked" : "ready",
      ready: status.state !== "blocked",
      missing: Object.freeze([]),
      externalState: Object.freeze([]),
      capabilities: Object.freeze([]),
      negotiationModes: Object.freeze([]),
    });
  }

  const missing = new Set();
  if (provider.syncMetadata.requiresLedger && !provider.externalState.includes("sync-ledger")) missing.add("sync-ledger");
  if (provider.syncMetadata.requiresCheckpoint && !provider.externalState.includes("restart-checkpoint")) missing.add("restart-checkpoint");
  if (provider.syncMetadata.requiresCheckpoint && provider.syncMetadata.restartSafe !== true) missing.add("restart-safe-checkpoint");

  const ready = status.state !== "blocked"
    && missing.size === 0
    && provider.syncMetadata.restartSafe !== false;

  return Object.freeze({
    provider: provider.provider,
    detected: true,
    state: status.state === "blocked"
      ? "blocked"
      : ready
        ? "ready"
        : "needs-provider-state",
    ready,
    missing: Object.freeze([...missing].sort()),
    externalState: provider.externalState,
    capabilities: provider.capabilities,
    negotiationModes: provider.negotiation.modes,
  });
}

export function createDiagnosticPreview(summary = summarizeLanguageDiagnostics(), options = {}) {
  const status = createDiagnosticStatus(summary);
  const requestedProvider = text(options.provider, "mailchimp");
  const provider = summary.providerContracts.contracts.find((contract) => contract.provider === requestedProvider)
    ?? summary.providerContracts.mailchimp
    ?? null;
  const readiness = createProviderReadiness(provider, status);
  const primaryAction = createDiagnosticPreviewAction(summary, status, provider);
  const validationItems = [
    Object.freeze({
      id: "diagnostics-clear",
      label: "Diagnostics clear",
      state: status.state === "blocked" ? "failed" : "passed",
      detail: status.state === "blocked"
        ? `${summary.counts.error} blocking diagnostic(s) must be resolved.`
        : "No blocking diagnostics are present.",
    }),
    Object.freeze({
      id: "provider-contract",
      label: "Provider contract",
      state: readiness.detected
        ? readiness.ready
          ? "passed"
          : "action-required"
        : "not-applicable",
      detail: readiness.detected
        ? readiness.ready
          ? `${readiness.provider} contract is ready for runtime handoff.`
          : `${readiness.provider} contract is missing ${readiness.missing.join(", ")}.`
        : "No external provider contract was detected.",
    }),
    Object.freeze({
      id: "recovery-handoff",
      label: "Recovery handoff",
      state: status.recovery.available ? "action-required" : "passed",
      detail: status.recovery.available
        ? `Recovery available through ${status.recovery.mode}.`
        : "No recovery handoff is required.",
    }),
  ];

  return Object.freeze({
    protocol: "aios.language.diagnostics.preview.v1",
    sourceName: text(options.sourceName ?? options.fileName, "inline.aios"),
    state: status.state,
    ready: status.exportReady && readiness.ready,
    title: readiness.detected ? `${readiness.provider} language diagnostics` : "AI OS language diagnostics",
    readiness,
    validationSummary: Object.freeze({
      ok: status.state !== "blocked" && readiness.ready,
      counts: summary.counts,
      items: freezeArray(validationItems),
    }),
    acceptance: Object.freeze({
      required: readiness.detected && provider?.negotiation?.required === true,
      provider: readiness.detected ? readiness.provider : null,
      modes: readiness.negotiationModes,
      readyForAcceptance: status.state !== "blocked" && readiness.missing.length === 0,
    }),
    nextSteps: Object.freeze([
      primaryAction,
      ...summary.recoverable.slice(0, 3).map((diagnostic) => Object.freeze({
        id: `inspect:${diagnostic.code}`,
        label: `Inspect ${diagnostic.code}`,
        enabled: true,
        reason: diagnostic.hint ?? diagnostic.message,
        requiredData: Object.freeze([diagnostic.path, diagnostic.line].filter((value) => value != null).map(String)),
      })),
    ]),
    commandControls: Object.freeze({
      enabled: Object.freeze([...status.commandControls.enabled, primaryAction.id].filter((value, index, list) => list.indexOf(value) === index)),
      disabled: status.commandControls.disabled,
    }),
  });
}

export function createDiagnosticEnvelope(diagnostics = [], options = {}) {
  const summary = summarizeLanguageDiagnostics(diagnostics);
  const status = createDiagnosticStatus(summary);
  return Object.freeze({
    protocol: "aios.language.diagnostics.v1",
    sourceName: text(options.sourceName ?? options.fileName, "inline.aios"),
    summary,
    status,
    preview: createDiagnosticPreview(summary, options),
    providerContracts: summary.providerContracts,
    diagnostics: summary.diagnostics,
  });
}

export function assertDiagnosticsApiReady() {
  const envelope = createDiagnosticEnvelope([
    { severity: "warning", code: "AIOS_MAILCHIMP_IDEMPOTENCY", message: "missing idempotency" },
  ]);

  return Object.freeze({
    ok: envelope.summary.counts.warning === 1
      && envelope.status.state === "review"
      && envelope.status.recovery.available === true
      && envelope.preview.acceptance.required === true
      && envelope.providerContracts.mailchimp?.syncMetadata.requiresLedger === true,
    protocol: envelope.protocol,
  });
}
