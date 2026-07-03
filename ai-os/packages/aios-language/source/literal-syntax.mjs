const LITERAL_KINDS = Object.freeze(["string", "number", "boolean", "null", "array", "object", "identifier"]);
const CONTRACT_LITERAL_KEYS = new Set([
  "adapter",
  "backoff",
  "capability",
  "checkpoint",
  "handoff",
  "idempotency",
  "memory",
  "role",
  "status",
  "tenant",
  "truth",
  "workspace",
]);
const EXPORTABLE_LITERAL_ROLES = new Set(["adapter", "capability", "checkpoint", "handoff", "idempotency", "memory", "role", "status", "tenant", "truth", "workspace"]);
const MAILCHIMP_PROVIDER_KEYS = new Set(["adapter", "capability", "handoff", "provider", "service", "sync"]);
const MAILCHIMP_CAPABILITY_ALIASES = Object.freeze({
  campaign: "mailchimp.campaign.write",
  campaigns: "mailchimp.campaign.write",
  audience: "mailchimp.audience.read",
  audiences: "mailchimp.audience.read",
  list: "mailchimp.audience.read",
  lists: "mailchimp.audience.read",
  report: "mailchimp.report.read",
  reports: "mailchimp.report.read",
  template: "mailchimp.template.write",
  templates: "mailchimp.template.write",
});

function position(line = 1, column = 1, offset = 0) {
  return Object.freeze({ line, column, offset });
}

function diagnostic(code, message, at, severity = "error", recovery = "inspect_literal") {
  return Object.freeze({
    code,
    severity,
    message,
    line: at.line,
    column: at.column,
    offset: at.offset,
    recovery,
  });
}

function cursorFor(source) {
  return { source: String(source ?? ""), index: 0, line: 1, column: 1 };
}

function peek(cursor, distance = 0) {
  return cursor.source[cursor.index + distance] ?? "";
}

function advance(cursor) {
  const char = peek(cursor);
  cursor.index += 1;
  if (char === "\n") {
    cursor.line += 1;
    cursor.column = 1;
  } else {
    cursor.column += 1;
  }
  return char;
}

function at(cursor) {
  return position(cursor.line, cursor.column, cursor.index);
}

function skipTrivia(cursor) {
  while (cursor.index < cursor.source.length) {
    const char = peek(cursor);
    if (/\s/.test(char)) {
      advance(cursor);
      continue;
    }
    if (char === "/" && peek(cursor, 1) === "/") {
      while (cursor.index < cursor.source.length && peek(cursor) !== "\n") advance(cursor);
      continue;
    }
    if (char === "/" && peek(cursor, 1) === "*") {
      advance(cursor);
      advance(cursor);
      while (cursor.index < cursor.source.length) {
        if (peek(cursor) === "*" && peek(cursor, 1) === "/") {
          advance(cursor);
          advance(cursor);
          break;
        }
        advance(cursor);
      }
      continue;
    }
    break;
  }
}

function readIdentifier(cursor) {
  const start = at(cursor);
  let value = "";
  while (/[A-Za-z0-9_.:-]/.test(peek(cursor))) value += advance(cursor);
  return { kind: "identifier", value, raw: value, start, end: at(cursor) };
}

function readObjectKey(cursor) {
  const start = at(cursor);
  let value = "";
  while (/[A-Za-z0-9_.-]/.test(peek(cursor))) value += advance(cursor);
  return { kind: "identifier", value, raw: value, start, end: at(cursor) };
}

function readNumber(cursor, diagnostics) {
  const start = at(cursor);
  let raw = "";
  if (peek(cursor) === "-") raw += advance(cursor);
  while (/[0-9]/.test(peek(cursor))) raw += advance(cursor);
  if (peek(cursor) === "." && /[0-9]/.test(peek(cursor, 1))) {
    raw += advance(cursor);
    while (/[0-9]/.test(peek(cursor))) raw += advance(cursor);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    diagnostics.push(diagnostic("AIOS_LITERAL_NUMBER", `Invalid numeric literal "${raw}".`, start, "error", "replace_number"));
  }
  return { kind: "number", value, raw, start, end: at(cursor) };
}

function readString(cursor, diagnostics) {
  const start = at(cursor);
  const quote = advance(cursor);
  let value = "";
  let raw = quote;
  let terminated = false;
  const escapes = { n: "\n", r: "\r", t: "\t", "\"": "\"", "'": "'", "\\": "\\" };

  while (cursor.index < cursor.source.length) {
    const char = advance(cursor);
    raw += char;
    if (char === quote) {
      terminated = true;
      break;
    }
    if (char === "\\") {
      const escaped = advance(cursor);
      raw += escaped;
      value += escapes[escaped] ?? escaped;
      continue;
    }
    if (char === "\n") {
      diagnostics.push(diagnostic("AIOS_LITERAL_STRING_LINE", "String literal cannot span lines.", start, "error", "close_string"));
      break;
    }
    value += char;
  }

  if (!terminated) {
    diagnostics.push(diagnostic("AIOS_LITERAL_STRING_UNTERMINATED", "Unterminated string literal.", start, "error", "close_string"));
  }

  return { kind: "string", value, raw, quote, start, end: at(cursor) };
}

function parseArray(cursor, diagnostics) {
  const start = at(cursor);
  const entries = [];
  advance(cursor);
  skipTrivia(cursor);
  while (cursor.index < cursor.source.length && peek(cursor) !== "]") {
    entries.push(parseLiteralValue(cursor, diagnostics));
    skipTrivia(cursor);
    if (peek(cursor) === ",") {
      advance(cursor);
      skipTrivia(cursor);
      continue;
    }
    if (peek(cursor) !== "]") {
      diagnostics.push(diagnostic("AIOS_LITERAL_ARRAY_SEPARATOR", "Expected ',' or ']' in array literal.", at(cursor), "error", "insert_array_separator"));
      break;
    }
  }
  if (peek(cursor) === "]") advance(cursor);
  else diagnostics.push(diagnostic("AIOS_LITERAL_ARRAY_UNTERMINATED", "Unterminated array literal.", start, "error", "close_array"));
  return { kind: "array", value: entries.map((entry) => entry.value), entries, raw: null, start, end: at(cursor) };
}

function parseObject(cursor, diagnostics) {
  const start = at(cursor);
  const entries = [];
  advance(cursor);
  skipTrivia(cursor);
  while (cursor.index < cursor.source.length && peek(cursor) !== "}") {
    const keyLiteral = peek(cursor) === "\"" || peek(cursor) === "'" ? readString(cursor, diagnostics) : readObjectKey(cursor);
    skipTrivia(cursor);
    if (peek(cursor) !== ":") {
      diagnostics.push(diagnostic("AIOS_LITERAL_OBJECT_COLON", "Expected ':' after object literal key.", at(cursor), "error", "insert_object_colon"));
      break;
    }
    advance(cursor);
    skipTrivia(cursor);
    const valueLiteral = parseLiteralValue(cursor, diagnostics);
    entries.push({ key: String(keyLiteral.value), value: valueLiteral });
    skipTrivia(cursor);
    if (peek(cursor) === ",") {
      advance(cursor);
      skipTrivia(cursor);
      continue;
    }
    if (peek(cursor) !== "}") {
      diagnostics.push(diagnostic("AIOS_LITERAL_OBJECT_SEPARATOR", "Expected ',' or '}' in object literal.", at(cursor), "error", "insert_object_separator"));
      break;
    }
  }
  if (peek(cursor) === "}") advance(cursor);
  else diagnostics.push(diagnostic("AIOS_LITERAL_OBJECT_UNTERMINATED", "Unterminated object literal.", start, "error", "close_object"));
  return {
    kind: "object",
    value: Object.freeze(Object.fromEntries(entries.map((entry) => [entry.key, entry.value.value]))),
    entries: Object.freeze(entries),
    raw: null,
    start,
    end: at(cursor),
  };
}

function parseLiteralValue(cursor, diagnostics) {
  skipTrivia(cursor);
  const char = peek(cursor);
  if (char === "\"" || char === "'") return readString(cursor, diagnostics);
  if (char === "[" ) return parseArray(cursor, diagnostics);
  if (char === "{") return parseObject(cursor, diagnostics);
  if (char === "-" || /[0-9]/.test(char)) return readNumber(cursor, diagnostics);

  const identifier = readIdentifier(cursor);
  if (identifier.value === "true" || identifier.value === "false") {
    return { ...identifier, kind: "boolean", value: identifier.value === "true" };
  }
  if (identifier.value === "null") return { ...identifier, kind: "null", value: null };
  if (!identifier.value) {
    diagnostics.push(diagnostic("AIOS_LITERAL_EXPECTED", "Expected literal value.", at(cursor), "error", "insert_literal"));
  }
  return identifier;
}

function freezeLiteral(literal) {
  const contract = {
    kind: literal.kind,
    value: literal.value,
    raw: literal.raw,
    range: Object.freeze({ start: literal.start, end: literal.end }),
  };
  if (literal.entries) contract.entries = Object.freeze(literal.entries.map(freezeLiteralEntry));
  if (literal.quote) contract.quote = literal.quote;
  return Object.freeze(contract);
}

function freezeLiteralEntry(entry) {
  if (entry && Object.hasOwn(entry, "key")) {
    return Object.freeze({ key: entry.key, value: freezeLiteral(entry.value) });
  }
  return freezeLiteral(entry);
}

