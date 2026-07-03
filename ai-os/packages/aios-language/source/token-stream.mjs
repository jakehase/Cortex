import {
  TOKEN_TYPES,
  createDiagnostic,
  createTokenStateSnapshot,
  hydrateTokenStateSnapshot,
  summarizeTokenState,
  tokenLabel,
} from "./tokens.mjs";

function stableToken(token, fallbackIndex = 0) {
  return Object.freeze({
    type: token?.type ?? TOKEN_TYPES.EOF,
    value: String(token?.value ?? ""),
    line: Number.isInteger(token?.line) ? token.line : 1,
    column: Number.isInteger(token?.column) ? token.column : 1,
    offset: Number.isInteger(token?.offset) ? token.offset : fallbackIndex,
    numericValue: typeof token?.numericValue === "number" ? token.numericValue : null,
    quote: token?.quote ?? null,
  });
}

function stableDiagnostic(diagnostic) {
  return Object.freeze({
    code: diagnostic?.code ?? "TOKEN_STREAM_UNKNOWN",
    message: String(diagnostic?.message ?? ""),
    severity: diagnostic?.severity ?? "error",
    line: Number.isInteger(diagnostic?.line) ? diagnostic.line : 1,
    column: Number.isInteger(diagnostic?.column) ? diagnostic.column : 1,
    offset: Number.isInteger(diagnostic?.offset) ? diagnostic.offset : 0,
  });
}

