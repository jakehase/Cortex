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
  const suffix = normalized.split(".").filter(Boolean).at(-1) ?? normalized;
  if (CONTRACT_LITERAL_KEYS.has(normalized)) return normalized;
  if (CONTRACT_LITERAL_KEYS.has(suffix)) return suffix;
  if (literal.kind === "object" && literal.entries?.some((entry) => entry.key === "adapter")) return "handoff";
  if ((literal.kind === "array" || literal.kind === "string" || literal.kind === "identifier") && normalized.includes("capab")) return "capability";
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

function buildBoundaryPermissionRow(capability, boundary, providerContracts) {
  const tenant = boundary.tenants[0]?.value ?? "";
  const workspace = boundary.workspaces[0]?.value ?? "global";
  const role = boundary.roles[0]?.value ?? "";
  const denied = boundary.permissionState.denied.includes(capability.value);
  const requiresTenant = providerContracts.sync?.externalWriteRequested === true
    || providerContracts.sync?.externalWriteAllowed === true;
  const blockedBy = Object.freeze([
    ...(boundary.workspaceState.ok ? [] : ["workspace_escape"]),
    ...(requiresTenant && !tenant ? ["tenant_missing"] : []),
    ...(!role ? ["role_missing"] : []),
    ...(denied ? ["permission_denied"] : []),
  ].sort());
  const state = blockedBy.length > 0
    ? "blocked"
    : providerContracts.sync?.externalWriteRequested === true
      ? "audit-ready"
      : "local-ready";

  return Object.freeze({
    schema: "aios.literal.boundary-permission-row.v1",
    capability: capability.value,
    sourceKey: capability.key,
    tenant,
    workspace,
    role,
    roleLevel: boundary.permissionState.level,
    requiredLevel: capabilityPermissionLevel(capability.value),
    state,
    blockedBy,
    localOnly: providerContracts.sync?.externalWriteAllowed !== true,
    writesExternalSystem: providerContracts.sync?.externalWriteAllowed === true && blockedBy.length === 0,
    auditSubject: `${tenant || "tenant:none"}:${workspace}:${role || "role:none"}:${capability.value}`,
    nextAction: blockedBy.includes("workspace_escape")
      ? "repair_boundary_scope"
      : blockedBy.includes("tenant_missing")
        ? "bind_tenant_boundary"
        : blockedBy.includes("role_missing")
          ? "bind_role_boundary"
          : denied ? "repair_role_permission_boundary" : "handoff_permission_audit",
  });
}

function permissionDecisionState(row, externalWriteRequested, externalWriteAllowed) {
  if (row.state === "blocked") return "blocked";
  if (externalWriteRequested && !externalWriteAllowed) return "review";
  if (row.writesExternalSystem) return "external-ready";
  return "local-ready";
}

function buildBoundaryMatrixRow(row, boundary, providerContracts, index) {
  const externalWriteRequested = providerContracts.sync?.externalWriteRequested === true;
  const externalWriteAllowed = providerContracts.sync?.externalWriteAllowed === true;
  const decisionState = permissionDecisionState(row, externalWriteRequested, externalWriteAllowed);
  const denied = row.blockedBy.includes("permission_denied");
  const missing = row.blockedBy.filter((item) => item.endsWith("_missing"));
  const externalReview = decisionState === "review";
  const effect = denied || row.state === "blocked"
    ? "deny"
    : externalReview ? "review" : "allow";
  const principal = `${row.tenant || "tenant:none"}:${row.role || "role:none"}`;
  const resource = `${row.workspace || "global"}:${row.capability}`;
  return Object.freeze({
    schema: "aios.literal.boundary-permission-matrix-row.v1",
    order: index + 1,
    decisionId: stableLiteralCommandId("permission", principal, resource, effect),
    principal,
    tenant: row.tenant,
    workspace: row.workspace,
    role: row.role,
    capability: row.capability,
    resource,
    roleLevel: row.roleLevel,
    requiredLevel: row.requiredLevel,
    effect,
    state: decisionState,
    missing,
    blockedBy: row.blockedBy,
    restartSafe: row.restartSafe !== false && row.state !== "blocked",
    localOnly: row.localOnly !== false || !externalWriteAllowed,
    writesExternalSystem: row.writesExternalSystem === true && effect === "allow",
    requiresExternalApproval: externalWriteRequested && !externalWriteAllowed,
    idempotencyKey: stableLiteralCommandId("idempotent", "permission", principal, resource),
    nextAction: row.state === "blocked"
      ? row.nextAction
      : externalReview
        ? "confirm_boundary_external_audit"
        : "handoff_permission_audit",
    reason: denied
      ? `Role ${row.role || "unknown"} is below required level ${row.requiredLevel} for ${row.capability}.`
      : missing.length > 0
        ? `Permission decision is missing ${missing[0].replace("_missing", "")}.`
        : externalReview
          ? "External Mailchimp write was requested but boundary audit is still local-only."
          : `Role ${row.role || "unknown"} grants ${row.capability} inside ${row.workspace || "global"}.`,
  });
}

function buildBoundaryPermissionMatrix(capabilityRows, boundary, providerContracts) {
  const baselineCapability = Object.freeze({
    capability: "mailchimp.status.read",
    sourceKey: "boundary",
    tenant: boundary.tenants[0]?.value ?? "",
    workspace: boundary.workspaces[0]?.value ?? "global",
    role: boundary.roles[0]?.value ?? "",
    roleLevel: boundary.permissionState.level,
    requiredLevel: 1,
    state: boundary.workspaceState.ok ? "local-ready" : "blocked",
    blockedBy: Object.freeze([
      ...(boundary.workspaceState.ok ? [] : ["workspace_escape"]),
      ...(boundary.roles.length === 0 ? ["role_missing"] : []),
    ].sort()),
    localOnly: true,
    writesExternalSystem: false,
    auditSubject: `${boundary.tenants[0]?.value ?? "tenant:none"}:${boundary.workspaces[0]?.value ?? "global"}:${boundary.roles[0]?.value ?? "role:none"}:mailchimp.status.read`,
    nextAction: boundary.workspaceState.ok
      ? boundary.roles.length === 0 ? "bind_role_boundary" : "handoff_permission_audit"
      : "repair_boundary_scope",
  });
  const sourceRows = capabilityRows.length > 0 ? capabilityRows : Object.freeze([baselineCapability]);
  const rows = Object.freeze(sourceRows.map((row, index) => buildBoundaryMatrixRow(row, boundary, providerContracts, index)));
  const blocked = rows.filter((row) => row.effect === "deny" || row.state === "blocked");
  const review = rows.filter((row) => row.effect === "review" || row.requiresExternalApproval);
  const missing = Object.freeze(Array.from(new Set(rows.flatMap((row) => row.missing))).sort());
  const blockers = Object.freeze([
    ...blocked.map((row) => `${row.capability}:${row.blockedBy[0] ?? "blocked"}`),
    ...missing.map((item) => `missing:${item.replace("_missing", "")}`),
  ].sort());
  const state = blockers.length > 0
    ? "blocked"
    : review.length > 0 ? "review" : providerContracts.sync?.externalWriteAllowed === true ? "external-ready" : "local-ready";

  return Object.freeze({
    schema: "aios.literal.boundary-permission-matrix.v1",
    matrixId: stableLiteralCommandId(
      "permission-matrix",
      boundary.tenants[0]?.value ?? "tenant:none",
      boundary.workspaces[0]?.value ?? "global",
      boundary.roles[0]?.value ?? "role:none",
      rows.length,
      state,
    ),
    state,
    rows,
    reviewQueue: Object.freeze([...blocked, ...review].map((row, index) => Object.freeze({
      order: index + 1,
      decisionId: row.decisionId,
      capability: row.capability,
      effect: row.effect,
      state: row.state,
      nextAction: row.nextAction,
      reason: row.reason,
      restartSafe: row.restartSafe,
    }))),
    blockers,
    counters: Object.freeze({
      rows: rows.length,
      allow: rows.filter((row) => row.effect === "allow").length,
      review: review.length,
      deny: blocked.length,
      missing: missing.length,
      externalPending: rows.filter((row) => row.requiresExternalApproval).length,
      externalReady: rows.filter((row) => row.state === "external-ready").length,
    }),
    handoff: Object.freeze({
      ready: blockers.length === 0 && review.length === 0,
      restartSafe: rows.every((row) => row.restartSafe),
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction: blockers.length > 0
        ? rows.find((row) => row.effect === "deny" || row.state === "blocked")?.nextAction ?? "repair_role_permission_boundary"
        : review.length > 0 ? "confirm_boundary_external_audit" : "handoff_permission_audit",
    }),
  });
}

function buildBoundaryPermissionEnvelope(boundary, providerContracts, auditTrail) {
  const capabilityRows = Object.freeze((boundary.capabilities ?? []).map((capability) => buildBoundaryPermissionRow(
    capability,
    boundary,
    providerContracts,
  )));
  const externalWriteRequested = providerContracts.sync?.externalWriteRequested === true;
  const externalWriteAllowed = providerContracts.sync?.externalWriteAllowed === true;
  const tenant = boundary.tenants[0]?.value ?? "";
  const workspace = boundary.workspaces[0]?.value ?? "global";
  const role = boundary.roles[0]?.value ?? "";
  const missing = Object.freeze([
    ...(externalWriteRequested && !tenant ? ["tenant"] : []),
    ...(!workspace ? ["workspace"] : []),
    ...(capabilityRows.length > 0 && !role ? ["role"] : []),
  ].sort());
  const blockedRows = capabilityRows.filter((row) => row.state === "blocked");
  const permissionMatrix = buildBoundaryPermissionMatrix(capabilityRows, boundary, providerContracts);
  const externalReady = missing.length === 0
    && blockedRows.length === 0
    && boundary.workspaceState.ok
    && boundary.permissionState.ok
    && (!externalWriteRequested || Boolean(tenant));
  const auditRows = Object.freeze([
    ...auditTrail.map((event, index) => Object.freeze({
      order: index + 1,
      type: event.type,
      subject: event.subject,
      state: event.state,
      nextAction: event.nextAction,
      restartSafe: event.state !== "blocked",
    })),
    ...capabilityRows.map((row, index) => Object.freeze({
      order: auditTrail.length + index + 1,
      type: "permission",
      subject: row.auditSubject,
      state: row.state,
      nextAction: row.nextAction,
      restartSafe: row.state !== "blocked",
    })),
  ]);
  const blockers = Object.freeze([
    ...missing.map((item) => `missing:${item}`),
    ...blockedRows.flatMap((row) => row.blockedBy.map((blocker) => `${row.capability}:${blocker}`)),
    ...auditRows.filter((row) => !row.restartSafe).map((row) => `${row.type}:${row.subject}`),
  ].sort());
  const statusState = blockers.length > 0
    ? "blocked"
    : externalWriteRequested ? "audit-ready" : "local-ready";
  const nextAction = blockers.length > 0
    ? capabilityRows.find((row) => row.state === "blocked")?.nextAction
      ?? (missing.includes("tenant") ? "bind_tenant_boundary" : missing.includes("role") ? "bind_role_boundary" : "repair_boundary_scope")
    : externalWriteRequested && !externalWriteAllowed
      ? "confirm_boundary_external_audit"
      : "handoff_permission_audit";

  return Object.freeze({
    schema: "aios.literal.boundary-permission-envelope.v1",
    state: statusState,
    tenant,
    workspace,
    role,
    externalWriteRequested,
    externalWriteAllowed: externalWriteAllowed && externalReady,
    localOnly: !(externalWriteAllowed && externalReady),
    auditHandoffReady: blockers.length === 0 && auditRows.every((row) => row.restartSafe),
    missing,
    capabilities: capabilityRows,
    permissionMatrix,
    reviewQueue: permissionMatrix.reviewQueue,
    auditRows,
    blockers,
    counters: Object.freeze({
      capabilities: capabilityRows.length,
      granted: capabilityRows.filter((row) => row.state !== "blocked").length,
      denied: capabilityRows.filter((row) => row.blockedBy.includes("permission_denied")).length,
      matrixRows: permissionMatrix.counters.rows,
      matrixReview: permissionMatrix.counters.review,
      matrixDenied: permissionMatrix.counters.deny,
      matrixExternalPending: permissionMatrix.counters.externalPending,
      auditRows: auditRows.length,
      blockers: blockers.length,
    }),
    statusPatch: Object.freeze({
      state: blockers.length > 0 ? "blocked" : externalWriteRequested ? "review" : "ready",
      nextAction,
      message: blockers.length > 0
        ? `Boundary permission envelope blocked by ${blockers[0]}.`
        : `${capabilityRows.length} capability permissions are ready for boundary audit handoff.`,
    }),
  });
}

function buildTenantBoundaryLease(boundary, providerContracts, auditTrail, permissionEnvelope) {
  const tenant = boundary.tenants[0]?.value ?? "";
  const workspace = boundary.workspaces[0]?.value ?? "global";
  const role = boundary.roles[0]?.value ?? "";
  const externalWriteRequested = providerContracts.sync?.externalWriteRequested === true
    || permissionEnvelope.externalWriteRequested === true;
  const externalWriteAllowed = providerContracts.sync?.externalWriteAllowed === true
    && permissionEnvelope.externalWriteAllowed === true;
  const statusChannel = providerContracts.sync?.statusChannels?.[0]
    ?? providerContracts.handoff?.statusChannel
    ?? "mailchimp.contract.status";
  const checkpoint = stableLiteralCommandId(
    "tenant-boundary",
    tenant || "tenant-none",
    workspace,
    role || "role-none",
    providerContracts.sync?.checkpoints?.[0] ?? "local",
  );
  const missing = Object.freeze([
    ...(externalWriteRequested && !tenant ? ["tenant"] : []),
    ...(externalWriteRequested && !workspace ? ["workspace"] : []),
    ...(boundary.capabilities.length > 0 && !role ? ["role"] : []),
  ]);
  const duplicateTenants = Object.freeze(boundary.tenants
    .filter((item) => item.value !== tenant)
    .map((item) => item.value)
    .sort());
  const workspaceEscapes = Object.freeze(boundary.workspaceState.escaped ?? []);
  const deniedCapabilities = Object.freeze(boundary.permissionState.denied ?? []);
  const permissionBlockers = Object.freeze(permissionEnvelope.blockers ?? []);
  const blockers = Object.freeze([
    ...missing.map((item) => `missing:${item}`),
    ...workspaceEscapes.map((item) => `workspace_escape:${item}`),
    ...deniedCapabilities.map((item) => `permission_denied:${item}`),
    ...(permissionEnvelope.auditHandoffReady === false ? permissionBlockers.map((item) => `permission:${item}`) : []),
  ].sort());
  const review = Object.freeze([
    ...duplicateTenants.map((item) => `tenant_ambiguous:${item}`),
    ...(externalWriteRequested && !externalWriteAllowed && blockers.length === 0 ? ["external_write_requires_confirmation"] : []),
  ].sort());
  const leaseRows = Object.freeze([
    ...boundary.tenants.map((item, index) => Object.freeze({
      schema: "aios.literal.tenant-boundary-lease-row.v1",
      order: index + 1,
      type: "tenant",
      subject: item.value,
      sourceKey: item.key,
      state: blockers.some((blocker) => blocker.startsWith("missing:tenant"))
        ? "blocked"
        : item.value === tenant ? "leased" : "review",
      checkpoint,
      statusChannel,
      restartSafe: item.value === tenant && blockers.length === 0,
      localOnly: !externalWriteAllowed,
      writesExternalSystem: externalWriteAllowed,
      idempotencyKey: stableLiteralCommandId("tenant-lease", item.value, workspace, role || "role-none"),
      nextAction: item.value === tenant ? "handoff_tenant_boundary_lease" : "select_tenant_boundary",
    })),
    ...boundary.workspaces.map((item, index) => Object.freeze({
      schema: "aios.literal.tenant-boundary-lease-row.v1",
      order: boundary.tenants.length + index + 1,
      type: "workspace",
      subject: item.value,
      sourceKey: item.key,
      state: workspaceEscapes.includes(item.value) ? "blocked" : "scoped",
      checkpoint,
      statusChannel,
      restartSafe: !workspaceEscapes.includes(item.value),
      localOnly: true,
      writesExternalSystem: false,
      idempotencyKey: stableLiteralCommandId("workspace-lease", item.value, tenant || "tenant-none"),
      nextAction: workspaceEscapes.includes(item.value) ? "repair_boundary_scope" : "handoff_workspace_boundary_lease",
    })),
    ...boundary.roles.map((item, index) => Object.freeze({
      schema: "aios.literal.tenant-boundary-lease-row.v1",
      order: boundary.tenants.length + boundary.workspaces.length + index + 1,
      type: "role",
      subject: item.value,
      sourceKey: item.key,
      state: deniedCapabilities.length > 0 ? "blocked" : "granted",
      checkpoint,
      statusChannel,
      restartSafe: deniedCapabilities.length === 0,
      localOnly: true,
      writesExternalSystem: false,
      idempotencyKey: stableLiteralCommandId("role-lease", tenant || "tenant-none", item.value),
      nextAction: deniedCapabilities.length > 0 ? "repair_role_permission_boundary" : "handoff_role_boundary_lease",
    })),
  ]);
  const auditSubjects = new Set(auditTrail.map((event) => `${event.type}:${event.subject}`));
  const unleasedAuditRows = Object.freeze(leaseRows
    .filter((row) => !auditSubjects.has(`${row.type}:${row.subject}`))
    .map((row) => `${row.type}:${row.subject}`)
    .sort());
  const ready = blockers.length === 0
    && permissionEnvelope.auditHandoffReady !== false
    && leaseRows.every((row) => row.restartSafe)
    && (!externalWriteRequested || Boolean(tenant && role));
  const state = blockers.length > 0
    ? "blocked"
    : review.length > 0 ? "review" : leaseRows.length > 0 ? "leased" : "empty";
  const nextAction = blockers.length > 0
    ? blockers[0].startsWith("missing:tenant") ? "bind_tenant_boundary"
      : blockers[0].startsWith("missing:role") ? "bind_role_boundary"
        : blockers[0].startsWith("workspace_escape") ? "repair_boundary_scope"
          : blockers[0].startsWith("permission") ? permissionEnvelope.statusPatch?.nextAction ?? "handoff_permission_audit"
            : "repair_tenant_boundary_lease"
    : review.some((item) => item.startsWith("tenant_ambiguous"))
      ? "select_tenant_boundary"
      : review.includes("external_write_requires_confirmation")
        ? "confirm_boundary_external_audit"
        : "handoff_tenant_boundary_lease";

  return Object.freeze({
    schema: "aios.literal.tenant-boundary-lease.v1",
    leaseId: checkpoint,
    state,
    tenant,
    workspace,
    role,
    rows: leaseRows,
    blockers,
    review,
    unleasedAuditRows,
    counters: Object.freeze({
      rows: leaseRows.length,
      leased: leaseRows.filter((row) => row.state === "leased" || row.state === "scoped" || row.state === "granted").length,
      blocked: leaseRows.filter((row) => row.state === "blocked").length + blockers.length,
      review: leaseRows.filter((row) => row.state === "review").length + review.length,
      restartSafe: leaseRows.filter((row) => row.restartSafe).length,
      externalWrites: leaseRows.filter((row) => row.writesExternalSystem).length,
      auditSubjects: auditSubjects.size,
      unleasedAuditRows: unleasedAuditRows.length,
    }),
    statusPatch: Object.freeze({
      state: ready ? "ready" : state === "review" ? "review" : "blocked",
      nextAction,
      message: ready
        ? `Tenant boundary lease ${tenant || "local"} is ready for ${workspace}.`
        : `Tenant boundary lease is ${state}; next action is ${nextAction}.`,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: !externalWriteAllowed,
      writesExternalSystem: externalWriteAllowed,
      restartSafe: ready,
      nextAction,
    }),
  });
}

function boundaryCommandRow(type, subject, sourceKey, state, checkpoint, statusChannel, nextAction, extras = {}) {
  const blocked = state === "blocked" || extras.restartSafe === false;
  return Object.freeze({
    schema: "aios.literal.boundary-command-row.v1",
    commandId: stableLiteralCommandId("boundary-command", type, sourceKey || subject, checkpoint, nextAction),
    type,
    subject,
    sourceKey: sourceKey || "",
    state,
    checkpoint,
    statusChannel,
    restartSafe: !blocked,
    localOnly: extras.localOnly !== false,
    writesExternalSystem: extras.writesExternalSystem === true && !blocked,
    idempotencyKey: stableLiteralCommandId("idempotent", "boundary-command", type, subject, checkpoint),
    requiredSetting: extras.requiredSetting ?? "",
    requiredControl: extras.requiredControl ?? "",
    blockedBy: Object.freeze([...(extras.blockedBy ?? [])].map(normalizeControlText).filter(Boolean).sort()),
    auditSubject: extras.auditSubject ?? `${type}:${subject}`,
    nextAction,
    reason: extras.reason ?? `${type} boundary command is ${state}.`,
  });
}

function boundaryCommandState(row, fallbackState = "ready") {
  if (row?.state === "blocked" || row?.restartSafe === false) return "blocked";
  if (row?.state === "review" || row?.requiresExternalApproval === true) return "review";
  if (["leased", "scoped", "granted", "external-ready", "audit-ready", "local-ready"].includes(row?.state)) return "ready";
  return fallbackState;
}