function inferContractRole(key, literal) {
  const normalized = String(key ?? "").toLowerCase();
  if (CONTRACT_LITERAL_KEYS.has(normalized)) return normalized;
  if (literal.kind === "object" && literal.entries?.some((entry) => entry.key === "adapter")) return "handoff";
  if (literal.kind === "array" && normalized.includes("capab")) return "capability";
  return "literal";
}

function stableLiteralValue(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(stableLiteralValue));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableLiteralValue(item)])));
  }
  return value;
}

function literalExportState(contract) {
  if (contract.diagnostics.some((item) => item.severity === "error")) return "blocked";
  if (!EXPORTABLE_LITERAL_ROLES.has(contract.role)) return "local";
  if (contract.kind === "identifier" && !contract.value) return "blocked";
  if (contract.status?.state === "blocked") return "blocked";
  return "export-ready";
}

function literalTimelineEvent(contract, index) {
  const state = literalExportState(contract);
  return Object.freeze({
    sequence: index + 1,
    key: contract.key,
    role: contract.role,
    kind: contract.kind,
    state,
    nextAction: state === "export-ready" ? `export_${contract.role}_literal` : contract.status?.nextAction ?? "inspect_literal",
    diagnosticCount: contract.diagnostics.length,
  });
}

function summarizeLiteralAnalytics(contracts, diagnostics) {
  const counters = {
    total: contracts.length,
    exportReady: 0,
    localOnly: 0,
    blocked: 0,
    diagnostics: diagnostics.length,
    errors: diagnostics.filter((item) => item.severity === "error").length,
    warnings: diagnostics.filter((item) => item.severity === "warning").length,
  };
  const byRole = {};
  const byKind = {};
  for (const contract of contracts) {
    const state = literalExportState(contract);
    if (state === "export-ready") counters.exportReady += 1;
    else if (state === "blocked") counters.blocked += 1;
    else counters.localOnly += 1;
    byRole[contract.role] = (byRole[contract.role] ?? 0) + 1;
    byKind[contract.kind] = (byKind[contract.kind] ?? 0) + 1;
  }
  return Object.freeze({
    schema: "aios.literal.analytics.v1",
    counters: Object.freeze(counters),
    byRole: Object.freeze(Object.fromEntries(Object.entries(byRole).sort())),
    byKind: Object.freeze(Object.fromEntries(Object.entries(byKind).sort())),
  });
}

function buildLiteralHistorySnapshot(contracts, diagnostics) {
  const timeline = contracts.map(literalTimelineEvent);
  const blocked = timeline.filter((event) => event.state === "blocked");
  const ready = timeline.filter((event) => event.state === "export-ready");
  return Object.freeze({
    schema: "aios.literal.history.v1",
    revision: `literal:${contracts.length}:${diagnostics.length}:${ready.length}`,
    latestState: blocked.length > 0 ? "blocked" : diagnostics.some((item) => item.severity === "warning") ? "review" : "ready",
    snapshots: Object.freeze(timeline.map((event) => Object.freeze({
      key: event.key,
      role: event.role,
      state: event.state,
      nextAction: event.nextAction,
    }))),
    timeline: Object.freeze(timeline),
  });
}

function buildLiteralExportSummary(contracts, diagnostics) {
  const rows = contracts.map((contract) => Object.freeze({
    key: contract.key,
    role: contract.role,
    kind: contract.kind,
    state: literalExportState(contract),
    value: stableLiteralValue(contract.value),
  }));
  const exportableRows = rows.filter((row) => row.state === "export-ready");
  return Object.freeze({
    schema: "aios.literal.export-summary.v1",
    exportReady: exportableRows.length > 0 && diagnostics.every((item) => item.severity !== "error"),
    rows: Object.freeze(rows),
    exportableKeys: Object.freeze(exportableRows.map((row) => row.key)),
    blockedKeys: Object.freeze(rows.filter((row) => row.state === "blocked").map((row) => row.key)),
    nextAction: diagnostics.some((item) => item.severity === "error")
      ? diagnostics.find((item) => item.severity === "error")?.recovery ?? "repair_literal"
      : exportableRows.length > 0 ? "publish_literal_exports" : "retain_local_literals",
  });
}

function literalExportManifestRow(contract, providerContracts, boundaryContract, runtimeState) {
  const state = literalExportState(contract);
  const provider = (providerContracts.providers ?? []).find((item) => item.sourceKey === contract.key);
  const runtimeCommands = (runtimeState.commands ?? [])
    .filter((command) => command.key === contract.key || command.key === "capability" && contract.role === "capability");
  const boundaryEvents = (boundaryContract.auditTrail ?? [])
    .filter((event) => event.subject === normalizeControlText(contract.value) || event.subject === normalizeMailchimpCapability(contract.value));
  const publishable = state === "export-ready"
    && (provider?.handoff.ready ?? true)
    && runtimeCommands.every((command) => command.restartSafe && command.state !== "blocked")
    && boundaryEvents.every((event) => event.state !== "blocked");

  return Object.freeze({
    schema: "aios.literal.export-manifest-row.v1",
    key: contract.key,
    role: contract.role,
    kind: contract.kind,
    state: publishable ? "publishable" : state === "blocked" ? "blocked" : state,
    value: stableLiteralValue(contract.value),
    provider: provider ? Object.freeze({
      adapter: provider.adapter,
      service: provider.service,
      statusChannel: provider.sync.statusChannel,
      checkpoint: provider.sync.checkpoint,
      handoffReady: provider.handoff.ready,
      writesExternalSystem: provider.sync.externalWriteAllowed,
      nextAction: provider.handoff.nextAction,
    }) : null,
    runtime: Object.freeze({
      commandIds: Object.freeze(runtimeCommands.map((command) => command.id).sort()),
      restartSafe: runtimeCommands.every((command) => command.restartSafe),
      blockedCommandIds: Object.freeze(runtimeCommands
        .filter((command) => command.state === "blocked" || !command.restartSafe)
        .map((command) => command.id)
        .sort()),
    }),
    boundary: Object.freeze({
      eventCount: boundaryEvents.length,
      blocked: boundaryEvents.some((event) => event.state === "blocked"),
      subjects: Object.freeze(boundaryEvents.map((event) => `${event.type}:${event.subject}`).sort()),
    }),
    nextAction: publishable
      ? "publish_literal_manifest_row"
      : provider?.handoff.ready === false
        ? provider.handoff.nextAction
        : runtimeCommands.find((command) => command.state === "blocked" || !command.restartSafe)?.nextAction
          ?? boundaryEvents.find((event) => event.state === "blocked")?.nextAction
          ?? (state === "blocked" ? contract.status?.nextAction ?? "repair_literal" : "retain_literal_manifest_row"),
  });
}

function buildLiteralExportPackage(contracts, exportSummary, history, providerContracts, boundaryContract, runtimeState, operationalHealth) {
  const manifest = Object.freeze(contracts.map((contract) => literalExportManifestRow(
    contract,
    providerContracts,
    boundaryContract,
    runtimeState,
  )));
  const publishableRows = manifest.filter((row) => row.state === "publishable");
  const blockedRows = manifest.filter((row) => row.state === "blocked" || row.runtime.blockedCommandIds.length > 0 || row.boundary.blocked);
  const providerChannels = Array.from(new Set([
    ...(providerContracts.sync?.statusChannels ?? []),
    runtimeState.statusChannel,
  ].filter(Boolean))).sort();
  const revision = stableLiteralCommandId(
    "literal-export-package",
    history.revision,
    runtimeState.revision,
    operationalHealth.state,
    publishableRows.length,
    blockedRows.length,
  );

  return Object.freeze({
    schema: "aios.literal.export-package.v1",
    revision,
    exportReady: exportSummary.exportReady
      && blockedRows.length === 0
      && operationalHealth.state !== "failed"
      && runtimeState.persistedView.restartSafe === true,
    manifest,
    counters: Object.freeze({
      total: manifest.length,
      publishable: publishableRows.length,
      blocked: blockedRows.length,
      providerBacked: manifest.filter((row) => row.provider).length,
      runtimeCommands: runtimeState.commandSummary.total,
      boundaryEvents: boundaryContract.auditTrail?.length ?? 0,
    }),
    status: Object.freeze({
      state: blockedRows.length > 0 || operationalHealth.state === "failed"
        ? "blocked"
        : publishableRows.length > 0 ? "ready" : "local",
      checkpoint: runtimeState.checkpoint,
      statusChannels: Object.freeze(providerChannels),
      historyRevision: history.revision,
      runtimeRevision: runtimeState.revision,
      healthState: operationalHealth.state,
      restartSafe: runtimeState.persistedView.restartSafe === true,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0 && runtimeState.clientHandoff.ready === true,
      localOnly: providerContracts.sync?.localOnly !== false,
      writesExternalSystem: providerContracts.sync?.externalWriteAllowed === true,
      checkpoint: runtimeState.checkpoint,
      statusChannel: providerChannels[0] || "mailchimp.contract.status",
      nextAction: blockedRows[0]?.nextAction
        ?? operationalHealth.statusPatch?.nextAction
        ?? (publishableRows.length > 0 ? "publish_literal_export_package" : "retain_literal_export_package"),
    }),
  });
}

function normalizeControlText(value) {
  return String(value ?? "").trim();
}

function stableRuntimePart(value) {
  return normalizeControlText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "none";
}

function stableLiteralCommandId(...parts) {
  return parts.map(stableRuntimePart).join(":");
}