function stableStringSet(values) {
  return Object.freeze([...new Set(Array.from(values ?? [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))].sort());
}

function stableBoundaryValue(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
}

function normalizeBoundaryContext(context = {}) {
  return Object.freeze({
    workspace: stableBoundaryValue(context.workspace),
    tenant: stableBoundaryValue(context.tenant),
    role: stableBoundaryValue(context.role),
    permissions: stableStringSet(context.permissions),
    auditChannel: stableBoundaryValue(context.auditChannel),
    localOnly: context.localOnly !== false,
  });
}

function boundaryStatus(value, label) {
  if (!value) {
    return Object.freeze({
      label,
      ok: false,
      status: "missing",
      nextAction: `declare-${label}`,
    });
  }

  if (value.includes("*") || value.includes("..")) {
    return Object.freeze({
      label,
      ok: false,
      status: "unsafe",
      nextAction: `narrow-${label}`,
    });
  }

  return Object.freeze({
    label,
    ok: true,
    status: "scoped",
    nextAction: "continue",
  });
}

function compareBoundary(expected = {}, actual = {}) {
  const mismatches = [];
  for (const key of ["workspace", "tenant", "role"]) {
    if (expected[key] && actual[key] && expected[key] !== actual[key]) {
      mismatches.push(Object.freeze({
        key,
        expected: expected[key],
        actual: actual[key],
      }));
    }
  }
  return Object.freeze(mismatches);
}

function normalizeCursor(cursor, tokenCount) {
  const numericCursor = Number.isInteger(cursor) ? cursor : 0;
  return Math.min(Math.max(0, numericCursor), Math.max(0, tokenCount - 1));
}

function isTerminalToken(token) {
  return token?.type === TOKEN_TYPES.EOF;
}

function stableCommandId(kind, cursor, payload = {}) {
  const payloadKey = Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}:${String(value)}`)
    .sort()
    .join("|");
  return `token-stream:${kind}:${cursor}:${payloadKey}`;
}

function commandDiagnostic(code, message, stream, severity = "warning") {
  return stableDiagnostic(streamDiagnostic(code, message, currentToken(stream), severity));
}

function streamDiagnostic(code, message, token, severity = "error") {
  return createDiagnostic(code, message, token ?? { line: 1, column: 1, offset: 0 }, severity);
}

function classifyStreamDiagnostic(diagnostic) {
  const code = diagnostic?.code ?? "TOKEN_STREAM_UNKNOWN";
  if (code.includes("BOUNDARY") || code.includes("PERMISSION")) {
    return Object.freeze({
      code,
      status: "blocked",
      retryable: false,
      retryAfterMs: null,
      nextAction: "correct-token-boundary",
    });
  }

  if (code.includes("CURSOR") || code.includes("CHECKPOINT")) {
    return Object.freeze({
      code,
      status: "retryable",
      retryable: true,
      retryAfterMs: 0,
      nextAction: "reload-token-checkpoint",
    });
  }

  if (diagnostic?.severity === "warning") {
    return Object.freeze({
      code,
      status: "degraded",
      retryable: true,
      retryAfterMs: 100,
      nextAction: "continue-with-warning",
    });
  }

  return Object.freeze({
    code,
    status: "failed",
    retryable: false,
    retryAfterMs: 500,
    nextAction: "surface-token-error",
  });
}

function createStreamActionableErrors(diagnostics) {
  return Object.freeze(Array.from(diagnostics ?? []).map((diagnostic) => {
    const recovery = classifyStreamDiagnostic(diagnostic);
    return Object.freeze({
      code: diagnostic.code,
      message: diagnostic.message,
      severity: diagnostic.severity,
      line: diagnostic.line,
      column: diagnostic.column,
      recovery,
      nextAction: recovery.nextAction,
    });
  }));
}

function retryPlanForStream(recoveries) {
  if (recoveries.some((entry) => entry.status === "blocked")) {
    return Object.freeze({
      strategy: "manual-boundary-correction",
      retryAfterMs: null,
      maxAttempts: 0,
    });
  }

  if (recoveries.some((entry) => entry.status === "retryable")) {
    return Object.freeze({
      strategy: "checkpoint-reload",
      retryAfterMs: 0,
      maxAttempts: 1,
    });
  }

  if (recoveries.some((entry) => entry.status === "degraded")) {
    return Object.freeze({
      strategy: "bounded-replay",
      retryAfterMs: 100,
      maxAttempts: 2,
    });
  }

  if (recoveries.length > 0) {
    return Object.freeze({
      strategy: "surface-error",
      retryAfterMs: 500,
      maxAttempts: 0,
    });
  }

  return Object.freeze({
    strategy: "none",
    retryAfterMs: 0,
    maxAttempts: 0,
  });
}

export function createTokenStream(tokens = [], options = {}) {
  const stableTokens = Array.from(tokens ?? []).map(stableToken);
  const boundary = normalizeBoundaryContext({
    workspace: options.workspace,
    tenant: options.tenant,
    role: options.role,
    permissions: options.permissions,
    auditChannel: options.auditChannel,
    localOnly: options.localOnly,
  });
  const withEof = stableTokens.some(isTerminalToken)
    ? stableTokens
    : [
        ...stableTokens,
        stableToken({
          type: TOKEN_TYPES.EOF,
          value: "",
          line: stableTokens.at(-1)?.line ?? 1,
          column: stableTokens.at(-1)?.column ?? 1,
          offset: stableTokens.at(-1)?.offset ?? 0,
        }, stableTokens.length),
      ];
  const diagnostics = Array.from(options.diagnostics ?? []).map(stableDiagnostic);
  const cursor = normalizeCursor(options.cursor, withEof.length);

  return Object.freeze({
    schema: "aios.token.stream.v1",
    cursor,
    tokens: Object.freeze(withEof),
    diagnostics: Object.freeze(diagnostics),
    metadata: Object.freeze({
      sourceId: options.sourceId ?? null,
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      permissions: boundary.permissions,
      auditChannel: boundary.auditChannel,
      localOnly: boundary.localOnly,
      handoff: options.handoff ?? "parser",
      appliedCommands: Object.freeze(Array.from(options.appliedCommands ?? [])),
      boundary,
    }),
  });
}

export function tokenStreamFromSnapshot(snapshot, options = {}) {
  const hydrated = hydrateTokenStateSnapshot(snapshot);
  return createTokenStream(hydrated.tokens, {
    diagnostics: hydrated.diagnostics,
    sourceId: options.sourceId ?? snapshot?.metadata?.sourceId ?? null,
    workspace: options.workspace ?? snapshot?.metadata?.workspace ?? null,
    tenant: options.tenant ?? snapshot?.metadata?.tenant ?? null,
    role: options.role ?? snapshot?.metadata?.role ?? null,
    permissions: options.permissions ?? snapshot?.metadata?.permissions ?? [],
    auditChannel: options.auditChannel ?? snapshot?.metadata?.auditChannel ?? null,
    localOnly: options.localOnly ?? snapshot?.metadata?.localOnly ?? true,
    cursor: options.cursor ?? 0,
    handoff: options.handoff ?? "snapshot-replay",
    appliedCommands: options.appliedCommands ?? snapshot?.metadata?.appliedCommands ?? [],
  });
}

export function currentToken(stream) {
  const tokens = Array.from(stream?.tokens ?? []);
  return tokens[normalizeCursor(stream?.cursor, tokens.length)] ?? stableToken({ type: TOKEN_TYPES.EOF });
}

export function peekToken(stream, distance = 0) {
  const tokens = Array.from(stream?.tokens ?? []);
  const cursor = normalizeCursor(stream?.cursor, tokens.length);
  const offset = Number.isInteger(distance) ? distance : 0;
  return tokens[normalizeCursor(cursor + offset, tokens.length)] ?? stableToken({ type: TOKEN_TYPES.EOF });
}

export function advanceTokenStream(stream, distance = 1) {
  const tokens = Array.from(stream?.tokens ?? []);
  const step = Number.isInteger(distance) ? Math.max(0, distance) : 1;
  return Object.freeze({
    ...stream,
    cursor: normalizeCursor((stream?.cursor ?? 0) + step, tokens.length),
  });
}

export function createTokenStreamCommand(stream, kind, payload = {}) {
  const tokens = Array.from(stream?.tokens ?? []);
  const cursor = normalizeCursor(stream?.cursor, tokens.length);
  const safeKind = String(kind ?? "noop");
  const streamBoundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  const payloadBoundary = normalizeBoundaryContext({
    workspace: payload.workspace ?? streamBoundary.workspace,
    tenant: payload.tenant ?? streamBoundary.tenant,
    role: payload.role ?? streamBoundary.role,
    permissions: payload.permissions ?? streamBoundary.permissions,
    auditChannel: payload.auditChannel ?? streamBoundary.auditChannel,
    localOnly: payload.localOnly ?? streamBoundary.localOnly,
  });
  const commandPayload = Object.freeze({
    distance: Number.isInteger(payload.distance) ? payload.distance : undefined,
    cursor: Number.isInteger(payload.cursor) ? payload.cursor : undefined,
    reason: payload.reason ?? null,
    expectedType: payload.expectedType ?? null,
    expectedValue: payload.expectedValue ?? null,
  });
  const boundaryMismatches = compareBoundary(streamBoundary, payloadBoundary);

  return Object.freeze({
    schema: "aios.token.stream.command.v1",
    id: payload.id ?? stableCommandId(safeKind, cursor, commandPayload),
    kind: safeKind,
    cursor,
    sourceId: stream?.metadata?.sourceId ?? null,
    workspace: payloadBoundary.workspace,
    tenant: payloadBoundary.tenant,
    role: payloadBoundary.role,
    boundary: payloadBoundary,
    boundaryMismatches,
    audit: Object.freeze({
      channel: payloadBoundary.auditChannel,
      required: safeKind !== "noop" || boundaryMismatches.length > 0,
      status: payloadBoundary.auditChannel
        ? "audit-ready"
        : safeKind !== "noop"
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    payload: commandPayload,
  });
}

export function applyTokenStreamCommand(stream, command) {
  const tokens = Array.from(stream?.tokens ?? []);
  const metadata = stream?.metadata ?? {};
  const appliedCommands = new Set(metadata.appliedCommands ?? []);
  const safeCommand = command ?? createTokenStreamCommand(stream, "noop");
  const commandId = safeCommand.id ?? stableCommandId(safeCommand.kind, stream?.cursor ?? 0, safeCommand.payload ?? {});
  const streamBoundary = normalizeBoundaryContext(metadata.boundary ?? metadata);
  const commandBoundary = normalizeBoundaryContext(safeCommand.boundary ?? safeCommand);
  const boundaryMismatches = compareBoundary(streamBoundary, commandBoundary);

  if (boundaryMismatches.length > 0) {
    const diagnostic = commandDiagnostic(
      "TOKEN_STREAM_COMMAND_BOUNDARY_CONFLICT",
      `Token stream command boundary mismatch for ${boundaryMismatches.map((entry) => entry.key).join(", ")}.`,
      stream,
    );
    return Object.freeze({
      schema: "aios.token.stream.command.result.v1",
      ok: false,
      idempotent: false,
      command: Object.freeze({ ...safeCommand, id: commandId, boundaryMismatches }),
      stream: Object.freeze({
        ...stream,
        diagnostics: Object.freeze([...(stream?.diagnostics ?? []), diagnostic]),
      }),
      diagnostic,
      status: "boundary-conflict",
      nextAction: "reload-token-checkpoint",
    });
  }

  if (appliedCommands.has(commandId)) {
    return Object.freeze({
      schema: "aios.token.stream.command.result.v1",
      ok: true,
      idempotent: true,
      command: Object.freeze({ ...safeCommand, id: commandId }),
      stream,
      status: "already-applied",
      nextAction: "continue",
    });
  }

  const expectedCursor = Number.isInteger(safeCommand.cursor) ? safeCommand.cursor : normalizeCursor(stream?.cursor, tokens.length);
  if (expectedCursor !== normalizeCursor(stream?.cursor, tokens.length)) {
    const diagnostic = commandDiagnostic(
      "TOKEN_STREAM_COMMAND_CURSOR_CONFLICT",
      `Token stream command expected cursor ${expectedCursor} but found ${normalizeCursor(stream?.cursor, tokens.length)}.`,
      stream,
    );
    return Object.freeze({
      schema: "aios.token.stream.command.result.v1",
      ok: false,
      idempotent: false,
      command: Object.freeze({ ...safeCommand, id: commandId }),
      stream: Object.freeze({
        ...stream,
        diagnostics: Object.freeze([...(stream?.diagnostics ?? []), diagnostic]),
      }),
      diagnostic,
      status: "cursor-conflict",
      nextAction: "reload-token-checkpoint",
    });
  }

  let nextStream = stream;
  if (safeCommand.kind === "advance") {
    nextStream = advanceTokenStream(stream, safeCommand.payload?.distance ?? 1);
  } else if (safeCommand.kind === "rewind") {
    nextStream = Object.freeze({
      ...stream,
      cursor: normalizeCursor((stream?.cursor ?? 0) - Math.max(0, safeCommand.payload?.distance ?? 1), tokens.length),
    });
  } else if (safeCommand.kind === "restore-cursor") {
    nextStream = Object.freeze({
      ...stream,
      cursor: normalizeCursor(safeCommand.payload?.cursor, tokens.length),
    });
  } else if (safeCommand.kind !== "noop") {
    const diagnostic = commandDiagnostic(
      "TOKEN_STREAM_COMMAND_UNKNOWN",
      `Unsupported token stream command '${safeCommand.kind}'.`,
      stream,
    );
    nextStream = Object.freeze({
      ...stream,
      diagnostics: Object.freeze([...(stream?.diagnostics ?? []), diagnostic]),
    });
  }

  const nextApplied = Object.freeze([...appliedCommands, commandId]);
  nextStream = Object.freeze({
    ...nextStream,
    metadata: Object.freeze({
      ...(nextStream?.metadata ?? {}),
      appliedCommands: nextApplied,
    }),
  });

  return Object.freeze({
    schema: "aios.token.stream.command.result.v1",
    ok: safeCommand.kind === "noop" || safeCommand.kind === "advance" || safeCommand.kind === "rewind" || safeCommand.kind === "restore-cursor",
    idempotent: false,
    command: Object.freeze({ ...safeCommand, id: commandId }),
    stream: nextStream,
    status: "applied",
    nextAction: "continue",
  });
}

export function matchToken(stream, type, value) {
  const token = currentToken(stream);
  const matched = token.type === type && (value === undefined || token.value === value);

  return Object.freeze({
    matched,
    token,
    stream: matched ? advanceTokenStream(stream) : stream,
  });
}

export function expectToken(stream, type, value, code, message) {
  const token = currentToken(stream);
  if (token.type === type && (value === undefined || token.value === value)) {
    return Object.freeze({
      ok: true,
      token,
      stream: advanceTokenStream(stream),
      diagnostic: null,
    });
  }

  const diagnostic = streamDiagnostic(
    code ?? "TOKEN_STREAM_EXPECTED_TOKEN",
    `${message ?? "Unexpected token."} Found ${tokenLabel(token)}.`,
    token,
  );

  return Object.freeze({
    ok: false,
    token: null,
    stream: Object.freeze({
      ...stream,
      diagnostics: Object.freeze([...(stream?.diagnostics ?? []), stableDiagnostic(diagnostic)]),
    }),
    diagnostic,
  });
}

export function createTokenCheckpoint(stream, reason = "manual") {
  const tokens = Array.from(stream?.tokens ?? []);
  const diagnostics = Array.from(stream?.diagnostics ?? []);
  const boundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  const snapshot = createTokenStateSnapshot(tokens, diagnostics, {
    workspace: boundary.workspace,
    tenant: boundary.tenant,
    role: boundary.role,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    localOnly: boundary.localOnly,
    sourceLength: tokens.at(-1)?.offset ?? null,
  });
  const summary = summarizeTokenState(snapshot);
  const boundaryChecks = Object.freeze({
    workspace: boundaryStatus(boundary.workspace, "workspace"),
    tenant: boundaryStatus(boundary.tenant, "tenant"),
    role: boundaryStatus(boundary.role, "role"),
  });
  const boundaryOk = Object.values(boundaryChecks).every((entry) => entry.ok);

  return Object.freeze({
    schema: "aios.token.checkpoint.v1",
    reason,
    cursor: normalizeCursor(stream?.cursor, tokens.length),
    restartSafe: summary.restartSafe && boundaryOk,
    handoff: stream?.metadata?.handoff ?? "parser",
    boundary,
    boundaryChecks,
    audit: Object.freeze({
      channel: boundary.auditChannel,
      required: !boundaryOk || diagnostics.length > 0,
      status: boundary.auditChannel
        ? "audit-ready"
        : !boundaryOk || diagnostics.length > 0
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    clientState: Object.freeze({
      sourceId: stream?.metadata?.sourceId ?? null,
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      cursor: normalizeCursor(stream?.cursor, tokens.length),
      appliedCommands: Object.freeze(Array.from(stream?.metadata?.appliedCommands ?? [])),
      restoreCommand: createTokenStreamCommand(stream, "restore-cursor", {
        cursor: normalizeCursor(stream?.cursor, tokens.length),
        reason: "checkpoint-restore",
      }),
    }),
    snapshot,
    summary,
  });
}

export function createTokenStreamBoundaryReport(stream, options = {}) {
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    ...options,
  });
  const checks = Object.freeze({
    workspace: boundaryStatus(boundary.workspace, "workspace"),
    tenant: boundaryStatus(boundary.tenant, "tenant"),
    role: boundaryStatus(boundary.role, "role"),
  });
  const missingPermissions = stableStringSet(Array.from(options.requiredPermissions ?? [])
    .filter((permission) => !boundary.permissions.includes(permission)));
  const ok = Object.values(checks).every((entry) => entry.ok) && missingPermissions.length === 0;

  return Object.freeze({
    schema: "aios.token.stream.boundary-report.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    handoff: stream?.metadata?.handoff ?? "parser",
    boundary,
    checks,
    missingPermissions,
    audit: Object.freeze({
      channel: boundary.auditChannel,
      required: !ok || missingPermissions.length > 0,
      status: boundary.auditChannel
        ? "audit-ready"
        : !ok
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    ok,
    status: ok ? "scoped" : missingPermissions.length > 0 ? "permission-review" : "boundary-review",
    nextAction: ok
      ? "continue"
      : missingPermissions.length > 0
        ? "review-role-permissions"
        : "correct-token-boundary",
  });
}

export function createTokenStreamHealthReport(stream, options = {}) {
  const diagnostics = Object.freeze(Array.from(stream?.diagnostics ?? []).map(stableDiagnostic));
  const actualBoundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  const expectedBoundary = normalizeBoundaryContext({
    workspace: options.expectedWorkspace ?? options.workspace ?? actualBoundary.workspace,
    tenant: options.expectedTenant ?? options.tenant ?? actualBoundary.tenant,
    role: options.expectedRole ?? options.role ?? actualBoundary.role,
    permissions: options.permissions ?? actualBoundary.permissions,
    auditChannel: options.auditChannel ?? actualBoundary.auditChannel,
    localOnly: options.localOnly ?? actualBoundary.localOnly,
  });
  const expectedMismatches = compareBoundary(expectedBoundary, actualBoundary);
  const boundaryReport = createTokenStreamBoundaryReport(stream, {
    workspace: actualBoundary.workspace,
    tenant: actualBoundary.tenant,
    role: actualBoundary.role,
    permissions: options.permissions ?? stream?.metadata?.permissions ?? [],
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    requiredPermissions: options.requiredPermissions ?? [],
  });
  const blocking = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const recoveries = Object.freeze(diagnostics.map(classifyStreamDiagnostic));
  const actionableErrors = createStreamActionableErrors(diagnostics);
  const checkpoint = createTokenCheckpoint(stream, options.reason ?? "token-stream-health");
  const cursor = normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length);
  const commandLag = Array.from(stream?.metadata?.appliedCommands ?? []).length;
  const boundaryBlocked = !boundaryReport.ok || expectedMismatches.length > 0;
  const failed = blocking.length > 0 || boundaryBlocked;
  const degraded = !failed && diagnostics.length > 0;
  const retry = retryPlanForStream(boundaryBlocked
    ? [...recoveries, Object.freeze({
        code: "TOKEN_STREAM_BOUNDARY_REPORT",
        status: "blocked",
        retryable: false,
        retryAfterMs: null,
        nextAction: boundaryReport.nextAction,
      })]
    : recoveries);

  return Object.freeze({
    schema: "aios.token.stream.health.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    ok: !failed,
    status: boundaryBlocked
      ? boundaryReport.status
      : failed
        ? "failed"
        : degraded
          ? "degraded"
          : "healthy",
    cursor,
    tokenCount: Array.from(stream?.tokens ?? []).length,
    diagnosticCount: diagnostics.length,
    blockingCount: blocking.length,
    commandLag,
    boundary: boundaryReport,
    expectedBoundary,
    expectedMismatches,
    checkpoint: Object.freeze({
      cursor: checkpoint.cursor,
      restartSafe: checkpoint.restartSafe,
      audit: checkpoint.audit,
      restoreCommand: checkpoint.clientState.restoreCommand,
    }),
    retry,
    recoveries,
    actionableErrors,
    degradedMode: Object.freeze({
      enabled: degraded || retry.strategy === "bounded-replay",
      reason: degraded ? "warning-diagnostics" : retry.strategy,
      handoff: stream?.metadata?.handoff ?? "parser",
    }),
    nextAction: boundaryBlocked
      ? expectedMismatches.length > 0 ? "reload-token-checkpoint" : boundaryReport.nextAction
      : failed
        ? actionableErrors[0]?.nextAction ?? "surface-token-error"
        : degraded
          ? "continue-with-token-warnings"
          : "continue",
  });
}

function countTokenTypes(tokens) {
  const counters = {};
  for (const token of tokens ?? []) {
    const type = token?.type ?? TOKEN_TYPES.EOF;
    counters[type] = (counters[type] ?? 0) + 1;
  }

  return Object.freeze(Object.fromEntries(Object.entries(counters).sort(([left], [right]) => left.localeCompare(right))));
}

function countDiagnosticSeverities(diagnostics) {
  const counters = { error: 0, warning: 0, info: 0 };
  const byCode = {};

  for (const diagnostic of diagnostics ?? []) {
    const severity = diagnostic?.severity ?? "error";
    counters[severity] = (counters[severity] ?? 0) + 1;
    const code = diagnostic?.code ?? "TOKEN_STREAM_UNKNOWN";
    byCode[code] = (byCode[code] ?? 0) + 1;
  }

  return Object.freeze({
    error: counters.error,
    warning: counters.warning,
    info: counters.info,
    byCode: Object.freeze(Object.fromEntries(Object.entries(byCode).sort(([left], [right]) => left.localeCompare(right)))),
  });
}

function commandCounters(commands) {
  const byKind = {};
  const ids = [];

  for (const command of commands ?? []) {
    const text = String(command ?? "");
    const [, , kind = "unknown"] = text.split(":");
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    ids.push(text);
  }

  return Object.freeze({
    total: ids.length,
    byKind: Object.freeze(Object.fromEntries(Object.entries(byKind).sort(([left], [right]) => left.localeCompare(right)))),
    ids: Object.freeze(ids.sort()),
  });
}

function cursorTimeline(stream, options = {}) {
  const tokens = Array.from(stream?.tokens ?? []);
  const cursor = normalizeCursor(stream?.cursor, tokens.length);
  const applied = Array.from(stream?.metadata?.appliedCommands ?? []);
  const previousCursor = Number.isInteger(options.previousCursor)
    ? normalizeCursor(options.previousCursor, tokens.length)
    : Math.max(0, cursor - applied.length);
  const checkpointCursor = Number.isInteger(options.checkpointCursor)
    ? normalizeCursor(options.checkpointCursor, tokens.length)
    : cursor;

  return Object.freeze([
    Object.freeze({
      schema: "aios.token.stream.timeline-event.v1",
      label: "checkpoint",
      cursor: checkpointCursor,
      token: tokens[checkpointCursor] ?? stableToken({ type: TOKEN_TYPES.EOF }),
      commandCount: applied.length,
      status: checkpointCursor === cursor ? "current" : "restore-point",
    }),
    Object.freeze({
      schema: "aios.token.stream.timeline-event.v1",
      label: "previous",
      cursor: previousCursor,
      token: tokens[previousCursor] ?? stableToken({ type: TOKEN_TYPES.EOF }),
      commandCount: 0,
      status: previousCursor === cursor ? "current" : "historical",
    }),
    Object.freeze({
      schema: "aios.token.stream.timeline-event.v1",
      label: "current",
      cursor,
      token: currentToken(stream),
      commandCount: applied.length,
      status: isTerminalToken(currentToken(stream)) ? "eof" : "active",
    }),
  ]);
}

export function createTokenStreamHistorySnapshot(stream, options = {}) {
  const tokens = Object.freeze(Array.from(stream?.tokens ?? []).map(stableToken));
  const diagnostics = Object.freeze(Array.from(stream?.diagnostics ?? []).map(stableDiagnostic));
  const boundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  const checkpoint = createTokenCheckpoint(stream, options.reason ?? "token-stream-history");
  const commands = commandCounters(stream?.metadata?.appliedCommands ?? []);
  const timeline = cursorTimeline(stream, {
    previousCursor: options.previousCursor,
    checkpointCursor: checkpoint.cursor,
  });
  const checkpointNextAction = checkpoint.summary?.nextAction ?? "repair-token-checkpoint";

  return Object.freeze({
    schema: "aios.token.stream.history-snapshot.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    handoff: stream?.metadata?.handoff ?? "parser",
    cursor: normalizeCursor(stream?.cursor, tokens.length),
    tokenCount: tokens.length,
    diagnosticCount: diagnostics.length,
    boundary,
    counters: Object.freeze({
      tokensByType: countTokenTypes(tokens),
      diagnostics: countDiagnosticSeverities(diagnostics),
      commands,
    }),
    checkpoint: Object.freeze({
      cursor: checkpoint.cursor,
      restartSafe: checkpoint.restartSafe,
      restoreCommand: checkpoint.clientState.restoreCommand,
    }),
    timeline,
    exportSummary: Object.freeze({
      sourceId: stream?.metadata?.sourceId ?? null,
      cursor: normalizeCursor(stream?.cursor, tokens.length),
      commandCount: commands.total,
      diagnosticCount: diagnostics.length,
      restartSafe: checkpoint.restartSafe,
      nextAction: checkpoint.restartSafe ? "export-token-history" : checkpointNextAction,
    }),
    nextAction: checkpoint.restartSafe ? "export-token-history" : checkpointNextAction,
  });
}

export function createTokenStreamAnalyticsReport(stream, options = {}) {
  const history = createTokenStreamHistorySnapshot(stream, options);
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    reason: options.reason ?? "token-stream-analytics",
  });
  const exportReady = health.ok && history.checkpoint.restartSafe;
  const terminal = currentToken(stream).type === TOKEN_TYPES.EOF;

  return Object.freeze({
    schema: "aios.token.stream.analytics.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    ok: exportReady,
    status: exportReady
      ? terminal ? "complete" : "active"
      : health.status,
    counters: Object.freeze({
      tokenCount: history.tokenCount,
      diagnosticCount: history.diagnosticCount,
      commandCount: history.counters.commands.total,
      tokenTypes: history.counters.tokensByType,
      diagnostics: history.counters.diagnostics,
      commands: history.counters.commands.byKind,
    }),
    history,
    timeline: history.timeline,
    report: Object.freeze({
      boundaryStatus: health.boundary.status,
      healthStatus: health.status,
      cursor: history.cursor,
      currentToken: tokenLabel(currentToken(stream)),
      exportReady,
      restartSafe: history.checkpoint.restartSafe,
      restoreCommand: history.checkpoint.restoreCommand,
    }),
    exportSummary: Object.freeze({
      sourceId: history.sourceId,
      handoff: history.handoff,
      status: exportReady ? "export-ready" : health.status,
      cursor: history.cursor,
      tokenCount: history.tokenCount,
      commandCount: history.counters.commands.total,
      nextAction: exportReady ? "publish-token-stream-report" : health.nextAction,
    }),
    nextAction: exportReady ? "publish-token-stream-report" : health.nextAction,
  });
}

function normalizeCommandPlanStep(step, index, stream) {
  const kind = String(step?.kind ?? "noop");
  const payload = Object.freeze({
    ...(step?.payload ?? {}),
    distance: step?.distance ?? step?.payload?.distance,
    cursor: step?.cursor ?? step?.payload?.cursor,
    reason: step?.reason ?? step?.payload?.reason ?? `plan-step-${index}`,
    expectedType: step?.expectedType ?? step?.payload?.expectedType,
    expectedValue: step?.expectedValue ?? step?.payload?.expectedValue,
    workspace: step?.workspace ?? step?.payload?.workspace,
    tenant: step?.tenant ?? step?.payload?.tenant,
    role: step?.role ?? step?.payload?.role,
    permissions: step?.permissions ?? step?.payload?.permissions,
    auditChannel: step?.auditChannel ?? step?.payload?.auditChannel,
    localOnly: step?.localOnly ?? step?.payload?.localOnly,
  });
  const command = createTokenStreamCommand(stream, kind, payload);

  return Object.freeze({
    schema: "aios.token.stream.command-plan.step.v1",
    index,
    label: step?.label ?? `${kind}:${index}`,
    command,
    previewToken: currentToken(stream),
    status: kind === "noop" ? "observed" : "pending",
    nextAction: kind === "noop" ? "continue" : "apply-token-command",
  });
}

function previewCommandPlanCursor(stream, steps) {
  let preview = stream;
  const events = [];

  for (const step of steps) {
    const before = normalizeCursor(preview?.cursor, Array.from(preview?.tokens ?? []).length);
    if (step.command.kind === "advance") {
      preview = advanceTokenStream(preview, step.command.payload?.distance ?? 1);
    } else if (step.command.kind === "rewind") {
      preview = Object.freeze({
        ...preview,
        cursor: normalizeCursor(before - Math.max(0, step.command.payload?.distance ?? 1), Array.from(preview?.tokens ?? []).length),
      });
    } else if (step.command.kind === "restore-cursor") {
      preview = Object.freeze({
        ...preview,
        cursor: normalizeCursor(step.command.payload?.cursor, Array.from(preview?.tokens ?? []).length),
      });
    }

    events.push(Object.freeze({
      schema: "aios.token.stream.command-plan.preview-event.v1",
      index: step.index,
      kind: step.command.kind,
      fromCursor: before,
      toCursor: normalizeCursor(preview?.cursor, Array.from(preview?.tokens ?? []).length),
      token: currentToken(preview),
      status: step.command.kind === "noop" ? "unchanged" : "previewed",
    }));
  }

  return Object.freeze({
    schema: "aios.token.stream.command-plan.preview.v1",
    cursor: normalizeCursor(preview?.cursor, Array.from(preview?.tokens ?? []).length),
    currentToken: currentToken(preview),
    eof: currentToken(preview).type === TOKEN_TYPES.EOF,
    events: Object.freeze(events),
  });
}

export function createTokenStreamCommandPlan(stream, steps = [], options = {}) {
  const plannedSteps = Object.freeze(Array.from(steps ?? []).map((step, index) => normalizeCommandPlanStep(step, index, stream)));
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    reason: options.reason ?? "token-stream-command-plan",
  });
  const analytics = createTokenStreamAnalyticsReport(stream, {
    ...options,
    reason: options.reason ?? "token-stream-command-plan",
  });
  const mismatched = plannedSteps.filter((step) => step.command.boundaryMismatches.length > 0);
  const mutating = plannedSteps.filter((step) => step.command.kind !== "noop");
  const supportedKinds = new Set(["noop", "advance", "rewind", "restore-cursor"]);
  const unsupported = plannedSteps.filter((step) => !supportedKinds.has(step.command.kind));
  const preview = previewCommandPlanCursor(stream, plannedSteps);
  const accepted = health.ok && mismatched.length === 0 && unsupported.length === 0;

  return Object.freeze({
    schema: "aios.token.stream.command-plan.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    stepCount: plannedSteps.length,
    steps: plannedSteps,
    preview,
    readiness: Object.freeze({
      accepted,
      status: accepted
        ? mutating.length > 0 ? "ready-to-apply" : "ready-noop"
        : mismatched.length > 0
          ? "boundary-review"
          : unsupported.length > 0
            ? "unsupported-command"
            : health.status,
      mutatingCount: mutating.length,
      unsupportedCommands: Object.freeze(unsupported.map((step) => step.command.kind)),
      boundaryMismatches: Object.freeze(mismatched.flatMap((step) => step.command.boundaryMismatches.map((mismatch) => Object.freeze({
        step: step.index,
        key: mismatch.key,
        expected: mismatch.expected,
        actual: mismatch.actual,
      })))),
      audit: Object.freeze({
        required: mutating.length > 0 || mismatched.length > 0,
        channel: stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel ?? null,
        status: stream?.metadata?.auditChannel || stream?.metadata?.boundary?.auditChannel
          ? "audit-ready"
          : mutating.length > 0 || mismatched.length > 0
            ? "audit-channel-missing"
            : "audit-optional",
      }),
    }),
    analytics: analytics.exportSummary,
    health: Object.freeze({
      ok: health.ok,
      status: health.status,
      cursor: health.cursor,
      nextAction: health.nextAction,
    }),
    exportSummary: Object.freeze({
      sourceId: stream?.metadata?.sourceId ?? null,
      status: accepted ? "command-plan-ready" : health.status,
      stepCount: plannedSteps.length,
      previewCursor: preview.cursor,
      mutatingCount: mutating.length,
      nextAction: accepted ? "apply-token-command-plan" : health.nextAction,
    }),
    nextAction: accepted
      ? "apply-token-command-plan"
      : mismatched.length > 0
        ? "reload-token-checkpoint"
        : unsupported.length > 0
          ? "choose-supported-token-command"
          : health.nextAction,
  });
}

export function applyTokenStreamCommandPlan(stream, planOrSteps = [], options = {}) {
  const plan = Array.isArray(planOrSteps)
    ? createTokenStreamCommandPlan(stream, planOrSteps, options)
    : planOrSteps;
  let nextStream = stream;
  const results = [];

  if (!plan?.readiness?.accepted) {
    return Object.freeze({
      schema: "aios.token.stream.command-plan.result.v1",
      ok: false,
      appliedCount: 0,
      plan,
      stream,
      results: Object.freeze([]),
      status: plan?.readiness?.status ?? "invalid-plan",
      nextAction: plan?.nextAction ?? "create-token-command-plan",
    });
  }

  for (const step of plan.steps) {
    const command = createTokenStreamCommand(nextStream, step.command.kind, {
      ...step.command.payload,
      id: step.command.id,
    });
    const result = applyTokenStreamCommand(nextStream, command);
    results.push(Object.freeze({
      schema: "aios.token.stream.command-plan.step-result.v1",
      index: step.index,
      ok: result.ok,
      status: result.status,
      cursor: result.stream?.cursor ?? nextStream?.cursor ?? 0,
      nextAction: result.nextAction,
    }));
    nextStream = result.stream;
    if (!result.ok) {
      break;
    }
  }

  const failed = results.find((result) => !result.ok);
  const analytics = createTokenStreamAnalyticsReport(nextStream, {
    ...options,
    reason: options.reason ?? "token-stream-command-plan-result",
  });

  return Object.freeze({
    schema: "aios.token.stream.command-plan.result.v1",
    ok: !failed,
    appliedCount: results.filter((result) => result.ok).length,
    plan,
    stream: nextStream,
    results: Object.freeze(results),
    analytics: analytics.exportSummary,
    status: failed ? failed.status : "applied",
    nextAction: failed ? failed.nextAction : analytics.nextAction,
  });
}

function normalizeProviderServiceOptions(options = {}) {
  const adapter = String(options.adapter ?? options.provider ?? "runtime.run");
  const [providerPart, ...operationParts] = adapter.split(".");
  const provider = String(options.provider ?? providerPart ?? "runtime").trim() || "runtime";
  const operation = String(options.operation ?? operationParts.join(".") ?? "run").trim() || "run";
  const mutatingOperations = new Set(["syncAudience", "upsertCampaign", "createCampaign", "scheduleCampaign"]);
  const readOperations = new Set(["fetchAudience", "syncAudience"]);
  const requiredPermissions = stableStringSet([
    ...(options.requiredPermissions ?? []),
    provider === "mailchimp" && readOperations.has(operation) ? "mailchimp.read" : null,
    provider === "mailchimp" && mutatingOperations.has(operation) ? "mailchimp.write" : null,
  ].filter(Boolean));

  return Object.freeze({
    adapter: options.adapter ?? `${provider}.${operation}`,
    provider,
    operation,
    requiredPermissions,
    requestedCapabilities: stableStringSet(options.requestedCapabilities ?? []),
    externalTraceId: stableBoundaryValue(options.externalTraceId),
    serviceId: stableBoundaryValue(options.serviceId) ?? `${provider}:${operation}`,
    statusChannel: stableBoundaryValue(options.statusChannel),
    auditChannel: stableBoundaryValue(options.auditChannel),
    scheduledAt: stableBoundaryValue(options.scheduledAt),
    enabled: options.enabled !== false,
    acceptedBy: stableBoundaryValue(options.acceptedBy),
  });
}

function providerServiceSyncKey(service, boundary, stream) {
  return [
    "token-provider-service",
    service.provider,
    service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    boundary.role ?? "role",
  ].map((part) => String(part).trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function createProviderCapabilityNegotiation(service, boundary) {
  const baseCapabilities = service.provider === "mailchimp"
    ? ["audit", "checkpoint", "external-status", "provider-read", "retry"]
    : ["checkpoint", "external-status", "retry"];
  const supportedCapabilities = stableStringSet([
    ...baseCapabilities,
    service.requiredPermissions.includes("mailchimp.write") ? "provider-write" : null,
    service.requiredPermissions.includes("mailchimp.write") ? "idempotency" : null,
  ].filter(Boolean));
  const requested = service.requestedCapabilities.length > 0 ? service.requestedCapabilities : supportedCapabilities;
  const unsupportedCapabilities = stableStringSet(requested.filter((capability) => !supportedCapabilities.includes(capability)));
  const missingPermissions = stableStringSet(service.requiredPermissions.filter((permission) => !boundary.permissions.includes(permission)));
  const accepted = unsupportedCapabilities.length === 0 && missingPermissions.length === 0;

  return Object.freeze({
    schema: "aios.token.stream.provider-capability-negotiation.v1",
    accepted,
    provider: service.provider,
    operation: service.operation,
    supportedCapabilities,
    requestedCapabilities: Object.freeze(requested),
    requiredPermissions: service.requiredPermissions,
    grantedPermissions: boundary.permissions,
    missingPermissions,
    unsupportedCapabilities,
    status: accepted
      ? "accepted"
      : missingPermissions.length > 0
        ? "permission-review"
        : "capability-review",
    nextAction: accepted
      ? "prepare-provider-handoff"
      : missingPermissions.length > 0
        ? "align-provider-permissions"
        : "choose-supported-provider-capability",
  });
}

function createProviderPreviewAcceptance(service, health, analytics, negotiation, boundary) {
  const auditChannel = service.auditChannel ?? boundary.auditChannel;
  const statusChannel = service.statusChannel ?? auditChannel;
  const disabled = !service.enabled;
  const missing = Object.freeze([
    disabled ? "service-enabled" : null,
    statusChannel ? null : "status-channel",
    health.ok ? null : "healthy-token-stream",
    analytics.ok ? null : "exportable-token-stream",
    negotiation.accepted ? null : "provider-capability-negotiation",
    service.requiredPermissions.length > 0 && !auditChannel ? "audit-channel" : null,
  ].filter(Boolean));
  const accepted = missing.length === 0 && Boolean(service.acceptedBy || service.provider !== "mailchimp");

  return Object.freeze({
    schema: "aios.token.stream.provider-preview-acceptance.v1",
    accepted,
    acceptedBy: service.acceptedBy,
    requiresUserAcceptance: service.provider === "mailchimp",
    enabled: service.enabled,
    missing,
    status: disabled
      ? "disabled"
      : missing.length === 0
        ? accepted ? "accepted" : "awaiting-acceptance"
        : missing.includes("provider-capability-negotiation")
          ? negotiation.status
          : missing.includes("healthy-token-stream")
            ? health.status
            : "preview-review",
    controls: Object.freeze({
      canEnable: disabled,
      canDisable: !disabled,
      canAccept: !disabled && missing.every((entry) => entry !== "healthy-token-stream" && entry !== "provider-capability-negotiation"),
      canSchedule: !disabled && health.ok && negotiation.accepted,
      canHandoff: accepted,
    }),
    statusChannel,
    audit: Object.freeze({
      channel: auditChannel,
      required: service.provider === "mailchimp" || negotiation.missingPermissions.length > 0,
      status: auditChannel
        ? "audit-ready"
        : service.provider === "mailchimp" || negotiation.missingPermissions.length > 0
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    nextAction: accepted
      ? "handoff-provider-service"
      : disabled
        ? "enable-provider-service"
        : missing.includes("status-channel")
          ? "declare-status-channel"
          : missing.includes("audit-channel")
            ? "declare-audit-channel"
            : missing.includes("provider-capability-negotiation")
              ? negotiation.nextAction
              : missing.includes("healthy-token-stream")
                ? health.nextAction
                : "accept-provider-preview",
  });
}

export function createTokenStreamProviderServiceContract(stream, options = {}) {
  const service = normalizeProviderServiceOptions(options);
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: service.auditChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel,
  });
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "provider-service-contract",
  });
  const analytics = createTokenStreamAnalyticsReport(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "provider-service-contract",
  });
  const negotiation = createProviderCapabilityNegotiation(service, boundary);
  const acceptance = createProviderPreviewAcceptance(service, health, analytics, negotiation, boundary);
  const syncKey = providerServiceSyncKey(service, boundary, stream);

  return Object.freeze({
    schema: "aios.token.stream.provider-service.contract.v1",
    service: Object.freeze({
      id: service.serviceId,
      adapter: service.adapter,
      provider: service.provider,
      operation: service.operation,
      enabled: service.enabled,
      scheduledAt: service.scheduledAt,
      externalTraceId: service.externalTraceId ?? syncKey,
    }),
    boundary,
    negotiation,
    acceptance,
    sync: Object.freeze({
      syncKey,
      sourceId: stream?.metadata?.sourceId ?? null,
      cursor: normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
      checkpointCursor: analytics.history.checkpoint.cursor,
      commandCount: analytics.counters.commandCount,
      statusChannel: acceptance.statusChannel,
      auditChannel: acceptance.audit.channel,
      handoff: stream?.metadata?.handoff ?? "parser",
    }),
    preview: Object.freeze({
      tokenWindow: describeTokenWindow(stream, 3),
      health: Object.freeze({
        ok: health.ok,
        status: health.status,
        nextAction: health.nextAction,
      }),
      analytics: analytics.exportSummary,
      requiredPermissions: service.requiredPermissions,
      missingPermissions: negotiation.missingPermissions,
      nextAction: acceptance.nextAction,
    }),
    exportSummary: Object.freeze({
      provider: service.provider,
      operation: service.operation,
      status: acceptance.status,
      accepted: acceptance.accepted,
      syncKey,
      nextAction: acceptance.nextAction,
    }),
    nextAction: acceptance.nextAction,
  });
}

function readinessStep(label, status, accepted, nextAction, details = {}) {
  return Object.freeze({
    schema: "aios.token.stream.provider-readiness.step.v1",
    label,
    status,
    accepted: Boolean(accepted),
    nextAction,
    details: Object.freeze(details),
  });
}

function firstReadinessBlocker(steps) {
  return Array.from(steps ?? []).find((step) => !step.accepted) ?? null;
}

export function createTokenStreamProviderReadinessPreview(stream, options = {}) {
  const contract = createTokenStreamProviderServiceContract(stream, {
    ...options,
    reason: options.reason ?? "provider-readiness-preview",
  });
  const checkpoint = createTokenCheckpoint(stream, options.reason ?? "provider-readiness-preview");
  const health = contract.preview.health;
  const missingStatusChannel = !contract.acceptance.statusChannel;
  const missingAudit = contract.acceptance.audit.required && contract.acceptance.audit.status !== "audit-ready";
  const requiresAcceptance = contract.acceptance.requiresUserAcceptance;
  const acceptedBy = contract.acceptance.acceptedBy;
  const steps = Object.freeze([
    readinessStep("token-stream", health.status, health.ok, health.nextAction, {
      cursor: contract.sync.cursor,
      checkpointCursor: contract.sync.checkpointCursor,
      restartSafe: checkpoint.restartSafe,
    }),
    readinessStep("provider-capabilities", contract.negotiation.status, contract.negotiation.accepted, contract.negotiation.nextAction, {
      requestedCapabilities: contract.negotiation.requestedCapabilities,
      unsupportedCapabilities: contract.negotiation.unsupportedCapabilities,
      requiredPermissions: contract.negotiation.requiredPermissions,
      missingPermissions: contract.negotiation.missingPermissions,
    }),
    readinessStep("external-status", missingStatusChannel ? "status-channel-missing" : "status-channel-ready", !missingStatusChannel, missingStatusChannel ? "declare-status-channel" : "continue", {
      statusChannel: contract.acceptance.statusChannel,
      auditChannel: contract.acceptance.audit.channel,
    }),
    readinessStep("audit", contract.acceptance.audit.status, !missingAudit, missingAudit ? "declare-audit-channel" : "continue", {
      required: contract.acceptance.audit.required,
      channel: contract.acceptance.audit.channel,
    }),
    readinessStep("acceptance", contract.acceptance.status, !requiresAcceptance || Boolean(acceptedBy), contract.acceptance.nextAction, {
      requiresUserAcceptance,
      acceptedBy,
      controls: contract.acceptance.controls,
    }),
  ]);
  const blocker = firstReadinessBlocker(steps);
  const accepted = !blocker && contract.acceptance.accepted;

  return Object.freeze({
    schema: "aios.token.stream.provider-readiness-preview.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: contract.service.provider,
    operation: contract.service.operation,
    adapter: contract.service.adapter,
    accepted,
    status: accepted
      ? "ready"
      : blocker?.status ?? contract.acceptance.status,
    sync: contract.sync,
    steps,
    explanation: Object.freeze({
      headline: accepted
        ? "Provider handoff is ready."
        : `${blocker?.label ?? "provider"} requires ${blocker?.nextAction ?? contract.nextAction}.`,
      blocker: blocker
        ? Object.freeze({
            label: blocker.label,
            status: blocker.status,
            nextAction: blocker.nextAction,
          })
        : null,
      validationSummary: Object.freeze({
        tokenStreamReady: health.ok,
        capabilitiesAccepted: contract.negotiation.accepted,
        statusReady: !missingStatusChannel,
        auditReady: !missingAudit,
        previewAccepted: !requiresAcceptance || Boolean(acceptedBy),
      }),
    }),
    serviceContract: contract,
    exportSummary: Object.freeze({
      provider: contract.service.provider,
      operation: contract.service.operation,
      status: accepted ? "ready" : blocker?.status ?? contract.acceptance.status,
      accepted,
      syncKey: contract.sync.syncKey,
      nextAction: accepted ? "handoff-provider-service" : blocker?.nextAction ?? contract.nextAction,
    }),
    nextAction: accepted ? "handoff-provider-service" : blocker?.nextAction ?? contract.nextAction,
  });
}

export function createTokenStreamProviderAcceptanceSummary(stream, options = {}) {
  const readiness = options.readinessPreview ?? createTokenStreamProviderReadinessPreview(stream, {
    ...options,
    reason: options.reason ?? "provider-acceptance-summary",
  });
  const contract = readiness.serviceContract;
  const validation = readiness.explanation.validationSummary;
  const failedSteps = Object.freeze(readiness.steps.filter((step) => !step.accepted));
  const blocker = failedSteps[0] ?? null;
  const missing = Object.freeze([
    validation.tokenStreamReady ? null : "token-stream",
    validation.capabilitiesAccepted ? null : "provider-capabilities",
    validation.statusReady ? null : "external-status",
    validation.auditReady ? null : "audit",
    validation.previewAccepted ? null : "preview-acceptance",
    ...Array.from(contract.acceptance.missing ?? []),
  ].filter(Boolean));
  const controls = contract.acceptance.controls;
  const decision = readiness.accepted
    ? "accepted"
    : blocker?.label === "acceptance"
      ? "awaiting-user-acceptance"
      : blocker?.label === "provider-capabilities"
        ? "provider-review"
        : blocker?.label === "token-stream"
          ? "stream-review"
          : blocker?.label === "audit"
            ? "audit-review"
            : blocker?.label === "external-status"
              ? "status-review"
              : contract.acceptance.status;
  const nextStep = Object.freeze({
    label: readiness.accepted
      ? "Provider handoff"
      : blocker?.label ?? "Provider preview",
    action: readiness.accepted
      ? "handoff-provider-service"
      : blocker?.nextAction ?? contract.acceptance.nextAction,
    retryable: !readiness.accepted && (blocker?.label === "token-stream" || contract.acceptance.status === "awaiting-acceptance"),
    requiresOperator: !readiness.accepted && (
      blocker?.label === "acceptance"
      || blocker?.label === "audit"
      || blocker?.label === "external-status"
      || contract.acceptance.status === "awaiting-acceptance"
    ),
  });

  return Object.freeze({
    schema: "aios.token.stream.provider-acceptance-summary.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: readiness.provider,
    operation: readiness.operation,
    adapter: readiness.adapter,
    accepted: readiness.accepted,
    status: decision,
    syncKey: readiness.sync.syncKey,
    boundary: Object.freeze({
      workspace: contract.boundary.workspace,
      tenant: contract.boundary.tenant,
      role: contract.boundary.role,
      localOnly: contract.boundary.localOnly,
    }),
    validationSummary: Object.freeze({
      tokenStreamReady: validation.tokenStreamReady,
      capabilitiesAccepted: validation.capabilitiesAccepted,
      statusReady: validation.statusReady,
      auditReady: validation.auditReady,
      previewAccepted: validation.previewAccepted,
      missing,
    }),
    preview: Object.freeze({
      tokenWindow: contract.preview.tokenWindow,
      requiredPermissions: contract.preview.requiredPermissions,
      missingPermissions: contract.preview.missingPermissions,
      statusChannel: contract.acceptance.statusChannel,
      audit: contract.acceptance.audit,
    }),
    controls: Object.freeze({
      canPreview: controls.canSchedule || controls.canAccept || readiness.steps.length > 0,
      canAccept: controls.canAccept,
      canSchedule: controls.canSchedule,
      canHandoff: controls.canHandoff && readiness.accepted,
      canDisable: controls.canDisable,
    }),
    failedSteps: Object.freeze(failedSteps.map((step) => Object.freeze({
      label: step.label,
      status: step.status,
      nextAction: step.nextAction,
      details: step.details,
    }))),
    explanation: Object.freeze({
      headline: readiness.accepted
        ? `${readiness.provider}.${readiness.operation} preview is accepted and ready for handoff.`
        : `${readiness.provider}.${readiness.operation} preview is waiting on ${nextStep.action}.`,
      blocker: blocker
        ? Object.freeze({
            label: blocker.label,
            status: blocker.status,
            nextAction: blocker.nextAction,
          })
        : null,
      nextStep,
    }),
    nextAction: nextStep.action,
  });
}

function mailchimpAdoptionOperationMode(operation) {
  return ["syncAudience", "upsertCampaign", "createCampaign", "scheduleCampaign"].includes(operation)
    ? "mutating"
    : "read";
}

function createMailchimpAdoptionRestartPlan(stream, serviceContract, checkpoint, acceptanceSummary) {
  const mutating = mailchimpAdoptionOperationMode(serviceContract.service.operation) === "mutating";
  const hasIdempotency = serviceContract.negotiation.supportedCapabilities.includes("idempotency")
    && serviceContract.negotiation.requestedCapabilities.includes("idempotency");
  const statusReady = Boolean(serviceContract.acceptance.statusChannel);
  const auditReady = !serviceContract.acceptance.audit.required || serviceContract.acceptance.audit.status === "audit-ready";
  const missing = Object.freeze([
    checkpoint.restartSafe ? null : "restart-safe-token-checkpoint",
    statusReady ? null : "external-status-channel",
    auditReady ? null : "audit-channel",
    mutating && !hasIdempotency ? "idempotency-capability" : null,
    acceptanceSummary.accepted ? null : "preview-acceptance",
  ].filter(Boolean));
  const commandId = stableCommandId("mailchimp-adopt", checkpoint.cursor, {
    provider: serviceContract.service.provider,
    operation: serviceContract.service.operation,
    syncKey: serviceContract.sync.syncKey,
  });

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-adoption.restart-plan.v1",
    restartSafe: missing.length === 0,
    operationMode: mutating ? "mutating" : "read",
    checkpoint: Object.freeze({
      cursor: checkpoint.cursor,
      restartSafe: checkpoint.restartSafe,
      restoreCommand: checkpoint.clientState.restoreCommand,
    }),
    command: Object.freeze({
      id: commandId,
      kind: "mailchimp-adopt",
      idempotent: !mutating || hasIdempotency,
      writesProvider: mutating,
      statusChannel: serviceContract.acceptance.statusChannel,
      auditChannel: serviceContract.acceptance.audit.channel,
    }),
    missing,
    status: missing.length === 0
      ? "restart-safe"
      : missing.includes("restart-safe-token-checkpoint")
        ? "checkpoint-review"
        : missing.includes("idempotency-capability")
          ? "idempotency-review"
          : missing.includes("external-status-channel")
            ? "status-review"
            : missing.includes("audit-channel")
              ? "audit-review"
              : "acceptance-review",
    nextAction: missing.length === 0
      ? "persist-mailchimp-adoption-state"
      : missing.includes("restart-safe-token-checkpoint")
        ? "reload-token-checkpoint"
        : missing.includes("external-status-channel")
          ? "declare-status-channel"
          : missing.includes("audit-channel")
            ? "declare-audit-channel"
            : missing.includes("idempotency-capability")
              ? "request-idempotency-capability"
              : acceptanceSummary.nextAction,
  });
}

export function createTokenStreamMailchimpAdoptionPacket(stream, options = {}) {
  const readiness = options.readinessPreview ?? createTokenStreamProviderReadinessPreview(stream, {
    ...options,
    adapter: options.adapter ?? "mailchimp.syncAudience",
    provider: "mailchimp",
    reason: options.reason ?? "mailchimp-adoption-packet",
  });
  const acceptanceSummary = options.acceptanceSummary ?? createTokenStreamProviderAcceptanceSummary(stream, {
    ...options,
    readinessPreview: readiness,
    reason: options.reason ?? "mailchimp-adoption-packet",
  });
  const serviceContract = readiness.serviceContract;
  const checkpoint = createTokenCheckpoint(stream, options.reason ?? "mailchimp-adoption-packet");
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    permissions: serviceContract.boundary.permissions,
    auditChannel: serviceContract.boundary.auditChannel,
    requiredPermissions: serviceContract.negotiation.requiredPermissions,
    reason: options.reason ?? "mailchimp-adoption-packet",
  });
  const restartPlan = createMailchimpAdoptionRestartPlan(stream, serviceContract, checkpoint, acceptanceSummary);
  const detected = serviceContract.service.provider === "mailchimp";
  const ready = detected && readiness.accepted && acceptanceSummary.accepted && health.ok && restartPlan.restartSafe;
  const missing = Object.freeze([
    detected ? null : "mailchimp-provider",
    health.ok ? null : "healthy-token-stream",
    readiness.accepted ? null : "provider-readiness",
    acceptanceSummary.accepted ? null : "preview-acceptance",
    ...restartPlan.missing,
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-adoption-packet.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: serviceContract.service.provider,
    operation: serviceContract.service.operation,
    adapter: serviceContract.service.adapter,
    detected,
    ready,
    status: !detected
      ? "not-detected"
      : ready
        ? "ready-for-client-adoption"
        : missing.includes("healthy-token-stream")
          ? health.status
          : missing.includes("provider-readiness")
            ? readiness.status
            : missing.includes("preview-acceptance")
              ? acceptanceSummary.status
              : restartPlan.status,
    boundary: Object.freeze({
      workspace: serviceContract.boundary.workspace,
      tenant: serviceContract.boundary.tenant,
      role: serviceContract.boundary.role,
      localOnly: serviceContract.boundary.localOnly,
    }),
    sync: Object.freeze({
      syncKey: serviceContract.sync.syncKey,
      statusChannel: serviceContract.sync.statusChannel,
      auditChannel: serviceContract.sync.auditChannel,
      cursor: serviceContract.sync.cursor,
      checkpointCursor: serviceContract.sync.checkpointCursor,
    }),
    validationSummary: Object.freeze({
      tokenStreamReady: health.ok,
      providerReady: readiness.accepted,
      previewAccepted: acceptanceSummary.accepted,
      restartSafe: restartPlan.restartSafe,
      missing,
    }),
    restartPlan,
    controls: Object.freeze({
      canPreview: detected && health.ok,
      canAccept: detected && acceptanceSummary.controls.canAccept,
      canPersist: restartPlan.restartSafe,
      canHandoffParser: ready,
      canResumeFromCheckpoint: Boolean(checkpoint.clientState.restoreCommand),
    }),
    clientState: Object.freeze({
      sourceId: stream?.metadata?.sourceId ?? null,
      workspace: serviceContract.boundary.workspace,
      tenant: serviceContract.boundary.tenant,
      role: serviceContract.boundary.role,
      syncKey: serviceContract.sync.syncKey,
      restoreCommand: checkpoint.clientState.restoreCommand,
      statusChannel: serviceContract.sync.statusChannel,
      auditChannel: serviceContract.sync.auditChannel,
      command: restartPlan.command,
    }),
    nextAction: ready
      ? "handoff-mailchimp-client-adoption"
      : !detected
        ? "continue"
        : missing.includes("healthy-token-stream")
          ? health.nextAction
          : missing.includes("provider-readiness")
            ? readiness.nextAction
            : missing.includes("preview-acceptance")
              ? acceptanceSummary.nextAction
              : restartPlan.nextAction,
  });
}

function createMailchimpWorkflowStatus(adoption, adapterStatus, auditReport) {
  const missing = Object.freeze([
    adoption.detected ? null : "mailchimp-provider",
    adoption.validationSummary.tokenStreamReady ? null : "token-stream",
    adoption.validationSummary.providerReady ? null : "provider-readiness",
    adoption.validationSummary.previewAccepted ? null : "preview-acceptance",
    adoption.validationSummary.restartSafe ? null : "restart-safe-adoption",
    adapterStatus.parserHandoff.accepted ? null : adapterStatus.parserHandoff.blockedGate ?? "adapter-status",
    auditReport.ok ? null : "command-audit",
  ].filter(Boolean));
  const ready = missing.length === 0;

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-workflow.status.v1",
    ready,
    missing,
    status: ready
      ? "ready-for-workflow-handoff"
      : missing.includes("mailchimp-provider")
        ? "not-detected"
        : missing.includes("token-stream")
          ? adoption.status
          : missing.includes("provider-readiness")
            ? "provider-review"
            : missing.includes("preview-acceptance")
              ? "acceptance-review"
              : missing.includes("restart-safe-adoption")
                ? adoption.restartPlan.status
                : missing.includes("command-audit")
                  ? auditReport.status
                  : adapterStatus.status,
    nextAction: ready
      ? "handoff-mailchimp-workflow"
      : missing.includes("token-stream")
        ? adoption.nextAction
        : missing.includes("provider-readiness")
          ? adoption.nextAction
          : missing.includes("preview-acceptance")
            ? adoption.nextAction
            : missing.includes("restart-safe-adoption")
              ? adoption.restartPlan.nextAction
              : missing.includes("command-audit")
                ? auditReport.nextAction
                : adapterStatus.nextAction,
  });
}

function createMailchimpWorkflowTimeline(readiness, acceptance, adoption, adapterStatus, auditReport) {
  return Object.freeze([
    Object.freeze({
      schema: "aios.token.stream.mailchimp-workflow.event.v1",
      label: "preview",
      accepted: readiness.explanation.validationSummary.tokenStreamReady,
      status: readiness.serviceContract.preview.health.status,
      nextAction: readiness.serviceContract.preview.health.nextAction,
    }),
    Object.freeze({
      schema: "aios.token.stream.mailchimp-workflow.event.v1",
      label: "capabilities",
      accepted: readiness.explanation.validationSummary.capabilitiesAccepted,
      status: readiness.serviceContract.negotiation.status,
      nextAction: readiness.serviceContract.negotiation.nextAction,
    }),
    Object.freeze({
      schema: "aios.token.stream.mailchimp-workflow.event.v1",
      label: "acceptance",
      accepted: acceptance.accepted,
      status: acceptance.status,
      nextAction: acceptance.nextAction,
    }),
    Object.freeze({
      schema: "aios.token.stream.mailchimp-workflow.event.v1",
      label: "restart",
      accepted: adoption.restartPlan.restartSafe,
      status: adoption.restartPlan.status,
      nextAction: adoption.restartPlan.nextAction,
    }),
    Object.freeze({
      schema: "aios.token.stream.mailchimp-workflow.event.v1",
      label: "adapter-status",
      accepted: adapterStatus.parserHandoff.accepted,
      status: adapterStatus.parserHandoff.status,
      nextAction: adapterStatus.parserHandoff.nextAction,
    }),
    Object.freeze({
      schema: "aios.token.stream.mailchimp-workflow.event.v1",
      label: "command-audit",
      accepted: auditReport.ok,
      status: auditReport.status,
      nextAction: auditReport.nextAction,
    }),
  ]);
}

export function createTokenStreamMailchimpWorkflowSession(stream, options = {}) {
  const adapter = options.adapter ?? options.expectedAdapter ?? "mailchimp.syncAudience";
  const requestedCapabilities = options.requestedCapabilities ?? [
    "audit",
    "checkpoint",
    "external-status",
    "provider-read",
    "provider-write",
    "idempotency",
  ];
  const sessionOptions = Object.freeze({
    ...options,
    adapter,
    provider: "mailchimp",
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel ?? null,
    statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel ?? null,
    requestedCapabilities,
    reason: options.reason ?? "mailchimp-workflow-session",
  });
  const readiness = createTokenStreamProviderReadinessPreview(stream, sessionOptions);
  const acceptance = createTokenStreamProviderAcceptanceSummary(stream, {
    ...sessionOptions,
    readinessPreview: readiness,
  });
  const adoption = createTokenStreamMailchimpAdoptionPacket(stream, {
    ...sessionOptions,
    readinessPreview: readiness,
    acceptanceSummary: acceptance,
  });
  const adapterStatus = createTokenStreamAdapterStatusPacket(stream, {
    ...sessionOptions,
    acceptedBy: options.acceptedBy,
  });
  const auditReport = createTokenStreamCommandAuditReport(stream, [
    adoption.restartPlan.checkpoint.restoreCommand,
    Object.freeze({
      kind: "noop",
      reason: "mailchimp-workflow-status-observe",
      auditChannel: sessionOptions.auditChannel,
      permissions: sessionOptions.permissions,
    }),
  ], {
    ...sessionOptions,
    requiredPermissions: readiness.serviceContract.negotiation.requiredPermissions,
  });
  const workflowStatus = createMailchimpWorkflowStatus(adoption, adapterStatus, auditReport);
  const timeline = createMailchimpWorkflowTimeline(readiness, acceptance, adoption, adapterStatus, auditReport);

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-workflow-session.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: "mailchimp",
    operation: readiness.operation,
    adapter,
    ready: workflowStatus.ready,
    status: workflowStatus.status,
    boundary: adoption.boundary,
    sync: Object.freeze({
      syncKey: adoption.sync.syncKey,
      statusChannel: adoption.sync.statusChannel,
      auditChannel: adoption.sync.auditChannel,
      cursor: adoption.sync.cursor,
      checkpointCursor: adoption.sync.checkpointCursor,
      restoreCommand: adoption.clientState.restoreCommand,
    }),
    timeline,
    readiness: readiness.exportSummary,
    acceptance: Object.freeze({
      accepted: acceptance.accepted,
      status: acceptance.status,
      missing: acceptance.validationSummary.missing,
      controls: acceptance.controls,
      nextAction: acceptance.nextAction,
    }),
    adoption: Object.freeze({
      ready: adoption.ready,
      status: adoption.status,
      missing: adoption.validationSummary.missing,
      restartSafe: adoption.restartPlan.restartSafe,
      command: adoption.restartPlan.command,
      nextAction: adoption.nextAction,
    }),
    adapterStatus: adapterStatus.exportSummary,
    commandAudit: auditReport.exportSummary,
    validationSummary: Object.freeze({
      tokenStreamReady: adoption.validationSummary.tokenStreamReady,
      providerReady: adoption.validationSummary.providerReady,
      previewAccepted: adoption.validationSummary.previewAccepted,
      restartSafe: adoption.validationSummary.restartSafe,
      adapterReady: adapterStatus.parserHandoff.accepted,
      commandAuditReady: auditReport.ok,
      missing: workflowStatus.missing,
    }),
    controls: Object.freeze({
      canPreview: adoption.controls.canPreview,
      canAccept: acceptance.controls.canAccept,
      canPersist: adoption.controls.canPersist,
      canReplayRestore: auditReport.controls.canRetryFromCheckpoint,
      canHandoffParser: workflowStatus.ready,
      canHandoffClient: workflowStatus.ready && adoption.controls.canHandoffParser,
    }),
    clientState: Object.freeze({
      ...adoption.clientState,
      workflowStatus: workflowStatus.status,
      workflowNextAction: workflowStatus.nextAction,
      adapterReady: adapterStatus.parserHandoff.accepted,
      commandAuditReady: auditReport.ok,
    }),
    exportSummary: Object.freeze({
      sourceId: stream?.metadata?.sourceId ?? null,
      status: workflowStatus.ready ? "workflow-ready" : "workflow-review",
      syncKey: adoption.sync.syncKey,
      missing: workflowStatus.missing,
      nextAction: workflowStatus.nextAction,
    }),
    nextAction: workflowStatus.nextAction,
  });
}

function normalizeAdapterStatusOptions(options = {}) {
  const adapter = String(options.adapter ?? options.expectedAdapter ?? "runtime.run");
  const [providerPart, ...operationParts] = adapter.split(".");
  const provider = String(options.provider ?? providerPart ?? "runtime").trim() || "runtime";
  const operation = String(options.operation ?? operationParts.join(".") ?? "run").trim() || "run";

  return Object.freeze({
    adapter: options.adapter ?? `${provider}.${operation}`,
    provider,
    operation,
    acceptedBy: stableBoundaryValue(options.acceptedBy),
    auditChannel: stableBoundaryValue(options.auditChannel),
    statusChannel: stableBoundaryValue(options.statusChannel),
    requestedCapabilities: stableStringSet(options.requestedCapabilities ?? []),
    enabled: options.enabled !== false,
    reason: options.reason ?? "adapter-status-packet",
  });
}

function adapterStatusGate(label, accepted, status, nextAction, details = {}) {
  return Object.freeze({
    schema: "aios.token.stream.adapter-status.gate.v1",
    label,
    accepted: Boolean(accepted),
    status,
    nextAction,
    details: Object.freeze(details),
  });
}

export function createTokenStreamAdapterStatusPacket(stream, options = {}) {
  const adapter = normalizeAdapterStatusOptions(options);
  const service = createTokenStreamProviderServiceContract(stream, {
    ...options,
    adapter: adapter.adapter,
    provider: adapter.provider,
    operation: adapter.operation,
    acceptedBy: adapter.acceptedBy,
    auditChannel: adapter.auditChannel ?? options.auditChannel,
    statusChannel: adapter.statusChannel ?? options.statusChannel,
    requestedCapabilities: adapter.requestedCapabilities,
    enabled: adapter.enabled,
    reason: adapter.reason,
  });
  const readiness = createTokenStreamProviderReadinessPreview(stream, {
    ...options,
    adapter: adapter.adapter,
    provider: adapter.provider,
    operation: adapter.operation,
    acceptedBy: adapter.acceptedBy,
    auditChannel: service.acceptance.audit.channel,
    statusChannel: service.acceptance.statusChannel,
    requestedCapabilities: adapter.requestedCapabilities,
    enabled: adapter.enabled,
    readinessPreview: undefined,
    reason: `${adapter.reason}:readiness`,
  });
  const acceptance = createTokenStreamProviderAcceptanceSummary(stream, {
    ...options,
    readinessPreview: readiness,
    reason: `${adapter.reason}:acceptance`,
  });
  const adoption = adapter.provider === "mailchimp"
    ? createTokenStreamMailchimpAdoptionPacket(stream, {
        ...options,
        adapter: adapter.adapter,
        provider: adapter.provider,
        operation: adapter.operation,
        acceptedBy: adapter.acceptedBy,
        auditChannel: service.acceptance.audit.channel,
        statusChannel: service.acceptance.statusChannel,
        requestedCapabilities: adapter.requestedCapabilities.length > 0
          ? adapter.requestedCapabilities
          : service.negotiation.supportedCapabilities,
        acceptanceSummary: acceptance,
        readinessPreview: readiness,
        reason: `${adapter.reason}:mailchimp-adoption`,
      })
    : null;
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    permissions: service.boundary.permissions,
    auditChannel: service.boundary.auditChannel,
    requiredPermissions: service.negotiation.requiredPermissions,
    reason: `${adapter.reason}:health`,
  });
  const checkpoint = createTokenCheckpoint(stream, `${adapter.reason}:checkpoint`);
  const parserHandoffReady = health.ok
    && readiness.accepted
    && acceptance.accepted
    && (!adoption || adoption.ready)
    && checkpoint.restartSafe;
  const gates = Object.freeze([
    adapterStatusGate("token-stream", health.ok, health.status, health.nextAction, {
      cursor: health.cursor,
      diagnosticCount: health.diagnosticCount,
      blockingCount: health.blockingCount,
    }),
    adapterStatusGate("checkpoint", checkpoint.restartSafe, checkpoint.restartSafe ? "restart-safe" : "checkpoint-review", checkpoint.restartSafe ? "continue" : checkpoint.summary?.nextAction ?? "reload-token-checkpoint", {
      cursor: checkpoint.cursor,
      restoreCommand: checkpoint.clientState.restoreCommand,
    }),
    adapterStatusGate("provider-readiness", readiness.accepted, readiness.status, readiness.nextAction, readiness.explanation.validationSummary),
    adapterStatusGate("preview-acceptance", acceptance.accepted, acceptance.status, acceptance.nextAction, acceptance.validationSummary),
    adapterStatusGate("client-adoption", !adoption || adoption.ready, adoption?.status ?? "not-required", adoption?.nextAction ?? "continue", {
      provider: adapter.provider,
      required: Boolean(adoption),
      missing: adoption?.validationSummary?.missing ?? Object.freeze([]),
    }),
  ]);
  const blocker = gates.find((gate) => !gate.accepted) ?? null;
  const status = parserHandoffReady
    ? "ready-for-parser-handoff"
    : blocker?.status ?? service.acceptance.status;

  return Object.freeze({
    schema: "aios.token.stream.adapter-status-packet.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    adapter: adapter.adapter,
    provider: adapter.provider,
    operation: adapter.operation,
    ready: parserHandoffReady,
    status,
    boundary: Object.freeze({
      workspace: service.boundary.workspace,
      tenant: service.boundary.tenant,
      role: service.boundary.role,
      localOnly: service.boundary.localOnly,
    }),
    sync: Object.freeze({
      syncKey: service.sync.syncKey,
      sourceId: service.sync.sourceId,
      cursor: service.sync.cursor,
      checkpointCursor: service.sync.checkpointCursor,
      statusChannel: service.sync.statusChannel,
      auditChannel: service.sync.auditChannel,
      restoreCommand: checkpoint.clientState.restoreCommand,
    }),
    permissions: Object.freeze({
      required: service.negotiation.requiredPermissions,
      granted: service.negotiation.grantedPermissions,
      missing: service.negotiation.missingPermissions,
    }),
    gates,
    service: service.exportSummary,
    readiness: readiness.exportSummary,
    acceptance: Object.freeze({
      accepted: acceptance.accepted,
      status: acceptance.status,
      controls: acceptance.controls,
      nextStep: acceptance.explanation.nextStep,
    }),
    adoption: adoption
      ? Object.freeze({
          ready: adoption.ready,
          status: adoption.status,
          restartSafe: adoption.restartPlan.restartSafe,
          command: adoption.restartPlan.command,
          missing: adoption.validationSummary.missing,
          nextAction: adoption.nextAction,
        })
      : null,
    recovery: Object.freeze({
      restartSafe: checkpoint.restartSafe && (!adoption || adoption.restartPlan.restartSafe),
      retry: health.retry,
      checkpoint: Object.freeze({
        cursor: checkpoint.cursor,
        restoreCommand: checkpoint.clientState.restoreCommand,
      }),
    }),
    parserHandoff: Object.freeze({
      accepted: parserHandoffReady,
      status,
      blockedGate: blocker?.label ?? null,
      nextAction: parserHandoffReady ? "handoff-parser" : blocker?.nextAction ?? service.nextAction,
    }),
    exportSummary: Object.freeze({
      provider: adapter.provider,
      operation: adapter.operation,
      status,
      ready: parserHandoffReady,
      syncKey: service.sync.syncKey,
      blockedGate: blocker?.label ?? null,
      nextAction: parserHandoffReady ? "handoff-parser" : blocker?.nextAction ?? service.nextAction,
    }),
    nextAction: parserHandoffReady ? "handoff-parser" : blocker?.nextAction ?? service.nextAction,
  });
}

function receiptStatusForCommand(command, stream, boundaryReport) {
  const mutatesCursor = command.kind !== "noop";
  const mismatched = Array.from(command.boundaryMismatches ?? []);
  const auditReady = command.audit?.status === "audit-ready" || !command.audit?.required;
  const alreadyApplied = Array.from(stream?.metadata?.appliedCommands ?? []).includes(command.id);

  return Object.freeze({
    accepted: mismatched.length === 0 && boundaryReport.ok && auditReady,
    alreadyApplied,
    mutatesCursor,
    status: mismatched.length > 0
      ? "boundary-conflict"
      : !boundaryReport.ok
        ? boundaryReport.status
        : !auditReady
          ? "audit-review"
          : alreadyApplied
            ? "already-applied"
            : mutatesCursor
              ? "ready-to-apply"
              : "observed",
    nextAction: mismatched.length > 0
      ? "reload-token-checkpoint"
      : !boundaryReport.ok
        ? boundaryReport.nextAction
        : !auditReady
          ? "declare-audit-channel"
          : alreadyApplied
            ? "continue"
            : mutatesCursor
              ? "apply-token-command"
              : "continue",
  });
}

export function createTokenStreamCommandAuditReport(stream, commands = [], options = {}) {
  const commandList = Object.freeze(Array.from(commands ?? []).map((command, index) => (
    command?.schema === "aios.token.stream.command.v1"
      ? command
      : createTokenStreamCommand(stream, command?.kind ?? "noop", {
          ...(command?.payload ?? command ?? {}),
          reason: command?.reason ?? command?.payload?.reason ?? `audit-command-${index}`,
        })
  )));
  const boundaryReport = createTokenStreamBoundaryReport(stream, {
    ...(options.boundary ?? {}),
    requiredPermissions: options.requiredPermissions ?? [],
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel ?? null,
  });
  const checkpoint = createTokenCheckpoint(stream, options.reason ?? "token-command-audit");
  const receipts = Object.freeze(commandList.map((command, index) => {
    const commandBoundary = normalizeBoundaryContext(command.boundary ?? command);
    const streamBoundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
    const mismatches = compareBoundary(streamBoundary, commandBoundary);
    const safeCommand = Object.freeze({
      ...command,
      boundaryMismatches: mismatches,
    });
    const receipt = receiptStatusForCommand(safeCommand, stream, boundaryReport);

    return Object.freeze({
      schema: "aios.token.stream.command-audit.receipt.v1",
      index,
      commandId: safeCommand.id,
      kind: safeCommand.kind,
      cursor: safeCommand.cursor,
      sourceId: stream?.metadata?.sourceId ?? null,
      accepted: receipt.accepted,
      idempotent: receipt.alreadyApplied || safeCommand.kind === "noop" || safeCommand.kind === "restore-cursor",
      alreadyApplied: receipt.alreadyApplied,
      mutatesCursor: receipt.mutatesCursor,
      boundaryMismatches: mismatches,
      audit: safeCommand.audit,
      status: receipt.status,
      nextAction: receipt.nextAction,
    });
  }));
  const blocked = receipts.filter((receipt) => !receipt.accepted && !receipt.alreadyApplied);
  const mutating = receipts.filter((receipt) => receipt.mutatesCursor);
  const auditMissing = receipts.filter((receipt) => receipt.audit?.status === "audit-channel-missing");
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    reason: options.reason ?? "token-command-audit",
  });

  return Object.freeze({
    schema: "aios.token.stream.command-audit.report.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    ok: blocked.length === 0 && health.ok,
    status: blocked.length === 0 && health.ok
      ? mutating.length > 0 ? "ready-to-apply" : "observed"
      : auditMissing.length > 0
        ? "audit-review"
        : !boundaryReport.ok
          ? boundaryReport.status
          : health.status,
    commandCount: receipts.length,
    acceptedCount: receipts.filter((receipt) => receipt.accepted).length,
    mutatingCount: mutating.length,
    receipts,
    boundary: boundaryReport,
    checkpoint: Object.freeze({
      cursor: checkpoint.cursor,
      restartSafe: checkpoint.restartSafe,
      restoreCommand: checkpoint.clientState.restoreCommand,
    }),
    controls: Object.freeze({
      canApply: blocked.length === 0 && health.ok,
      canRetryFromCheckpoint: Boolean(checkpoint.clientState.restoreCommand),
      canAudit: Boolean(boundaryReport.audit.channel),
      canReplayIdempotently: receipts.every((receipt) => receipt.idempotent || !receipt.mutatesCursor),
    }),
    exportSummary: Object.freeze({
      status: blocked.length === 0 && health.ok ? "command-audit-ready" : "command-audit-review",
      commandCount: receipts.length,
      blockedCount: blocked.length,
      auditMissingCount: auditMissing.length,
      nextAction: blocked[0]?.nextAction ?? health.nextAction,
    }),
    nextAction: blocked[0]?.nextAction ?? health.nextAction,
  });
}

export function describeTokenWindow(stream, radius = 2) {
  const tokens = Array.from(stream?.tokens ?? []);
  const cursor = normalizeCursor(stream?.cursor, tokens.length);
  const safeRadius = Math.max(0, Number.isInteger(radius) ? radius : 2);
  const start = Math.max(0, cursor - safeRadius);
  const end = Math.min(tokens.length, cursor + safeRadius + 1);

  return Object.freeze({
    schema: "aios.token.window.v1",
    cursor,
    current: currentToken(stream),
    before: Object.freeze(tokens.slice(start, cursor)),
    after: Object.freeze(tokens.slice(cursor + 1, end)),
    eof: currentToken(stream).type === TOKEN_TYPES.EOF,
  });
}