function buildBoundaryCommandCenter(boundary, providerContracts, permissionEnvelope, tenantBoundaryLease, diagnostics) {
  const checkpoint = tenantBoundaryLease.handoff?.checkpoint
    || stableLiteralCommandId(
      "boundary-command",
      boundary.tenants[0]?.value ?? "tenant-none",
      boundary.workspaces[0]?.value ?? "global",
      boundary.roles[0]?.value ?? "role-none",
    );
  const statusChannel = tenantBoundaryLease.handoff?.statusChannel
    || providerContracts.sync?.statusChannels?.[0]
    || "mailchimp.contract.status";
  const externalRequested = providerContracts.sync?.externalWriteRequested === true
    || permissionEnvelope.externalWriteRequested === true;
  const externalAllowed = providerContracts.sync?.externalWriteAllowed === true
    && permissionEnvelope.externalWriteAllowed === true
    && tenantBoundaryLease.handoff?.writesExternalSystem === true;
  const diagnosticRows = diagnostics.map((item) => boundaryCommandRow(
    "diagnostic",
    item.key || item.code,
    item.key || item.code,
    item.severity === "error" ? "blocked" : "review",
    checkpoint,
    statusChannel,
    item.recovery || "repair_boundary_contract",
    {
      blockedBy: [item.code],
      requiredControl: item.recovery || "",
      reason: item.message,
    },
  ));
  const leaseRows = (tenantBoundaryLease.rows ?? []).map((row) => boundaryCommandRow(
    row.type,
    row.subject,
    row.sourceKey,
    boundaryCommandState(row),
    row.checkpoint || checkpoint,
    row.statusChannel || statusChannel,
    row.nextAction,
    {
      localOnly: row.localOnly,
      writesExternalSystem: row.writesExternalSystem,
      blockedBy: row.state === "blocked" ? [row.nextAction] : [],
      requiredSetting: row.type === "tenant" ? "tenant" : row.type === "workspace" ? "workspace" : row.type === "role" ? "role" : "",
      requiredControl: row.type === "tenant" ? "tenant-boundary-lease" : row.type === "workspace" ? "workspace-scope" : "role-permission",
      auditSubject: `${row.type}:${row.subject}`,
      reason: row.state === "blocked"
        ? `${row.type} boundary lease is blocked.`
        : `${row.type} boundary lease can be replayed from ${row.checkpoint || checkpoint}.`,
    },
  ));
  const permissionRows = (permissionEnvelope.permissionMatrix?.rows ?? []).map((row) => boundaryCommandRow(
    "permission",
    `${row.principal}:${row.capability}`,
    row.decisionId,
    row.effect === "deny" || row.state === "blocked" ? "blocked" : row.effect === "review" ? "review" : "ready",
    checkpoint,
    statusChannel,
    row.nextAction,
    {
      localOnly: row.localOnly,
      writesExternalSystem: row.writesExternalSystem && externalAllowed,
      blockedBy: row.blockedBy,
      requiredControl: row.requiresExternalApproval ? "external-boundary-approval" : "permission-audit",
      auditSubject: row.resource,
      reason: row.reason,
    },
  ));
  const rows = Object.freeze([...diagnosticRows, ...leaseRows, ...permissionRows]
    .sort((left, right) => `${left.type}:${left.subject}:${left.commandId}`.localeCompare(`${right.type}:${right.subject}:${right.commandId}`))
    .map((row, index) => Object.freeze({ order: index + 1, ...row })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const missingSettings = Object.freeze(Array.from(new Set([
    ...(permissionEnvelope.missing ?? []),
    ...(tenantBoundaryLease.blockers ?? []),
    ...blockedRows.flatMap((row) => row.blockedBy),
  ].map((item) => String(item).replace(/^missing:/, "")).filter(Boolean))).sort());
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (externalRequested && !externalAllowed ? "confirm_boundary_external_audit" : rows.length > 0 ? "handoff_boundary_command_center" : "attach_boundary_literals");
  const state = blockedRows.length > 0
    ? "blocked"
    : reviewRows.length > 0 || (externalRequested && !externalAllowed)
      ? "review"
      : rows.length > 0 ? "ready" : "empty";

  return Object.freeze({
    schema: "aios.literal.boundary-command-center.v1",
    revision: stableLiteralCommandId("boundary-command-center", checkpoint, state, rows.length, blockedRows.length, reviewRows.length),
    state,
    rows,
    commands: rows,
    requiredSettings: Object.freeze({
      tenant: boundary.tenants[0]?.value ?? "",
      workspace: boundary.workspaces[0]?.value ?? "global",
      role: boundary.roles[0]?.value ?? "",
      missing: missingSettings,
      externalApprovalRequired: externalRequested && !externalAllowed,
    }),
    controls: Object.freeze({
      enableExternalAudit: externalRequested && externalAllowed && blockedRows.length === 0,
      holdExternalAudit: externalRequested && !externalAllowed,
      requireOperatorReview: blockedRows.length > 0,
      replayLeaseCommands: rows.some((row) => row.type !== "diagnostic" && row.restartSafe),
    }),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blockedRows.length,
      review: reviewRows.length + (externalRequested && !externalAllowed ? 1 : 0),
      ready: rows.filter((row) => row.state === "ready").length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
      diagnostics: diagnosticRows.length,
      permissions: permissionRows.length,
      leases: leaseRows.length,
      missingSettings: missingSettings.length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.type}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.type}:${row.subject}:${row.nextAction}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0 && (!externalRequested || externalAllowed || reviewRows.length > 0),
      checkpoint,
      statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      restartSafe: blockedRows.length === 0,
      nextAction,
    }),
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
    ...uniqueWorkspaces.map((item) => buildBoundaryAuditEvent("workspace", item.value, workspaceState.ok ? "scoped" : "blocked", workspaceState.nextAction, `Workspace boundary ${item.value} is ${workspaceState.ok ? "scoped" : "blocked"}.`)),
    ...uniqueTenants.map((item) => buildBoundaryAuditEvent("tenant", item.value, "isolated", "handoff_tenant_audit", `Tenant ${item.value} is isolated for Mailchimp handoff.`)),
    ...uniqueRoles.map((item) => buildBoundaryAuditEvent("role", item.value, permissionState.ok ? "granted" : "blocked", permissionState.nextAction, `Role ${item.value} permission level is ${permissionState.level}.`)),
    ...uniqueCapabilities.map((item) => buildBoundaryAuditEvent("capability", item.value, permissionState.denied.includes(item.value) ? "denied" : "requested", permissionState.nextAction, `Capability ${item.value} requires level ${capabilityPermissionLevel(item.value)}.`)),
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
  const permissionEnvelope = buildBoundaryPermissionEnvelope(provisional, providerContracts, auditTrail);
  const tenantBoundaryLease = buildTenantBoundaryLease(provisional, providerContracts, auditTrail, permissionEnvelope);
  const commandCenter = buildBoundaryCommandCenter(provisional, providerContracts, permissionEnvelope, tenantBoundaryLease, diagnostics);
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;

  return Object.freeze({
    schema: "aios.literal.boundary-contract.v1",
    workspaces: uniqueWorkspaces,
    tenants: uniqueTenants,
    roles: uniqueRoles,
    capabilities: uniqueCapabilities,
    workspaceState,
    permissionState,
    permissionEnvelope,
    tenantBoundaryLease,
    commandCenter,
    diagnostics,
    auditTrail,
    handoff: Object.freeze({
      ready: errorCount === 0
        && workspaceState.ok
        && permissionState.ok
        && permissionEnvelope.auditHandoffReady
        && tenantBoundaryLease.handoff.ready
        && commandCenter.handoff.ready,
      tenant: uniqueTenants[0]?.value ?? "",
      workspace: uniqueWorkspaces[0]?.value ?? "global",
      role: primaryRole,
      localOnly: commandCenter.handoff.localOnly,
      writesExternalSystem: commandCenter.handoff.writesExternalSystem,
      nextAction: errorCount > 0
        ? diagnostics.find((item) => item.severity === "error")?.recovery ?? "repair_boundary_scope"
        : commandCenter.handoff.nextAction !== "handoff_boundary_command_center"
          ? commandCenter.handoff.nextAction
        : permissionEnvelope.statusPatch.nextAction !== "handoff_permission_audit"
          ? permissionEnvelope.statusPatch.nextAction
          : tenantBoundaryLease.handoff.nextAction !== "handoff_tenant_boundary_lease"
            ? tenantBoundaryLease.handoff.nextAction
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

function buildLiteralLifecycleReadiness(workflowControls, runtimeState, providerContracts, diagnostics) {
  const disabled = new Set(workflowControls.disabled ?? []);
  const rows = Object.freeze((workflowControls.controls ?? []).map((control, index) => {
    const command = (runtimeState.commands ?? []).find((item) => item.key === control.key && item.value === control.value && item.type.includes(control.type));
    const parsedSchedule = control.type === "schedule" ? parseLiteralSchedule(control.value) : null;
    const suppressed = control.type === "enable" && disabled.has(control.value);
    const blockers = Object.freeze([
      ...(control.type === "schedule" && parsedSchedule?.valid === false ? ["invalid_schedule"] : []),
      ...(command?.state === "blocked" ? ["runtime_command_blocked"] : []),
      ...(command?.restartSafe === false ? ["runtime_command_not_restart_safe"] : []),
      ...(providerContracts.handoff?.ready === false && command?.writesExternalSystem === true ? ["provider_handoff_not_ready"] : []),
    ].sort());
    const state = blockers.length > 0
      ? "blocked"
      : suppressed || command?.state === "skipped" ? "suppressed" : "ready";

    return Object.freeze({
      schema: "aios.literal.lifecycle-readiness-row.v1",
      order: index + 1,
      key: control.key,
      type: control.type,
      value: stableLiteralValue(control.value),
      state,
      suppressed,
      commandId: command?.id ?? "",
      checkpoint: command?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: command?.statusChannel ?? runtimeState.statusChannel,
      idempotencyKey: command?.idempotencyKey ?? stableLiteralCommandId("idempotent", "literal-lifecycle-readiness", control.type, control.key, control.value),
      restartSafe: blockers.length === 0 && command?.restartSafe !== false,
      localOnly: command?.localOnly ?? providerContracts.sync?.localOnly !== false,
      writesExternalSystem: command?.writesExternalSystem === true,
      parsedSchedule,
      blockers,
      nextAction: blockers.includes("invalid_schedule")
        ? "repair_literal_schedule"
        : blockers.includes("provider_handoff_not_ready")
          ? providerContracts.handoff?.nextAction ?? "repair_literal_provider_contract"
          : blockers.length > 0
            ? command?.nextAction ?? workflowControls.nextAction
            : suppressed ? "retain_disabled_literal_lifecycle_control" : command?.nextAction ?? "apply_literal_lifecycle_control",
    });
  }));
  const diagnosticRows = Object.freeze([
    ...(workflowControls.diagnostics ?? []),
    ...diagnostics.filter((item) => item.code === "AIOS_LITERAL_WORKFLOW_SCHEDULE"),
  ].map((item) => Object.freeze({
    schema: "aios.literal.lifecycle-readiness-diagnostic.v1",
    code: item.code,
    severity: item.severity,
    message: item.message,
    key: item.key ?? "",
    nextAction: item.recovery,
  })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const warningRows = diagnosticRows.filter((row) => row.severity === "warning");
  const ready = blockedRows.length === 0
    && workflowControls.valid !== false
    && runtimeState.persistedView?.restartSafe !== false
    && providerContracts.handoff?.ready !== false;
  const nextAction = blockedRows[0]?.nextAction
    ?? diagnosticRows[0]?.nextAction
    ?? (rows.length > 0 ? "adopt_literal_lifecycle_readiness" : "attach_literal_lifecycle_control");

  return Object.freeze({
    schema: "aios.literal.lifecycle-readiness.v1",
    state: ready ? (warningRows.length > 0 ? "review" : "ready") : "blocked",
    rows,
    diagnostics: diagnosticRows,
    counters: Object.freeze({
      rows: rows.length,
      ready: rows.filter((row) => row.state === "ready").length,
      suppressed: rows.filter((row) => row.state === "suppressed").length,
      blocked: blockedRows.length,
      warnings: warningRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `literal:${row.type}:${row.key}:${row.nextAction}`).sort()),
      review: Object.freeze(warningRows.map((row) => `diagnostic:${row.code}:${row.key}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      localOnly: rows.every((row) => row.localOnly !== false),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildLiteralOperatorControlPanel(workflowControls, lifecycleReadiness, runtimeState, providerContracts, operationalHealth, previewAcceptance) {
  const lifecycleRows = Object.freeze((lifecycleReadiness.rows ?? []).map((row, index) => Object.freeze({
    schema: "aios.literal.operator-control-row.v1",
    order: index + 1,
    source: "lifecycle",
    subject: `${row.type}:${row.key}`,
    state: row.state,
    enabled: row.state !== "suppressed" && row.state !== "blocked",
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    commandId: row.commandId,
    nextAction: row.nextAction,
  })));
  const providerRows = Object.freeze((providerContracts.providers ?? []).map((provider, index) => Object.freeze({
    schema: "aios.literal.operator-control-row.v1",
    order: lifecycleRows.length + index + 1,
    source: "provider",
    subject: `${provider.sourceKey}:${provider.adapter}`,
    state: provider.handoff?.ready === true ? "ready" : "blocked",
    enabled: provider.handoff?.ready === true,
    restartSafe: provider.idempotency?.restartSafe === true,
    localOnly: provider.sync?.localOnly !== false,
    writesExternalSystem: provider.sync?.externalWriteAllowed === true,
    checkpoint: provider.sync?.checkpoint ?? "",
    statusChannel: provider.sync?.statusChannel ?? "mailchimp.contract.status",
    commandId: stableLiteralCommandId("literal-operator-provider", provider.sourceKey, provider.adapter),
    nextAction: provider.handoff?.nextAction ?? "repair_literal_provider_contract",
  })));
  const recoveryRows = Object.freeze((previewAcceptance.rows ?? []).filter((row) => row.source === "diagnostic" || row.state === "blocked").map((row, index) => Object.freeze({
    schema: "aios.literal.operator-control-row.v1",
    order: lifecycleRows.length + providerRows.length + index + 1,
    source: "preview",
    subject: row.subject,
    state: row.state,
    enabled: row.state !== "blocked",
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    checkpoint: previewAcceptance.handoff?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: previewAcceptance.handoff?.statusChannel ?? runtimeState.statusChannel,
    commandId: stableLiteralCommandId("literal-operator-preview", row.source, row.subject),
    nextAction: row.nextAction,
  })));
  const rows = Object.freeze([...lifecycleRows, ...providerRows, ...recoveryRows]);
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const disabledControls = Object.freeze([
    ...(workflowControls.disabled ?? []).map((value) => `workflow:${value}`),
    ...rows.filter((row) => row.enabled === false).map((row) => `${row.source}:${row.subject}`),
  ].sort());
  const state = blockedRows.length > 0
    ? "blocked"
    : operationalHealth.state === "degraded" ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? operationalHealth.statusPatch?.nextAction
    ?? (rows.length > 0 ? "publish_literal_operator_controls" : "attach_literal_operator_controls");

  return Object.freeze({
    schema: "aios.literal.operator-control-panel.v1",
    revision: stableLiteralCommandId("literal-operator-controls", runtimeState.revision, state, rows.length, blockedRows.length),
    state,
    rows,
    disabledControls,
    counters: Object.freeze({
      rows: rows.length,
      lifecycle: lifecycleRows.length,
      providers: providerRows.length,
      preview: recoveryRows.length,
      enabled: rows.filter((row) => row.enabled).length,
      disabled: disabledControls.length,
      blocked: blockedRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0 && runtimeState.persistedView?.restartSafe !== false,
      acceptedForExternalWrite: blockedRows.length === 0 && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint: previewAcceptance.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: previewAcceptance.handoff?.statusChannel ?? runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
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

function buildLiteralStatusLedger(commands, replayState, checkpoint, statusChannel, diagnostics) {
  const rows = Object.freeze(commands.map((command, index) => {
    const expectedState = command.state === "ready" ? "queued" : command.state;
    const persistedState = command.restartSafe === true
      ? expectedState
      : "blocked";
    const drifted = persistedState !== expectedState || !command.idempotencyKey;
    return Object.freeze({
      schema: "aios.literal.status-ledger-row.v1",
      sequence: index + 1,
      rowId: stableLiteralCommandId("literal-ledger", checkpoint, index + 1, command.type, command.key, command.value),
      commandId: command.id,
      type: command.type,
      key: command.key,
      value: command.value,
      checkpoint: command.checkpoint,
      statusChannel: command.statusChannel,
      expectedState,
      persistedState,
      drifted,
      restartSafe: command.restartSafe === true && !drifted,
      idempotencyKey: command.idempotencyKey,
      localOnly: command.localOnly !== false,
      writesExternalSystem: command.writesExternalSystem === true,
      nextAction: drifted ? "rebuild_literal_status_ledger" : command.nextAction,
    });
  }));
  const driftRows = rows.filter((row) => row.drifted || !row.restartSafe);
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const errors = diagnostics.filter((item) => item.severity === "error");
  const state = errors.length > 0 || driftRows.length > 0
    ? "blocked"
    : warnings.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";

  return Object.freeze({
    schema: "aios.literal.status-ledger.v1",
    revision: stableLiteralCommandId(
      "literal-status-ledger",
      checkpoint,
      replayState,
      rows.length,
      driftRows.length,
      warnings.length,
      errors.length,
    ),
    state,
    replayState,
    checkpoint,
    statusChannel,
    rows,
    blockers: Object.freeze([
      ...driftRows.map((row) => `literal-ledger:${row.commandId}`),
      ...errors.map((item) => `diagnostic:${item.code}`),
    ].sort()),
    counters: Object.freeze({
      rows: rows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      drifted: driftRows.length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
      warnings: warnings.length,
      errors: errors.length,
    }),
    handoff: Object.freeze({
      ready: driftRows.length === 0 && errors.length === 0,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction: driftRows[0]?.nextAction
        ?? errors[0]?.recovery
        ?? (rows.length > 0 ? "persist_literal_status_ledger" : "retain_empty_literal_status_ledger"),
    }),
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
  const statusLedger = buildLiteralStatusLedger(commands, replayState, checkpoint, statusChannel, diagnostics);

  return Object.freeze({
    schema: "aios.literal.runtime-state.v1",
    revision,
    replayState,
    checkpoint,
    statusChannel,
    commands,
    statusLedger,
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
      restartSafe: blocked.length === 0 && errors.length === 0 && statusLedger.handoff.ready === true,
      blockedCommandIds: Object.freeze(blocked.map((command) => command.id).sort()),
      idempotencyKeys: Object.freeze(commands.map((command) => command.idempotencyKey).filter(Boolean).sort()),
      statusLedgerRevision: statusLedger.revision,
      statusLedgerBlockers: statusLedger.blockers,
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

function buildLiteralResumeManifest(runtimeState, providerContracts, workflowControls, diagnostics) {
  const commandRows = Object.freeze((runtimeState.commands ?? []).map((command, index) => {
    const persistedState = command.restartSafe === true
      ? command.statusPatch?.state ?? (command.state === "ready" ? "queued" : command.state)
      : "blocked";
    const canReplay = command.restartSafe === true
      && command.idempotent === true
      && Boolean(command.idempotencyKey)
      && persistedState !== "blocked";
    return Object.freeze({
      schema: "aios.literal.resume-command-row.v1",
      sequence: index + 1,
      commandId: command.id,
      type: command.type,
      key: command.key,
      checkpoint: command.checkpoint,
      statusChannel: command.statusChannel,
      persistedState,
      replayState: canReplay ? "replayable" : "held",
      idempotencyKey: command.idempotencyKey,
      restartSafe: command.restartSafe === true,
      idempotent: command.idempotent === true,
      localOnly: command.localOnly !== false,
      writesExternalSystem: command.writesExternalSystem === true,
      nextAction: canReplay ? command.nextAction : command.statusPatch?.nextAction ?? "repair_literal_resume_command",
    });
  }));
  const blockers = Object.freeze([
    ...commandRows
      .filter((row) => row.replayState !== "replayable")
      .map((row) => `command:${row.commandId}`),
    ...diagnostics
      .filter((item) => item.severity === "error")
      .map((item) => `diagnostic:${item.code}:${item.key ?? "literal"}`),
    ...(runtimeState.statusLedger?.blockers ?? []).map((blocker) => `status-ledger:${blocker}`),
  ].sort());
  const replayableRows = commandRows.filter((row) => row.replayState === "replayable");
  const checkpoint = runtimeState.checkpoint || providerContracts.sync?.checkpoints?.[0] || "literal:local";
  const statusChannel = runtimeState.statusChannel || providerContracts.sync?.statusChannels?.[0] || "mailchimp.contract.status";
  const externalRows = commandRows.filter((row) => row.writesExternalSystem);
  const state = blockers.length > 0
    ? "blocked"
    : replayableRows.length > 0 ? "resume-ready" : "empty";

  return Object.freeze({
    schema: "aios.literal.resume-manifest.v1",
    revision: stableLiteralCommandId(
      "literal-resume",
      runtimeState.revision,
      state,
      commandRows.length,
      blockers.length,
    ),
    state,
    checkpoint,
    statusChannel,
    rows: commandRows,
    blockers,
    counters: Object.freeze({
      rows: commandRows.length,
      replayable: replayableRows.length,
      held: commandRows.length - replayableRows.length,
      restartSafe: commandRows.filter((row) => row.restartSafe).length,
      idempotent: commandRows.filter((row) => row.idempotent).length,
      externalWrites: externalRows.length,
      diagnostics: diagnostics.length,
      errors: diagnostics.filter((item) => item.severity === "error").length,
    }),
    clientState: Object.freeze({
      requiredKeys: Object.freeze([
        "literalResumeManifestRevision",
        "literalResumeCheckpoint",
        "literalResumeStatusChannel",
        "literalResumeToken",
      ]),
      persistedState: Object.freeze({
        literalResumeManifestRevision: stableLiteralCommandId("literal-resume", runtimeState.revision, commandRows.length),
        literalResumeCheckpoint: checkpoint,
        literalResumeStatusChannel: statusChannel,
        literalResumeToken: stableLiteralCommandId("resume", checkpoint, state, replayableRows.length),
        literalRuntimeRevision: runtimeState.revision,
      }),
      hydrated: Boolean(checkpoint && statusChannel),
    }),
    replay: Object.freeze({
      available: state === "resume-ready",
      replayFromCheckpoint: state === "resume-ready",
      nextCommandId: replayableRows[0]?.commandId ?? "",
      idempotencyKeys: Object.freeze(commandRows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      blockedCommandIds: Object.freeze(commandRows.filter((row) => row.replayState !== "replayable").map((row) => row.commandId).sort()),
    }),
    handoff: Object.freeze({
      ready: state !== "blocked",
      checkpoint,
      statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0 && providerContracts.sync?.externalWriteAllowed === true,
      nextAction: blockers.length > 0
        ? "repair_literal_resume_manifest"
        : replayableRows.length > 0
          ? "persist_literal_resume_manifest"
          : workflowControls.nextAction ?? "retain_empty_literal_resume_manifest",
    }),
  });
}

function buildLiteralRestartDigest(runtimeState, resumeManifest, operationalHealth, providerContracts) {
  const rows = Object.freeze((resumeManifest.rows ?? []).map((row, index) => {
    const persistedState = row.persistedState || "unknown";
    const blocked = row.replayState !== "replayable"
      || row.restartSafe !== true
      || row.idempotent !== true
      || !row.idempotencyKey;
    return Object.freeze({
      schema: "aios.literal.restart-digest-row.v1",
      sequence: index + 1,
      commandId: row.commandId,
      type: row.type,
      key: row.key,
      checkpoint: row.checkpoint || resumeManifest.checkpoint || runtimeState.checkpoint,
      statusChannel: row.statusChannel || resumeManifest.statusChannel || runtimeState.statusChannel,
      persistedState,
      expectedState: row.replayState === "replayable" ? persistedState : "blocked",
      replayState: row.replayState,
      restartSafe: row.restartSafe === true && !blocked,
      idempotencyKey: row.idempotencyKey,
      writesExternalSystem: row.writesExternalSystem === true,
      blocker: blocked ? `literal-restart:${row.commandId || index + 1}:${row.nextAction}` : "",
      nextAction: blocked ? row.nextAction || "repair_literal_restart_digest" : "replay_literal_restart_command",
    });
  }));
  const blockedRows = rows.filter((row) => row.blocker);
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const statusLedgerReady = runtimeState.statusLedger?.handoff?.ready !== false;
  const healthReady = operationalHealth.handoffReady !== false && operationalHealth.state !== "failed";
  const providerReady = providerContracts.handoff?.ready !== false;
  const accepted = blockedRows.length === 0
    && statusLedgerReady
    && healthReady
    && providerReady
    && resumeManifest.handoff?.ready !== false;
  const checkpoint = resumeManifest.checkpoint || runtimeState.checkpoint || providerContracts.sync?.checkpoints?.[0] || "literal:local";
  const statusChannel = resumeManifest.statusChannel || runtimeState.statusChannel || providerContracts.sync?.statusChannels?.[0] || "mailchimp.contract.status";
  const revision = stableLiteralCommandId(
    "literal-restart-digest",
    resumeManifest.revision,
    runtimeState.revision,
    accepted ? "accepted" : "blocked",
    rows.length,
    blockedRows.length,
  );

  return Object.freeze({
    schema: "aios.literal.restart-digest.v1",
    revision,
    state: accepted ? (rows.length > 0 ? "restart-ready" : "empty") : "blocked",
    checkpoint,
    statusChannel,
    rows,
    blockers: Object.freeze(blockedRows.map((row) => row.blocker).sort()),
    counters: Object.freeze({
      rows: rows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      blocked: blockedRows.length,
      externalWrites: externalRows.length,
      statusLedgerRows: runtimeState.statusLedger?.counters?.rows ?? 0,
      statusLedgerDrifted: runtimeState.statusLedger?.counters?.drifted ?? 0,
    }),
    persistedState: Object.freeze({
      restartDigestRevision: revision,
      restartDigestCheckpoint: checkpoint,
      restartDigestStatusChannel: statusChannel,
      restartDigestToken: stableLiteralCommandId("literal-restart-token", checkpoint, revision),
      resumeManifestRevision: resumeManifest.revision,
      runtimeRevision: runtimeState.revision,
      replayState: runtimeState.replayState,
    }),
    handoff: Object.freeze({
      ready: accepted,
      checkpoint,
      statusChannel,
      localOnly: providerContracts.sync?.localOnly !== false && externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0 && providerContracts.sync?.externalWriteAllowed === true,
      nextAction: blockedRows[0]?.nextAction
        ?? (accepted ? "handoff_literal_restart_digest" : "repair_literal_restart_digest"),
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

function literalHealthIncidentSeverity(row) {
  if (row.code?.includes("BOUNDARY") || row.code?.includes("HANDOFF")) return "critical";
  if (row.code?.includes("RUNTIME") || row.code?.includes("IDEMPOTENCY")) return "major";
  if (row.code?.includes("EXTERNAL_SYNC")) return "minor";
  return row.action?.includes("repair") ? "major" : "minor";
}

function buildLiteralIncidentSnapshot(operationalHealth, providerContracts, boundaryContract, runtimeState) {
  const incidentRows = Object.freeze([
    ...(operationalHealth.failures ?? []).map((failure, index) => Object.freeze({
      schema: "aios.literal.incident-row.v1",
      order: index + 1,
      source: "literal-health",
      subject: `${failure.code}:${failure.key}`,
      code: failure.code,
      severity: literalHealthIncidentSeverity(failure),
      state: "failed",
      checkpoint: operationalHealth.statusPatch?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: providerContracts.sync?.statusChannels?.[0] ?? runtimeState.statusChannel,
      restartSafe: false,
      localOnly: true,
      writesExternalSystem: false,
      nextAction: failure.action,
      detail: failure.detail,
    })),
    ...(operationalHealth.degraded ?? []).map((event, index) => Object.freeze({
      schema: "aios.literal.incident-row.v1",
      order: (operationalHealth.failures?.length ?? 0) + index + 1,
      source: "literal-health",
      subject: `${event.code}:${event.key}`,
      code: event.code,
      severity: literalHealthIncidentSeverity(event),
      state: "degraded",
      checkpoint: operationalHealth.statusPatch?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: providerContracts.sync?.statusChannels?.[0] ?? runtimeState.statusChannel,
      restartSafe: runtimeState.persistedView?.restartSafe === true,
      localOnly: providerContracts.sync?.localOnly !== false,
      writesExternalSystem: false,
      nextAction: event.action,
      detail: event.detail,
    })),
    ...(boundaryContract.permissionEnvelope?.reviewQueue ?? []).map((row, index) => Object.freeze({
      schema: "aios.literal.incident-row.v1",
      order: (operationalHealth.failures?.length ?? 0) + (operationalHealth.degraded?.length ?? 0) + index + 1,
      source: "boundary-permission",
      subject: row.decisionId,
      code: row.effect === "deny" ? "AIOS_MAILCHIMP_PERMISSION_DENIED" : "AIOS_MAILCHIMP_PERMISSION_REVIEW",
      severity: row.effect === "deny" ? "critical" : "minor",
      state: row.effect === "deny" ? "failed" : "review",
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: providerContracts.sync?.externalWriteAllowed !== true,
      writesExternalSystem: false,
      nextAction: row.nextAction,
      detail: row.reason,
    })),
  ]);
  const failures = incidentRows.filter((row) => row.state === "failed");
  const review = incidentRows.filter((row) => row.state === "review" || row.state === "degraded");
  const retryable = operationalHealth.retryable === true
    && failures.length === 0
    && runtimeState.resume?.available === true
    && runtimeState.persistedView?.restartSafe === true;
  const state = failures.length > 0 ? "failed" : review.length > 0 ? "review" : "healthy";
  const nextAction = failures[0]?.nextAction
    ?? review[0]?.nextAction
    ?? (incidentRows.length > 0 ? "monitor_literal_mailchimp_incidents" : "retain_literal_mailchimp_health");

  return Object.freeze({
    schema: "aios.literal.incident-snapshot.v1",
    revision: stableLiteralCommandId(
      "literal-incident",
      runtimeState.revision,
      state,
      incidentRows.length,
      failures.length,
      review.length,
    ),
    state,
    rows: incidentRows,
    counters: Object.freeze({
      rows: incidentRows.length,
      failures: failures.length,
      review: review.length,
      restartSafe: incidentRows.filter((row) => row.restartSafe).length,
      externalWrites: incidentRows.filter((row) => row.writesExternalSystem).length,
    }),
    retry: Object.freeze({
      available: retryable,
      strategy: retryable ? operationalHealth.backoff?.strategy ?? "checkpoint-linear" : "none",
      backoffSeconds: retryable ? operationalHealth.backoff?.seconds ?? 0 : 0,
      checkpoint: runtimeState.checkpoint,
      nextCommandId: runtimeState.resume?.nextCommandId ?? "",
    }),
    handoff: Object.freeze({
      ready: failures.length === 0,
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      localOnly: true,
      writesExternalSystem: false,
      nextAction,
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

function deploymentControlKey(control) {
  return stableLiteralCommandId(control.type, control.key, control.value);
}

function buildLiteralDeploymentPlan(workflowControls, providerContracts, runtimeState, boundaryContract, operationalHealth, adoptionSignature, releaseReport) {
  const disabled = new Set(workflowControls.disabled ?? []);
  const commandsByControl = new Map((runtimeState.commands ?? [])
    .filter((command) => command.type.startsWith("mailchimp.feature.")
      || command.type === "mailchimp.schedule.configure"
      || command.type === "mailchimp.setting.apply")
    .map((command) => [stableLiteralCommandId(
      command.type.includes(".enable") ? "enable"
        : command.type.includes(".disable") ? "disable"
          : command.type.includes(".schedule") ? "schedule" : "setting",
      command.key,
      command.value,
    ), command]));
  const controlRows = Object.freeze((workflowControls.controls ?? []).map((control, index) => {
    const parsedSchedule = control.type === "schedule" ? parseLiteralSchedule(control.value) : null;
    const command = commandsByControl.get(deploymentControlKey(control));
    const disabledByControl = control.type === "enable" && disabled.has(control.value);
    const blocked = control.type === "schedule" && parsedSchedule?.valid === false
      || command?.state === "blocked"
      || command?.restartSafe === false;
    const state = blocked
      ? "blocked"
      : disabledByControl ? "suppressed" : command?.state === "skipped" ? "suppressed" : "ready";
    return Object.freeze({
      schema: "aios.literal.deployment-control-row.v1",
      order: index + 1,
      key: control.key,
      type: control.type,
      value: stableLiteralValue(control.value),
      state,
      commandId: command?.id ?? "",
      idempotencyKey: command?.idempotencyKey ?? stableLiteralCommandId("literal-control", control.type, control.key, control.value),
      restartSafe: command?.restartSafe !== false && state !== "blocked",
      localOnly: command?.localOnly !== false,
      writesExternalSystem: command?.writesExternalSystem === true,
      schedule: parsedSchedule ? Object.freeze({
        mode: parsedSchedule.mode,
        cadence: parsedSchedule.cadence,
        valid: parsedSchedule.valid,
      }) : null,
      nextAction: state === "blocked"
        ? command?.nextAction ?? "repair_literal_workflow"
        : state === "suppressed"
          ? "retain_suppressed_literal_control"
          : command?.nextAction ?? "apply_literal_workflow_control",
    });
  }));
  const settingRows = Object.freeze(Object.entries(workflowControls.settings ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value], index) => {
      const command = (runtimeState.commands ?? []).find((item) => item.type === "mailchimp.setting.apply" && item.key === key);
      return Object.freeze({
        schema: "aios.literal.deployment-setting-row.v1",
        order: index + 1,
        key,
        value: stableLiteralValue(value),
        state: command?.state === "blocked" ? "blocked" : "ready",
        commandId: command?.id ?? "",
        restartSafe: command?.restartSafe !== false,
        nextAction: command?.state === "blocked" ? command.nextAction : "apply_literal_setting",
      });
    }));
  const scheduleRows = Object.freeze((workflowControls.schedules ?? []).map((schedule, index) => {
    const command = (runtimeState.commands ?? []).find((item) => item.type === "mailchimp.schedule.configure" && item.key === schedule.key);
    return Object.freeze({
      schema: "aios.literal.deployment-schedule-row.v1",
      order: index + 1,
      key: schedule.key,
      value: schedule.value,
      mode: schedule.parsed.mode,
      cadence: schedule.parsed.cadence,
      valid: schedule.parsed.valid,
      state: schedule.parsed.valid && command?.state !== "blocked" ? "ready" : "blocked",
      commandId: command?.id ?? "",
      restartSafe: schedule.parsed.valid && command?.restartSafe !== false,
      nextAction: schedule.parsed.valid ? "schedule_literal_workflow" : "repair_literal_schedule",
    });
  }));
  const blockers = Object.freeze([
    ...controlRows.filter((row) => row.state === "blocked").map((row) => `control:${row.type}:${row.key}`),
    ...settingRows.filter((row) => row.state === "blocked" || row.restartSafe === false).map((row) => `setting:${row.key}`),
    ...scheduleRows.filter((row) => row.state === "blocked" || row.restartSafe === false).map((row) => `schedule:${row.key}`),
    ...(boundaryContract.handoff?.ready === false ? [`boundary:${boundaryContract.handoff.nextAction}`] : []),
    ...(operationalHealth.handoffReady === false ? [`health:${operationalHealth.statusPatch?.nextAction ?? "repair_literal_operational_health"}`] : []),
    ...(releaseReport.handoff?.ready === false ? [`release:${releaseReport.handoff.nextAction}`] : []),
    ...(adoptionSignature.handoff?.ready === false ? (adoptionSignature.handoff.blockedReasons ?? []).map((reason) => `adoption:${reason}`) : []),
  ].sort());
  const statusChannel = adoptionSignature.handoff?.statusChannel
    || runtimeState.statusChannel
    || providerContracts.sync?.statusChannels?.[0]
    || "mailchimp.contract.status";
  const checkpoint = adoptionSignature.handoff?.checkpoint
    || runtimeState.checkpoint
    || providerContracts.sync?.checkpoints?.[0]
    || "literal:local";
  const ready = blockers.length === 0
    && runtimeState.persistedView?.restartSafe === true
    && workflowControls.valid !== false
    && adoptionSignature.handoff?.ready === true
    && releaseReport.releaseReady === true;

  return Object.freeze({
    schema: "aios.literal.deployment-plan.v1",
    revision: stableLiteralCommandId(
      "literal-deployment",
      runtimeState.revision,
      adoptionSignature.revision,
      releaseReport.revision,
      blockers.length,
      controlRows.length,
    ),
    ready,
    state: ready ? "ready" : blockers.some((blocker) => blocker.startsWith("schedule:")) ? "needs-schedule-repair" : "blocked",
    checkpoint,
    statusChannel,
    controls: controlRows,
    settings: settingRows,
    schedules: scheduleRows,
    counters: Object.freeze({
      controls: controlRows.length,
      settings: settingRows.length,
      schedules: scheduleRows.length,
      readyControls: controlRows.filter((row) => row.state === "ready").length,
      suppressedControls: controlRows.filter((row) => row.state === "suppressed").length,
      blockedControls: controlRows.filter((row) => row.state === "blocked").length,
      restartSafe: controlRows.filter((row) => row.restartSafe).length + settingRows.filter((row) => row.restartSafe).length + scheduleRows.filter((row) => row.restartSafe).length,
    }),
    blockers,
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: providerContracts.sync?.localOnly !== false,
      writesExternalSystem: providerContracts.sync?.externalWriteAllowed === true,
      nextAction: blockers.length > 0
        ? blockers[0].split(":").slice(1).join(":") || "repair_literal_deployment_plan"
        : "adopt_literal_deployment_plan",
    }),
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

function buildLiteralSyncBridge(providerContracts, runtimeState, workflowControls, boundaryContract, releaseReport, deploymentPlan) {
  const permissionEnvelope = boundaryContract.permissionEnvelope ?? {};
  const providerRows = Object.freeze((providerContracts.providers ?? []).map((provider, index) => {
    const commands = (runtimeState.commands ?? [])
      .filter((command) => command.checkpoint === provider.sync.checkpoint || command.key === provider.sourceKey)
      .sort((left, right) => left.id.localeCompare(right.id));
    const blockedCommand = commands.find((command) => command.state === "blocked" || command.restartSafe === false);
    const boundaryBlocked = provider.sync.externalWriteRequested === true && permissionEnvelope.auditHandoffReady === false;
    const state = provider.handoff.ready === false || blockedCommand || boundaryBlocked
      ? "blocked"
      : provider.sync.externalWriteRequested && !provider.sync.externalWriteAllowed
        ? "review"
        : "ready";

    return Object.freeze({
      schema: "aios.literal.sync-bridge-provider-row.v1",
      order: index + 1,
      key: provider.sourceKey,
      service: provider.service,
      adapter: provider.adapter,
      state,
      checkpoint: provider.sync.checkpoint,
      statusChannel: provider.sync.statusChannel,
      requestedCapabilities: provider.requestedCapabilities,
      commandIds: Object.freeze(commands.map((command) => command.id)),
      restartSafe: provider.idempotency.restartSafe === true && commands.every((command) => command.restartSafe !== false),
      localOnly: provider.sync.localOnly,
      externalWriteRequested: provider.sync.externalWriteRequested,
      externalWriteAllowed: provider.sync.externalWriteAllowed && permissionEnvelope.externalWriteAllowed !== false,
      tenant: boundaryContract.handoff?.tenant ?? "",
      permissionEnvelopeState: permissionEnvelope.state ?? "unknown",
      permissionAuditReady: permissionEnvelope.auditHandoffReady === true,
      nextAction: state === "ready"
        ? "handoff_literal_sync_provider"
        : boundaryBlocked
          ? permissionEnvelope.statusPatch?.nextAction ?? "handoff_permission_audit"
          : blockedCommand?.nextAction ?? provider.handoff.nextAction,
    });
  }));
  const capabilityRows = Object.freeze((workflowControls.mailchimpScopes ?? []).map((scope, index) => {
    const providers = providerRows.filter((row) => row.requestedCapabilities.includes(scope));
    return Object.freeze({
      schema: "aios.literal.sync-bridge-capability-row.v1",
      order: index + 1,
      capability: scope,
      providerKeys: Object.freeze(providers.map((row) => row.key).sort()),
      covered: providers.length > 0,
      state: providers.length > 0 ? "covered" : "missing-provider",
      nextAction: providers.length > 0 ? "negotiate_literal_mailchimp_capability" : "attach_literal_mailchimp_provider",
    });
  }));
  const statusChannels = Object.freeze(Array.from(new Set([
    ...(providerContracts.sync?.statusChannels ?? []),
    runtimeState.statusChannel,
    releaseReport.handoff?.statusChannel,
    deploymentPlan.handoff?.statusChannel,
  ].filter(Boolean))).sort());
  const checkpoints = Object.freeze(Array.from(new Set([
    ...(providerContracts.sync?.checkpoints ?? []),
    runtimeState.checkpoint,
    releaseReport.handoff?.checkpoint,
    deploymentPlan.handoff?.checkpoint,
  ].filter(Boolean))).sort());
  const blocked = Object.freeze([
    ...providerRows
      .filter((row) => row.state === "blocked" || row.restartSafe === false)
      .map((row) => `provider:${row.key}:${row.nextAction}`),
    ...capabilityRows
      .filter((row) => !row.covered)
      .map((row) => `capability:${row.capability}`),
    ...(boundaryContract.handoff?.ready === false ? [`boundary:${boundaryContract.handoff.nextAction}`] : []),
    ...(releaseReport.handoff?.ready === false ? [`release:${releaseReport.handoff.nextAction}`] : []),
    ...(deploymentPlan.handoff?.ready === false ? [`deployment:${deploymentPlan.handoff.nextAction}`] : []),
  ].sort());
  const review = Object.freeze(providerRows
    .filter((row) => row.state === "review")
    .map((row) => `external-sync:${row.key}`));
  const ready = blocked.length === 0
    && runtimeState.persistedView?.restartSafe === true
    && releaseReport.handoff?.ready === true
    && deploymentPlan.handoff?.ready === true;

  return Object.freeze({
    schema: "aios.literal.sync-bridge.v1",
    ready,
    state: blocked.length > 0 ? "blocked" : review.length > 0 ? "review" : ready ? "ready" : "warming",
    providers: providerRows,
    capabilities: capabilityRows,
    statusChannels,
    checkpoints,
    boundary: Object.freeze({
      tenant: boundaryContract.handoff?.tenant ?? "",
      workspace: boundaryContract.handoff?.workspace ?? "global",
      role: boundaryContract.handoff?.role ?? "",
      ready: boundaryContract.handoff?.ready !== false,
      permissionEnvelopeState: permissionEnvelope.state ?? "unknown",
      permissionAuditReady: permissionEnvelope.auditHandoffReady === true,
      permissionBlockers: Object.freeze(permissionEnvelope.blockers ?? []),
    }),
    counters: Object.freeze({
      providers: providerRows.length,
      capabilities: capabilityRows.length,
      coveredCapabilities: capabilityRows.filter((row) => row.covered).length,
      blocked: blocked.length,
      review: review.length,
      restartSafeProviders: providerRows.filter((row) => row.restartSafe).length,
      permissionBlockers: permissionEnvelope.counters?.blockers ?? 0,
    }),
    blockers: blocked,
    review,
    handoff: Object.freeze({
      ready,
      checkpoint: checkpoints[0] || "literal:local",
      statusChannel: statusChannels[0] || "mailchimp.contract.status",
      localOnly: providerContracts.sync?.localOnly !== false,
      writesExternalSystem: providerContracts.sync?.externalWriteAllowed === true && permissionEnvelope.externalWriteAllowed === true,
      nextAction: blocked.length > 0
        ? blocked[0].split(":").slice(2).join(":") || "repair_literal_sync_bridge"
        : review.length > 0 ? "confirm_literal_external_sync" : "adopt_literal_sync_bridge",
    }),
  });
}

function buildLiteralProviderNegotiation(providerContracts, runtimeState, workflowControls, boundaryContract, syncBridge) {
  const permissionEnvelope = boundaryContract.permissionEnvelope ?? {};
  const requestedCapabilities = Object.freeze(Array.from(new Set([
    ...(providerContracts.requestedCapabilities ?? []),
    ...(workflowControls.mailchimpScopes ?? []),
  ].filter(Boolean))).sort());
  const providerCapabilitySet = new Set((providerContracts.providers ?? [])
    .flatMap((provider) => provider.requestedCapabilities ?? []));
  const missingCapabilities = Object.freeze(requestedCapabilities
    .filter((capability) => !providerCapabilitySet.has(capability))
    .sort());
  const providerRows = Object.freeze((providerContracts.providers ?? []).map((provider, index) => {
    const syncRow = (syncBridge.providers ?? []).find((row) => row.key === provider.sourceKey);
    const runtimeCommands = (runtimeState.commands ?? [])
      .filter((command) => command.key === provider.sourceKey || command.checkpoint === provider.sync.checkpoint)
      .sort((left, right) => left.id.localeCompare(right.id));
    const blockers = Object.freeze([
      ...(provider.handoff.ready ? [] : ["provider_handoff"]),
      ...(provider.idempotency.restartSafe ? [] : ["provider_idempotency"]),
      ...(runtimeCommands.some((command) => command.restartSafe === false || command.state === "blocked") ? ["runtime_command"] : []),
      ...(provider.sync.externalWriteRequested && permissionEnvelope.auditHandoffReady === false ? ["permission_envelope"] : []),
      ...(syncRow?.state === "blocked" ? ["sync_bridge"] : []),
    ].sort());
    const review = Object.freeze([
      ...(provider.sync.externalWriteRequested && !provider.sync.externalWriteAllowed ? ["external_sync_confirmation"] : []),
      ...(syncRow?.state === "review" ? ["sync_bridge_review"] : []),
    ].sort());
    const state = blockers.length > 0 ? "blocked" : review.length > 0 ? "review" : "negotiated";

    return Object.freeze({
      schema: "aios.literal.provider-negotiation-row.v1",
      order: index + 1,
      sourceKey: provider.sourceKey,
      service: provider.service,
      adapter: provider.adapter,
      state,
      checkpoint: provider.sync.checkpoint,
      statusChannel: provider.sync.statusChannel,
      requestedCapabilities: provider.requestedCapabilities,
      commandIds: Object.freeze(runtimeCommands.map((command) => command.id)),
      idempotencyKey: provider.idempotency.key,
      restartSafe: blockers.length === 0 && provider.idempotency.restartSafe === true,
      localOnly: provider.sync.localOnly || permissionEnvelope.externalWriteAllowed !== true,
      externalWriteRequested: provider.sync.externalWriteRequested,
      externalWriteAllowed: provider.sync.externalWriteAllowed && permissionEnvelope.externalWriteAllowed === true,
      blockers,
      review,
      nextAction: blockers.includes("permission_envelope")
        ? permissionEnvelope.statusPatch?.nextAction ?? "handoff_permission_audit"
        : blockers.includes("runtime_command")
          ? runtimeCommands.find((command) => command.state === "blocked" || command.restartSafe === false)?.nextAction ?? "repair_literal_runtime_state"
          : blockers.length > 0
            ? provider.handoff.nextAction
            : review.length > 0 ? "confirm_literal_provider_negotiation" : "handoff_literal_provider_negotiation",
    });
  }));
  const blockers = Object.freeze([
    ...missingCapabilities.map((capability) => `capability:${capability}`),
    ...providerRows.flatMap((row) => row.blockers.map((blocker) => `provider:${row.sourceKey}:${blocker}`)),
    ...(syncBridge.handoff?.ready === false ? [`sync:${syncBridge.handoff.nextAction}`] : []),
  ].sort());
  const review = Object.freeze(providerRows
    .flatMap((row) => row.review.map((item) => `provider:${row.sourceKey}:${item}`))
    .sort());
  const negotiated = blockers.length === 0
    && providerRows.every((row) => row.state === "negotiated" || row.state === "review")
    && missingCapabilities.length === 0;
  const externalWriteAllowed = providerRows.some((row) => row.externalWriteAllowed)
    && permissionEnvelope.externalWriteAllowed === true
    && blockers.length === 0;
  const statusChannels = Object.freeze(Array.from(new Set([
    ...(providerContracts.sync?.statusChannels ?? []),
    syncBridge.handoff?.statusChannel,
    ...providerRows.map((row) => row.statusChannel),
  ].filter(Boolean))).sort());
  const checkpoints = Object.freeze(Array.from(new Set([
    ...(providerContracts.sync?.checkpoints ?? []),
    syncBridge.handoff?.checkpoint,
    ...providerRows.map((row) => row.checkpoint),
  ].filter(Boolean))).sort());

  return Object.freeze({
    schema: "aios.literal.provider-negotiation.v1",
    state: blockers.length > 0 ? "blocked" : review.length > 0 ? "review" : negotiated ? "negotiated" : "warming",
    negotiated,
    providers: providerRows,
    requestedCapabilities,
    missingCapabilities,
    blockers,
    review,
    counters: Object.freeze({
      providers: providerRows.length,
      requestedCapabilities: requestedCapabilities.length,
      missingCapabilities: missingCapabilities.length,
      negotiatedProviders: providerRows.filter((row) => row.state === "negotiated").length,
      reviewProviders: providerRows.filter((row) => row.state === "review").length,
      blockedProviders: providerRows.filter((row) => row.state === "blocked").length,
      externalWriteProviders: providerRows.filter((row) => row.externalWriteAllowed).length,
    }),
    sync: Object.freeze({
      localOnly: !externalWriteAllowed,
      externalWriteRequested: providerRows.some((row) => row.externalWriteRequested),
      externalWriteAllowed,
      checkpoints,
      statusChannels,
    }),
    handoff: Object.freeze({
      ready: negotiated,
      checkpoint: checkpoints[0] || "literal:provider-negotiation",
      statusChannel: statusChannels[0] || "mailchimp.contract.status",
      localOnly: !externalWriteAllowed,
      writesExternalSystem: externalWriteAllowed,
      nextAction: blockers.length > 0
        ? blockers[0].split(":").slice(2).join(":") || "repair_literal_provider_negotiation"
        : review.length > 0 ? "confirm_literal_provider_negotiation" : "handoff_literal_provider_negotiation",
    }),
  });
}

function buildLiteralProviderCommitWindow(providerNegotiation, providerContracts, syncBridge, runtimeState) {
  const providerRows = Object.freeze((providerNegotiation.providers ?? []).map((row, index) => {
    const provider = (providerContracts.providers ?? []).find((item) => item.sourceKey === row.sourceKey);
    const syncRow = (syncBridge.providers ?? []).find((item) => item.key === row.sourceKey);
    const externalRequested = row.externalWriteRequested === true || provider?.sync?.externalWriteRequested === true;
    const externalAllowed = row.externalWriteAllowed === true && provider?.sync?.externalWriteAllowed === true;
    const blockers = Object.freeze([
      ...(row.blockers ?? []).map((blocker) => `provider:${blocker}`),
      ...(row.restartSafe === true ? [] : ["provider:restart_safety"]),
      ...(syncRow?.state === "blocked" ? ["sync:blocked"] : []),
      ...(externalRequested && !externalAllowed ? ["sync:external_confirmation"] : []),
    ].sort());
    const review = Object.freeze([
      ...(row.review ?? []).map((item) => `provider:${item}`),
      ...(syncRow?.state === "review" ? ["sync:review"] : []),
    ].sort());
    const state = blockers.length > 0 ? "held" : review.length > 0 ? "review" : externalAllowed ? "commit-ready" : "preview-ready";
    const checkpoint = row.checkpoint || provider?.sync?.checkpoint || runtimeState.checkpoint;
    const statusChannel = row.statusChannel || provider?.sync?.statusChannel || runtimeState.statusChannel;

    return Object.freeze({
      schema: "aios.literal.provider-commit-window-row.v1",
      order: index + 1,
      sourceKey: row.sourceKey,
      service: row.service || provider?.service || "mailchimp",
      adapter: row.adapter || provider?.adapter || "mailchimp",
      state,
      checkpoint,
      statusChannel,
      requestedCapabilities: row.requestedCapabilities ?? provider?.requestedCapabilities ?? Object.freeze([]),
      idempotencyKey: row.idempotencyKey || provider?.idempotency?.key || stableLiteralCommandId("idempotent", "literal-provider", row.sourceKey),
      restartSafe: blockers.length === 0 && row.restartSafe === true,
      localOnly: !externalAllowed,
      writesExternalSystem: externalAllowed,
      blockers,
      review,
      nextAction: blockers.includes("sync:external_confirmation")
        ? "confirm_literal_provider_commit_window"
        : blockers.length > 0
          ? row.nextAction ?? "repair_literal_provider_commit_window"
          : review.length > 0 ? "review_literal_provider_commit_window" : "commit_literal_provider_status",
    });
  }));
  const blockers = Object.freeze(providerRows
    .filter((row) => row.state === "held" || row.restartSafe === false)
    .map((row) => `${row.sourceKey}:${row.nextAction}`)
    .sort());
  const review = Object.freeze(providerRows
    .flatMap((row) => row.review.map((item) => `${row.sourceKey}:${item}`))
    .sort());
  const externalRows = providerRows.filter((row) => row.writesExternalSystem);
  const checkpoints = Object.freeze(Array.from(new Set([
    providerNegotiation.handoff?.checkpoint,
    syncBridge.handoff?.checkpoint,
    runtimeState.checkpoint,
    ...providerRows.map((row) => row.checkpoint),
  ].filter(Boolean))).sort());
  const statusChannels = Object.freeze(Array.from(new Set([
    providerNegotiation.handoff?.statusChannel,
    syncBridge.handoff?.statusChannel,
    runtimeState.statusChannel,
    ...providerRows.map((row) => row.statusChannel),
  ].filter(Boolean))).sort());
  const state = blockers.length > 0
    ? "held"
    : review.length > 0 ? "review" : externalRows.length > 0 ? "commit-ready" : providerRows.length > 0 ? "preview-ready" : "empty";
  const nextAction = blockers.length > 0
    ? "repair_literal_provider_commit_window"
    : review.length > 0 ? "review_literal_provider_commit_window" : "handoff_literal_provider_commit_window";

  return Object.freeze({
    schema: "aios.literal.provider-commit-window.v1",
    revision: stableLiteralCommandId("literal-provider-commit", providerNegotiation.revision, state, providerRows.length, blockers.length, review.length),
    state,
    rows: providerRows,
    blockers,
    review,
    counters: Object.freeze({
      rows: providerRows.length,
      held: providerRows.filter((row) => row.state === "held").length,
      review: providerRows.filter((row) => row.state === "review").length,
      commitReady: providerRows.filter((row) => row.state === "commit-ready").length,
      previewReady: providerRows.filter((row) => row.state === "preview-ready").length,
      externalWrites: externalRows.length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockers.length === 0,
      acceptedForExternalWrite: blockers.length === 0 && externalRows.length > 0,
      blockedBy: blockers,
      review,
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockers.length === 0,
      checkpoint: checkpoints[0] || runtimeState.checkpoint,
      statusChannel: statusChannels[0] || runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function literalReadinessRowState(row) {
  if (!row) return "blocked";
  if (row.state === "blocked" || row.ready === false || row.restartSafe === false) return "blocked";
  if (row.state === "review" || row.state === "degraded") return "review";
  if (row.state === "publishable" || row.state === "release-ready" || row.ready === true) return "ready";
  return row.state ?? "ready";
}

function buildLiteralClientReadiness(contracts, exportSummary, exportPackage, releaseReport, workflowControls, providerContracts, boundaryContract, runtimeState, operationalHealth, deploymentPlan, syncBridge) {
  const permissionEnvelope = boundaryContract.permissionEnvelope ?? {};
  const providerRows = Object.freeze((providerContracts.providers ?? []).map((provider, index) => Object.freeze({
    schema: "aios.literal.client-readiness-provider-row.v1",
    order: index + 1,
    sourceKey: provider.sourceKey,
    service: provider.service,
    adapter: provider.adapter,
    state: provider.handoff.ready ? "ready" : "blocked",
    checkpoint: provider.sync.checkpoint,
    statusChannel: provider.sync.statusChannel,
    restartSafe: provider.idempotency.restartSafe === true,
    localOnly: provider.sync.localOnly,
    writesExternalSystem: provider.sync.externalWriteAllowed && permissionEnvelope.externalWriteAllowed === true,
    capabilities: provider.requestedCapabilities,
    permissionAuditReady: permissionEnvelope.auditHandoffReady === true,
    nextAction: permissionEnvelope.auditHandoffReady === false
      ? permissionEnvelope.statusPatch?.nextAction ?? "handoff_permission_audit"
      : provider.handoff.nextAction,
  })));
  const workflowRows = Object.freeze((workflowControls.controls ?? []).map((control, index) => {
    const command = (runtimeState.commands ?? []).find((item) => item.key === control.key && item.value === control.value);
    const blocked = command?.state === "blocked" || command?.restartSafe === false || control.valid === false;
    return Object.freeze({
      schema: "aios.literal.client-readiness-workflow-row.v1",
      order: index + 1,
      type: control.type,
      key: control.key,
      value: control.value,
      state: blocked ? "blocked" : command?.state === "skipped" ? "suppressed" : "ready",
      commandId: command?.id ?? "",
      restartSafe: command?.restartSafe !== false && !blocked,
      statusChannel: command?.statusChannel ?? runtimeState.statusChannel,
      checkpoint: command?.checkpoint ?? runtimeState.checkpoint,
      nextAction: blocked ? command?.nextAction ?? workflowControls.nextAction : command?.nextAction ?? "apply_literal_workflow_control",
    });
  }));
  const exportRows = Object.freeze((exportPackage.manifest ?? []).map((row, index) => Object.freeze({
    schema: "aios.literal.client-readiness-export-row.v1",
    order: index + 1,
    key: row.key,
    role: row.role,
    state: row.state,
    publishable: row.state === "publishable",
    restartSafe: row.runtime.restartSafe,
    commandIds: row.runtime.commandIds,
    boundaryBlocked: row.boundary.blocked,
    nextAction: row.nextAction,
  })));
  const releaseRows = Object.freeze((releaseReport.rows ?? []).map((row, index) => Object.freeze({
    schema: "aios.literal.client-readiness-release-row.v1",
    order: index + 1,
    key: row.key,
    role: row.role,
    state: row.state,
    releaseReady: row.state === "release-ready",
    restartSafe: row.restartSafe !== false,
    nextAction: row.nextAction,
  })));
  const boundaryRows = Object.freeze((boundaryContract.auditTrail ?? []).map((event, index) => Object.freeze({
    schema: "aios.literal.client-readiness-boundary-row.v1",
    order: index + 1,
    type: event.type,
    subject: event.subject,
    state: event.state,
    restartSafe: event.state !== "blocked",
    localOnly: event.localOnly !== false,
    writesExternalSystem: event.writesExternalSystem === true,
    nextAction: event.nextAction,
  })));
  const permissionRows = Object.freeze((permissionEnvelope.auditRows ?? []).map((row, index) => Object.freeze({
    schema: "aios.literal.client-readiness-permission-row.v1",
    order: index + 1,
    type: row.type,
    subject: row.subject,
    state: row.state,
    restartSafe: row.restartSafe,
    localOnly: permissionEnvelope.localOnly !== false,
    writesExternalSystem: permissionEnvelope.externalWriteAllowed === true,
    nextAction: row.nextAction,
  })));
  const deploymentRows = Object.freeze((deploymentPlan.controls ?? []).map((row, index) => Object.freeze({
    schema: "aios.literal.client-readiness-deployment-row.v1",
    order: index + 1,
    type: row.type,
    key: row.key,
    state: row.state,
    restartSafe: row.restartSafe !== false,
    nextAction: row.nextAction,
  })));
  const allRows = Object.freeze([
    ...providerRows.map((row) => Object.freeze({ source: "provider", subject: row.sourceKey, state: row.state, restartSafe: row.restartSafe, nextAction: row.nextAction })),
    ...workflowRows.map((row) => Object.freeze({ source: "workflow", subject: `${row.type}:${row.key}`, state: row.state, restartSafe: row.restartSafe, nextAction: row.nextAction })),
    ...exportRows.map((row) => Object.freeze({ source: "export", subject: row.key, state: row.state, restartSafe: row.restartSafe, nextAction: row.nextAction })),
    ...releaseRows.map((row) => Object.freeze({ source: "release", subject: row.key, state: row.state, restartSafe: row.restartSafe, nextAction: row.nextAction })),
    ...boundaryRows.map((row) => Object.freeze({ source: "boundary", subject: `${row.type}:${row.subject}`, state: row.state, restartSafe: row.restartSafe, nextAction: row.nextAction })),
    ...permissionRows.map((row) => Object.freeze({ source: "permission", subject: `${row.type}:${row.subject}`, state: row.state, restartSafe: row.restartSafe, nextAction: row.nextAction })),
    ...deploymentRows.map((row) => Object.freeze({ source: "deployment", subject: `${row.type}:${row.key}`, state: row.state, restartSafe: row.restartSafe, nextAction: row.nextAction })),
  ].sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
  const blockers = Object.freeze([
    ...allRows.filter((row) => literalReadinessRowState(row) === "blocked").map((row) => `${row.source}:${row.subject}:${row.nextAction}`),
    ...(permissionEnvelope.auditHandoffReady === false ? (permissionEnvelope.blockers ?? []).map((blocker) => `permission:${blocker}`) : []),
    ...(runtimeState.persistedView?.restartSafe === false ? (runtimeState.persistedView.blockedCommandIds ?? []).map((id) => `runtime:${id}`) : []),
    ...(operationalHealth.handoffReady === false ? [`health:${operationalHealth.statusPatch?.nextAction ?? "repair_literal_operational_health"}`] : []),
    ...(syncBridge.handoff?.ready === false ? [`sync:${syncBridge.handoff.nextAction}`] : []),
  ].sort());
  const review = Object.freeze([
    ...allRows.filter((row) => literalReadinessRowState(row) === "review").map((row) => `${row.source}:${row.subject}`),
    ...(operationalHealth.state === "degraded" ? (operationalHealth.degraded ?? []).map((row) => `health:${row.code}`) : []),
    ...(syncBridge.review ?? []).map((item) => `sync:${item}`),
  ].sort());
  const acceptedForRuntime = blockers.length === 0
    && runtimeState.clientHandoff?.ready === true
    && exportSummary.exportReady === true
    && exportPackage.handoff?.ready === true
    && releaseReport.handoff?.ready === true
    && deploymentPlan.handoff?.ready === true
    && syncBridge.handoff?.ready === true
    && operationalHealth.handoffReady === true;
  const nextAction = blockers.length > 0
    ? blockers[0].split(":").slice(2).join(":") || "repair_literal_client_readiness"
    : review.length > 0 ? "review_literal_client_readiness" : "accept_literal_client_readiness";
  const statusChannels = Object.freeze(Array.from(new Set([
    runtimeState.statusChannel,
    exportPackage.handoff?.statusChannel,
    releaseReport.handoff?.statusChannel,
    deploymentPlan.handoff?.statusChannel,
    syncBridge.handoff?.statusChannel,
    ...(providerContracts.sync?.statusChannels ?? []),
  ].filter(Boolean))).sort());
  const checkpoints = Object.freeze(Array.from(new Set([
    runtimeState.checkpoint,
    exportPackage.handoff?.checkpoint,
    releaseReport.handoff?.checkpoint,
    deploymentPlan.handoff?.checkpoint,
    syncBridge.handoff?.checkpoint,
    ...(providerContracts.sync?.checkpoints ?? []),
  ].filter(Boolean))).sort());

  return Object.freeze({
    schema: "aios.literal.client-readiness.v1",
    preview: Object.freeze({
      previewId: stableLiteralCommandId("literal-client-preview", runtimeState.revision, blockers.length, review.length),
      title: "Mailchimp literal readiness",
      status: blockers.length > 0 ? "blocked" : review.length > 0 ? "review" : acceptedForRuntime ? "ready" : "warming",
      rows: allRows,
      providerRows,
      workflowRows,
      exportRows,
      releaseRows,
      boundaryRows,
      permissionRows,
      deploymentRows,
      counters: Object.freeze({
        contracts: contracts.length,
        rows: allRows.length,
        providers: providerRows.length,
        workflowControls: workflowRows.length,
        publishableExports: exportRows.filter((row) => row.publishable).length,
        releaseReadyRows: releaseRows.filter((row) => row.releaseReady).length,
        boundaryRows: boundaryRows.length,
        permissionRows: permissionRows.length,
        permissionBlockers: permissionEnvelope.counters?.blockers ?? 0,
        deploymentRows: deploymentRows.length,
        blocked: blockers.length,
        review: review.length,
      }),
    }),
    validationSummary: Object.freeze({
      state: blockers.length > 0 ? "blocked" : review.length > 0 ? "review" : acceptedForRuntime ? "ready" : "warming",
      restartSafe: runtimeState.persistedView?.restartSafe === true,
      exportReady: exportSummary.exportReady === true,
      operationalHealth: operationalHealth.state,
      syncBridgeReady: syncBridge.handoff?.ready === true,
      permissionEnvelopeState: permissionEnvelope.state ?? "unknown",
      permissionAuditReady: permissionEnvelope.auditHandoffReady === true,
      blocked: blockers.length,
      review: review.length,
      nextAction,
    }),
    acceptance: Object.freeze({
      required: blockers.length > 0 || review.length > 0 || providerContracts.sync?.externalWriteRequested === true,
      acceptedForRuntime,
      acceptedForExternalWrite: providerContracts.sync?.externalWriteAllowed === true
        && permissionEnvelope.externalWriteAllowed === true
        && acceptedForRuntime,
      blockedBy: blockers,
      review,
      nextAction,
    }),
    handoff: Object.freeze({
      ready: acceptedForRuntime,
      checkpoint: checkpoints[0] || runtimeState.checkpoint,
      statusChannel: statusChannels[0] || runtimeState.statusChannel,
      statusChannels,
      localOnly: providerContracts.sync?.localOnly !== false,
      writesExternalSystem: providerContracts.sync?.externalWriteAllowed === true && permissionEnvelope.externalWriteAllowed === true,
      nextAction,
    }),
    nextSteps: Object.freeze([
      ...blockers.map((blocker, index) => Object.freeze({
        order: index + 1,
        action: blocker.split(":").slice(2).join(":") || "repair_literal_client_readiness",
        subject: blocker,
        restartSafe: false,
      })),
      ...(blockers.length === 0 ? [Object.freeze({
        order: 1,
        action: nextAction,
        subject: checkpoints[0] || runtimeState.checkpoint,
        restartSafe: true,
      })] : []),
    ]),
  });
}

function literalClientActionState(row) {
  if (row.state === "blocked" || row.restartSafe === false) return "blocked";
  if (row.state === "review" || row.state === "degraded") return "review";
  if (row.state === "suppressed" || row.state === "skipped") return "suppressed";
  if (row.state === "publishable" || row.state === "release-ready" || row.state === "audit-ready" || row.state === "local-ready") return "queued";
  return row.state === "ready" ? "queued" : row.state ?? "queued";
}

function literalActionQueueRow(source, subject, action, row, runtimeState, fallback = {}) {
  const state = literalClientActionState(row);
  return Object.freeze({
    source,
    subject,
    action,
    commandId: row.commandId ?? fallback.commandId ?? "",
    checkpoint: row.checkpoint ?? fallback.checkpoint ?? runtimeState.checkpoint,
    statusChannel: row.statusChannel ?? fallback.statusChannel ?? runtimeState.statusChannel,
    idempotencyKey: row.idempotencyKey ?? fallback.idempotencyKey ?? stableLiteralCommandId("idempotent", source, subject, action),
    state,
    restartSafe: row.restartSafe !== false && state !== "blocked",
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    statusPatch: Object.freeze({
      state,
      nextAction: action,
      message: fallback.message ?? `${source} ${subject} is ${state} for Mailchimp client replay.`,
    }),
  });
}

function buildLiteralClientActionQueue(runtimeState, exportPackage, releaseReport, deploymentPlan, syncBridge, clientReadiness, analyticsExportJournal) {
  const runtimeRows = (runtimeState.commands ?? []).map((command) => literalActionQueueRow(
    "literal-runtime",
    `${command.type}:${command.key}`,
    command.nextAction,
    command,
    runtimeState,
    {
      commandId: command.id,
      idempotencyKey: command.idempotencyKey,
      message: command.statusPatch?.message,
    },
  ));
  const exportRows = (exportPackage.manifest ?? [])
    .filter((row) => row.state === "publishable" || row.state === "blocked" || row.runtime.restartSafe === false || row.boundary.blocked)
    .map((row) => literalActionQueueRow(
      "literal-export-package",
      `${row.role}:${row.key}`,
      row.nextAction,
      row,
      runtimeState,
      {
        checkpoint: exportPackage.handoff?.checkpoint,
        statusChannel: exportPackage.handoff?.statusChannel,
        idempotencyKey: stableLiteralCommandId("idempotent", "literal-export", row.key, exportPackage.revision),
        message: `Literal export ${row.key} is ${row.state}.`,
      },
    ));
  const releaseRows = (releaseReport.rows ?? []).map((row) => literalActionQueueRow(
    "literal-release-report",
    `${row.role}:${row.key}`,
    row.nextAction,
    row,
    runtimeState,
    {
      checkpoint: releaseReport.handoff?.checkpoint,
      statusChannel: releaseReport.handoff?.statusChannel,
      idempotencyKey: stableLiteralCommandId("idempotent", "literal-release", row.key, releaseReport.revision),
      message: `Literal release row ${row.key} is ${row.state}.`,
    },
  ));
  const deploymentRows = (deploymentPlan.controls ?? []).map((row) => literalActionQueueRow(
    "literal-deployment",
    `${row.type}:${row.key}`,
    row.nextAction,
    row,
    runtimeState,
    {
      checkpoint: deploymentPlan.handoff?.checkpoint,
      statusChannel: deploymentPlan.handoff?.statusChannel,
      idempotencyKey: stableLiteralCommandId("idempotent", "literal-deployment", row.type, row.key, deploymentPlan.revision),
      message: `Literal deployment control ${row.key} is ${row.state}.`,
    },
  ));
  const syncRows = (syncBridge.rows ?? []).map((row) => literalActionQueueRow(
    "literal-sync-bridge",
    `${row.source}:${row.subject}`,
    row.nextAction,
    row,
    runtimeState,
    {
      checkpoint: row.checkpoint || syncBridge.handoff?.checkpoint,
      statusChannel: row.statusChannel || syncBridge.handoff?.statusChannel,
      idempotencyKey: stableLiteralCommandId("idempotent", "literal-sync", row.source, row.subject, syncBridge.revision),
      message: `Literal sync bridge ${row.subject} is ${row.state}.`,
    },
  ));
  const readinessRows = (clientReadiness.nextSteps ?? []).map((step) => literalActionQueueRow(
    "literal-client-readiness",
    step.subject,
    step.action,
    step,
    runtimeState,
    {
      checkpoint: clientReadiness.handoff?.checkpoint,
      statusChannel: clientReadiness.handoff?.statusChannel,
      commandId: stableLiteralCommandId("literal-readiness-step", clientReadiness.preview?.previewId, step.order, step.subject),
      idempotencyKey: stableLiteralCommandId("idempotent", "literal-readiness", step.action, step.subject),
      message: `Literal client readiness step ${step.subject} is ${clientReadiness.validationSummary?.state ?? "unknown"}.`,
    },
  ));
  const analyticsRows = (analyticsExportJournal.nextSteps ?? []).map((step) => literalActionQueueRow(
    "literal-analytics-journal",
    step.subject,
    step.action,
    step,
    runtimeState,
    {
      checkpoint: analyticsExportJournal.handoff?.checkpoint,
      statusChannel: analyticsExportJournal.handoff?.statusChannel,
      commandId: stableLiteralCommandId("literal-analytics-step", analyticsExportJournal.report?.reportId, step.order, step.subject),
      idempotencyKey: stableLiteralCommandId("idempotent", "literal-analytics", step.action, step.subject),
      message: `Literal analytics journal step ${step.subject} is ${analyticsExportJournal.report?.state ?? "unknown"}.`,
    },
  ));
  const rows = Object.freeze([...runtimeRows, ...exportRows, ...releaseRows, ...deploymentRows, ...syncRows, ...readinessRows, ...analyticsRows]
    .map((row, index) => Object.freeze({
      schema: "aios.literal.client-action-row.v1",
      order: index + 1,
      id: stableLiteralCommandId("literal-client-action", index + 1, row.source, row.commandId || row.subject),
      ...row,
    }))
    .sort((left, right) => left.id.localeCompare(right.id)));
  const blockers = rows.filter((row) => row.state === "blocked" || !row.restartSafe);
  const review = rows.filter((row) => row.state === "review");
  const ready = blockers.length === 0
    && clientReadiness.handoff?.ready !== false
    && deploymentPlan.handoff?.ready !== false
    && syncBridge.handoff?.ready !== false
    && analyticsExportJournal.handoff?.ready !== false;

  return Object.freeze({
    schema: "aios.literal.client-action-queue.v1",
    revision: stableLiteralCommandId(
      "literal-client-actions",
      runtimeState.revision,
      exportPackage.revision,
      releaseReport.revision,
      rows.length,
      blockers.length,
    ),
    rows,
    blockers: Object.freeze(blockers.map((row) => `${row.source}:${row.subject}`).sort()),
    review: Object.freeze(review.map((row) => `${row.source}:${row.subject}`).sort()),
    counters: Object.freeze({
      rows: rows.length,
      queued: rows.filter((row) => row.state === "queued").length,
      blocked: blockers.length,
      review: review.length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint: clientReadiness.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: clientReadiness.handoff?.statusChannel ?? runtimeState.statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction: blockers[0]?.action
        ?? (review.length > 0 ? "review_literal_client_actions" : "adopt_literal_client_actions"),
    }),
  });
}

function journalMetricRow(kind, name, count, exportReady, nextAction) {
  return Object.freeze({
    schema: "aios.literal.analytics-journal-metric.v1",
    kind,
    name,
    count,
    state: exportReady ? "export-ready" : count > 0 ? "observed" : "empty",
    exportReady,
    nextAction,
  });
}

function buildLiteralAnalyticsExportJournal(analytics, history, exportSummary, exportPackage, releaseReport, clientReadiness, syncBridge) {
  const roleRows = Object.freeze(Object.entries(analytics.byRole ?? {}).map(([role, count]) => journalMetricRow(
    "role",
    role,
    count,
    (exportSummary.exportableKeys ?? []).some((key) => key.toLowerCase().endsWith(`.${role}`) || key === role),
    role === "literal" ? "retain_local_literal_metrics" : `export_${role}_analytics`,
  )));
  const kindRows = Object.freeze(Object.entries(analytics.byKind ?? {}).map(([kind, count]) => journalMetricRow(
    "kind",
    kind,
    count,
    count > 0 && analytics.counters.errors === 0,
    `report_${kind}_literal_metrics`,
  )));
  const exportRows = Object.freeze((exportPackage.manifest ?? []).map((row, index) => Object.freeze({
    schema: "aios.literal.analytics-journal-export-row.v1",
    order: index + 1,
    key: row.key,
    role: row.role,
    kind: row.kind,
    state: row.state,
    publishable: row.state === "publishable",
    providerBacked: Boolean(row.provider),
    restartSafe: row.runtime?.restartSafe !== false,
    boundaryBlocked: row.boundary?.blocked === true,
    nextAction: row.nextAction,
  })));
  const historyRows = Object.freeze((history.timeline ?? []).map((event) => Object.freeze({
    schema: "aios.literal.analytics-journal-history-row.v1",
    sequence: event.sequence,
    key: event.key,
    role: event.role,
    kind: event.kind,
    state: event.state,
    diagnosticCount: event.diagnosticCount,
    nextAction: event.nextAction,
  })));
  const releaseRows = Object.freeze((releaseReport.rows ?? []).map((row, index) => Object.freeze({
    schema: "aios.literal.analytics-journal-release-row.v1",
    order: index + 1,
    key: row.key,
    role: row.role,
    state: row.state,
    releaseReady: row.state === "release-ready",
    healthState: row.health?.state ?? "unknown",
    nextAction: row.nextAction,
  })));
  const blockers = Object.freeze([
    ...(exportSummary.blockedKeys ?? []).map((key) => `export:${key}`),
    ...exportRows
      .filter((row) => row.state === "blocked" || !row.restartSafe || row.boundaryBlocked)
      .map((row) => `export-row:${row.key}:${row.nextAction}`),
    ...releaseRows
      .filter((row) => row.state === "blocked" || row.healthState === "failed")
      .map((row) => `release-row:${row.key}:${row.nextAction}`),
    ...(clientReadiness.acceptance?.blockedBy ?? []).map((blocker) => `client-readiness:${blocker}`),
    ...(syncBridge.blockers ?? []).map((blocker) => `sync:${blocker}`),
  ].sort());
  const review = Object.freeze([
    ...historyRows
      .filter((row) => row.state === "local")
      .map((row) => `local:${row.key}`),
    ...releaseRows
      .filter((row) => !row.releaseReady && row.state !== "blocked" && row.healthState !== "failed")
      .map((row) => `release-review:${row.key}`),
    ...(clientReadiness.acceptance?.review ?? []).map((item) => `client-readiness:${item}`),
    ...(syncBridge.review ?? []).map((item) => `sync:${item}`),
  ].sort());
  const statusChannels = Object.freeze(Array.from(new Set([
    exportPackage.handoff?.statusChannel,
    releaseReport.handoff?.statusChannel,
    clientReadiness.handoff?.statusChannel,
    syncBridge.handoff?.statusChannel,
  ].filter(Boolean))).sort());
  const checkpoints = Object.freeze(Array.from(new Set([
    exportPackage.handoff?.checkpoint,
    releaseReport.handoff?.checkpoint,
    clientReadiness.handoff?.checkpoint,
    syncBridge.handoff?.checkpoint,
  ].filter(Boolean))).sort());
  const counters = Object.freeze({
    totalContracts: analytics.counters.total,
    exportReady: analytics.counters.exportReady,
    localOnly: analytics.counters.localOnly,
    blocked: blockers.length,
    review: review.length,
    diagnostics: analytics.counters.diagnostics,
    errors: analytics.counters.errors,
    warnings: analytics.counters.warnings,
    roles: roleRows.length,
    kinds: kindRows.length,
    publishableExports: exportRows.filter((row) => row.publishable).length,
    releaseReadyRows: releaseRows.filter((row) => row.releaseReady).length,
    historyRows: historyRows.length,
  });
  const ready = blockers.length === 0
    && exportSummary.exportReady === true
    && exportPackage.handoff?.ready === true
    && releaseReport.handoff?.ready === true
    && clientReadiness.handoff?.ready === true
    && syncBridge.handoff?.ready === true;
  const state = blockers.length > 0 ? "blocked" : review.length > 0 ? "review" : ready ? "ready" : "warming";
  const nextAction = blockers.length > 0
    ? blockers[0].split(":").slice(2).join(":") || "repair_literal_analytics_export_journal"
    : review.length > 0 ? "review_literal_analytics_export_journal" : "publish_literal_analytics_export_journal";

  return Object.freeze({
    schema: "aios.literal.analytics-export-journal.v1",
    revision: stableLiteralCommandId(
      "literal-analytics-journal",
      history.revision,
      exportPackage.revision,
      releaseReport.revision,
      state,
      counters.exportReady,
      counters.blocked,
    ),
    state,
    ready,
    counters,
    metrics: Object.freeze({
      roles: roleRows,
      kinds: kindRows,
    }),
    exports: Object.freeze({
      rows: exportRows,
      exportableKeys: exportSummary.exportableKeys,
      blockedKeys: exportSummary.blockedKeys,
      packageRevision: exportPackage.revision,
    }),
    history: Object.freeze({
      revision: history.revision,
      latestState: history.latestState,
      rows: historyRows,
    }),
    report: Object.freeze({
      releaseRevision: releaseReport.revision,
      releaseReady: releaseReport.releaseReady === true,
      releaseRows,
      clientReadinessState: clientReadiness.validationSummary?.state ?? "unknown",
      syncBridgeState: syncBridge.state ?? "unknown",
    }),
    blockers,
    review,
    handoff: Object.freeze({
      ready,
      checkpoint: checkpoints[0] || "literal:analytics",
      statusChannel: statusChannels[0] || "mailchimp.contract.status",
      statusChannels,
      localOnly: exportPackage.handoff?.localOnly !== false && clientReadiness.handoff?.localOnly !== false,
      writesExternalSystem: exportPackage.handoff?.writesExternalSystem === true || clientReadiness.handoff?.writesExternalSystem === true,
      nextAction,
    }),
    timeline: Object.freeze([
      ...historyRows.map((row) => Object.freeze({
        source: "literal-history",
        label: row.key,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...exportRows.map((row) => Object.freeze({
        source: "literal-export",
        label: row.key,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...releaseRows.map((row) => Object.freeze({
        source: "literal-release",
        label: row.key,
        state: row.state,
        nextAction: row.nextAction,
      })),
    ]),
  });
}

function buildLiteralExportAuditBundle(analyticsExportJournal, exportPackage, releaseReport, runtimeState, providerContracts) {
  const journalRows = Object.freeze([
    ...(analyticsExportJournal.history?.rows ?? []).map((row) => Object.freeze({
      schema: "aios.literal.export-audit-row.v1",
      source: "history",
      subject: row.key,
      state: row.state,
      checkpoint: analyticsExportJournal.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: analyticsExportJournal.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: row.state !== "blocked",
      localOnly: true,
      writesExternalSystem: false,
      evidence: Object.freeze({
        role: row.role,
        kind: row.kind,
        diagnosticCount: row.diagnosticCount,
        sequence: row.sequence,
      }),
      nextAction: row.nextAction,
    })),
    ...(analyticsExportJournal.exports?.rows ?? []).map((row) => Object.freeze({
      schema: "aios.literal.export-audit-row.v1",
      source: "export",
      subject: row.key,
      state: row.state,
      checkpoint: exportPackage.handoff?.checkpoint ?? analyticsExportJournal.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: exportPackage.handoff?.statusChannel ?? analyticsExportJournal.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: row.restartSafe !== false && row.boundaryBlocked !== true,
      localOnly: exportPackage.handoff?.localOnly !== false,
      writesExternalSystem: exportPackage.handoff?.writesExternalSystem === true,
      evidence: Object.freeze({
        role: row.role,
        kind: row.kind,
        publishable: row.publishable,
        providerBacked: row.providerBacked,
        boundaryBlocked: row.boundaryBlocked,
      }),
      nextAction: row.nextAction,
    })),
    ...(analyticsExportJournal.report?.releaseRows ?? []).map((row) => Object.freeze({
      schema: "aios.literal.export-audit-row.v1",
      source: "release",
      subject: row.key,
      state: row.state,
      checkpoint: releaseReport.handoff?.checkpoint ?? analyticsExportJournal.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: releaseReport.handoff?.statusChannel ?? analyticsExportJournal.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: row.healthState !== "failed" && row.state !== "blocked",
      localOnly: releaseReport.handoff?.localOnly !== false,
      writesExternalSystem: releaseReport.handoff?.writesExternalSystem === true,
      evidence: Object.freeze({
        role: row.role,
        releaseReady: row.releaseReady,
        healthState: row.healthState,
      }),
      nextAction: row.nextAction,
    })),
  ]);
  const providerRows = Object.freeze((providerContracts.providers ?? []).map((provider) => Object.freeze({
    schema: "aios.literal.export-audit-provider.v1",
    source: "provider",
    subject: `${provider.sourceKey}:${provider.adapter}`,
    state: provider.handoff?.ready === true ? "ready" : "blocked",
    checkpoint: provider.sync?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: provider.sync?.statusChannel ?? runtimeState.statusChannel,
    restartSafe: provider.idempotency?.restartSafe === true,
    localOnly: provider.sync?.localOnly !== false,
    writesExternalSystem: provider.sync?.externalWriteAllowed === true,
    missingCapabilities: Object.freeze(provider.capabilities?.missing ?? []),
    nextAction: provider.handoff?.nextAction ?? "repair_literal_provider_contract",
  })));
  const rows = Object.freeze([...journalRows, ...providerRows].sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review" || row.state === "local" || row.state === "observed");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const checkpoints = Object.freeze(Array.from(new Set(rows.map((row) => row.checkpoint).filter(Boolean))).sort());
  const statusChannels = Object.freeze(Array.from(new Set(rows.map((row) => row.statusChannel).filter(Boolean))).sort());
  const state = blockedRows.length > 0
    ? "blocked"
    : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "publish_literal_export_audit_bundle" : "attach_literal_export_audit_bundle");

  return Object.freeze({
    schema: "aios.literal.export-audit-bundle.v1",
    revision: stableLiteralCommandId(
      "literal-export-audit",
      analyticsExportJournal.revision,
      exportPackage.revision,
      releaseReport.revision,
      runtimeState.revision,
      state,
      rows.length,
      blockedRows.length,
    ),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      history: rows.filter((row) => row.source === "history").length,
      exports: rows.filter((row) => row.source === "export").length,
      releases: rows.filter((row) => row.source === "release").length,
      providers: providerRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
      exportReady: analyticsExportJournal.counters?.exportReady ?? 0,
      publishableExports: analyticsExportJournal.counters?.publishableExports ?? 0,
    }),
    validationSummary: Object.freeze({
      accepted: blockedRows.length === 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    exportSummary: Object.freeze({
      packageRevision: exportPackage.revision,
      releaseRevision: releaseReport.revision,
      journalRevision: analyticsExportJournal.revision,
      exportableKeys: Object.freeze(analyticsExportJournal.exports?.exportableKeys ?? []),
      blockedKeys: Object.freeze(analyticsExportJournal.exports?.blockedKeys ?? []),
      statusChannels,
      checkpoints,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0 && analyticsExportJournal.handoff?.ready === true,
      checkpoint: checkpoints[0] || analyticsExportJournal.handoff?.checkpoint || runtimeState.checkpoint,
      statusChannel: statusChannels[0] || analyticsExportJournal.handoff?.statusChannel || runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
    timeline: Object.freeze(rows.map((row, index) => Object.freeze({
      sequence: index + 1,
      source: `literal-export-audit:${row.source}`,
      label: row.subject,
      state: row.state,
      nextAction: row.nextAction,
    }))),
  });
}

function buildLiteralWorkflowHandoff(clientReadiness, clientActionQueue, providerNegotiation, deploymentPlan, syncBridge, runtimeState) {
  const readinessRows = (clientReadiness.preview?.rows ?? []).map((row, index) => Object.freeze({
    source: "literal-client-readiness",
    order: index + 1,
    subject: `${row.source}:${row.subject}`,
    state: row.state,
    checkpoint: clientReadiness.handoff?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: clientReadiness.handoff?.statusChannel ?? runtimeState.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: clientReadiness.handoff?.localOnly !== false,
    writesExternalSystem: clientReadiness.handoff?.writesExternalSystem === true,
    nextAction: row.nextAction,
  }));
  const actionRows = (clientActionQueue.rows ?? []).map((row, index) => Object.freeze({
    source: row.source || "literal-client-action",
    order: readinessRows.length + index + 1,
    subject: row.subject,
    state: row.state,
    checkpoint: row.checkpoint ?? clientActionQueue.handoff?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: row.statusChannel ?? clientActionQueue.handoff?.statusChannel ?? runtimeState.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    nextAction: row.action ?? row.nextAction ?? clientActionQueue.handoff?.nextAction ?? "adopt_literal_client_actions",
  }));
  const providerRows = (providerNegotiation.providers ?? []).map((row, index) => Object.freeze({
    source: "literal-provider-negotiation",
    order: readinessRows.length + actionRows.length + index + 1,
    subject: `${row.sourceKey}:${row.adapter}`,
    state: row.state,
    checkpoint: row.checkpoint ?? providerNegotiation.handoff?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: row.statusChannel ?? providerNegotiation.handoff?.statusChannel ?? runtimeState.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.externalWriteAllowed === true,
    nextAction: row.nextAction,
  }));
  const deploymentRows = (deploymentPlan.controls ?? []).map((row, index) => Object.freeze({
    source: "literal-deployment-control",
    order: readinessRows.length + actionRows.length + providerRows.length + index + 1,
    subject: `${row.type}:${row.key}`,
    state: row.state,
    checkpoint: deploymentPlan.handoff?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: deploymentPlan.handoff?.statusChannel ?? runtimeState.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    nextAction: row.nextAction,
  }));
  const syncRows = (syncBridge.providers ?? []).map((row, index) => Object.freeze({
    source: "literal-sync-bridge",
    order: readinessRows.length + actionRows.length + providerRows.length + deploymentRows.length + index + 1,
    subject: `${row.key}:${row.adapter}`,
    state: row.state,
    checkpoint: row.checkpoint ?? syncBridge.handoff?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: row.statusChannel ?? syncBridge.handoff?.statusChannel ?? runtimeState.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.externalWriteAllowed === true,
    nextAction: row.nextAction,
  }));
  const rows = Object.freeze([...readinessRows, ...actionRows, ...providerRows, ...deploymentRows, ...syncRows]
    .sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const ready = blockedRows.length === 0
    && clientReadiness.handoff?.ready !== false
    && clientActionQueue.handoff?.ready !== false
    && providerNegotiation.handoff?.ready !== false
    && deploymentPlan.handoff?.ready !== false
    && syncBridge.handoff?.ready !== false
    && runtimeState.persistedView?.restartSafe !== false;
  const checkpoint = clientActionQueue.handoff?.checkpoint
    ?? clientReadiness.handoff?.checkpoint
    ?? providerNegotiation.handoff?.checkpoint
    ?? runtimeState.checkpoint;
  const statusChannel = clientActionQueue.handoff?.statusChannel
    ?? clientReadiness.handoff?.statusChannel
    ?? providerNegotiation.handoff?.statusChannel
    ?? runtimeState.statusChannel;
  const nextAction = blockedRows[0]?.nextAction
    ?? (reviewRows.length > 0 ? "review_literal_workflow_handoff" : "handoff_literal_workflow");

  return Object.freeze({
    schema: "aios.literal.workflow-handoff.v1",
    revision: stableLiteralCommandId("literal-workflow-handoff", runtimeState.revision, checkpoint, rows.length, blockedRows.length),
    ready,
    state: ready ? "ready" : blockedRows.length > 0 ? "blocked" : "review",
    checkpoint,
    statusChannel,
    preview: Object.freeze({
      previewId: stableLiteralCommandId("literal-workflow-preview", runtimeState.revision, rows.length, blockedRows.length),
      title: "Mailchimp literal workflow handoff",
      rows,
      counters: Object.freeze({
        rows: rows.length,
        blocked: blockedRows.length,
        review: reviewRows.length,
        queued: rows.filter((row) => row.state === "queued").length,
        ready: rows.filter((row) => row.state === "ready").length,
        releaseReady: rows.filter((row) => row.state === "release-ready").length,
        externalWrites: rows.filter((row) => row.writesExternalSystem).length,
        restartSafe: rows.filter((row) => row.restartSafe).length,
      }),
    }),
    validationSummary: Object.freeze({
      state: ready ? "ready" : blockedRows.length > 0 ? "blocked" : "review",
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      restartSafe: blockedRows.length === 0,
      nextAction,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      nextAction,
    }),
    nextSteps: Object.freeze((blockedRows.length > 0 ? blockedRows : reviewRows).map((row, index) => Object.freeze({
      order: index + 1,
      action: row.nextAction,
      subject: row.subject,
      source: row.source,
      restartSafe: row.restartSafe,
    }))),
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildLiteralClientStatusAdoption(runtimeState, clientActionQueue, workflowHandoff, providerNegotiation, syncBridge) {
  const actionRows = (clientActionQueue.rows ?? []).map((row, index) => Object.freeze({
    source: row.source || "literal-client-action",
    subject: row.subject,
    order: index + 1,
    state: row.state === "queued" ? "pending" : row.state,
    checkpoint: row.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey || stableLiteralCommandId("idempotent", "literal-status", row.source, row.subject),
    nextAction: row.action || row.nextAction || clientActionQueue.handoff?.nextAction || "adopt_literal_client_actions",
  }));
  const workflowRows = (workflowHandoff.preview?.rows ?? []).map((row, index) => Object.freeze({
    source: row.source || "literal-workflow-handoff",
    subject: row.subject,
    order: actionRows.length + index + 1,
    state: row.state === "queued" || row.state === "release-ready" ? "pending" : row.state,
    checkpoint: row.checkpoint || workflowHandoff.handoff?.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || workflowHandoff.handoff?.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: stableLiteralCommandId("idempotent", "literal-workflow-status", row.source, row.subject),
    nextAction: row.nextAction || workflowHandoff.handoff?.nextAction || "handoff_literal_workflow",
  }));
  const providerRows = (providerNegotiation.providers ?? []).map((row, index) => Object.freeze({
    source: "literal-provider-negotiation",
    subject: `${row.sourceKey}:${row.adapter}`,
    order: actionRows.length + workflowRows.length + index + 1,
    state: row.state === "ready" ? "accepted" : row.state,
    checkpoint: row.checkpoint || providerNegotiation.handoff?.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || providerNegotiation.handoff?.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.externalWriteAllowed === true,
    idempotencyKey: stableLiteralCommandId("idempotent", "literal-provider-status", row.sourceKey, row.adapter),
    nextAction: row.nextAction || providerNegotiation.handoff?.nextAction || "handoff_literal_provider_negotiation",
  }));
  const syncRows = (syncBridge.providers ?? []).map((row, index) => Object.freeze({
    source: "literal-sync-provider",
    subject: `${row.key}:${row.adapter}`,
    order: actionRows.length + workflowRows.length + providerRows.length + index + 1,
    state: row.state === "ready" ? "accepted" : row.state,
    checkpoint: row.checkpoint || syncBridge.handoff?.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || syncBridge.handoff?.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.externalWriteAllowed === true,
    idempotencyKey: stableLiteralCommandId("idempotent", "literal-sync-status", row.key, row.adapter),
    nextAction: row.nextAction || syncBridge.handoff?.nextAction || "handoff_literal_sync_bridge",
  }));
  const rows = Object.freeze([...actionRows, ...workflowRows, ...providerRows, ...syncRows]
    .sort((left, right) => `${left.source}:${left.subject}:${left.order}`.localeCompare(`${right.source}:${right.subject}:${right.order}`))
    .map((row, index) => Object.freeze({
      schema: "aios.literal.client-status-adoption-row.v1",
      rowId: stableLiteralCommandId("literal-client-status", index + 1, row.source, row.subject, row.checkpoint),
      order: index + 1,
      ...row,
    })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const acceptedRows = rows.filter((row) => row.state === "accepted" || row.state === "ready" || row.state === "pending");
  const ready = blockedRows.length === 0
    && clientActionQueue.handoff?.ready !== false
    && workflowHandoff.handoff?.ready !== false
    && providerNegotiation.handoff?.ready !== false
    && syncBridge.handoff?.ready !== false
    && runtimeState.persistedView?.restartSafe !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : ready ? "ready" : "warming";
  const checkpoint = workflowHandoff.handoff?.checkpoint || clientActionQueue.handoff?.checkpoint || runtimeState.checkpoint;
  const statusChannel = workflowHandoff.handoff?.statusChannel || clientActionQueue.handoff?.statusChannel || runtimeState.statusChannel;
  const nextAction = blockedRows[0]?.nextAction
    ?? (reviewRows.length > 0 ? "review_literal_client_status_adoption" : "publish_literal_client_status_adoption");

  return Object.freeze({
    schema: "aios.literal.client-status-adoption.v1",
    revision: stableLiteralCommandId("literal-client-status-adoption", runtimeState.revision, checkpoint, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      accepted: acceptedRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || syncBridge.handoff?.writesExternalSystem === true,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function literalRecoveryStateFromStatusRow(row) {
  if (row.state === "blocked" || row.restartSafe === false) return "blocked";
  if (row.state === "review") return "review";
  if (row.state === "accepted" || row.state === "ready" || row.state === "pending") return "recoverable";
  return "observed";
}

function buildLiteralRecoveryAdoption(runtimeState, operationalHealth, clientStatusAdoption, diagnostics) {
  const diagnosticRows = diagnostics.map((item, index) => Object.freeze({
    source: "literal-diagnostic",
    subject: `${item.key ?? "literal"}:${item.code}`,
    order: index + 1,
    state: item.severity === "error" ? "blocked" : "review",
    checkpoint: runtimeState.checkpoint,
    statusChannel: runtimeState.statusChannel,
    restartSafe: item.severity !== "error",
    localOnly: true,
    writesExternalSystem: false,
    idempotencyKey: stableLiteralCommandId("idempotent", "literal-recovery-diagnostic", item.key ?? "literal", item.code, item.offset ?? index),
    nextAction: item.recovery ?? "inspect_literal",
  }));
  const healthRows = [
    ...(operationalHealth.failures ?? []).map((failure, index) => Object.freeze({
      source: "literal-health",
      subject: `${failure.key}:${failure.code}`,
      order: diagnosticRows.length + index + 1,
      state: "blocked",
      checkpoint: operationalHealth.statusPatch?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: operationalHealth.statusPatch?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: false,
      localOnly: true,
      writesExternalSystem: false,
      idempotencyKey: stableLiteralCommandId("idempotent", "literal-recovery-health", failure.key, failure.code),
      nextAction: failure.action,
    })),
    ...(operationalHealth.degraded ?? []).map((event, index) => Object.freeze({
      source: "literal-health",
      subject: `${event.key}:${event.code}`,
      order: diagnosticRows.length + (operationalHealth.failures?.length ?? 0) + index + 1,
      state: "review",
      checkpoint: operationalHealth.statusPatch?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: operationalHealth.statusPatch?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: true,
      localOnly: true,
      writesExternalSystem: false,
      idempotencyKey: stableLiteralCommandId("idempotent", "literal-recovery-health", event.key, event.code),
      nextAction: event.action,
    })),
  ];
  const statusRows = (clientStatusAdoption.rows ?? []).map((row, index) => Object.freeze({
    source: "literal-client-status",
    subject: `${row.source}:${row.subject}`,
    order: diagnosticRows.length + healthRows.length + index + 1,
    state: literalRecoveryStateFromStatusRow(row),
    checkpoint: row.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: stableLiteralCommandId("idempotent", "literal-recovery-status", row.rowId || row.subject),
    nextAction: row.state === "blocked" ? row.nextAction : "adopt_literal_recovery_status",
  }));
  const rows = Object.freeze([...diagnosticRows, ...healthRows, ...statusRows]
    .sort((left, right) => `${left.source}:${left.subject}:${left.order}`.localeCompare(`${right.source}:${right.subject}:${right.order}`))
    .map((row, index) => Object.freeze({
      schema: "aios.literal.recovery-adoption-row.v1",
      rowId: stableLiteralCommandId("literal-recovery-adoption", index + 1, row.source, row.subject, row.checkpoint),
      order: index + 1,
      ...row,
    })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const recoverableRows = rows.filter((row) => row.state === "recoverable");
  const checkpoint = clientStatusAdoption.handoff?.checkpoint || runtimeState.checkpoint;
  const statusChannel = clientStatusAdoption.handoff?.statusChannel || runtimeState.statusChannel;
  const ready = blockedRows.length === 0
    && runtimeState.persistedView?.restartSafe !== false
    && operationalHealth.handoffReady !== false
    && clientStatusAdoption.handoff?.ready !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : ready ? "ready" : "warming";
  const nextAction = blockedRows[0]?.nextAction
    ?? (reviewRows.length > 0 ? "review_literal_recovery_adoption" : "publish_literal_recovery_adoption");

  return Object.freeze({
    schema: "aios.literal.recovery-adoption.v1",
    revision: stableLiteralCommandId("literal-recovery-adoption", runtimeState.revision, operationalHealth.state, checkpoint, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      recoverable: recoverableRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      diagnostics: diagnosticRows.length,
      healthRows: healthRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || clientStatusAdoption.handoff?.writesExternalSystem === true,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    persistedView: Object.freeze({
      key: stableLiteralCommandId("literal-recovery-view", checkpoint, rows.length, state),
      restartSafe: ready,
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      resumeFromCheckpoint: ready || reviewRows.length > 0,
      blockedRowIds: Object.freeze(blockedRows.map((row) => row.rowId).sort()),
    }),
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildLiteralOperationalReport(runtimeState, operationalHealth, exportPackage, releaseReport, providerNegotiation, clientStatusAdoption, recoveryAdoption, diagnostics) {
  const rows = Object.freeze([
    Object.freeze({
      source: "literal-runtime",
      subject: runtimeState.checkpoint,
      state: runtimeState.persistedView?.restartSafe === false ? "blocked" : runtimeState.replayState === "hold" ? "blocked" : "ready",
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      restartSafe: runtimeState.persistedView?.restartSafe !== false,
      localOnly: runtimeState.clientHandoff?.localOnly !== false,
      writesExternalSystem: runtimeState.clientHandoff?.writesExternalSystem === true,
      nextAction: runtimeState.resume?.nextAction ?? "inspect_literal_runtime_state",
    }),
    Object.freeze({
      source: "literal-health",
      subject: operationalHealth.statusPatch?.checkpoint ?? runtimeState.checkpoint,
      state: operationalHealth.state === "failed" ? "blocked" : operationalHealth.state === "degraded" ? "review" : "ready",
      checkpoint: operationalHealth.statusPatch?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: operationalHealth.statusPatch?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: operationalHealth.handoffReady !== false && operationalHealth.state !== "failed",
      localOnly: true,
      writesExternalSystem: false,
      nextAction: operationalHealth.statusPatch?.nextAction ?? "inspect_literal_operational_health",
    }),
    Object.freeze({
      source: "literal-export-package",
      subject: exportPackage.revision,
      state: exportPackage.handoff?.ready === false ? "blocked" : exportPackage.status?.state ?? "ready",
      checkpoint: exportPackage.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: exportPackage.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: exportPackage.handoff?.ready !== false,
      localOnly: exportPackage.handoff?.localOnly !== false,
      writesExternalSystem: exportPackage.handoff?.writesExternalSystem === true,
      nextAction: exportPackage.handoff?.nextAction ?? "inspect_literal_export_package",
    }),
    Object.freeze({
      source: "literal-release-report",
      subject: releaseReport.revision,
      state: releaseReport.handoff?.ready === false ? "blocked" : releaseReport.state ?? "ready",
      checkpoint: releaseReport.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: releaseReport.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: releaseReport.handoff?.ready !== false,
      localOnly: releaseReport.handoff?.localOnly !== false,
      writesExternalSystem: releaseReport.handoff?.writesExternalSystem === true,
      nextAction: releaseReport.handoff?.nextAction ?? "inspect_literal_release_report",
    }),
    Object.freeze({
      source: "literal-provider-negotiation",
      subject: providerNegotiation.revision,
      state: providerNegotiation.handoff?.ready === false ? "blocked" : providerNegotiation.state ?? "ready",
      checkpoint: providerNegotiation.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: providerNegotiation.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: providerNegotiation.handoff?.ready !== false,
      localOnly: providerNegotiation.handoff?.localOnly !== false,
      writesExternalSystem: providerNegotiation.handoff?.writesExternalSystem === true,
      nextAction: providerNegotiation.handoff?.nextAction ?? "inspect_literal_provider_negotiation",
    }),
    Object.freeze({
      source: "literal-client-status",
      subject: clientStatusAdoption.revision,
      state: clientStatusAdoption.handoff?.ready === false ? "blocked" : clientStatusAdoption.state ?? "ready",
      checkpoint: clientStatusAdoption.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: clientStatusAdoption.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: clientStatusAdoption.handoff?.ready !== false,
      localOnly: clientStatusAdoption.handoff?.localOnly !== false,
      writesExternalSystem: clientStatusAdoption.handoff?.writesExternalSystem === true,
      nextAction: clientStatusAdoption.handoff?.nextAction ?? "inspect_literal_client_status_adoption",
    }),
    Object.freeze({
      source: "literal-recovery",
      subject: recoveryAdoption.revision,
      state: recoveryAdoption.handoff?.ready === false ? "blocked" : recoveryAdoption.state ?? "ready",
      checkpoint: recoveryAdoption.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: recoveryAdoption.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: recoveryAdoption.persistedView?.restartSafe !== false,
      localOnly: recoveryAdoption.handoff?.localOnly !== false,
      writesExternalSystem: recoveryAdoption.handoff?.writesExternalSystem === true,
      nextAction: recoveryAdoption.handoff?.nextAction ?? "inspect_literal_recovery_adoption",
    }),
  ].map((row, index) => Object.freeze({
    schema: "aios.literal.operational-report-row.v1",
    rowId: stableLiteralCommandId("literal-operational", index + 1, row.source, row.subject, row.checkpoint),
    order: index + 1,
    ...row,
  })));
  const diagnosticRows = Object.freeze(diagnostics.map((item) => Object.freeze({
    source: "literal-diagnostic",
    subject: `${item.key ?? "literal"}:${item.code}`,
    state: item.severity === "error" ? "blocked" : "review",
    checkpoint: runtimeState.checkpoint,
    statusChannel: runtimeState.statusChannel,
    restartSafe: item.severity !== "error",
    nextAction: item.recovery ?? "inspect_literal",
  })));
  const allRows = Object.freeze([...rows, ...diagnosticRows]);
  const blockedRows = allRows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = allRows.filter((row) => row.state === "review");
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : "ready";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? providerNegotiation.handoff?.nextAction
    ?? runtimeState.resume?.nextAction
    ?? "publish_literal_operational_report";

  return Object.freeze({
    schema: "aios.literal.operational-report.v1",
    revision: stableLiteralCommandId("literal-operational-report", runtimeState.revision, operationalHealth.state, exportPackage.revision, providerNegotiation.revision, state),
    state,
    rows,
    diagnostics: diagnosticRows,
    counters: Object.freeze({
      rows: rows.length,
      diagnostics: diagnostics.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: allRows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
      healthFailures: operationalHealth.failureCount ?? 0,
      healthDegraded: operationalHealth.degradedCount ?? 0,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint: providerNegotiation.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: providerNegotiation.handoff?.statusChannel ?? runtimeState.statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildLiteralClientResumeEnvelope(runtimeState, operationalHealth, clientStatusAdoption, recoveryAdoption, operationalReport) {
  const statusRows = Object.freeze((clientStatusAdoption.rows ?? []).map((row) => Object.freeze({
    source: "literal-client-status",
    subject: `${row.source}:${row.subject}`,
    state: row.state,
    checkpoint: row.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey || stableLiteralCommandId("idempotent", "literal-resume-status", row.rowId ?? row.subject),
    nextAction: row.nextAction || clientStatusAdoption.handoff?.nextAction || "publish_literal_client_status_adoption",
  })));
  const recoveryRows = Object.freeze((recoveryAdoption.rows ?? []).map((row) => Object.freeze({
    source: "literal-recovery",
    subject: `${row.source}:${row.subject}`,
    state: row.state,
    checkpoint: row.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey || stableLiteralCommandId("idempotent", "literal-resume-recovery", row.rowId ?? row.subject),
    nextAction: row.nextAction || recoveryAdoption.handoff?.nextAction || "publish_literal_recovery_adoption",
  })));
  const operationalRows = Object.freeze((operationalReport.rows ?? []).map((row) => Object.freeze({
    source: "literal-operational",
    subject: `${row.source}:${row.subject}`,
    state: row.state,
    checkpoint: row.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: stableLiteralCommandId("idempotent", "literal-resume-operational", row.rowId ?? row.subject),
    nextAction: row.nextAction || operationalReport.handoff?.nextAction || "publish_literal_operational_report",
  })));
  const healthRows = Object.freeze([
    ...(operationalHealth.failures ?? []).map((failure) => Object.freeze({
      source: "literal-health",
      subject: `${failure.key}:${failure.code}`,
      state: "blocked",
      checkpoint: operationalHealth.statusPatch?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: operationalHealth.statusPatch?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: false,
      localOnly: true,
      writesExternalSystem: false,
      idempotencyKey: stableLiteralCommandId("idempotent", "literal-resume-health", failure.key, failure.code),
      nextAction: failure.action,
    })),
    ...(operationalHealth.degraded ?? []).map((event) => Object.freeze({
      source: "literal-health",
      subject: `${event.key}:${event.code}`,
      state: "review",
      checkpoint: operationalHealth.statusPatch?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: operationalHealth.statusPatch?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: true,
      localOnly: true,
      writesExternalSystem: false,
      idempotencyKey: stableLiteralCommandId("idempotent", "literal-resume-health", event.key, event.code),
      nextAction: event.action,
    })),
  ]);
  const rows = Object.freeze([...statusRows, ...recoveryRows, ...operationalRows, ...healthRows]
    .sort((left, right) => `${left.source}:${left.subject}:${left.idempotencyKey}`.localeCompare(`${right.source}:${right.subject}:${right.idempotencyKey}`))
    .map((row, index) => Object.freeze({
      schema: "aios.literal.client-resume-envelope-row.v1",
      order: index + 1,
      rowId: stableLiteralCommandId("literal-client-resume", index + 1, row.source, row.subject, row.checkpoint),
      ...row,
    })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const checkpoint = clientStatusAdoption.handoff?.checkpoint
    || recoveryAdoption.handoff?.checkpoint
    || operationalReport.handoff?.checkpoint
    || runtimeState.checkpoint;
  const statusChannel = clientStatusAdoption.handoff?.statusChannel
    || recoveryAdoption.handoff?.statusChannel
    || operationalReport.handoff?.statusChannel
    || runtimeState.statusChannel;
  const hydrated = Boolean(checkpoint && statusChannel && runtimeState.persistedView?.restartSafe !== false);
  const ready = hydrated
    && blockedRows.length === 0
    && operationalHealth.state !== "failed"
    && operationalHealth.handoffReady !== false
    && clientStatusAdoption.handoff?.ready !== false
    && recoveryAdoption.handoff?.ready !== false
    && operationalReport.handoff?.ready !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : ready ? "ready" : "warming";
  const nextAction = blockedRows[0]?.nextAction
    ?? (reviewRows.length > 0 ? "review_literal_client_resume_envelope" : "resume_literal_client_runtime");

  return Object.freeze({
    schema: "aios.literal.client-resume-envelope.v1",
    revision: stableLiteralCommandId("literal-client-resume", runtimeState.revision, operationalHealth.state, checkpoint, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      statusRows: statusRows.length,
      recoveryRows: recoveryRows.length,
      operationalRows: operationalRows.length,
      healthRows: healthRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    clientState: Object.freeze({
      requiredKeys: Object.freeze(["requestId", "workflowId", "checkpoint", "statusChannel", "resumeToken", "healthState"]),
      hydrated,
      checkpoint,
      statusChannel,
      resumeToken: stableLiteralCommandId("resume", checkpoint, runtimeState.revision, recoveryAdoption.revision),
      persistenceRevision: runtimeState.revision,
      healthState: operationalHealth.state,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || operationalHealth.state !== "healthy",
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildLiteralControlIntent(workflowControls, lifecycleReadiness, providerContracts, operatorControlPanel, runtimeState) {
  const disabled = new Set(workflowControls.disabled ?? []);
  const enabled = new Set(workflowControls.enabled ?? []);
  const settingRows = Object.freeze(Object.entries(workflowControls.settings ?? {}).map(([key, value], index) => {
    const readinessRow = (lifecycleReadiness.rows ?? []).find((row) => row.type === "setting" && row.key === key);
    const state = readinessRow?.state ?? "ready";
    return Object.freeze({
      schema: "aios.literal.control-intent-row.v1",
      order: index + 1,
      source: "setting",
      subject: key,
      value: stableLiteralValue(value),
      state,
      enabled: state !== "blocked" && !disabled.has(key),
      checkpoint: readinessRow?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: readinessRow?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: readinessRow?.restartSafe !== false,
      localOnly: readinessRow?.localOnly !== false,
      writesExternalSystem: readinessRow?.writesExternalSystem === true,
      idempotencyKey: readinessRow?.idempotencyKey ?? stableLiteralCommandId("idempotent", "literal-control-setting", key),
      nextAction: readinessRow?.nextAction ?? "apply_literal_setting_control",
    });
  }));
  const scheduleRows = Object.freeze((workflowControls.schedules ?? []).map((schedule, index) => {
    const readinessRow = (lifecycleReadiness.rows ?? []).find((row) => row.type === "schedule" && row.key === schedule.key && row.value === schedule.value);
    const state = schedule.parsed?.valid === false ? "blocked" : readinessRow?.state ?? "ready";
    return Object.freeze({
      schema: "aios.literal.control-intent-row.v1",
      order: settingRows.length + index + 1,
      source: "schedule",
      subject: schedule.key,
      value: schedule.value,
      state,
      enabled: state !== "blocked",
      checkpoint: readinessRow?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: readinessRow?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: readinessRow?.restartSafe !== false && schedule.parsed?.valid !== false,
      localOnly: readinessRow?.localOnly !== false,
      writesExternalSystem: readinessRow?.writesExternalSystem === true,
      idempotencyKey: readinessRow?.idempotencyKey ?? stableLiteralCommandId("idempotent", "literal-control-schedule", schedule.key, schedule.value),
      nextAction: schedule.parsed?.valid === false ? "repair_literal_schedule" : readinessRow?.nextAction ?? "schedule_literal_workflow",
    });
  }));
  const toggleRows = Object.freeze((workflowControls.controls ?? [])
    .filter((control) => control.type === "enable" || control.type === "disable")
    .map((control, index) => {
      const readinessRow = (lifecycleReadiness.rows ?? []).find((row) => row.type === control.type && row.key === control.key && row.value === control.value);
      const suppressed = control.type === "enable" && disabled.has(control.value);
      const state = readinessRow?.state ?? (suppressed ? "suppressed" : "ready");
      return Object.freeze({
        schema: "aios.literal.control-intent-row.v1",
        order: settingRows.length + scheduleRows.length + index + 1,
        source: control.type,
        subject: `${control.key}:${control.value}`,
        value: control.value,
        state,
        enabled: control.type === "disable" ? false : enabled.has(control.value) && !suppressed && state !== "blocked",
        checkpoint: readinessRow?.checkpoint ?? runtimeState.checkpoint,
        statusChannel: readinessRow?.statusChannel ?? runtimeState.statusChannel,
        restartSafe: readinessRow?.restartSafe !== false,
        localOnly: readinessRow?.localOnly !== false,
        writesExternalSystem: readinessRow?.writesExternalSystem === true,
        idempotencyKey: readinessRow?.idempotencyKey ?? stableLiteralCommandId("idempotent", "literal-control-toggle", control.type, control.key, control.value),
        nextAction: suppressed ? "retain_disabled_literal_lifecycle_control" : readinessRow?.nextAction ?? `${control.type}_literal_control`,
      });
    }));
  const providerRows = Object.freeze((providerContracts.providers ?? []).map((provider, index) => {
    const panelRow = (operatorControlPanel.rows ?? []).find((row) => row.source === "provider" && row.subject === `${provider.sourceKey}:${provider.adapter}`);
    const state = provider.handoff?.ready === false
      ? "blocked"
      : provider.sync?.externalWriteRequested && !provider.sync?.externalWriteAllowed ? "review" : "ready";
    return Object.freeze({
      schema: "aios.literal.control-intent-row.v1",
      order: settingRows.length + scheduleRows.length + toggleRows.length + index + 1,
      source: "provider-sync",
      subject: `${provider.sourceKey}:${provider.adapter}`,
      value: provider.sync?.mode ?? "local",
      state,
      enabled: panelRow?.enabled !== false && state !== "blocked",
      checkpoint: provider.sync?.checkpoint ?? panelRow?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: provider.sync?.statusChannel ?? panelRow?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: provider.idempotency?.restartSafe === true && panelRow?.restartSafe !== false,
      localOnly: provider.sync?.localOnly !== false,
      writesExternalSystem: provider.sync?.externalWriteAllowed === true,
      idempotencyKey: provider.idempotency?.key ?? stableLiteralCommandId("idempotent", "literal-provider-sync", provider.sourceKey, provider.adapter),
      nextAction: state === "review" ? "confirm_literal_external_sync" : provider.handoff?.nextAction ?? "negotiate_literal_mailchimp_capabilities",
    });
  }));
  const rows = Object.freeze([...settingRows, ...scheduleRows, ...toggleRows, ...providerRows]
    .sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`))
    .map((row, index) => Object.freeze({ ...row, order: index + 1 })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "adopt_literal_control_intent" : "attach_literal_control_intent");

  return Object.freeze({
    schema: "aios.literal.control-intent.v1",
    revision: stableLiteralCommandId("literal-control-intent", runtimeState.revision, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      settings: settingRows.length,
      schedules: scheduleRows.length,
      toggles: toggleRows.length,
      providers: providerRows.length,
      enabled: rows.filter((row) => row.enabled).length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint: rows[0]?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: rows[0]?.statusChannel ?? runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function buildLiteralExternalHandoffState(providerContracts, providerCommitWindow, campaignExportReadiness, operatorControlPanel, runtimeState, controlIntent = null) {
  const providerRows = (providerContracts.providers ?? []).map((provider, index) => Object.freeze({
    source: "literal-provider",
    subject: `${provider.sourceKey}:${provider.adapter}`,
    order: index + 1,
    state: provider.handoff?.ready === false ? "blocked" : provider.sync?.externalWriteRequested && !provider.sync?.externalWriteAllowed ? "review" : "ready",
    checkpoint: provider.sync?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: provider.sync?.statusChannel ?? runtimeState.statusChannel,
    restartSafe: provider.idempotency?.restartSafe === true,
    localOnly: provider.sync?.localOnly !== false,
    writesExternalSystem: provider.sync?.externalWriteAllowed === true,
    idempotencyKey: provider.idempotency?.key ?? stableLiteralCommandId("idempotent", "literal-provider", provider.sourceKey, provider.adapter),
    nextAction: provider.handoff?.nextAction ?? "negotiate_literal_mailchimp_capabilities",
  }));
  const commitRows = (providerCommitWindow.rows ?? []).map((row, index) => Object.freeze({
    source: "literal-provider-commit",
    subject: `${row.sourceKey}:${row.adapter}`,
    order: providerRows.length + index + 1,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey || stableLiteralCommandId("idempotent", "literal-provider-commit", row.sourceKey, row.adapter),
    nextAction: row.nextAction,
  }));
  const campaignRows = (campaignExportReadiness.rows ?? []).map((row, index) => Object.freeze({
    source: "literal-campaign-export",
    subject: `${row.role}:${row.key}`,
    order: providerRows.length + commitRows.length + index + 1,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: stableLiteralCommandId("idempotent", "literal-campaign-export", row.role, row.key, row.checkpoint),
    nextAction: row.nextAction,
  }));
  const controlRows = (operatorControlPanel.rows ?? []).map((row, index) => Object.freeze({
    source: "literal-operator-control",
    subject: `${row.source}:${row.subject}`,
    order: providerRows.length + commitRows.length + campaignRows.length + index + 1,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: stableLiteralCommandId("idempotent", "literal-operator-control", row.source, row.subject),
    nextAction: row.nextAction,
  }));
  const controlIntentRows = (controlIntent?.rows ?? []).map((row, index) => Object.freeze({
    source: `literal-control-intent:${row.source}`,
    subject: row.subject,
    order: providerRows.length + commitRows.length + campaignRows.length + controlRows.length + index + 1,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey || stableLiteralCommandId("idempotent", "literal-control-intent", row.source, row.subject),
    nextAction: row.nextAction,
  }));
  const rows = Object.freeze([...providerRows, ...commitRows, ...campaignRows, ...controlRows, ...controlIntentRows]
    .sort((left, right) => `${left.source}:${left.subject}:${left.order}`.localeCompare(`${right.source}:${right.subject}:${right.order}`))
    .map((row, index) => Object.freeze({
      schema: "aios.literal.external-handoff-row.v1",
      rowId: stableLiteralCommandId("literal-external-handoff", index + 1, row.source, row.subject, row.checkpoint),
      order: index + 1,
      ...row,
    })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.state === "held" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const checkpoints = Object.freeze(Array.from(new Set([
    runtimeState.checkpoint,
    ...(providerContracts.sync?.checkpoints ?? []),
    providerCommitWindow.handoff?.checkpoint,
    campaignExportReadiness.handoff?.checkpoint,
    operatorControlPanel.handoff?.checkpoint,
    ...rows.map((row) => row.checkpoint),
  ].filter(Boolean))).sort());
  const statusChannels = Object.freeze(Array.from(new Set([
    runtimeState.statusChannel,
    ...(providerContracts.sync?.statusChannels ?? []),
    providerCommitWindow.handoff?.statusChannel,
    campaignExportReadiness.handoff?.statusChannel,
    operatorControlPanel.handoff?.statusChannel,
    ...rows.map((row) => row.statusChannel),
  ].filter(Boolean))).sort());
  const externalRequested = providerContracts.sync?.externalWriteRequested === true
    || rows.some((row) => row.writesExternalSystem);
  const externalAllowed = providerContracts.sync?.externalWriteAllowed === true
    && blockedRows.length === 0
    && rows.every((row) => row.restartSafe !== false && row.idempotencyKey);
  const ready = blockedRows.length === 0
    && providerContracts.handoff?.ready !== false
    && providerCommitWindow.handoff?.ready !== false
    && campaignExportReadiness.handoff?.ready !== false
    && operatorControlPanel.handoff?.ready !== false
    && runtimeState.persistedView?.restartSafe !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : ready ? "ready" : "warming";
  const nextAction = blockedRows[0]?.nextAction
    ?? (reviewRows.length > 0 ? "review_literal_external_handoff" : "publish_literal_external_handoff");

  return Object.freeze({
    schema: "aios.literal.external-handoff-state.v1",
    revision: stableLiteralCommandId("literal-external-handoff", runtimeState.revision, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      providerRows: providerRows.length,
      commitRows: commitRows.length,
      campaignRows: campaignRows.length,
      controlRows: controlRows.length,
      controlIntentRows: controlIntentRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && externalAllowed,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    sync: Object.freeze({
      externalWriteRequested: externalRequested,
      externalWriteAllowed: externalAllowed,
      localOnly: !externalAllowed,
      checkpoints,
      statusChannels,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint: checkpoints[0] || runtimeState.checkpoint,
      statusChannel: statusChannels[0] || runtimeState.statusChannel,
      localOnly: !externalAllowed,
      writesExternalSystem: externalAllowed,
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

function literalPreviewAcceptanceRow(source, subject, state, nextAction, extras = {}) {
  const blocked = state === "blocked" || extras.restartSafe === false;
  return Object.freeze({
    schema: "aios.literal.preview-acceptance-row.v1",
    rowId: stableLiteralCommandId("literal-preview", source, subject, extras.checkpoint ?? "local"),
    source,
    subject,
    state,
    checkpoint: extras.checkpoint ?? "",
    statusChannel: extras.statusChannel ?? "mailchimp.contract.status",
    restartSafe: extras.restartSafe !== false && !blocked,
    localOnly: extras.localOnly !== false,
    writesExternalSystem: extras.writesExternalSystem === true,
    nextAction: blocked ? nextAction : nextAction || "accept_literal_preview_row",
    reason: extras.reason ?? "",
  });
}

function buildLiteralPreviewAcceptance(
  contracts,
  exportPackage,
  releaseReport,
  lifecycleReadiness,
  providerNegotiation,
  clientReadiness,
  clientActionQueue,
  workflowHandoff,
  clientStatusAdoption,
  recoveryAdoption,
  operationalReport,
  runtimeState,
  boundaryContract,
  combinedDiagnostics,
) {
  const rows = Object.freeze([
    literalPreviewAcceptanceRow("export-package", exportPackage.revision, exportPackage.handoff?.ready === false ? "blocked" : exportPackage.status?.state ?? "ready", exportPackage.handoff?.nextAction ?? "publish_literal_export_package", {
      checkpoint: exportPackage.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: exportPackage.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: exportPackage.status?.restartSafe !== false,
      localOnly: exportPackage.handoff?.localOnly !== false,
      writesExternalSystem: exportPackage.handoff?.writesExternalSystem === true,
      reason: "Literal export manifest must be publishable before preview acceptance.",
    }),
    literalPreviewAcceptanceRow("release-report", releaseReport.revision, releaseReport.handoff?.ready === false ? "blocked" : releaseReport.state ?? "ready", releaseReport.handoff?.nextAction ?? "publish_literal_release_report", {
      checkpoint: releaseReport.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: releaseReport.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: releaseReport.persistedView?.restartSafe !== false,
      localOnly: releaseReport.handoff?.localOnly !== false,
      writesExternalSystem: releaseReport.handoff?.writesExternalSystem === true,
      reason: "Release report explains literal readiness to clients.",
    }),
    literalPreviewAcceptanceRow("lifecycle-readiness", lifecycleReadiness.state, lifecycleReadiness.handoff?.ready === false ? "blocked" : lifecycleReadiness.state ?? "ready", lifecycleReadiness.handoff?.nextAction ?? "adopt_literal_lifecycle_readiness", {
      checkpoint: lifecycleReadiness.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: lifecycleReadiness.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: lifecycleReadiness.counters?.blocked === 0,
      localOnly: lifecycleReadiness.handoff?.localOnly !== false,
      writesExternalSystem: lifecycleReadiness.handoff?.writesExternalSystem === true,
      reason: "Settings and schedules need restart-safe lifecycle acceptance.",
    }),
    literalPreviewAcceptanceRow("provider-negotiation", providerNegotiation.revision, providerNegotiation.handoff?.ready === false ? "blocked" : providerNegotiation.state ?? "ready", providerNegotiation.handoff?.nextAction ?? "handoff_literal_provider_negotiation", {
      checkpoint: providerNegotiation.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: providerNegotiation.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: providerNegotiation.counters?.blockedProviders === 0,
      localOnly: providerNegotiation.handoff?.localOnly !== false,
      writesExternalSystem: providerNegotiation.handoff?.writesExternalSystem === true,
      reason: "Mailchimp provider capability negotiation gates external handoff.",
    }),
    literalPreviewAcceptanceRow("client-readiness", clientReadiness.revision, clientReadiness.handoff?.ready === false ? "blocked" : clientReadiness.state ?? "ready", clientReadiness.handoff?.nextAction ?? "accept_literal_client_readiness", {
      checkpoint: clientReadiness.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: clientReadiness.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: clientReadiness.validationSummary?.blocked === 0,
      localOnly: clientReadiness.handoff?.localOnly !== false,
      writesExternalSystem: clientReadiness.handoff?.writesExternalSystem === true,
      reason: "Client readiness summarizes preview rows shown to the user.",
    }),
    literalPreviewAcceptanceRow("client-action-queue", clientActionQueue.revision, clientActionQueue.handoff?.ready === false ? "blocked" : clientActionQueue.state ?? "queued", clientActionQueue.handoff?.nextAction ?? "adopt_literal_client_actions", {
      checkpoint: clientActionQueue.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: clientActionQueue.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: clientActionQueue.counters?.blocked === 0,
      localOnly: clientActionQueue.handoff?.localOnly !== false,
      writesExternalSystem: clientActionQueue.handoff?.writesExternalSystem === true,
      reason: "Client actions must be idempotent before runtime adoption.",
    }),
    literalPreviewAcceptanceRow("workflow-handoff", workflowHandoff.revision, workflowHandoff.handoff?.ready === false ? "blocked" : workflowHandoff.state ?? "ready", workflowHandoff.handoff?.nextAction ?? "handoff_literal_workflow", {
      checkpoint: workflowHandoff.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: workflowHandoff.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: workflowHandoff.preview?.counters?.blocked === 0,
      localOnly: workflowHandoff.handoff?.localOnly !== false,
      writesExternalSystem: workflowHandoff.handoff?.writesExternalSystem === true,
      reason: "Workflow handoff ties preview, provider, and action queue state together.",
    }),
    literalPreviewAcceptanceRow("client-status-adoption", clientStatusAdoption.revision, clientStatusAdoption.handoff?.ready === false ? "blocked" : clientStatusAdoption.state ?? "accepted", clientStatusAdoption.handoff?.nextAction ?? "publish_literal_client_status_adoption", {
      checkpoint: clientStatusAdoption.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: clientStatusAdoption.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: clientStatusAdoption.counters?.blocked === 0,
      localOnly: clientStatusAdoption.handoff?.localOnly !== false,
      writesExternalSystem: clientStatusAdoption.handoff?.writesExternalSystem === true,
      reason: "Accepted status rows make the preview restart-safe for clients.",
    }),
    literalPreviewAcceptanceRow("recovery-adoption", recoveryAdoption.revision, recoveryAdoption.handoff?.ready === false ? "blocked" : recoveryAdoption.state ?? "ready", recoveryAdoption.handoff?.nextAction ?? "publish_literal_recovery_adoption", {
      checkpoint: recoveryAdoption.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: recoveryAdoption.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: recoveryAdoption.persistedView?.restartSafe !== false,
      localOnly: recoveryAdoption.handoff?.localOnly !== false,
      writesExternalSystem: recoveryAdoption.handoff?.writesExternalSystem === true,
      reason: "Recovery adoption makes validation failures explainable in the preview.",
    }),
    literalPreviewAcceptanceRow("operational-report", operationalReport.revision, operationalReport.handoff?.ready === false ? "blocked" : operationalReport.state ?? "ready", operationalReport.handoff?.nextAction ?? "publish_literal_operational_report", {
      checkpoint: operationalReport.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: operationalReport.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: operationalReport.counters?.blocked === 0,
      localOnly: operationalReport.handoff?.localOnly !== false,
      writesExternalSystem: operationalReport.handoff?.writesExternalSystem === true,
      reason: "Operational report is the final user-visible literal health summary.",
    }),
  ]);
  const diagnosticRows = Object.freeze(combinedDiagnostics.map((item, index) => Object.freeze({
    schema: "aios.literal.preview-acceptance-diagnostic.v1",
    order: index + 1,
    code: item.code,
    severity: item.severity,
    key: item.key ?? "",
    message: item.message,
    nextAction: item.recovery ?? "inspect_literal_preview_acceptance",
  })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || !row.restartSafe);
  const reviewRows = diagnosticRows.filter((row) => row.severity === "warning");
  const requiredClientState = Object.freeze([
    "literalPreviewAcceptanceRevision",
    "literalRuntimeCheckpoint",
    "literalStatusChannel",
    ...(boundaryContract.permissionEnvelope?.externalWriteRequested ? ["tenant", "workspace", "role"] : []),
  ].sort());
  const nextAction = blockedRows[0]?.nextAction
    ?? diagnosticRows.find((row) => row.severity === "error")?.nextAction
    ?? (reviewRows.length > 0 ? reviewRows[0].nextAction : "accept_literal_preview_contracts");

  return Object.freeze({
    schema: "aios.literal.preview-acceptance.v1",
    revision: stableLiteralCommandId("literal-preview-acceptance", runtimeState.revision, exportPackage.revision, clientReadiness.revision, rows.length, blockedRows.length, diagnosticRows.length),
    state: blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : contracts.length > 0 ? "ready" : "empty",
    rows,
    diagnostics: diagnosticRows,
    validationSummary: Object.freeze({
      rows: rows.length,
      blocked: blockedRows.length,
      warnings: reviewRows.length,
      errors: diagnosticRows.filter((row) => row.severity === "error").length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
      literalContracts: contracts.length,
    }),
    acceptance: Object.freeze({
      acceptedForPreview: blockedRows.length === 0,
      acceptedForRuntime: blockedRows.length === 0 && runtimeState.persistedView?.restartSafe === true,
      acceptedForExternalWrite: blockedRows.length === 0 && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.code}:${row.key}`).sort()),
      nextAction,
    }),
    clientState: Object.freeze({
      requiredKeys: requiredClientState,
      persistedState: Object.freeze({
        literalPreviewAcceptanceRevision: stableLiteralCommandId("literal-preview", runtimeState.revision, rows.length),
        literalRuntimeCheckpoint: runtimeState.checkpoint,
        literalStatusChannel: runtimeState.statusChannel,
        tenant: boundaryContract.handoff?.tenant ?? "",
        workspace: boundaryContract.handoff?.workspace ?? "global",
        role: boundaryContract.handoff?.role ?? "",
      }),
    }),
    nextStepQueue: Object.freeze([
      ...blockedRows.map((row, index) => Object.freeze({
        order: index + 1,
        action: row.nextAction,
        subject: `${row.source}:${row.subject}`,
        restartSafe: row.restartSafe,
      })),
      ...(blockedRows.length === 0 ? [Object.freeze({
        order: 1,
        action: reviewRows.length > 0 ? "review_literal_preview_warnings" : "accept_literal_preview_contracts",
        subject: runtimeState.checkpoint,
        restartSafe: true,
      })] : []),
    ]),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildLiteralCampaignExportReadiness(
  contracts,
  analytics,
  history,
  exportPackage,
  releaseReport,
  providerCommitWindow,
  clientReadiness,
  analyticsExportJournal,
  previewAcceptance,
) {
  const campaignContracts = contracts.filter((contract) => {
    const capability = normalizeMailchimpCapability(contract.value);
    const nestedCapabilities = collectMailchimpCapabilities(contract.value);
    return contract.role === "capability" && capability.includes("campaign")
      || normalizeControlText(contract.key).toLowerCase().includes("campaign")
      || normalizeControlText(contract.value).toLowerCase().includes("campaign")
      || nestedCapabilities.some((item) => item.includes("campaign"));
  });
  const contractKeys = new Set(campaignContracts.map((contract) => contract.key));
  const rows = Object.freeze((exportPackage.manifest ?? [])
    .filter((row) => contractKeys.has(row.key) || normalizeControlText(row.value).toLowerCase().includes("campaign"))
    .map((row, index) => Object.freeze({
      schema: "aios.literal.campaign-export-row.v1",
      order: index + 1,
      key: row.key,
      role: row.role,
      state: row.state,
      checkpoint: row.provider?.checkpoint ?? exportPackage.handoff?.checkpoint ?? "",
      statusChannel: row.provider?.statusChannel ?? exportPackage.handoff?.statusChannel ?? "mailchimp.contract.status",
      restartSafe: row.runtime?.restartSafe !== false && row.boundary?.blocked !== true,
      providerBacked: Boolean(row.provider),
      localOnly: row.provider?.writesExternalSystem !== true,
      writesExternalSystem: row.provider?.writesExternalSystem === true,
      nextAction: row.nextAction,
    })));
  const releaseRows = Object.freeze((releaseReport.rows ?? [])
    .filter((row) => contractKeys.has(row.key) || normalizeControlText(row.value).toLowerCase().includes("campaign"))
    .map((row) => Object.freeze({
      key: row.key,
      state: row.state,
      releaseReady: row.releaseReady === true || row.state === "release-ready",
      nextAction: row.nextAction,
    })));
  const providerRows = Object.freeze((providerCommitWindow.rows ?? [])
    .filter((row) => normalizeControlText(row.sourceKey).toLowerCase().includes("campaign")
      || (row.capabilities ?? []).some((capability) => normalizeMailchimpCapability(capability).includes("campaign")))
    .map((row) => Object.freeze({
      sourceKey: row.sourceKey,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })));
  const previewRows = Object.freeze((previewAcceptance.rows ?? [])
    .filter((row) => normalizeControlText(row.subject).toLowerCase().includes("campaign")
      || ["export-package", "release-report", "analytics-export-journal"].includes(row.source))
    .map((row) => Object.freeze({
      source: row.source,
      subject: row.subject,
      state: row.state,
      restartSafe: row.restartSafe === true,
      nextAction: row.nextAction,
    })));
  const blockers = Object.freeze([
    ...rows.filter((row) => row.state === "blocked" || !row.restartSafe).map((row) => `manifest:${row.key}:${row.nextAction}`),
    ...releaseRows.filter((row) => !row.releaseReady).map((row) => `release:${row.key}:${row.nextAction}`),
    ...providerRows.filter((row) => row.state === "held" || row.state === "blocked" || !row.restartSafe).map((row) => `provider:${row.sourceKey}:${row.nextAction}`),
    ...previewRows.filter((row) => row.state === "blocked" || !row.restartSafe).map((row) => `preview:${row.source}:${row.nextAction}`),
  ].sort());
  const review = Object.freeze([
    ...(analytics.counters?.warnings > 0 ? ["analytics:warnings"] : []),
    ...providerRows.filter((row) => row.state === "review").map((row) => `provider:${row.sourceKey}`),
    ...previewRows.filter((row) => row.state === "review").map((row) => `preview:${row.source}`),
  ].sort());
  const checkpoint = exportPackage.handoff?.checkpoint
    || clientReadiness.handoff?.checkpoint
    || providerCommitWindow.handoff?.checkpoint
    || "literal:campaign-export";
  const statusChannel = exportPackage.handoff?.statusChannel
    || clientReadiness.handoff?.statusChannel
    || providerCommitWindow.handoff?.statusChannel
    || "mailchimp.contract.status";
  const state = blockers.length > 0
    ? "blocked"
    : review.length > 0 ? "review" : campaignContracts.length > 0 ? "ready" : "empty";
  const nextAction = blockers[0]?.split(":").slice(2).join(":")
    || (review.length > 0 ? "review_literal_campaign_export_readiness" : "publish_literal_campaign_export_readiness");

  return Object.freeze({
    schema: "aios.literal.campaign-export-readiness.v1",
    revision: stableLiteralCommandId("literal-campaign-export", history.revision, exportPackage.revision, releaseReport.revision, state, blockers.length),
    state,
    rows,
    releaseRows,
    providerRows,
    previewRows,
    counters: Object.freeze({
      campaignContracts: campaignContracts.length,
      rows: rows.length,
      releaseRows: releaseRows.length,
      providerRows: providerRows.length,
      previewRows: previewRows.length,
      exportReady: rows.filter((row) => row.state === "publishable" || row.state === "export-ready").length,
      blocked: blockers.length,
      review: review.length,
      analyticsExportReady: analyticsExportJournal.counters?.exportReady ?? 0,
      clientReadinessBlocked: clientReadiness.preview?.counters?.blocked ?? 0,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockers.length === 0,
      acceptedForExternalWrite: blockers.length === 0 && providerRows.some((row) => row.writesExternalSystem),
      blockedBy: blockers,
      review,
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockers.length === 0,
      checkpoint,
      statusChannel,
      localOnly: providerRows.every((row) => !row.writesExternalSystem),
      writesExternalSystem: providerRows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function literalRequestValueForRole(contracts, role) {
  const contract = contracts.find((item) => item.role === role);
  return contract ? normalizeControlText(contract.value) : "";
}

function buildLiteralClientRequestResumeDecision({
  rows,
  blockedRows,
  reviewRows,
  checkpoints,
  statusChannels,
  capabilityRows,
  clientStateMissingKeys,
  acceptedForRuntime,
  acceptedForExternalWrite,
}) {
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const replayableRows = rows.filter((row) => row.restartSafe && row.idempotencyKey && row.state !== "blocked");
  const blockedSubjects = Object.freeze([
    ...blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`),
    ...clientStateMissingKeys.map((key) => `client-state:${key}`),
  ].sort());
  const reviewSubjects = Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort());
  const resumeMode = blockedSubjects.length > 0
    ? "hold"
    : reviewSubjects.length > 0 ? "review" : externalRows.length > 0 ? "handoff" : "local-replay";
  const nextAction = blockedSubjects.length > 0
    ? blockedRows[0]?.nextAction ?? "hydrate_literal_client_request_state"
    : reviewSubjects.length > 0
      ? reviewRows[0]?.nextAction ?? "review_literal_client_request_resume"
      : externalRows.length > 0 ? "handoff_literal_client_request_resume" : "resume_literal_client_request";

  return Object.freeze({
    schema: "aios.literal.client-request-resume-decision.v1",
    resumeMode,
    replayable: acceptedForRuntime && replayableRows.length === rows.length,
    checkpoint: checkpoints[0] ?? "",
    statusChannel: statusChannels[0] ?? "mailchimp.contract.status",
    capabilities: capabilityRows,
    rows: Object.freeze(rows.map((row, index) => Object.freeze({
      schema: "aios.literal.client-request-resume-row.v1",
      order: index + 1,
      source: row.source,
      subject: row.subject,
      state: row.state,
      replayState: row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey
        ? "held"
        : row.state === "review" ? "review" : "replayable",
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      idempotencyKey: row.idempotencyKey,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey
        ? row.nextAction
        : row.state === "review" ? "review_literal_client_request_resume" : "replay_literal_client_request_row",
    }))),
    counters: Object.freeze({
      rows: rows.length,
      replayable: replayableRows.length,
      held: blockedRows.length + clientStateMissingKeys.length,
      review: reviewRows.length,
      externalWrites: externalRows.length,
      capabilities: capabilityRows.length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime,
      acceptedForExternalWrite,
      blockedBy: blockedSubjects,
      review: reviewSubjects,
      nextAction,
    }),
    handoff: Object.freeze({
      ready: acceptedForRuntime,
      checkpoint: checkpoints[0] ?? "",
      statusChannel: statusChannels[0] ?? "mailchimp.contract.status",
      localOnly: !acceptedForExternalWrite,
      writesExternalSystem: acceptedForExternalWrite,
      nextAction,
    }),
  });
}

function buildLiteralClientRequestSnapshot(contracts, providerContracts, boundaryContract, runtimeState, clientReadiness, externalHandoffState, previewAcceptance) {
  const capabilityRows = Object.freeze(Array.from(new Set([
    ...(providerContracts.requestedCapabilities ?? []),
    ...(providerContracts.capabilities ?? []).map((row) => row.capability),
    ...contracts
      .filter((contract) => contract.role === "capability")
      .map((contract) => normalizeMailchimpCapability(contract.value)),
  ].map(normalizeControlText).filter(Boolean))).sort());
  const providerRows = Object.freeze((providerContracts.providers ?? []).map((provider, index) => {
    const blockers = Object.freeze([
      ...(provider.handoff?.ready === false ? ["provider_handoff"] : []),
      ...(provider.idempotency?.restartSafe === false ? ["idempotency"] : []),
      ...(provider.sync?.externalWriteRequested === true && provider.sync?.externalWriteAllowed !== true ? ["external_write_confirmation"] : []),
    ].sort());
    const state = blockers.length > 0 ? "blocked" : provider.sync?.externalWriteRequested ? "review" : "ready";
    return Object.freeze({
      schema: "aios.literal.client-request-provider-row.v1",
      order: index + 1,
      source: "literal-provider",
      subject: `${provider.sourceKey}:${provider.adapter}`,
      service: provider.service,
      adapter: provider.adapter,
      checkpoint: provider.sync?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: provider.sync?.statusChannel ?? runtimeState.statusChannel,
      state,
      restartSafe: blockers.length === 0 && provider.idempotency?.restartSafe !== false,
      localOnly: provider.sync?.localOnly !== false,
      writesExternalSystem: provider.sync?.externalWriteAllowed === true,
      idempotencyKey: provider.idempotency?.key ?? stableLiteralCommandId("idempotent", "literal-request-provider", provider.sourceKey, provider.adapter),
      blockers,
      nextAction: blockers[0] === "external_write_confirmation"
        ? "confirm_literal_request_external_write"
        : blockers.length > 0 ? provider.handoff?.nextAction ?? "repair_literal_provider_contract" : provider.handoff?.nextAction ?? "adopt_literal_provider_request",
    });
  }));
  const runtimeRows = Object.freeze((runtimeState.commands ?? []).map((command, index) => Object.freeze({
    schema: "aios.literal.client-request-runtime-row.v1",
    order: providerRows.length + index + 1,
    source: "literal-runtime",
    subject: `${command.type}:${command.key}`,
    checkpoint: command.checkpoint,
    statusChannel: command.statusChannel,
    state: command.state === "ready" ? "queued" : command.state,
    restartSafe: command.restartSafe === true,
    localOnly: command.localOnly !== false,
    writesExternalSystem: command.writesExternalSystem === true,
    idempotencyKey: command.idempotencyKey,
    blockers: Object.freeze([
      ...(command.state === "blocked" ? ["runtime_blocked"] : []),
      ...(command.restartSafe === false ? ["restart_safety"] : []),
    ].sort()),
    nextAction: command.nextAction,
  })));
  const previewRows = Object.freeze((previewAcceptance.rows ?? []).filter((row) => row.state === "blocked" || row.state === "review").map((row, index) => Object.freeze({
    schema: "aios.literal.client-request-preview-row.v1",
    order: providerRows.length + runtimeRows.length + index + 1,
    source: `preview:${row.source}`,
    subject: row.subject,
    checkpoint: row.checkpoint ?? previewAcceptance.handoff?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: row.statusChannel ?? previewAcceptance.handoff?.statusChannel ?? runtimeState.statusChannel,
    state: row.state,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey ?? stableLiteralCommandId("idempotent", "literal-request-preview", row.source, row.subject),
    blockers: Object.freeze(row.state === "blocked" ? ["preview_blocked"] : []),
    nextAction: row.nextAction,
  })));
  const rows = Object.freeze([...providerRows, ...runtimeRows, ...previewRows]
    .sort((left, right) => `${left.source}:${left.subject}:${left.idempotencyKey}`.localeCompare(`${right.source}:${right.subject}:${right.idempotencyKey}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const checkpoints = Object.freeze(Array.from(new Set([
    runtimeState.checkpoint,
    clientReadiness.handoff?.checkpoint,
    externalHandoffState.handoff?.checkpoint,
    ...rows.map((row) => row.checkpoint),
  ].filter(Boolean))).sort());
  const statusChannels = Object.freeze(Array.from(new Set([
    runtimeState.statusChannel,
    clientReadiness.handoff?.statusChannel,
    externalHandoffState.handoff?.statusChannel,
    ...rows.map((row) => row.statusChannel),
  ].filter(Boolean))).sort());
  const acceptedForRuntime = blockedRows.length === 0
    && runtimeState.persistedView?.restartSafe === true
    && clientReadiness.handoff?.ready !== false
    && externalHandoffState.handoff?.ready !== false;
  const acceptedForExternalWrite = acceptedForRuntime && rows.some((row) => row.writesExternalSystem);
  const requiredClientKeys = Object.freeze(["requestId", "service", "adapter", "checkpoint", "statusChannel", "tenant"].sort());
  const clientStateMissingKeys = Object.freeze([
    ...(!providerContracts.service ? ["service"] : []),
    ...(!providerContracts.adapter ? ["adapter"] : []),
    ...(!checkpoints[0] ? ["checkpoint"] : []),
    ...(!statusChannels[0] ? ["statusChannel"] : []),
    ...(!(boundaryContract.handoff?.tenant || literalRequestValueForRole(contracts, "tenant")) ? ["tenant"] : []),
  ].sort());
  const requestResumeDecision = buildLiteralClientRequestResumeDecision({
    rows,
    blockedRows,
    reviewRows,
    checkpoints,
    statusChannels,
    capabilityRows,
    clientStateMissingKeys,
    acceptedForRuntime,
    acceptedForExternalWrite,
  });
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "adopt_literal_client_request_snapshot" : "attach_literal_client_request_snapshot");

  return Object.freeze({
    schema: "aios.literal.client-request-snapshot.v1",
    requestId: stableLiteralCommandId("literal-request", runtimeState.checkpoint, rows.length, blockedRows.length, reviewRows.length),
    state: blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty",
    service: providerContracts.service || "mailchimp",
    adapter: providerContracts.adapter || "mailchimp",
    tenant: boundaryContract.handoff?.tenant || literalRequestValueForRole(contracts, "tenant"),
    workspace: boundaryContract.handoff?.workspace || literalRequestValueForRole(contracts, "workspace"),
    role: boundaryContract.handoff?.role || literalRequestValueForRole(contracts, "role"),
    capabilities: capabilityRows,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      providers: providerRows.length,
      runtimeCommands: runtimeRows.length,
      previewRows: previewRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
      resumeReplayable: requestResumeDecision.counters.replayable,
      resumeHeld: requestResumeDecision.counters.held,
    }),
    requestResumeDecision,
    clientState: Object.freeze({
      requiredKeys: requiredClientKeys,
      missingKeys: clientStateMissingKeys,
      checkpoint: checkpoints[0] ?? "",
      statusChannel: statusChannels[0] ?? "mailchimp.contract.status",
    }),
    acceptance: Object.freeze({
      acceptedForRuntime,
      acceptedForExternalWrite,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: acceptedForRuntime,
      checkpoint: checkpoints[0] ?? "",
      statusChannel: statusChannels[0] ?? "mailchimp.contract.status",
      localOnly: !acceptedForExternalWrite,
      writesExternalSystem: acceptedForExternalWrite,
      userVisibleState: blockedRows.length > 0 ? "needs-attention" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "queued" : "idle",
      nextAction,
    }),
  });
}

function literalFreshnessSeconds(mode, externalWriteRequested) {
  const normalized = stableRuntimePart(mode || "local");
  if (normalized === "push" || normalized === "provider") return 60;
  if (normalized === "deferred") return 900;
  if (normalized === "pull") return 300;
  return externalWriteRequested ? 300 : 0;
}

function buildLiteralProviderFreshnessContract(providerContracts, runtimeState, clientRequestSnapshot, externalHandoffState) {
  const baseFreshnessSeconds = literalFreshnessSeconds(
    providerContracts.sync?.mode,
    providerContracts.sync?.externalWriteRequested === true,
  );
  const providerRows = Object.freeze((providerContracts.providers ?? []).map((provider, index) => {
    const freshnessSeconds = literalFreshnessSeconds(provider.sync?.mode, provider.sync?.externalWriteRequested === true) || baseFreshnessSeconds;
    return Object.freeze({
      schema: "aios.literal.provider-freshness-row.v1",
      source: "literal-provider",
      subject: `${provider.sourceKey}:${provider.adapter}`,
      order: index + 1,
      state: provider.handoff?.ready === false ? "blocked" : freshnessSeconds > 0 ? "fresh" : "local",
      checkpoint: provider.sync?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: provider.sync?.statusChannel ?? runtimeState.statusChannel,
      freshnessSeconds,
      restartSafe: provider.idempotency?.restartSafe !== false,
      localOnly: provider.sync?.localOnly !== false,
      writesExternalSystem: provider.sync?.externalWriteAllowed === true,
      idempotencyKey: provider.idempotency?.key ?? stableLiteralCommandId("idempotent", "literal-provider-freshness", provider.sourceKey, provider.adapter),
      nextAction: provider.handoff?.ready === false
        ? provider.handoff.nextAction
        : freshnessSeconds > 0 ? "publish_literal_provider_freshness" : "retain_local_literal_provider_freshness",
    });
  }));
  const requestRow = Object.freeze({
    schema: "aios.literal.provider-freshness-row.v1",
    source: "client-request",
    subject: clientRequestSnapshot.requestId,
    order: providerRows.length + 1,
    state: clientRequestSnapshot.handoff?.ready === false ? "blocked" : clientRequestSnapshot.state,
    checkpoint: clientRequestSnapshot.handoff?.checkpoint || runtimeState.checkpoint,
    statusChannel: clientRequestSnapshot.handoff?.statusChannel || runtimeState.statusChannel,
    freshnessSeconds: baseFreshnessSeconds,
    restartSafe: clientRequestSnapshot.handoff?.ready !== false,
    localOnly: clientRequestSnapshot.handoff?.localOnly !== false,
    writesExternalSystem: clientRequestSnapshot.handoff?.writesExternalSystem === true,
    idempotencyKey: stableLiteralCommandId("idempotent", "literal-client-freshness", clientRequestSnapshot.requestId),
    nextAction: clientRequestSnapshot.handoff?.nextAction ?? "adopt_literal_client_request_snapshot",
  });
  const externalRow = Object.freeze({
    schema: "aios.literal.provider-freshness-row.v1",
    source: "external-handoff",
    subject: externalHandoffState.revision,
    order: providerRows.length + 2,
    state: externalHandoffState.handoff?.ready === false ? "blocked" : externalHandoffState.state,
    checkpoint: externalHandoffState.handoff?.checkpoint || runtimeState.checkpoint,
    statusChannel: externalHandoffState.handoff?.statusChannel || runtimeState.statusChannel,
    freshnessSeconds: baseFreshnessSeconds,
    restartSafe: externalHandoffState.handoff?.ready !== false,
    localOnly: externalHandoffState.handoff?.localOnly !== false,
    writesExternalSystem: externalHandoffState.handoff?.writesExternalSystem === true,
    idempotencyKey: stableLiteralCommandId("idempotent", "literal-external-freshness", externalHandoffState.revision),
    nextAction: externalHandoffState.handoff?.nextAction ?? "publish_literal_external_handoff",
  });
  const rows = Object.freeze([...providerRows, requestRow, externalRow]
    .sort((left, right) => `${left.source}:${left.subject}:${left.order}`.localeCompare(`${right.source}:${right.subject}:${right.order}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : externalRows.length > 0 ? "fresh" : "local";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (externalRows.length > 0 ? "publish_literal_provider_freshness" : "retain_local_literal_provider_freshness");
  const sla = buildLiteralProviderHandoffSla(rows, providerContracts, runtimeState);

  return Object.freeze({
    schema: "aios.literal.provider-freshness.v1",
    revision: stableLiteralCommandId("literal-provider-freshness", providerContracts.service, providerContracts.adapter, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      providers: providerRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      externalWrites: externalRows.length,
      maxFreshnessSeconds: Math.max(0, ...rows.map((row) => row.freshnessSeconds)),
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0 && sla.handoff.ready === true,
      checkpoint: rows.find((row) => row.checkpoint)?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: rows.find((row) => row.statusChannel)?.statusChannel ?? runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction: blockedRows[0]?.nextAction ?? sla.handoff.nextAction ?? nextAction,
    }),
    sla,
  });
}

function literalProviderSlaTargetSeconds(row) {
  if (row.state === "blocked" || row.restartSafe === false) return 0;
  if (row.writesExternalSystem) return 120;
  if (row.freshnessSeconds > 0) return Math.max(300, row.freshnessSeconds);
  return 0;
}

function buildLiteralProviderHandoffSla(rows, providerContracts, runtimeState) {
  const slaRows = Object.freeze(rows.map((row, index) => {
    const targetSeconds = literalProviderSlaTargetSeconds(row);
    const stale = targetSeconds > 0 && row.freshnessSeconds > targetSeconds;
    const blocked = row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey;
    const state = blocked ? "blocked" : stale ? "stale" : targetSeconds > 0 ? "within-sla" : "local";
    return Object.freeze({
      schema: "aios.literal.provider-handoff-sla-row.v1",
      order: index + 1,
      source: row.source,
      subject: row.subject,
      state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      freshnessSeconds: row.freshnessSeconds,
      targetSeconds,
      breach: blocked || stale,
      restartSafe: row.restartSafe === true && !blocked,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: stableLiteralCommandId("idempotent", "literal-provider-sla", row.source, row.subject, row.checkpoint),
      nextAction: blocked
        ? row.nextAction
        : stale
          ? "refresh_literal_provider_handoff_sla"
          : targetSeconds > 0 ? "monitor_literal_provider_handoff_sla" : "retain_local_literal_provider_handoff_sla",
    });
  }));
  const blockedRows = slaRows.filter((row) => row.state === "blocked");
  const staleRows = slaRows.filter((row) => row.state === "stale");
  const externalRows = slaRows.filter((row) => row.writesExternalSystem);
  const nextAction = blockedRows[0]?.nextAction
    ?? staleRows[0]?.nextAction
    ?? (slaRows.length > 0 ? "monitor_literal_provider_handoff_sla" : "attach_literal_provider_handoff_sla");

  return Object.freeze({
    schema: "aios.literal.provider-handoff-sla.v1",
    revision: stableLiteralCommandId("literal-provider-sla", providerContracts.service, providerContracts.adapter, rows.length, blockedRows.length, staleRows.length),
    state: blockedRows.length > 0 ? "blocked" : staleRows.length > 0 ? "stale" : externalRows.length > 0 ? "within-sla" : "local",
    rows: slaRows,
    counters: Object.freeze({
      rows: slaRows.length,
      providers: rows.filter((row) => row.source === "literal-provider").length,
      blocked: blockedRows.length,
      stale: staleRows.length,
      withinSla: slaRows.filter((row) => row.state === "within-sla").length,
      local: slaRows.filter((row) => row.state === "local").length,
      externalWrites: externalRows.length,
      maxFreshnessSeconds: Math.max(0, ...slaRows.map((row) => row.freshnessSeconds)),
      maxTargetSeconds: Math.max(0, ...slaRows.map((row) => row.targetSeconds)),
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && staleRows.length === 0 && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(staleRows.map((row) => `${row.source}:${row.subject}:stale`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0 && staleRows.length === 0,
      checkpoint: slaRows.find((row) => row.checkpoint)?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: slaRows.find((row) => row.statusChannel)?.statusChannel ?? runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function literalReviewPacketRow(source, subject, state, handoff = {}, extras = {}) {
  const checkpoint = normalizeControlText(handoff.checkpoint || extras.checkpoint || "");
  const statusChannel = normalizeControlText(handoff.statusChannel || extras.statusChannel || "mailchimp.contract.status");
  const restartSafe = handoff.ready !== false && extras.restartSafe !== false;
  return Object.freeze({
    schema: "aios.literal.mailchimp-review-row.v1",
    source,
    subject: normalizeControlText(subject),
    state: normalizeControlText(state || "unknown"),
    checkpoint,
    statusChannel,
    restartSafe,
    localOnly: handoff.localOnly !== false && extras.localOnly !== false,
    writesExternalSystem: handoff.writesExternalSystem === true || extras.writesExternalSystem === true,
    idempotencyKey: stableLiteralCommandId("idempotent", "literal-review", source, subject, checkpoint || statusChannel),
    display: Object.freeze({
      title: normalizeControlText(extras.title || subject),
      detail: normalizeControlText(extras.detail || ""),
      badge: normalizeControlText(extras.badge || state || "unknown"),
    }),
    nextAction: normalizeControlText(extras.nextAction || handoff.nextAction || "review_literal_mailchimp_contract"),
  });
}

function buildLiteralMailchimpReviewPacket({
  contracts,
  exportSummary,
  previewAcceptance,
  clientRequestSnapshot,
  providerFreshness,
  campaignExportReadiness,
  externalHandoffState,
  runtimeState,
  boundaryContract,
  combinedDiagnostics,
}) {
  const exportRows = (exportSummary.rows ?? [])
    .filter((row) => row.role === "capability" || row.role === "handoff" || row.role === "tenant" || row.role === "workspace" || row.role === "role")
    .map((row) => literalReviewPacketRow(
      `literal-export:${row.role}`,
      row.key,
      row.state,
      runtimeState.clientHandoff,
      {
        title: `${row.role}:${row.key}`,
        detail: row.state === "export-ready" ? "Literal is ready for Mailchimp contract export." : "Literal is retained or blocked before export.",
        badge: row.kind,
        nextAction: row.state === "export-ready" ? "publish_literal_exports" : "inspect_literal_export_state",
      },
    ));
  const previewRows = (previewAcceptance.rows ?? []).map((row) => literalReviewPacketRow(
    `literal-preview:${row.source}`,
    row.subject,
    row.state,
    previewAcceptance.handoff,
    {
      restartSafe: row.restartSafe,
      localOnly: row.localOnly,
      writesExternalSystem: row.writesExternalSystem,
      title: row.subject,
      detail: `Preview acceptance from ${row.source}.`,
      badge: row.state,
      nextAction: row.nextAction,
    },
  ));
  const campaignRows = (campaignExportReadiness.rows ?? []).map((row) => literalReviewPacketRow(
    `literal-campaign:${row.role}`,
    row.key,
    row.state,
    campaignExportReadiness.handoff,
    {
      restartSafe: row.restartSafe,
      localOnly: row.localOnly,
      writesExternalSystem: row.writesExternalSystem,
      title: `${row.role}:${row.key}`,
      detail: "Mailchimp campaign export readiness row.",
      badge: row.state,
      nextAction: row.nextAction,
    },
  ));
  const freshnessRows = (providerFreshness.rows ?? []).map((row) => literalReviewPacketRow(
    `literal-freshness:${row.source}`,
    row.subject,
    row.state,
    providerFreshness.handoff,
    {
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe,
      localOnly: row.localOnly,
      writesExternalSystem: row.writesExternalSystem,
      title: row.subject,
      detail: `Provider freshness window ${row.freshnessSeconds ?? 0}s.`,
      badge: row.state,
      nextAction: row.nextAction,
    },
  ));
  const freshnessSlaRows = (providerFreshness.sla?.rows ?? []).map((row) => literalReviewPacketRow(
    `literal-freshness-sla:${row.source}`,
    row.subject,
    row.state === "within-sla" ? "ready" : row.state,
    providerFreshness.sla.handoff,
    {
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe,
      localOnly: row.localOnly,
      writesExternalSystem: row.writesExternalSystem,
      title: row.subject,
      detail: `Provider handoff SLA target ${row.targetSeconds}s with freshness ${row.freshnessSeconds}s.`,
      badge: row.state,
      nextAction: row.nextAction,
    },
  ));
  const boundaryRows = [
    ...(boundaryContract.permissionEnvelope?.permissionMatrix?.rows ?? []).map((row) => literalReviewPacketRow(
      "literal-boundary:permission",
      `${row.principal}:${row.capability}`,
      row.state,
      boundaryContract.permissionEnvelope.permissionMatrix.handoff,
      {
        restartSafe: row.restartSafe,
        localOnly: row.localOnly,
        writesExternalSystem: row.writesExternalSystem,
        title: `${row.principal}:${row.capability}`,
        detail: "Tenant permission boundary row.",
        badge: row.decision || row.state,
        nextAction: row.nextAction,
      },
    )),
    ...(boundaryContract.tenantBoundaryLease?.rows ?? []).map((row) => literalReviewPacketRow(
      `literal-boundary:${row.type}`,
      row.subject,
      row.state,
      boundaryContract.tenantBoundaryLease.handoff,
      {
        restartSafe: row.restartSafe,
        localOnly: row.localOnly,
        writesExternalSystem: row.writesExternalSystem,
        title: row.subject,
        detail: "Tenant boundary lease row.",
        badge: row.state,
        nextAction: row.nextAction,
      },
    )),
  ];
  const requestRow = literalReviewPacketRow(
    "literal-client-request",
    clientRequestSnapshot.requestId,
    clientRequestSnapshot.state,
    clientRequestSnapshot.handoff,
    {
      title: clientRequestSnapshot.requestId,
      detail: `Tenant ${clientRequestSnapshot.tenant || "unbound"} with ${clientRequestSnapshot.capabilities?.length ?? 0} requested capabilities.`,
      badge: clientRequestSnapshot.clientState?.hydrated ? "hydrated" : "missing-state",
      nextAction: clientRequestSnapshot.handoff?.nextAction,
    },
  );
  const externalRow = literalReviewPacketRow(
    "literal-external-handoff",
    externalHandoffState.revision,
    externalHandoffState.state,
    externalHandoffState.handoff,
    {
      title: externalHandoffState.revision,
      detail: "External handoff state for Mailchimp writes.",
      badge: externalHandoffState.handoff?.writesExternalSystem ? "external" : "local",
      nextAction: externalHandoffState.handoff?.nextAction,
    },
  );
  const diagnosticRows = combinedDiagnostics
    .filter((item) => item.severity === "error" || item.severity === "warning")
    .map((item) => literalReviewPacketRow(
      "literal-diagnostic",
      item.code,
      item.severity === "error" ? "blocked" : "review",
      runtimeState.clientHandoff,
      {
        restartSafe: item.severity !== "error",
        title: item.code,
        detail: item.message,
        badge: item.severity,
        nextAction: item.recovery,
      },
    ));
  const rows = Object.freeze([
    ...exportRows,
    ...previewRows,
    ...campaignRows,
    ...freshnessRows,
    ...freshnessSlaRows,
    ...boundaryRows,
    requestRow,
    externalRow,
    ...diagnosticRows,
  ].sort((left, right) => `${left.state}:${left.source}:${left.subject}`.localeCompare(`${right.state}:${right.source}:${right.subject}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const ready = blockedRows.length === 0
    && previewAcceptance.handoff?.ready !== false
    && clientRequestSnapshot.handoff?.ready !== false
    && providerFreshness.handoff?.ready !== false
    && externalHandoffState.handoff?.ready !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (ready ? "accept_literal_mailchimp_review_packet" : "prepare_literal_mailchimp_review_packet");

  return Object.freeze({
    schema: "aios.literal.mailchimp-review-packet.v1",
    revision: stableLiteralCommandId("literal-review-packet", state, rows.length, blockedRows.length, providerFreshness.revision),
    state,
    rows,
    validationSummary: Object.freeze({
      state,
      rows: rows.length,
      contracts: contracts.length,
      previewRows: previewRows.length,
      campaignRows: campaignRows.length,
      freshnessRows: freshnessRows.length,
      freshnessSlaRows: freshnessSlaRows.length,
      boundaryRows: boundaryRows.length,
      diagnostics: diagnosticRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
      nextAction,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || externalRows.length > 0,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    nextSteps: Object.freeze((blockedRows.length > 0 ? blockedRows : reviewRows).map((row, index) => Object.freeze({
      order: index + 1,
      action: row.nextAction,
      subject: `${row.source}:${row.subject}`,
      reason: row.display.detail,
      restartSafe: row.restartSafe,
    }))),
    handoff: Object.freeze({
      ready,
      checkpoint: rows.find((row) => row.checkpoint)?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: rows.find((row) => row.statusChannel)?.statusChannel ?? runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
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
  const resumeManifest = buildLiteralResumeManifest(runtimeState, providerContracts, workflowControls, combinedDiagnostics);
  const lifecycleReadiness = buildLiteralLifecycleReadiness(workflowControls, runtimeState, providerContracts, combinedDiagnostics);
  const operationalHealth = buildLiteralOperationalHealth(contracts, providerContracts, boundaryContract, workflowControls, runtimeState, combinedDiagnostics);
  const incidentSnapshot = buildLiteralIncidentSnapshot(operationalHealth, providerContracts, boundaryContract, runtimeState);
  const restartDigest = buildLiteralRestartDigest(runtimeState, resumeManifest, operationalHealth, providerContracts);
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
  const deploymentPlan = buildLiteralDeploymentPlan(
    workflowControls,
    providerContracts,
    runtimeState,
    boundaryContract,
    operationalHealth,
    adoptionSignature,
    releaseReport,
  );
  const syncBridge = buildLiteralSyncBridge(
    providerContracts,
    runtimeState,
    workflowControls,
    boundaryContract,
    releaseReport,
    deploymentPlan,
  );
  const providerNegotiation = buildLiteralProviderNegotiation(
    providerContracts,
    runtimeState,
    workflowControls,
    boundaryContract,
    syncBridge,
  );
  const providerCommitWindow = buildLiteralProviderCommitWindow(
    providerNegotiation,
    providerContracts,
    syncBridge,
    runtimeState,
  );
  const clientReadiness = buildLiteralClientReadiness(
    contracts,
    exportSummary,
    exportPackage,
    releaseReport,
    workflowControls,
    providerContracts,
    boundaryContract,
    runtimeState,
    operationalHealth,
    deploymentPlan,
    syncBridge,
  );
  const analyticsExportJournal = buildLiteralAnalyticsExportJournal(
    analytics,
    history,
    exportSummary,
    exportPackage,
    releaseReport,
    clientReadiness,
    syncBridge,
  );
  const exportAuditBundle = buildLiteralExportAuditBundle(
    analyticsExportJournal,
    exportPackage,
    releaseReport,
    runtimeState,
    providerContracts,
  );
  const clientActionQueue = buildLiteralClientActionQueue(
    runtimeState,
    exportPackage,
    releaseReport,
    deploymentPlan,
    syncBridge,
    clientReadiness,
    analyticsExportJournal,
  );
  const workflowHandoff = buildLiteralWorkflowHandoff(
    clientReadiness,
    clientActionQueue,
    providerNegotiation,
    deploymentPlan,
    syncBridge,
    runtimeState,
  );
  const clientStatusAdoption = buildLiteralClientStatusAdoption(
    runtimeState,
    clientActionQueue,
    workflowHandoff,
    providerNegotiation,
    syncBridge,
  );
  const recoveryAdoption = buildLiteralRecoveryAdoption(
    runtimeState,
    operationalHealth,
    clientStatusAdoption,
    combinedDiagnostics,
  );
  const operationalReport = buildLiteralOperationalReport(
    runtimeState,
    operationalHealth,
    exportPackage,
    releaseReport,
    providerNegotiation,
    clientStatusAdoption,
    recoveryAdoption,
    combinedDiagnostics,
  );
  const clientResumeEnvelope = buildLiteralClientResumeEnvelope(
    runtimeState,
    operationalHealth,
    clientStatusAdoption,
    recoveryAdoption,
    operationalReport,
  );
  const previewAcceptance = buildLiteralPreviewAcceptance(
    contracts,
    exportPackage,
    releaseReport,
    lifecycleReadiness,
    providerNegotiation,
    clientReadiness,
    clientActionQueue,
    workflowHandoff,
    clientStatusAdoption,
    recoveryAdoption,
    operationalReport,
    runtimeState,
    boundaryContract,
    combinedDiagnostics,
  );
  const campaignExportReadiness = buildLiteralCampaignExportReadiness(
    contracts,
    analytics,
    history,
    exportPackage,
    releaseReport,
    providerCommitWindow,
    clientReadiness,
    analyticsExportJournal,
    previewAcceptance,
  );
  const operatorControlPanel = buildLiteralOperatorControlPanel(
    workflowControls,
    lifecycleReadiness,
    runtimeState,
    providerContracts,
    operationalHealth,
    previewAcceptance,
  );
  const controlIntent = buildLiteralControlIntent(
    workflowControls,
    lifecycleReadiness,
    providerContracts,
    operatorControlPanel,
    runtimeState,
  );
  const externalHandoffState = buildLiteralExternalHandoffState(
    providerContracts,
    providerCommitWindow,
    campaignExportReadiness,
    operatorControlPanel,
    runtimeState,
    controlIntent,
  );
  const clientRequestSnapshot = buildLiteralClientRequestSnapshot(
    contracts,
    providerContracts,
    boundaryContract,
    runtimeState,
    clientReadiness,
    externalHandoffState,
    previewAcceptance,
  );
  const providerFreshness = buildLiteralProviderFreshnessContract(
    providerContracts,
    runtimeState,
    clientRequestSnapshot,
    externalHandoffState,
  );
  const mailchimpReviewPacket = buildLiteralMailchimpReviewPacket({
    contracts,
    exportSummary,
    previewAcceptance,
    clientRequestSnapshot,
    providerFreshness,
    campaignExportReadiness,
    externalHandoffState,
    runtimeState,
    boundaryContract,
    combinedDiagnostics,
  });
  return Object.freeze({
    schema: "aios.literal.contract-set.v1",
    ok: diagnostics.every((item) => item.severity !== "error")
      && workflowControls.valid
      && providerContracts.handoff.ready !== false
      && boundaryContract.handoff.ready !== false
      && runtimeState.persistedView.restartSafe
      && resumeManifest.handoff.ready
      && lifecycleReadiness.handoff.ready
      && operationalHealth.handoffReady
      && incidentSnapshot.handoff.ready
      && exportPackage.handoff.ready
      && releaseReport.handoff.ready
      && deploymentPlan.handoff.ready
      && providerNegotiation.handoff.ready
      && providerCommitWindow.handoff.ready
      && clientReadiness.handoff.ready
      && analyticsExportJournal.handoff.ready
      && exportAuditBundle.handoff.ready
      && workflowHandoff.handoff.ready
      && clientStatusAdoption.handoff.ready
      && recoveryAdoption.handoff.ready
      && operationalReport.handoff.ready
      && clientResumeEnvelope.handoff.ready
      && restartDigest.handoff.ready
      && previewAcceptance.handoff.ready
      && campaignExportReadiness.handoff.ready
      && operatorControlPanel.handoff.ready
      && controlIntent.handoff.ready
      && externalHandoffState.handoff.ready
      && clientRequestSnapshot.handoff.ready
      && providerFreshness.handoff.ready
      && mailchimpReviewPacket.handoff.ready,
    contracts: Object.freeze(contracts),
    diagnostics: combinedDiagnostics,
    roles: Object.freeze(Object.fromEntries(contracts.map((contract) => [contract.key, contract.role]).sort())),
    analytics,
    history,
    exportSummary,
    exportPackage,
    releaseReport,
    workflowControls,
    lifecycleReadiness,
    providerContracts,
    boundaryContract,
    runtimeState,
    resumeManifest,
    restartDigest,
    operationalHealth,
    incidentSnapshot,
    adoptionSignature,
    deploymentPlan,
    syncBridge,
    providerNegotiation,
    providerCommitWindow,
    clientReadiness,
    analyticsExportJournal,
    exportAuditBundle,
    clientActionQueue,
    workflowHandoff,
    clientStatusAdoption,
    recoveryAdoption,
    operationalReport,
    clientResumeEnvelope,
    previewAcceptance,
    campaignExportReadiness,
    operatorControlPanel,
    controlIntent,
    externalHandoffState,
    clientRequestSnapshot,
    providerFreshness,
    mailchimpReviewPacket,
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
    lifecycleReadiness: set.lifecycleReadiness,
    providerContracts: set.providerContracts,
    boundaryContract: set.boundaryContract,
    runtimeState: set.runtimeState,
    resumeManifest: set.resumeManifest,
    restartDigest: set.restartDigest,
    operationalHealth: set.operationalHealth,
    incidentSnapshot: set.incidentSnapshot,
    exportPackage: set.exportPackage,
    releaseReport: set.releaseReport,
    adoptionSignature: set.adoptionSignature,
    deploymentPlan: set.deploymentPlan,
    syncBridge: set.syncBridge,
    providerNegotiation: set.providerNegotiation,
    providerCommitWindow: set.providerCommitWindow,
    clientReadiness: set.clientReadiness,
    analyticsExportJournal: set.analyticsExportJournal,
    exportAuditBundle: set.exportAuditBundle,
    clientActionQueue: set.clientActionQueue,
    workflowHandoff: set.workflowHandoff,
    clientStatusAdoption: set.clientStatusAdoption,
    recoveryAdoption: set.recoveryAdoption,
    operationalReport: set.operationalReport,
    clientResumeEnvelope: set.clientResumeEnvelope,
    previewAcceptance: set.previewAcceptance,
    campaignExportReadiness: set.campaignExportReadiness,
    operatorControlPanel: set.operatorControlPanel,
    controlIntent: set.controlIntent,
    externalHandoffState: set.externalHandoffState,
    clientRequestSnapshot: set.clientRequestSnapshot,
    providerFreshness: set.providerFreshness,
    mailchimpReviewPacket: set.mailchimpReviewPacket,
  });
}

export function literalSyntaxSelfCheck() {
  const parsed = parseAiosLiteral("{ adapter: 'mailchimp', tenant: 'demo', workspace: 'mail/root', role: 'editor', dryRun: true, retry: [1, 2], schedule: 'every 15m', capabilities: ['mailchimp.campaign.write'] }");
  const report = summarizeLiteralContractExports([{ key: "handoff", value: parsed.literal.value }]);
  return Object.freeze({
    ok: parsed.ok && parsed.literal.kind === "object" && parsed.literal.value.adapter === "mailchimp"
      && report.exportSummary.exportableKeys.includes("handoff")
      && report.workflowControls.mailchimpScopes.includes("mailchimp.campaign.write")
      && report.lifecycleReadiness.handoff.ready === true
      && report.lifecycleReadiness.counters.rows >= report.workflowControls.controls.length
      && report.providerContracts.requestedCapabilities.includes("mailchimp.campaign.write")
      && report.boundaryContract.handoff.ready === true
      && report.boundaryContract.handoff.tenant === "demo"
      && report.boundaryContract.tenantBoundaryLease.handoff.ready === true
      && report.boundaryContract.tenantBoundaryLease.tenant === "demo"
      && report.runtimeState.commandSummary.total >= 3
      && report.runtimeState.statusLedger.handoff.ready === true
      && report.runtimeState.statusLedger.counters.rows === report.runtimeState.commandSummary.total
      && report.runtimeState.persistedView.restartSafe === true
      && report.resumeManifest.replay.available === true
      && report.resumeManifest.clientState.hydrated === true
      && report.restartDigest.handoff.ready === true
      && report.restartDigest.counters.rows === report.resumeManifest.counters.rows
      && report.operationalHealth.handoffReady === true
      && report.incidentSnapshot.handoff.ready === true
      && report.incidentSnapshot.state === "healthy"
      && report.exportPackage.handoff.ready === true
      && report.adoptionSignature.handoff.ready === true
      && report.adoptionSignature.boundary.tenant === "demo"
      && report.exportPackage.counters.publishable >= 1
      && report.releaseReport.releaseReady === true
      && report.releaseReport.counters.releaseReady >= 1
      && report.deploymentPlan.handoff.ready === true
      && report.syncBridge.handoff.ready === true
      && report.providerNegotiation.handoff.ready === true
      && report.providerCommitWindow.handoff.ready === true
      && report.providerCommitWindow.counters.rows >= 1
      && report.providerNegotiation.requestedCapabilities.includes("mailchimp.campaign.write")
      && report.clientReadiness.handoff.ready === true
      && report.analyticsExportJournal.handoff.ready === true
      && report.exportAuditBundle.handoff.ready === true
      && report.exportAuditBundle.counters.exportReady >= 1
      && report.exportAuditBundle.validationSummary.accepted === true
      && report.clientActionQueue.handoff.ready === true
      && report.workflowHandoff.handoff.ready === true
      && report.clientStatusAdoption.handoff.ready === true
      && report.recoveryAdoption.handoff.ready === true
      && report.operationalReport.handoff.ready === true
      && report.clientResumeEnvelope.handoff.ready === true
      && report.recoveryAdoption.persistedView.resumeFromCheckpoint === true
      && report.clientResumeEnvelope.clientState.hydrated === true
      && report.operationalReport.counters.rows >= 7
      && report.clientResumeEnvelope.counters.rows >= report.clientStatusAdoption.counters.rows
      && report.clientStatusAdoption.counters.rows >= report.clientActionQueue.counters.rows
      && report.workflowHandoff.preview.counters.rows >= report.clientActionQueue.counters.rows
      && report.clientActionQueue.counters.rows >= report.runtimeState.commandSummary.total
      && report.campaignExportReadiness.handoff.ready === true
      && report.campaignExportReadiness.counters.campaignContracts >= 1
      && report.analyticsExportJournal.counters.exportReady >= 1
      && report.clientReadiness.preview.counters.releaseReadyRows >= 1
      && report.syncBridge.capabilities.some((row) => row.capability === "mailchimp.campaign.write" && row.covered)
      && report.deploymentPlan.controls.some((row) => row.type === "schedule" && row.state === "ready")
      && report.operatorControlPanel.handoff.ready === true
      && report.operatorControlPanel.counters.lifecycle >= report.lifecycleReadiness.counters.rows
      && report.controlIntent.handoff.ready === true
      && report.controlIntent.counters.rows >= report.workflowControls.controls.length
      && report.externalHandoffState.handoff.ready === true
      && report.externalHandoffState.counters.rows >= report.providerCommitWindow.counters.rows
      && report.clientRequestSnapshot.handoff.ready === true
      && report.clientRequestSnapshot.tenant === "demo"
      && report.clientRequestSnapshot.capabilities.includes("mailchimp.campaign.write")
      && report.providerFreshness.handoff.ready === true
      && report.providerFreshness.counters.rows >= 3
      && report.mailchimpReviewPacket.handoff.ready === true
      && report.mailchimpReviewPacket.validationSummary.rows >= report.providerFreshness.counters.rows,
    schema: parsed.schema,
    diagnostics: parsed.diagnostics,
  });
}