function readObjectField(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const name of names) {
    if (Object.hasOwn(value, name)) return value[name];
  }
  return undefined;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(normalizeControlText).filter(Boolean).sort());
  }
  if (typeof value === "string") {
    return Object.freeze(value.split(/[,\s]+/).map(normalizeControlText).filter(Boolean).sort());
  }
  if (value === true) return Object.freeze(["default"]);
  return Object.freeze([]);
}

function normalizeMailchimpCapability(value) {
  const text = normalizeControlText(value).toLowerCase();
  if (!text) return "";
  if (text.startsWith("mailchimp.")) return text;
  return MAILCHIMP_CAPABILITY_ALIASES[text] ?? `mailchimp.${text}`;
}

function readBooleanFlag(value) {
  if (value === true || value === false) return value;
  const text = normalizeControlText(value).toLowerCase();
  if (!text) return false;
  return ["1", "on", "true", "yes", "write", "external", "provider", "push"].includes(text);
}

function readProviderString(value, names, fallback = "") {
  const fieldValue = readObjectField(value, names);
  if (fieldValue === undefined || fieldValue === null) return fallback;
  return normalizeControlText(fieldValue) || fallback;
}

function normalizeBoundaryToken(value) {
  return normalizeControlText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:/-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizedBoundaryList(value) {
  return Object.freeze(normalizeStringList(value)
    .map(normalizeBoundaryToken)
    .filter(Boolean)
    .sort());
}

function collectMailchimpCapabilities(value) {
  const rawCapabilities = [
    ...normalizeStringList(readObjectField(value, ["capabilities", "capability", "scopes"])),
    ...normalizeStringList(readObjectField(value, ["mailchimpCapabilities", "mailchimpScopes"])),
  ];
  const normalized = rawCapabilities
    .map(normalizeMailchimpCapability)
    .filter((item) => item.startsWith("mailchimp."));
  return Object.freeze(Array.from(new Set(normalized)).sort());
}

function hasMailchimpProviderSignal(contract) {
  const value = contract.value;
  if (typeof value === "string") {
    const text = normalizeControlText(value).toLowerCase();
    return text === "mailchimp" || text.startsWith("mailchimp.") || (contract.role === "adapter" && Boolean(text));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const service = readProviderString(value, ["service", "provider"], "");
  const adapter = readProviderString(value, ["adapter", "handoff"], "");
  const capabilities = collectMailchimpCapabilities(value);
  const hasProviderKey = Object.keys(value).some((key) => MAILCHIMP_PROVIDER_KEYS.has(key));
  return contract.role === "handoff"
    || contract.role === "adapter"
    || service.toLowerCase() === "mailchimp"
    || adapter.toLowerCase() === "mailchimp"
    || capabilities.length > 0
    || hasProviderKey;
}

function parseLiteralSyncMetadata(value, contract) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({
      mode: "local",
      checkpoint: `${contract.key}:local`,
      statusChannel: "mailchimp.contract.status",
      externalWriteRequested: false,
      externalWriteAllowed: false,
      localOnly: true,
    });
  }
  const syncValue = readObjectField(value, ["sync", "mode"]);
  const syncObject = syncValue && typeof syncValue === "object" && !Array.isArray(syncValue) ? syncValue : null;
  const mode = normalizeControlText(syncObject ? readObjectField(syncObject, ["mode", "type"]) : syncValue) || "local";
  const externalField = syncObject
    ? readObjectField(syncObject, ["external", "write", "externalWrite"])
    : readObjectField(value, ["external", "externalWrite", "write"]);
  const checkpoint = normalizeControlText(syncObject ? readObjectField(syncObject, ["checkpoint", "cursor"]) : readObjectField(value, ["checkpoint", "cursor"]))
    || `${contract.key}:${mode || "local"}`;
  const statusChannel = readProviderString(value, ["status", "statusChannel", "channel"], "mailchimp.contract.status");
  const externalWriteRequested = readBooleanFlag(externalField) || ["push", "provider"].includes(mode.toLowerCase());
  const externalWriteAllowed = externalWriteRequested && ["push", "provider"].includes(mode.toLowerCase());
  return Object.freeze({
    mode: mode.toLowerCase(),
    checkpoint,
    statusChannel,
    externalWriteRequested,
    externalWriteAllowed,
    localOnly: !externalWriteAllowed,
  });
}

function parseLiteralProviderContract(contract) {
  const value = contract.value;
  if (!hasMailchimpProviderSignal(contract)) return null;
  const scalarText = typeof value === "string" ? normalizeControlText(value) : "";
  const scalarCapability = scalarText.toLowerCase().startsWith("mailchimp.") ? normalizeMailchimpCapability(scalarText) : "";
  const service = typeof value === "object" && value !== null && !Array.isArray(value)
    ? readProviderString(value, ["service", "provider"], "mailchimp")
    : "mailchimp";
  const adapter = typeof value === "object" && value !== null && !Array.isArray(value)
    ? readProviderString(value, ["adapter", "handoff"], service || "mailchimp")
    : contract.role === "adapter" || contract.role === "handoff" ? scalarText || "mailchimp" : "mailchimp";
  const sync = parseLiteralSyncMetadata(value, contract);
  const requestedCapabilities = typeof value === "object" && value !== null && !Array.isArray(value)
    ? collectMailchimpCapabilities(value)
    : Object.freeze(scalarCapability ? [scalarCapability] : []);
  const idempotencyKey = typeof value === "object" && value !== null && !Array.isArray(value)
    ? readProviderString(value, ["idempotency", "idempotencyKey", "dedupe"], `${contract.key}:${adapter}:${sync.checkpoint}`)
    : `${contract.key}:${adapter}:${sync.checkpoint}`;
  const handoffTarget = typeof value === "object" && value !== null && !Array.isArray(value)
    ? readProviderString(value, ["handoff", "target"], sync.statusChannel)
    : sync.statusChannel;
  const hasService = Boolean(service);
  const hasAdapter = Boolean(adapter);
  const ready = hasService && hasAdapter && (!sync.externalWriteRequested || sync.externalWriteAllowed);

  return Object.freeze({
    schema: "aios.literal.mailchimp-provider.v1",
    sourceKey: contract.key,
    role: contract.role,
    service,
    adapter,
    requestedCapabilities,
    sync,
    handoff: Object.freeze({
      target: handoffTarget,
      statusChannel: sync.statusChannel,
      ready,
      writesExternalSystem: sync.externalWriteAllowed,
      nextAction: !hasService || !hasAdapter
        ? "repair_literal_provider_identity"
        : sync.externalWriteRequested && !sync.externalWriteAllowed
          ? "confirm_literal_external_sync"
          : requestedCapabilities.length > 0 ? "negotiate_literal_mailchimp_capabilities" : "attach_literal_mailchimp_capabilities",
    }),
    idempotency: Object.freeze({
      key: idempotencyKey,
      command: `mailchimp:${adapter}:${idempotencyKey}`,
      restartSafe: Boolean(idempotencyKey && sync.checkpoint),
    }),
  });
}

function buildLiteralProviderContracts(contracts) {
  const providers = contracts.map(parseLiteralProviderContract).filter(Boolean);
  const requestedCapabilities = Object.freeze(Array.from(new Set(providers.flatMap((provider) => provider.requestedCapabilities))).sort());
  const externalWriteRequested = providers.some((provider) => provider.sync.externalWriteRequested);
  const externalWriteAllowed = providers.some((provider) => provider.sync.externalWriteAllowed);
  const invalid = providers.filter((provider) => !provider.handoff.ready || !provider.idempotency.restartSafe);
  const diagnostics = invalid.map((provider) => Object.freeze({
    code: provider.handoff.ready ? "AIOS_LITERAL_PROVIDER_IDEMPOTENCY" : "AIOS_LITERAL_PROVIDER_HANDOFF",
    severity: "warning",
    message: provider.handoff.ready
      ? `Literal Mailchimp provider "${provider.sourceKey}" needs a restart-safe idempotency key.`
      : `Literal Mailchimp provider "${provider.sourceKey}" needs a valid local or provider sync handoff.`,
    line: 1,
    column: 1,
    offset: 0,
    recovery: provider.handoff.nextAction,
    key: provider.sourceKey,
  }));

  return Object.freeze({
    schema: "aios.literal.provider-contracts.v1",
    service: providers.find((provider) => provider.service)?.service || "mailchimp",
    adapter: providers.find((provider) => provider.adapter)?.adapter || "mailchimp",
    providers: Object.freeze(providers),
    requestedCapabilities,
    diagnostics: Object.freeze(diagnostics),
    sync: Object.freeze({
      externalWriteRequested,
      externalWriteAllowed,
      localOnly: !externalWriteAllowed,
      checkpoints: Object.freeze(Array.from(new Set(providers.map((provider) => provider.sync.checkpoint).filter(Boolean))).sort()),
      statusChannels: Object.freeze(Array.from(new Set(providers.map((provider) => provider.sync.statusChannel).filter(Boolean))).sort()),
    }),
    handoff: Object.freeze({
      ready: providers.length === 0 || invalid.length === 0,
      nextAction: invalid[0]?.handoff.nextAction
        ?? (providers.length > 0 ? "negotiate_literal_mailchimp_capabilities" : "attach_literal_mailchimp_provider"),
    }),
    idempotencyCommands: Object.freeze(providers.map((provider) => provider.idempotency.command).filter(Boolean).sort()),
  });
}

function readBoundaryValue(contract, names) {
  const directName = names.includes(contract.role) || names.some((name) => contract.key.toLowerCase().endsWith(`.${name}`));
  if (directName && (typeof contract.value === "string" || typeof contract.value === "number" || typeof contract.value === "boolean")) {
    return normalizeControlText(contract.value);
  }
  if (!contract.value || typeof contract.value !== "object" || Array.isArray(contract.value)) return "";
  return normalizeControlText(readObjectField(contract.value, names));
}

function collectBoundaryScopes(contract) {
  const value = contract.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze([]);
  return Object.freeze([
    ...normalizedBoundaryList(readObjectField(value, ["scopes", "scope", "capabilities", "capability"])),
    ...normalizedBoundaryList(readObjectField(value, ["permissions", "permission", "grants", "grant"])),
  ].sort());
}

function boundaryWorkspaceState(workspaces) {
  const escaped = workspaces.filter((workspace) => {
    const text = workspace.value;
    return text === ".."
      || text.includes("../")
      || text.includes("..\\")
      || text.startsWith("/")
      || /^[a-z]:/i.test(text);
  });
  return Object.freeze({
    ok: escaped.length === 0,
    values: Object.freeze(workspaces.map((workspace) => workspace.value).sort()),
    escaped: Object.freeze(escaped.map((workspace) => workspace.value).sort()),
    nextAction: escaped.length > 0 ? "repair_boundary_scope" : "bind_workspace_scope",
  });
}

function rolePermissionLevel(role) {
  const normalized = normalizeBoundaryToken(role);
  if (["owner", "admin", "maintainer"].includes(normalized)) return 3;
  if (["editor", "operator", "writer", "marketer"].includes(normalized)) return 2;
  if (["viewer", "reader", "auditor", "analyst"].includes(normalized)) return 1;
  return normalized ? 1 : 0;
}

function capabilityPermissionLevel(capability) {
  const normalized = normalizeMailchimpCapability(capability);
  if (normalized.endsWith(".write") || normalized.includes(".write.")) return 2;
  if (normalized.endsWith(".delete") || normalized.includes(".delete.")) return 3;
  if (normalized.endsWith(".admin") || normalized.includes(".admin.")) return 3;
  return normalized ? 1 : 0;
}

function buildBoundaryAuditEvent(type, subject, state, nextAction, detail = "") {
  return Object.freeze({
    type,
    subject,
    state,
    nextAction,
    detail,
    localOnly: true,
    writesExternalSystem: false,
  });
}

function buildLiteralBoundaryDiagnostics(boundary, providerContracts) {
  const diagnostics = [];
  const firstWorkspace = boundary.workspaces[0];
  const firstTenant = boundary.tenants[0];
  if (boundary.workspaceState.escaped.length > 0) {
    diagnostics.push(Object.freeze({
      code: "BOUNDARY_WORKSPACE_PATH_ESCAPE",
      severity: "error",
      message: `Workspace scope "${boundary.workspaceState.escaped[0]}" escapes the AI OS workspace boundary.`,
      line: 1,
      column: 1,
      offset: 0,
      recovery: "repair_boundary_scope",
      key: firstWorkspace?.key ?? "workspace",
    }));
  }
  if ((providerContracts.sync?.externalWriteRequested === true || providerContracts.sync?.externalWriteAllowed === true) && boundary.tenants.length === 0) {
    diagnostics.push(Object.freeze({
      code: "BOUNDARY_TENANT_REQUIRED",
      severity: "error",
      message: "External Mailchimp sync requires an explicit tenant boundary.",
      line: 1,
      column: 1,
      offset: 0,
      recovery: "bind_tenant_boundary",
      key: "tenant",
    }));
  }
  if (boundary.roles.length === 0 && boundary.capabilities.length > 0) {
    diagnostics.push(Object.freeze({
      code: "BOUNDARY_ROLE_REQUIRED",
      severity: "warning",
      message: "Mailchimp capability boundaries should include an explicit role.",
      line: 1,
      column: 1,
      offset: 0,
      recovery: "bind_role_boundary",
      key: "role",
    }));
  }
  if (boundary.permissionState.denied.length > 0) {
    diagnostics.push(Object.freeze({
      code: "BOUNDARY_PERMISSION_DENIED",
      severity: "error",
      message: `Role "${boundary.permissionState.role || "unknown"}" does not grant "${boundary.permissionState.denied[0]}".`,
      line: 1,
      column: 1,
      offset: 0,
      recovery: "repair_role_permission_boundary",
      key: boundary.permissionState.denied[0],
    }));
  }
  if (boundary.tenants.length > 1) {
    diagnostics.push(Object.freeze({
      code: "BOUNDARY_TENANT_AMBIGUOUS",
      severity: "warning",
      message: "Multiple tenant literals were found; the first tenant will be used for handoff.",
      line: 1,
      column: 1,
      offset: 0,
      recovery: "select_tenant_boundary",
      key: firstTenant?.key ?? "tenant",
    }));
  }
  return Object.freeze(diagnostics);
}

function buildLiteralBoundaryContract(contracts, providerContracts) {
  const workspaces = [];
  const tenants = [];
  const roles = [];
  const capabilities = [];
  const grants = [];

  for (const contract of contracts) {
    const workspace = readBoundaryValue(contract, ["workspace", "workspaceId", "root"]);
    const tenant = readBoundaryValue(contract, ["tenant", "tenantId", "account"]);
    const role = readBoundaryValue(contract, ["role", "actorRole", "permissionRole"]);
    const directCapability = contract.role === "capability" ? normalizeControlText(contract.value) : "";
    const scopedCapabilities = collectBoundaryScopes(contract)
      .map((scope) => scope.startsWith("mailchimp.") ? scope : normalizeMailchimpCapability(scope));

    if (workspace) workspaces.push(Object.freeze({ key: contract.key, value: workspace }));
    if (tenant) tenants.push(Object.freeze({ key: contract.key, value: tenant }));
    if (role) roles.push(Object.freeze({ key: contract.key, value: normalizeBoundaryToken(role) }));
    if (directCapability) capabilities.push(Object.freeze({ key: contract.key, value: normalizeMailchimpCapability(directCapability) }));
    for (const scope of scopedCapabilities.filter(Boolean)) {
      capabilities.push(Object.freeze({ key: contract.key, value: scope }));
    }
    for (const grant of collectBoundaryScopes(contract)) {
      grants.push(Object.freeze({ key: contract.key, value: grant }));
    }
  }

  const uniqueWorkspaces = Object.freeze(Array.from(new Map(workspaces.map((item) => [item.value, item])).values()).sort((left, right) => left.value.localeCompare(right.value)));
  const uniqueTenants = Object.freeze(Array.from(new Map(tenants.map((item) => [item.value, item])).values()).sort((left, right) => left.value.localeCompare(right.value)));
  const uniqueRoles = Object.freeze(Array.from(new Map(roles.map((item) => [item.value, item])).values()).sort((left, right) => left.value.localeCompare(right.value)));
  const uniqueCapabilities = Object.freeze(Array.from(new Map(capabilities.map((item) => [item.value, item])).values()).sort((left, right) => left.value.localeCompare(right.value)));
  const primaryRole = uniqueRoles[0]?.value ?? "";
  const roleLevel = rolePermissionLevel(primaryRole);
  const denied = uniqueCapabilities
    .map((item) => item.value)
    .filter((capability) => capabilityPermissionLevel(capability) > roleLevel && roleLevel > 0);
  const workspaceState = boundaryWorkspaceState(uniqueWorkspaces);
  const permissionState = Object.freeze({
    role: primaryRole,
    level: roleLevel,
    requested: Object.freeze(uniqueCapabilities.map((item) => item.value)),
    grants: Object.freeze(Array.from(new Set(grants.map((item) => item.value))).sort()),
    denied: Object.freeze(Array.from(new Set(denied)).sort()),
    ok: denied.length === 0 && (uniqueCapabilities.length === 0 || roleLevel > 0),
    nextAction: denied.length > 0
      ? "repair_role_permission_boundary"
      : uniqueCapabilities.length > 0 && roleLevel === 0
        ? "bind_role_boundary"
        : "handoff_permission_audit",
  });
  const auditTrail = Object.freeze([
    ...uniqueWorkspaces.map((item) => buildBoundaryAuditEvent("workspace", item.value, workspaceState.ok ? "scoped" : "blocked", workspaceState.nextAction)),
    ...uniqueTenants.map((item) => buildBoundaryAuditEvent("tenant", item.value, "isolated", "handoff_tenant_audit")),
    ...uniqueRoles.map((item) => buildBoundaryAuditEvent("role", item.value, permissionState.ok ? "granted" : "blocked", permissionState.nextAction)),
    ...uniqueCapabilities.map((item) => buildBoundaryAuditEvent("capability", item.value, permissionState.denied.includes(item.value) ? "denied" : "requested", permissionState.nextAction)),
  ]);
  const provisional = Object.freeze({
    workspaces: uniqueWorkspaces,
    tenants: uniqueTenants,
    roles: uniqueRoles,
    capabilities: uniqueCapabilities,
    workspaceState,
    permissionState,
  });
  const diagnostics = buildLiteralBoundaryDiagnostics(provisional, providerContracts);
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;

  return Object.freeze({
    schema: "aios.literal.boundary-contract.v1",
    workspaces: uniqueWorkspaces,
    tenants: uniqueTenants,
    roles: uniqueRoles,
    capabilities: uniqueCapabilities,
    workspaceState,
    permissionState,
    diagnostics,
    auditTrail,
    handoff: Object.freeze({
      ready: errorCount === 0 && workspaceState.ok && permissionState.ok,
      tenant: uniqueTenants[0]?.value ?? "",
      workspace: uniqueWorkspaces[0]?.value ?? "global",
      role: primaryRole,
      localOnly: true,
      writesExternalSystem: false,
      nextAction: errorCount > 0
        ? diagnostics.find((item) => item.severity === "error")?.recovery ?? "repair_boundary_scope"
        : diagnostics[0]?.recovery ?? "handoff_boundary_audit",
    }),
  });
}

function parseLiteralSchedule(value) {
  const text = normalizeControlText(value);
  const everyInterval = text.match(/^(every)\s+(\d+)(m|h|d)$/i);
  const compactInterval = text.match(/^(\d+)(m|h|d)$/i);
  const atTime = text.match(/^(at)\s+([0-2]\d:[0-5]\d)$/i);
  const cadence = everyInterval
    ? `${everyInterval[2]}${everyInterval[3].toLowerCase()}`
    : compactInterval ? `${compactInterval[1]}${compactInterval[2].toLowerCase()}` : "";
  return Object.freeze({
    raw: text,
    mode: everyInterval || compactInterval ? "interval" : atTime ? "clock" : text === "manual" ? "manual" : "unknown",
    cadence: cadence || (atTime ? atTime[2] : ""),
    valid: Boolean(everyInterval || compactInterval || atTime || text === "manual"),
  });
}

function buildLiteralWorkflowControls(contracts, diagnostics) {
  const controls = [];
  const settings = {};
  const schedules = [];
  const enabled = [];
  const disabled = [];
  const mailchimpScopes = [];

  for (const contract of contracts) {
    const value = contract.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    const enabledValues = normalizeStringList(readObjectField(value, ["enable", "enabled", "features"]));
    const disabledValues = normalizeStringList(readObjectField(value, ["disable", "disabled"]));
    const scheduleValue = readObjectField(value, ["schedule", "cadence", "run"]);
    const settingsValue = readObjectField(value, ["settings", "setting"]);
    const scopes = normalizeStringList(readObjectField(value, ["capabilities", "capability", "scopes"]));

    for (const item of enabledValues) {
      enabled.push(item);
      controls.push(Object.freeze({ key: contract.key, type: "enable", value: item }));
    }
    for (const item of disabledValues) {
      disabled.push(item);
      controls.push(Object.freeze({ key: contract.key, type: "disable", value: item }));
    }
    if (scheduleValue !== undefined) {
      const parsed = parseLiteralSchedule(scheduleValue);
      schedules.push(Object.freeze({ key: contract.key, value: normalizeControlText(scheduleValue), parsed }));
      controls.push(Object.freeze({ key: contract.key, type: "schedule", value: normalizeControlText(scheduleValue), valid: parsed.valid }));
    }
    if (settingsValue && typeof settingsValue === "object" && !Array.isArray(settingsValue)) {
      for (const [settingKey, settingValue] of Object.entries(settingsValue).sort(([left], [right]) => left.localeCompare(right))) {
        const fullKey = `${contract.key}.${settingKey}`;
        settings[fullKey] = stableLiteralValue(settingValue);
        controls.push(Object.freeze({ key: fullKey, type: "setting", value: stableLiteralValue(settingValue) }));
      }
    }
    for (const scope of scopes.filter((item) => item.startsWith("mailchimp."))) {
      mailchimpScopes.push(scope);
    }
  }

  const disabledSet = new Set(disabled);
  const scheduleWarnings = schedules
    .filter((schedule) => !schedule.parsed.valid)
    .map((schedule) => Object.freeze({
      code: "AIOS_LITERAL_WORKFLOW_SCHEDULE",
      severity: "warning",
      message: `Literal workflow schedule "${schedule.value}" is not recognized.`,
      line: 1,
      column: 1,
      offset: 0,
      recovery: "repair_literal_schedule",
      key: schedule.key,
    }));
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;

  return Object.freeze({
    schema: "aios.literal.workflow-controls.v1",
    controls: Object.freeze(controls),
    enabled: Object.freeze(enabled.filter((item) => !disabledSet.has(item)).sort()),
    disabled: Object.freeze(disabled.sort()),
    settings: Object.freeze(Object.fromEntries(Object.entries(settings).sort(([left], [right]) => left.localeCompare(right)))),
    schedules: Object.freeze(schedules),
    mailchimpScopes: Object.freeze(Array.from(new Set(mailchimpScopes)).sort()),
    diagnostics: Object.freeze(scheduleWarnings),
    valid: errorCount === 0 && scheduleWarnings.length === 0,
    nextAction: errorCount > 0
      ? diagnostics.find((item) => item.severity === "error")?.recovery ?? "repair_literal"
      : scheduleWarnings[0]?.recovery
        ?? (schedules.length > 0 ? "schedule_literal_workflow" : controls.length > 0 ? "apply_literal_workflow_controls" : "collect_literal_workflow_controls"),
  });
}

function literalRuntimeCommandState(command) {
  if (command.type === "mailchimp.provider.bind") {
    return Object.freeze({
      state: command.provider.handoff.ready ? "ready" : "blocked",
      restartSafe: command.provider.idempotency.restartSafe === true && command.provider.handoff.ready === true,
      nextAction: command.provider.handoff.nextAction,
      reason: command.provider.handoff.ready
        ? "Literal provider handoff can be replayed from checkpointed provider state."
        : "Literal provider handoff needs service, adapter, or sync repair.",
    });
  }
  if (command.type === "mailchimp.capability.request") {
    return Object.freeze({
      state: command.value ? "ready" : "blocked",
      restartSafe: Boolean(command.value),
      nextAction: command.value ? "negotiate_literal_mailchimp_capability" : "attach_literal_mailchimp_capability",
      reason: command.value
        ? "Capability request is deterministic and can be replayed."
        : "Capability replay requires a concrete scope.",
    });
  }
  if (command.type === "mailchimp.schedule.configure") {
    return Object.freeze({
      state: command.parsed.valid ? "ready" : "blocked",
      restartSafe: command.parsed.valid,
      nextAction: command.parsed.valid ? "schedule_literal_workflow" : "repair_literal_schedule",
      reason: command.parsed.valid
        ? "Schedule cadence can be restored after restart."
        : "Schedule cadence is not recognized.",
    });
  }
  if (command.type === "mailchimp.setting.apply") {
    return Object.freeze({
      state: "ready",
      restartSafe: true,
      nextAction: "apply_literal_setting",
      reason: "Literal setting is already shaped as a stable key/value pair.",
    });
  }
  if (command.type === "mailchimp.feature.disable") {
    return Object.freeze({
      state: "ready",
      restartSafe: true,
      nextAction: "disable_literal_feature",
      reason: "Disable controls are idempotent and supersede matching enable controls.",
    });
  }
  if (command.type === "mailchimp.feature.enable") {
    return Object.freeze({
      state: command.disabledSet.has(command.value) ? "skipped" : "ready",
      restartSafe: true,
      nextAction: "enable_literal_feature",
      reason: command.disabledSet.has(command.value)
        ? "Enable control is superseded by a matching disable control."
        : "Enable control can be replayed idempotently.",
    });
  }
  return Object.freeze({
    state: "ready",
    restartSafe: true,
    nextAction: "record_literal_runtime_state",
    reason: "Literal runtime state can be retained locally.",
  });
}

function buildLiteralProviderRuntimeCommands(providerContracts) {
  return Object.freeze((providerContracts.providers ?? []).map((provider, index) => {
    const state = literalRuntimeCommandState({ type: "mailchimp.provider.bind", provider });
    return Object.freeze({
      schema: "aios.literal.runtime-command.v1",
      id: stableLiteralCommandId("literal-provider", provider.sync.checkpoint, index + 1, provider.sourceKey, provider.adapter),
      type: "mailchimp.provider.bind",
      key: provider.sourceKey,
      value: provider.adapter,
      checkpoint: provider.sync.checkpoint,
      statusChannel: provider.sync.statusChannel,
      idempotencyKey: provider.idempotency.key,
      idempotent: true,
      restartSafe: state.restartSafe,
      state: state.state,
      nextAction: state.nextAction,
      localOnly: provider.sync.localOnly,
      writesExternalSystem: provider.sync.externalWriteAllowed,
      exportable: true,
      statusPatch: Object.freeze({
        state: state.state === "ready" ? "queued" : state.state,
        nextAction: state.nextAction,
        message: state.reason,
      }),
    });
  }));
}

function buildLiteralWorkflowRuntimeCommands(workflowControls, providerContracts) {
  const checkpoint = providerContracts.sync?.checkpoints?.[0] || "literal:local";
  const statusChannel = providerContracts.sync?.statusChannels?.[0] || "mailchimp.contract.status";
  const disabledSet = new Set(workflowControls.disabled ?? []);
  return Object.freeze((workflowControls.controls ?? []).map((control, index) => {
    const parsed = control.type === "schedule" ? parseLiteralSchedule(control.value) : null;
    const type = control.type === "enable"
      ? "mailchimp.feature.enable"
      : control.type === "disable"
        ? "mailchimp.feature.disable"
        : control.type === "schedule"
          ? "mailchimp.schedule.configure"
          : control.type === "setting" ? "mailchimp.setting.apply" : "mailchimp.workflow.record";
    const state = literalRuntimeCommandState({
      type,
      value: control.value,
      parsed,
      disabledSet,
    });
    return Object.freeze({
      schema: "aios.literal.runtime-command.v1",
      id: stableLiteralCommandId("literal-workflow", checkpoint, index + 1, control.type, control.key, control.value),
      type,
      key: control.key,
      value: control.value,
      checkpoint,
      statusChannel,
      idempotencyKey: stableLiteralCommandId("idempotent", checkpoint, control.type, control.key, control.value),
      idempotent: true,
      restartSafe: state.restartSafe,
      state: state.state,
      nextAction: state.nextAction,
      localOnly: providerContracts.sync?.localOnly !== false,
      writesExternalSystem: providerContracts.sync?.externalWriteAllowed === true && type.startsWith("mailchimp."),
      exportable: type.startsWith("mailchimp."),
      parsed,
      statusPatch: Object.freeze({
        state: state.state === "ready" ? "queued" : state.state,
        nextAction: state.nextAction,
        message: state.reason,
      }),
    });
  }));
}

function buildLiteralCapabilityRuntimeCommands(workflowControls, providerContracts) {
  const checkpoint = providerContracts.sync?.checkpoints?.[0] || "literal:local";
  const statusChannel = providerContracts.sync?.statusChannels?.[0] || "mailchimp.contract.status";
  return Object.freeze((workflowControls.mailchimpScopes ?? []).map((scope, index) => {
    const state = literalRuntimeCommandState({ type: "mailchimp.capability.request", value: scope });
    return Object.freeze({
      schema: "aios.literal.runtime-command.v1",
      id: stableLiteralCommandId("literal-capability", checkpoint, index + 1, scope),
      type: "mailchimp.capability.request",
      key: "capability",
      value: scope,
      checkpoint,
      statusChannel,
      idempotencyKey: stableLiteralCommandId("idempotent", checkpoint, "capability", scope),
      idempotent: true,
      restartSafe: state.restartSafe,
      state: state.state,
      nextAction: state.nextAction,
      localOnly: true,
      writesExternalSystem: false,
      exportable: true,
      statusPatch: Object.freeze({
        state: state.state === "ready" ? "queued" : state.state,
        nextAction: state.nextAction,
        message: state.reason,
      }),
    });
  }));
}

function summarizeLiteralRuntimeCommands(commands) {
  const byType = {};
  const byState = {};
  for (const command of commands) {
    byType[command.type] = (byType[command.type] ?? 0) + 1;
    byState[command.state] = (byState[command.state] ?? 0) + 1;
  }
  return Object.freeze({
    total: commands.length,
    restartSafe: commands.filter((command) => command.restartSafe).length,
    exportable: commands.filter((command) => command.exportable).length,
    externalWrites: commands.filter((command) => command.writesExternalSystem).length,
    blocked: commands.filter((command) => command.state === "blocked").length,
    skipped: commands.filter((command) => command.state === "skipped").length,
    byType: Object.freeze(Object.fromEntries(Object.entries(byType).sort())),
    byState: Object.freeze(Object.fromEntries(Object.entries(byState).sort())),
  });
}

function buildLiteralRuntimeState(workflowControls, providerContracts, diagnostics) {
  const commands = Object.freeze([
    ...buildLiteralProviderRuntimeCommands(providerContracts),
    ...buildLiteralCapabilityRuntimeCommands(workflowControls, providerContracts),
    ...buildLiteralWorkflowRuntimeCommands(workflowControls, providerContracts),
  ].sort((left, right) => left.id.localeCompare(right.id)));
  const blocked = commands.filter((command) => command.state === "blocked" || !command.restartSafe);
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const replayState = errors.length > 0 || blocked.length > 0
    ? "hold"
    : warnings.length > 0
      ? "review-ready"
      : commands.length > 0 ? "replay-ready" : "empty";
  const checkpoint = providerContracts.sync?.checkpoints?.[0] || "literal:local";
  const statusChannel = providerContracts.sync?.statusChannels?.[0] || "mailchimp.contract.status";
  const revision = stableLiteralCommandId(
    "literal-runtime",
    checkpoint,
    replayState,
    commands.length,
    warnings.length,
    errors.length,
  );
  const nextCommand = commands.find((command) => command.restartSafe && command.state !== "skipped");

  return Object.freeze({
    schema: "aios.literal.runtime-state.v1",
    revision,
    replayState,
    checkpoint,
    statusChannel,
    commands,
    commandSummary: summarizeLiteralRuntimeCommands(commands),
    resume: Object.freeze({
      available: replayState !== "hold" && Boolean(checkpoint),
      fromCheckpoint: checkpoint,
      nextCommandId: nextCommand?.id ?? "",
      nextAction: blocked[0]?.nextAction
        ?? nextCommand?.nextAction
        ?? providerContracts.handoff?.nextAction
        ?? workflowControls.nextAction,
    }),
    persistedView: Object.freeze({
      key: revision,
      restartSafe: blocked.length === 0 && errors.length === 0,
      blockedCommandIds: Object.freeze(blocked.map((command) => command.id).sort()),
      idempotencyKeys: Object.freeze(commands.map((command) => command.idempotencyKey).filter(Boolean).sort()),
    }),
    clientHandoff: Object.freeze({
      ready: replayState === "replay-ready" || replayState === "review-ready" || replayState === "empty",
      statusChannel,
      checkpoint,
      localOnly: providerContracts.sync?.localOnly !== false,
      writesExternalSystem: providerContracts.sync?.externalWriteAllowed === true,
      userVisibleState: replayState === "hold" ? "needs-attention" : commands.length > 0 ? "queued" : "idle",
      nextAction: blocked[0]?.nextAction
        ?? providerContracts.handoff?.nextAction
        ?? workflowControls.nextAction,
    }),
  });
}

function buildLiteralOperationalHealth(contracts, providerContracts, boundaryContract, workflowControls, runtimeState, diagnostics) {
  const failures = [];
  const degraded = [];
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const errors = diagnostics.filter((item) => item.severity === "error");
  const providerBlocked = providerContracts.providers
    .filter((provider) => provider.handoff.ready === false || provider.idempotency.restartSafe === false);
  const blockedCommands = runtimeState.commands.filter((command) => command.state === "blocked" || command.restartSafe === false);

  for (const item of errors) {
    failures.push(Object.freeze({
      code: item.code,
      key: item.key ?? "literal",
      action: item.recovery ?? "repair_literal",
      detail: item.message,
    }));
  }
  for (const provider of providerBlocked) {
    failures.push(Object.freeze({
      code: provider.handoff.ready ? "AIOS_LITERAL_PROVIDER_IDEMPOTENCY" : "AIOS_LITERAL_PROVIDER_HANDOFF",
      key: provider.sourceKey,
      action: provider.handoff.nextAction,
      detail: provider.handoff.ready
        ? `Provider "${provider.sourceKey}" is missing restart-safe idempotency.`
        : `Provider "${provider.sourceKey}" cannot hand off Mailchimp status yet.`,
    }));
  }
  for (const command of blockedCommands) {
    failures.push(Object.freeze({
      code: "AIOS_LITERAL_RUNTIME_COMMAND_BLOCKED",
      key: command.key,
      action: command.nextAction,
      detail: command.statusPatch?.message ?? command.id,
    }));
  }
  if (boundaryContract.handoff.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_LITERAL_BOUNDARY_HANDOFF",
      key: boundaryContract.diagnostics[0]?.key ?? "boundary",
      action: boundaryContract.handoff.nextAction,
      detail: boundaryContract.diagnostics[0]?.message ?? "Literal boundary handoff is not ready.",
    }));
  }
  for (const item of warnings) {
    degraded.push(Object.freeze({
      code: item.code,
      key: item.key ?? "literal",
      action: item.recovery ?? "review_literal",
      detail: item.message,
    }));
  }
  if (workflowControls.valid === false && workflowControls.diagnostics.length > 0) {
    degraded.push(Object.freeze({
      code: "AIOS_LITERAL_WORKFLOW_DEGRADED",
      key: workflowControls.diagnostics[0].key ?? "workflow",
      action: workflowControls.nextAction,
      detail: workflowControls.diagnostics[0].message,
    }));
  }
  if (providerContracts.sync.externalWriteRequested && !providerContracts.sync.externalWriteAllowed) {
    degraded.push(Object.freeze({
      code: "AIOS_LITERAL_EXTERNAL_SYNC_DEGRADED",
      key: providerContracts.sync.checkpoints[0] ?? "provider",
      action: "confirm_literal_external_sync",
      detail: "External Mailchimp sync was requested but only local sync is currently allowed.",
    }));
  }

  const state = failures.length > 0
    ? "failed"
    : degraded.length > 0
      ? "degraded"
      : runtimeState.commandSummary.total > 0 ? "healthy" : "idle";
  const retryable = state !== "healthy"
    && state !== "idle"
    && runtimeState.resume.available === true
    && runtimeState.persistedView.restartSafe === true;
  const retryPressure = failures.length + degraded.length + runtimeState.commandSummary.blocked + errors.length;
  const backoffSeconds = retryable ? Math.min(300, 10 * Math.max(1, retryPressure)) : 0;
  const handoffReady = failures.length === 0
    && providerContracts.handoff.ready !== false
    && boundaryContract.handoff.ready !== false
    && runtimeState.clientHandoff.ready === true;

  return Object.freeze({
    schema: "aios.literal.operational-health.v1",
    state,
    handoffReady,
    retryable,
    failureCount: failures.length,
    degradedCount: degraded.length,
    failures: Object.freeze(failures),
    degraded: Object.freeze(degraded),
    backoff: Object.freeze({
      strategy: retryable ? "checkpoint-linear" : "none",
      seconds: backoffSeconds,
      checkpoint: runtimeState.checkpoint,
      nextCommandId: runtimeState.resume.nextCommandId,
    }),
    statusPatch: Object.freeze({
      state: failures.length > 0 ? "blocked" : degraded.length > 0 ? "degraded" : handoffReady ? "ready" : "idle",
      nextAction: failures[0]?.action
        ?? degraded[0]?.action
        ?? runtimeState.clientHandoff.nextAction,
      message: failures[0]?.detail
        ?? degraded[0]?.detail
        ?? `${contracts.length} literal contracts prepared for Mailchimp runtime handoff.`,
    }),
  });
}

function buildLiteralAdoptionSignature(providerContracts, runtimeState, workflowControls, boundaryContract, exportPackage, operationalHealth) {
  const service = providerContracts.service || "mailchimp";
  const adapter = providerContracts.adapter || service;
  const capabilities = Object.freeze(Array.from(new Set([
    ...(providerContracts.requestedCapabilities ?? []),
    ...(workflowControls.mailchimpScopes ?? []),
  ].filter(Boolean))).sort());
  const statusChannels = Object.freeze(Array.from(new Set([
    ...(providerContracts.sync?.statusChannels ?? []),
    runtimeState.statusChannel,
    exportPackage.handoff?.statusChannel,
  ].filter(Boolean))).sort());
  const checkpoints = Object.freeze(Array.from(new Set([
    ...(providerContracts.sync?.checkpoints ?? []),
    runtimeState.checkpoint,
    exportPackage.handoff?.checkpoint,
  ].filter(Boolean))).sort());
  const blockedReasons = [
    ...(providerContracts.handoff?.ready === false ? ["provider_handoff"] : []),
    ...(runtimeState.persistedView?.restartSafe === false ? ["runtime_restart"] : []),
    ...(boundaryContract.handoff?.ready === false ? ["boundary"] : []),
    ...(workflowControls.valid === false ? ["workflow"] : []),
    ...(exportPackage.handoff?.ready === false ? ["export_package"] : []),
    ...(operationalHealth.handoffReady === false ? ["operational_health"] : []),
  ];
  const externalWriteRequested = providerContracts.sync?.externalWriteRequested === true;
  const externalWriteAllowed = providerContracts.sync?.externalWriteAllowed === true;
  const restartSafe = runtimeState.persistedView?.restartSafe === true;
  const revision = stableLiteralCommandId(
    "literal-surface",
    service,
    adapter,
    runtimeState.revision,
    exportPackage.revision,
    boundaryContract.handoff?.tenant ?? "tenant:none",
    blockedReasons.length,
  );

  return Object.freeze({
    schema: "aios.literal.adoption-signature.v1",
    source: "literal",
    revision,
    service,
    adapter,
    capabilities,
    boundary: Object.freeze({
      workspace: boundaryContract.handoff?.workspace ?? "global",
      tenant: boundaryContract.handoff?.tenant ?? "",
      role: boundaryContract.handoff?.role ?? "",
      ready: boundaryContract.handoff?.ready !== false,
      auditEvents: boundaryContract.auditTrail?.length ?? 0,
      nextAction: boundaryContract.handoff?.nextAction ?? "handoff_boundary_audit",
    }),
    lifecycle: Object.freeze({
      enabled: Object.freeze([...(workflowControls.enabled ?? [])]),
      disabled: Object.freeze([...(workflowControls.disabled ?? [])]),
      scheduleCount: workflowControls.schedules?.length ?? 0,
      valid: workflowControls.valid !== false,
    }),
    sync: Object.freeze({
      localOnly: providerContracts.sync?.localOnly !== false,
      externalWriteRequested,
      externalWriteAllowed,
      checkpoints,
      statusChannels,
    }),
    replay: Object.freeze({
      state: runtimeState.replayState,
      commandCount: runtimeState.commandSummary?.total ?? 0,
      restartSafe,
      resumeAvailable: runtimeState.resume?.available === true,
      nextAction: runtimeState.resume?.nextAction ?? providerContracts.handoff?.nextAction ?? workflowControls.nextAction,
    }),
    exports: Object.freeze({
      ready: exportPackage.handoff?.ready !== false,
      revision: exportPackage.revision,
      publishableRows: exportPackage.counters?.publishable ?? 0,
      blockedRows: exportPackage.counters?.blocked ?? 0,
    }),
    health: Object.freeze({
      state: operationalHealth.state,
      handoffReady: operationalHealth.handoffReady,
      retryable: operationalHealth.retryable,
      nextAction: operationalHealth.statusPatch?.nextAction ?? runtimeState.clientHandoff?.nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedReasons.length === 0,
      checkpoint: checkpoints[0] || "literal:local",
      statusChannel: statusChannels[0] || "mailchimp.contract.status",
      blockedReasons: Object.freeze(blockedReasons.sort()),
      nextAction: blockedReasons.length > 0
        ? operationalHealth.statusPatch?.nextAction
          ?? boundaryContract.handoff?.nextAction
          ?? runtimeState.resume?.nextAction
          ?? providerContracts.handoff?.nextAction
        : "adopt_literal_mailchimp_surface",
    }),
    fingerprint: stableLiteralCommandId(
      "literal",
      service,
      adapter,
      capabilities.join("+"),
      statusChannels.join("+"),
      externalWriteAllowed ? "external" : "local",
    ),
  });
}

function literalReleaseRow(contract, exportPackage, history, runtimeState, operationalHealth) {
  const manifestRow = (exportPackage.manifest ?? []).find((row) => row.key === contract.key);
  const historyEvent = (history.timeline ?? []).find((event) => event.key === contract.key);
  const runtimeCommands = (runtimeState.commands ?? [])
    .filter((command) => command.key === contract.key || command.key === "capability" && contract.role === "capability")
    .sort((left, right) => left.id.localeCompare(right.id));
  const healthFailure = (operationalHealth.failures ?? []).find((failure) => failure.key === contract.key || failure.key === contract.role);
  const healthDegraded = (operationalHealth.degraded ?? []).find((event) => event.key === contract.key || event.key === contract.role);
  const blockedCommand = runtimeCommands.find((command) => command.state === "blocked" || command.restartSafe === false);
  const state = healthFailure
    ? "blocked"
    : manifestRow?.state === "publishable"
      ? "release-ready"
      : manifestRow?.state ?? historyEvent?.state ?? literalExportState(contract);

  return Object.freeze({
    schema: "aios.literal.release-row.v1",
    key: contract.key,
    role: contract.role,
    kind: contract.kind,
    state,
    publishable: manifestRow?.state === "publishable",
    checkpoint: manifestRow?.provider?.checkpoint
      ?? runtimeCommands[0]?.checkpoint
      ?? exportPackage.handoff?.checkpoint
      ?? runtimeState.checkpoint,
    statusChannel: manifestRow?.provider?.statusChannel
      ?? runtimeCommands[0]?.statusChannel
      ?? exportPackage.handoff?.statusChannel
      ?? runtimeState.statusChannel,
    value: stableLiteralValue(contract.value),
    runtime: Object.freeze({
      commandIds: Object.freeze(runtimeCommands.map((command) => command.id)),
      restartSafe: runtimeCommands.every((command) => command.restartSafe !== false),
      blockedCommandId: blockedCommand?.id ?? "",
    }),
    history: Object.freeze({
      sequence: historyEvent?.sequence ?? 0,
      previousState: historyEvent?.state ?? "unknown",
      diagnosticCount: historyEvent?.diagnosticCount ?? contract.diagnostics.length,
    }),
    health: Object.freeze({
      state: healthFailure ? "failed" : healthDegraded ? "degraded" : "ready",
      code: healthFailure?.code ?? healthDegraded?.code ?? "",
      detail: healthFailure?.detail ?? healthDegraded?.detail ?? "",
    }),
    nextAction: healthFailure?.action
      ?? blockedCommand?.nextAction
      ?? manifestRow?.nextAction
      ?? historyEvent?.nextAction
      ?? "retain_literal_release_row",
  });
}

function summarizeLiteralReleaseRows(rows) {
  const byRole = {};
  const byState = {};
  for (const row of rows) {
    byRole[row.role] = (byRole[row.role] ?? 0) + 1;
    byState[row.state] = (byState[row.state] ?? 0) + 1;
  }
  return Object.freeze({
    total: rows.length,
    releaseReady: rows.filter((row) => row.state === "release-ready").length,
    publishable: rows.filter((row) => row.publishable).length,
    blocked: rows.filter((row) => row.state === "blocked" || row.runtime.blockedCommandId).length,
    degraded: rows.filter((row) => row.health.state === "degraded").length,
    restartSafe: rows.filter((row) => row.runtime.restartSafe).length,
    byRole: Object.freeze(Object.fromEntries(Object.entries(byRole).sort())),
    byState: Object.freeze(Object.fromEntries(Object.entries(byState).sort())),
  });
}

function buildLiteralReleaseReport(contracts, analytics, history, exportSummary, exportPackage, runtimeState, operationalHealth, providerContracts, boundaryContract, adoptionSignature) {
  const rows = Object.freeze(contracts.map((contract) => literalReleaseRow(
    contract,
    exportPackage,
    history,
    runtimeState,
    operationalHealth,
  )));
  const counters = summarizeLiteralReleaseRows(rows);
  const blockers = Object.freeze([
    ...rows
      .filter((row) => row.state === "blocked" || row.runtime.blockedCommandId)
      .map((row) => `${row.key}:${row.nextAction}`),
    ...(exportPackage.handoff?.ready === false ? [`export-package:${exportPackage.handoff.nextAction}`] : []),
    ...(operationalHealth.handoffReady === false ? [`health:${operationalHealth.statusPatch?.nextAction ?? "repair_literal_operational_health"}`] : []),
    ...(providerContracts.handoff?.ready === false ? [`provider:${providerContracts.handoff.nextAction}`] : []),
    ...(boundaryContract.handoff?.ready === false ? [`boundary:${boundaryContract.handoff.nextAction}`] : []),
  ].sort());
  const statusChannels = Object.freeze(Array.from(new Set([
    exportPackage.handoff?.statusChannel,
    runtimeState.statusChannel,
    ...(providerContracts.sync?.statusChannels ?? []),
    adoptionSignature.handoff?.statusChannel,
  ].filter(Boolean))).sort());
  const releaseReady = blockers.length === 0
    && exportPackage.exportReady === true
    && operationalHealth.handoffReady === true
    && adoptionSignature.handoff?.ready === true;
  const nextAction = blockers.length > 0
    ? blockers[0].split(":").slice(1).join(":") || "repair_literal_release"
    : releaseReady ? "publish_literal_release_report" : exportPackage.handoff?.nextAction ?? "prepare_literal_release_report";

  return Object.freeze({
    schema: "aios.literal.release-report.v1",
    revision: stableLiteralCommandId(
      "literal-release",
      history.revision,
      exportPackage.revision,
      runtimeState.revision,
      operationalHealth.state,
      counters.releaseReady,
      counters.blocked,
    ),
    releaseReady,
    counters,
    rows,
    analytics: Object.freeze({
      totalContracts: analytics.counters.total,
      exportReady: analytics.counters.exportReady,
      localOnly: analytics.counters.localOnly,
      diagnostics: analytics.counters.diagnostics,
      byRole: analytics.byRole,
      byKind: analytics.byKind,
    }),
    history: Object.freeze({
      revision: history.revision,
      latestState: history.latestState,
      timeline: Object.freeze(rows.map((row, index) => Object.freeze({
        sequence: index + 1,
        key: row.key,
        state: row.state,
        previousState: row.history.previousState,
        nextAction: row.nextAction,
      }))),
    }),
    exportSummary: Object.freeze({
      exportReady: exportSummary.exportReady,
      exportableKeys: exportSummary.exportableKeys,
      blockedKeys: exportSummary.blockedKeys,
      packageRevision: exportPackage.revision,
      publishableRows: exportPackage.counters?.publishable ?? 0,
      blockedRows: exportPackage.counters?.blocked ?? 0,
    }),
    handoff: Object.freeze({
      ready: releaseReady,
      checkpoint: exportPackage.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: statusChannels[0] || "mailchimp.contract.status",
      statusChannels,
      localOnly: exportPackage.handoff?.localOnly !== false,
      writesExternalSystem: exportPackage.handoff?.writesExternalSystem === true,
      blockers,
      nextAction,
    }),
  });
}

export function parseAiosLiteral(source, options = {}) {
  const cursor = cursorFor(source);
  const diagnostics = [];
  const literal = freezeLiteral(parseLiteralValue(cursor, diagnostics));
  skipTrivia(cursor);
  if (cursor.index < cursor.source.length) {
    diagnostics.push(diagnostic("AIOS_LITERAL_TRAILING_SOURCE", "Unexpected source after literal.", at(cursor), "warning", "trim_trailing_source"));
  }
  const ok = diagnostics.every((item) => item.severity !== "error");
  return Object.freeze({
    schema: "aios.literal.syntax.v1",
    ok,
    literal,
    diagnostics: Object.freeze(diagnostics),
    status: Object.freeze({
      state: ok ? "ready" : "blocked",
      nextAction: ok ? "lower_literal_contract" : diagnostics[0]?.recovery ?? "inspect_literal",
      restartSafe: ok || options.allowRecovery === true,
    }),
  });
}

export function normalizeLiteralContract(key, value, options = {}) {
  const parsed = typeof value === "string" && options.parseStringSource === true
    ? parseAiosLiteral(value, options)
    : { ok: true, literal: freezeLiteral({ kind: value === null ? "null" : Array.isArray(value) ? "array" : typeof value, value, raw: null, start: position(), end: position() }), diagnostics: [] };
  return Object.freeze({
    schema: "aios.literal.contract.v1",
    key: String(key ?? "literal"),
    role: inferContractRole(key, parsed.literal),
    kind: LITERAL_KINDS.includes(parsed.literal.kind) ? parsed.literal.kind : "identifier",
    value: parsed.literal.value,
    literal: parsed.literal,
    diagnostics: Object.freeze(parsed.diagnostics),
    status: parsed.status ?? Object.freeze({ state: "ready", nextAction: "lower_literal_contract", restartSafe: true }),
  });
}

export function collectLiteralContracts(entries = [], options = {}) {
  const contracts = Array.from(entries ?? []).map((entry, index) => normalizeLiteralContract(
    entry?.key ?? `literal:${index}`,
    entry?.value,
    options,
  ));
  const diagnostics = contracts.flatMap((contract) => contract.diagnostics.map((item) => ({ ...item, key: contract.key })));
  const analytics = summarizeLiteralAnalytics(contracts, diagnostics);
  const history = buildLiteralHistorySnapshot(contracts, diagnostics);
  const exportSummary = buildLiteralExportSummary(contracts, diagnostics);
  const workflowControls = buildLiteralWorkflowControls(contracts, diagnostics);
  const providerContracts = buildLiteralProviderContracts(contracts);
  const boundaryContract = buildLiteralBoundaryContract(contracts, providerContracts);
  const combinedDiagnostics = Object.freeze([
    ...diagnostics,
    ...workflowControls.diagnostics,
    ...providerContracts.diagnostics,
    ...boundaryContract.diagnostics,
  ]);
  const runtimeState = buildLiteralRuntimeState(workflowControls, providerContracts, combinedDiagnostics);
  const operationalHealth = buildLiteralOperationalHealth(contracts, providerContracts, boundaryContract, workflowControls, runtimeState, combinedDiagnostics);
  const exportPackage = buildLiteralExportPackage(contracts, exportSummary, history, providerContracts, boundaryContract, runtimeState, operationalHealth);
  const adoptionSignature = buildLiteralAdoptionSignature(providerContracts, runtimeState, workflowControls, boundaryContract, exportPackage, operationalHealth);
  const releaseReport = buildLiteralReleaseReport(
    contracts,
    analytics,
    history,
    exportSummary,
    exportPackage,
    runtimeState,
    operationalHealth,
    providerContracts,
    boundaryContract,
    adoptionSignature,
  );
  return Object.freeze({
    schema: "aios.literal.contract-set.v1",
    ok: diagnostics.every((item) => item.severity !== "error")
      && workflowControls.valid
      && providerContracts.handoff.ready !== false
      && boundaryContract.handoff.ready !== false
      && runtimeState.persistedView.restartSafe
      && operationalHealth.handoffReady
      && exportPackage.handoff.ready
      && releaseReport.handoff.ready,
    contracts: Object.freeze(contracts),
    diagnostics: combinedDiagnostics,
    roles: Object.freeze(Object.fromEntries(contracts.map((contract) => [contract.key, contract.role]).sort())),
    analytics,
    history,
    exportSummary,
    exportPackage,
    releaseReport,
    workflowControls,
    providerContracts,
    boundaryContract,
    runtimeState,
    operationalHealth,
    adoptionSignature,
  });
}

export function summarizeLiteralContractExports(entries = [], options = {}) {
  const set = collectLiteralContracts(entries, options);
  return Object.freeze({
    schema: "aios.literal.export-report.v1",
    ok: set.ok && set.exportSummary.exportReady,
    analytics: set.analytics,
    history: set.history,
    exportSummary: set.exportSummary,
    workflowControls: set.workflowControls,
    providerContracts: set.providerContracts,
    boundaryContract: set.boundaryContract,
    runtimeState: set.runtimeState,
    operationalHealth: set.operationalHealth,
    exportPackage: set.exportPackage,
    releaseReport: set.releaseReport,
    adoptionSignature: set.adoptionSignature,
  });
}

export function literalSyntaxSelfCheck() {
  const parsed = parseAiosLiteral("{ adapter: 'mailchimp', tenant: 'demo', workspace: 'mail/root', role: 'editor', dryRun: true, retry: [1, 2], schedule: 'every 15m', capabilities: ['mailchimp.campaign.write'] }");
  const report = summarizeLiteralContractExports([{ key: "handoff", value: parsed.literal.value }]);
  return Object.freeze({
    ok: parsed.ok && parsed.literal.kind === "object" && parsed.literal.value.adapter === "mailchimp"
      && report.exportSummary.exportableKeys.includes("handoff")
      && report.workflowControls.mailchimpScopes.includes("mailchimp.campaign.write")
      && report.providerContracts.requestedCapabilities.includes("mailchimp.campaign.write")
      && report.boundaryContract.handoff.ready === true
      && report.boundaryContract.handoff.tenant === "demo"
      && report.runtimeState.commandSummary.total >= 3
      && report.runtimeState.persistedView.restartSafe === true
      && report.operationalHealth.handoffReady === true
      && report.exportPackage.handoff.ready === true
      && report.adoptionSignature.handoff.ready === true
      && report.adoptionSignature.boundary.tenant === "demo"
      && report.exportPackage.counters.publishable >= 1
      && report.releaseReport.releaseReady === true
      && report.releaseReport.counters.releaseReady >= 1,
    schema: parsed.schema,
    diagnostics: parsed.diagnostics,
  });
}
