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

function stableBoundaryIncidentId(stream, boundary, status) {
  return [
    "token-boundary-incident",
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    boundary.role ?? "role",
    normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
    status,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
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

export function createTokenStreamBoundaryIncidentReport(stream, options = {}) {
  const actualBoundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  const expectedBoundary = normalizeBoundaryContext({
    workspace: options.expectedWorkspace ?? options.workspace ?? actualBoundary.workspace,
    tenant: options.expectedTenant ?? options.tenant ?? actualBoundary.tenant,
    role: options.expectedRole ?? options.role ?? actualBoundary.role,
    permissions: options.permissions ?? actualBoundary.permissions,
    auditChannel: options.auditChannel ?? actualBoundary.auditChannel,
    localOnly: options.localOnly ?? actualBoundary.localOnly,
  });
  const boundaryReport = createTokenStreamBoundaryReport(stream, {
    workspace: actualBoundary.workspace,
    tenant: actualBoundary.tenant,
    role: actualBoundary.role,
    permissions: options.permissions ?? actualBoundary.permissions,
    auditChannel: options.auditChannel ?? actualBoundary.auditChannel,
    requiredPermissions: options.requiredPermissions ?? [],
  });
  const mismatches = compareBoundary(expectedBoundary, actualBoundary);
  const missingScope = Object.entries(boundaryReport.checks)
    .filter(([, check]) => check.status === "missing")
    .map(([key]) => key);
  const unsafeScope = Object.entries(boundaryReport.checks)
    .filter(([, check]) => check.status === "unsafe")
    .map(([key]) => key);
  const diagnostics = Object.freeze([
    ...unsafeScope.map((key) => stableDiagnostic(createDiagnostic(
      "TOKEN_STREAM_UNSAFE_BOUNDARY_SCOPE",
      `Token stream ${key} boundary is unsafe.`,
      currentToken(stream),
      "error",
    ))),
    ...missingScope.map((key) => stableDiagnostic(createDiagnostic(
      "TOKEN_STREAM_MISSING_BOUNDARY_SCOPE",
      `Token stream ${key} boundary is missing.`,
      currentToken(stream),
      "error",
    ))),
    ...mismatches.map((entry) => stableDiagnostic(createDiagnostic(
      "TOKEN_STREAM_EXPECTED_BOUNDARY_MISMATCH",
      `Token stream ${entry.key} boundary expected '${entry.expected}' but found '${entry.actual}'.`,
      currentToken(stream),
      "error",
    ))),
    ...boundaryReport.missingPermissions.map((permission) => stableDiagnostic(createDiagnostic(
      "TOKEN_STREAM_MISSING_BOUNDARY_PERMISSION",
      `Token stream boundary is missing permission '${permission}'.`,
      currentToken(stream),
      "error",
    ))),
  ]);
  const blocked = diagnostics.length > 0 || !boundaryReport.ok;
  const status = !blocked
    ? "clear"
    : unsafeScope.length > 0 || mismatches.length > 0
      ? "tenant-isolation-blocked"
      : boundaryReport.missingPermissions.length > 0
        ? "permission-blocked"
        : "scope-incomplete";
  const handoffReady = !blocked && (boundaryReport.audit.status === "audit-ready" || !boundaryReport.audit.required);
  const incidentId = stableBoundaryIncidentId(stream, actualBoundary, status);

  return Object.freeze({
    schema: "aios.token.stream.boundary-incident.v1",
    incidentId,
    sourceId: stream?.metadata?.sourceId ?? null,
    cursor: normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
    status,
    blocked,
    severity: blocked ? "error" : "info",
    boundary: actualBoundary,
    expectedBoundary,
    checks: boundaryReport.checks,
    mismatches,
    missingScope: Object.freeze(missingScope),
    unsafeScope: Object.freeze(unsafeScope),
    missingPermissions: boundaryReport.missingPermissions,
    diagnostics,
    audit: Object.freeze({
      channel: boundaryReport.audit.channel,
      required: blocked || boundaryReport.audit.required,
      status: boundaryReport.audit.channel
        ? "audit-ready"
        : blocked || boundaryReport.audit.required
          ? "audit-channel-missing"
          : "audit-optional",
      handoff: blocked ? "hold-boundary-incident" : "emit-boundary-clear",
    }),
    controls: Object.freeze({
      canRetryAutomatically: false,
      canContinueDegraded: !blocked,
      canHandoffParser: handoffReady,
      canExportAudit: Boolean(boundaryReport.audit.channel),
    }),
    report: Object.freeze({
      label: blocked ? "Boundary incident" : "Boundary clear",
      summary: blocked
        ? `${status}:${diagnostics.length}`
        : "clear",
      nextAction: blocked
        ? unsafeScope.length > 0
          ? `narrow-${unsafeScope[0]}`
          : missingScope.length > 0
            ? `declare-${missingScope[0]}`
            : boundaryReport.missingPermissions.length > 0
              ? "review-role-permissions"
              : "reload-token-checkpoint"
        : "continue",
    }),
    nextAction: blocked
      ? unsafeScope.length > 0
        ? `narrow-${unsafeScope[0]}`
        : missingScope.length > 0
          ? `declare-${missingScope[0]}`
          : boundaryReport.missingPermissions.length > 0
            ? "review-role-permissions"
            : "reload-token-checkpoint"
      : "continue",
  });
}

export function createTokenStreamTenantBoundaryReadiness(stream, options = {}) {
  const requiredPermissions = stableStringSet(options.requiredPermissions ?? []);
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    workspace: options.workspace ?? stream?.metadata?.workspace ?? stream?.metadata?.boundary?.workspace,
    tenant: options.tenant ?? stream?.metadata?.tenant ?? stream?.metadata?.boundary?.tenant,
    role: options.role ?? stream?.metadata?.role ?? stream?.metadata?.boundary?.role,
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel,
    localOnly: options.localOnly ?? stream?.metadata?.localOnly ?? stream?.metadata?.boundary?.localOnly,
  });
  const boundaryReport = createTokenStreamBoundaryReport(stream, {
    workspace: boundary.workspace,
    tenant: boundary.tenant,
    role: boundary.role,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions,
  });
  const incident = createTokenStreamBoundaryIncidentReport(stream, {
    expectedWorkspace: options.expectedWorkspace ?? boundary.workspace,
    expectedTenant: options.expectedTenant ?? boundary.tenant,
    expectedRole: options.expectedRole ?? boundary.role,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions,
  });
  const missing = Object.freeze([
    boundaryReport.checks.workspace.ok ? null : "workspace",
    boundaryReport.checks.tenant.ok ? null : "tenant",
    boundaryReport.checks.role.ok ? null : "role",
    boundaryReport.missingPermissions.length === 0 ? null : "permissions",
    incident.mismatches.length === 0 ? null : "expected-boundary",
    boundaryReport.audit.status === "audit-ready" || !boundaryReport.audit.required ? null : "audit-channel",
  ].filter(Boolean));
  const accepted = missing.length === 0 && !incident.blocked;
  const firstMissing = missing[0] ?? null;
  const readinessId = stableBoundaryIncidentId(stream, boundary, accepted ? "ready" : firstMissing ?? "review");

  return Object.freeze({
    schema: "aios.token.stream.tenant-boundary-readiness.v1",
    readinessId,
    sourceId: stream?.metadata?.sourceId ?? null,
    accepted,
    status: accepted
      ? "tenant-boundary-ready"
      : firstMissing === "permissions"
        ? "permission-review"
        : firstMissing === "expected-boundary"
          ? incident.status
          : firstMissing === "audit-channel"
            ? "audit-review"
            : "scope-review",
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
      isolationKey: [
        "token-tenant-boundary",
        boundary.workspace ?? "workspace",
        boundary.tenant ?? "tenant",
        boundary.role ?? "role",
        stream?.metadata?.sourceId ?? "anonymous-source",
      ].map((part) => String(part).trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":"),
    }),
    permissions: Object.freeze({
      required: requiredPermissions,
      granted: boundary.permissions,
      missing: boundaryReport.missingPermissions,
    }),
    audit: boundaryReport.audit,
    incident: Object.freeze({
      incidentId: incident.incidentId,
      status: incident.status,
      blocked: incident.blocked,
      mismatches: incident.mismatches,
      missingScope: incident.missingScope,
      unsafeScope: incident.unsafeScope,
    }),
    validationSummary: Object.freeze({
      scopeReady: boundaryReport.checks.workspace.ok && boundaryReport.checks.tenant.ok && boundaryReport.checks.role.ok,
      permissionsReady: boundaryReport.missingPermissions.length === 0,
      expectedBoundaryReady: incident.mismatches.length === 0,
      auditReady: boundaryReport.audit.status === "audit-ready" || !boundaryReport.audit.required,
      missing,
    }),
    controls: Object.freeze({
      canHandoffParser: accepted,
      canRetryAutomatically: false,
      canContinueDegraded: accepted,
      canExportAudit: Boolean(boundaryReport.audit.channel),
    }),
    exportSummary: Object.freeze({
      readinessId,
      status: accepted ? "tenant-boundary-ready" : "tenant-boundary-review",
      missing,
      firstMissing,
      nextAction: accepted
        ? "continue"
        : firstMissing === "workspace"
          ? boundaryReport.checks.workspace.nextAction
          : firstMissing === "tenant"
            ? boundaryReport.checks.tenant.nextAction
            : firstMissing === "role"
              ? boundaryReport.checks.role.nextAction
              : firstMissing === "permissions"
                ? "review-role-permissions"
                : firstMissing === "audit-channel"
                  ? "declare-audit-channel"
                  : incident.nextAction,
    }),
    nextAction: accepted
      ? "continue"
      : firstMissing === "workspace"
        ? boundaryReport.checks.workspace.nextAction
        : firstMissing === "tenant"
          ? boundaryReport.checks.tenant.nextAction
          : firstMissing === "role"
            ? boundaryReport.checks.role.nextAction
            : firstMissing === "permissions"
              ? "review-role-permissions"
              : firstMissing === "audit-channel"
                ? "declare-audit-channel"
                : incident.nextAction,
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
  const boundaryIncident = createTokenStreamBoundaryIncidentReport(stream, options);
  const tenantBoundaryReadiness = createTokenStreamTenantBoundaryReadiness(stream, {
    ...options,
    permissions: options.permissions ?? actualBoundary.permissions,
    auditChannel: options.auditChannel ?? actualBoundary.auditChannel,
    requiredPermissions: options.requiredPermissions ?? [],
  });
  const blocking = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const recoveries = Object.freeze(diagnostics.map(classifyStreamDiagnostic));
  const actionableErrors = createStreamActionableErrors(diagnostics);
  const checkpoint = createTokenCheckpoint(stream, options.reason ?? "token-stream-health");
  const cursor = normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length);
  const commandLag = Array.from(stream?.metadata?.appliedCommands ?? []).length;
  const boundaryBlocked = !boundaryReport.ok || expectedMismatches.length > 0 || !tenantBoundaryReadiness.accepted;
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
    boundaryIncident,
    tenantBoundaryReadiness,
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
      ? tenantBoundaryReadiness.nextAction ?? boundaryIncident.nextAction
      : failed
        ? actionableErrors[0]?.nextAction ?? "surface-token-error"
        : degraded
          ? "continue-with-token-warnings"
          : "continue",
  });
}

function escalationStatus(health, incident, readiness) {
  if (readiness.accepted && !incident.blocked && health.ok) {
    return "clear";
  }

  if (incident.unsafeScope.length > 0 || incident.mismatches.length > 0) {
    return "tenant-isolation-blocked";
  }

  if (readiness.permissions.missing.length > 0) {
    return "permission-escalation";
  }

  if (readiness.validationSummary.auditReady === false) {
    return "audit-escalation";
  }

  if (!health.ok) {
    return health.status;
  }

  return "boundary-review";
}

function escalationSeverity(status, health, incident) {
  if (status === "clear") {
    return "info";
  }

  if (status === "audit-escalation" || health.status === "degraded") {
    return "warning";
  }

  if (incident.blocked || !health.ok) {
    return "error";
  }

  return "warning";
}

function createBoundaryEscalationCommand(kind, stream, boundary, payload = {}) {
  return Object.freeze({
    id: stableCommandId(`boundary-${kind}`, normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length), payload),
    kind,
    cursor: normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
    sourceId: stream?.metadata?.sourceId ?? null,
    boundary,
    payload: Object.freeze(Object.fromEntries(Object.entries(payload)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)))),
  });
}

export function createTokenStreamBoundaryEscalationPacket(stream, options = {}) {
  const health = options.health ?? createTokenStreamHealthReport(stream, {
    ...options,
    reason: options.reason ?? "token-stream-boundary-escalation",
  });
  const incident = options.boundaryIncident ?? health.boundaryIncident ?? createTokenStreamBoundaryIncidentReport(stream, options);
  const readiness = options.tenantBoundaryReadiness ?? health.tenantBoundaryReadiness ?? createTokenStreamTenantBoundaryReadiness(stream, options);
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel,
    localOnly: options.localOnly ?? stream?.metadata?.localOnly ?? stream?.metadata?.boundary?.localOnly,
  });
  const status = escalationStatus(health, incident, readiness);
  const severity = escalationSeverity(status, health, incident);
  const blocked = status !== "clear";
  const missing = Object.freeze([
    ...readiness.validationSummary.missing,
    ...incident.unsafeScope.map((key) => `unsafe-${key}`),
    ...incident.mismatches.map((entry) => `mismatch-${entry.key}`),
  ].filter((value, index, values) => value && values.indexOf(value) === index).sort());
  const primaryAction = blocked
    ? incident.nextAction !== "continue" ? incident.nextAction : readiness.nextAction
    : "continue";
  const auditRequired = blocked || health.boundary.audit.required || readiness.audit.required;
  const auditReady = Boolean(boundary.auditChannel) || readiness.audit.status === "audit-ready" || health.boundary.audit.status === "audit-ready";
  const commands = Object.freeze([
    createBoundaryEscalationCommand("hold-handoff", stream, boundary, {
      status,
      incidentId: incident.incidentId,
      readinessId: readiness.readinessId,
      reason: blocked ? primaryAction : "boundary-clear",
    }),
    blocked
      ? createBoundaryEscalationCommand("request-operator-review", stream, boundary, {
          status,
          severity,
          missing: missing.join(","),
          nextAction: primaryAction,
        })
      : createBoundaryEscalationCommand("release-handoff", stream, boundary, {
          readinessId: readiness.readinessId,
          nextAction: "continue",
        }),
    auditRequired
      ? createBoundaryEscalationCommand("emit-audit", stream, boundary, {
          auditChannel: boundary.auditChannel,
          auditStatus: auditReady ? "audit-ready" : "audit-channel-missing",
          incidentId: incident.incidentId,
        })
      : null,
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.token.stream.boundary-escalation.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    cursor: normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
    status,
    severity,
    blocked,
    boundary,
    incident: Object.freeze({
      incidentId: incident.incidentId,
      status: incident.status,
      blocked: incident.blocked,
      missingScope: incident.missingScope,
      unsafeScope: incident.unsafeScope,
      mismatches: incident.mismatches,
      missingPermissions: incident.missingPermissions,
    }),
    readiness: Object.freeze({
      readinessId: readiness.readinessId,
      accepted: readiness.accepted,
      status: readiness.status,
      missing: readiness.validationSummary.missing,
      permissions: readiness.permissions,
      audit: readiness.audit,
    }),
    health: Object.freeze({
      ok: health.ok,
      status: health.status,
      retry: health.retry,
      degradedMode: health.degradedMode,
      nextAction: health.nextAction,
    }),
    audit: Object.freeze({
      channel: boundary.auditChannel ?? readiness.audit.channel ?? health.boundary.audit.channel,
      required: auditRequired,
      status: auditReady
        ? "audit-ready"
        : auditRequired
          ? "audit-channel-missing"
          : "audit-optional",
      handoff: blocked ? "hold-boundary-escalation" : "emit-boundary-clear",
    }),
    commands,
    controls: Object.freeze({
      canHandoffParser: !blocked && readiness.controls.canHandoffParser,
      canRetryAutomatically: false,
      canContinueDegraded: !blocked && health.degradedMode.enabled,
      canExportAudit: auditReady,
      canReleaseHandoff: !blocked,
    }),
    exportSummary: Object.freeze({
      sourceId: stream?.metadata?.sourceId ?? null,
      status: blocked ? status : "boundary-clear",
      severity,
      missing,
      commandCount: commands.length,
      nextAction: blocked ? primaryAction : "continue",
    }),
    nextAction: blocked ? primaryAction : "continue",
  });
}

function executionBoundaryControlId(stream, boundary, phase) {
  return [
    "token-execution-boundary",
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    boundary.role ?? "role",
    phase,
    normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function normalizeExecutionBoundarySchedule(options = {}) {
  const enabled = options.enabled !== false;
  const schedule = ["immediate", "on-source-update", "manual", "disabled"].includes(options.schedule)
    ? options.schedule
    : enabled ? "immediate" : "disabled";
  const maxAttempts = Number.isInteger(options.maxAttempts)
    ? Math.min(Math.max(0, options.maxAttempts), 10)
    : 2;
  const attemptsUsed = Number.isInteger(options.attemptsUsed)
    ? Math.max(0, options.attemptsUsed)
    : 0;
  const retryAfterMs = Number.isInteger(options.retryAfterMs)
    ? Math.min(Math.max(0, options.retryAfterMs), 60000)
    : schedule === "immediate" ? 0 : 250;

  return Object.freeze({
    enabled,
    schedule: enabled ? schedule : "disabled",
    maxAttempts: enabled ? maxAttempts : 0,
    attemptsUsed,
    attemptsRemaining: enabled ? Math.max(0, maxAttempts - attemptsUsed) : 0,
    retryAfterMs: enabled && schedule !== "manual" && schedule !== "disabled" ? retryAfterMs : null,
  });
}

function executionBoundaryStage(label, accepted, status, nextAction, references = {}) {
  return Object.freeze({
    schema: "aios.token.stream.execution-boundary.stage.v1",
    label,
    accepted,
    status,
    nextAction,
    references: Object.freeze(Object.fromEntries(Object.entries(references)
      .filter(([, value]) => value !== undefined && value !== null)
      .sort(([left], [right]) => left.localeCompare(right)))),
  });
}

export function createTokenStreamExecutionBoundaryControl(stream, options = {}) {
  const health = options.health ?? createTokenStreamHealthReport(stream, {
    ...options,
    reason: options.reason ?? "token-execution-boundary-control",
  });
  const readiness = options.tenantBoundaryReadiness ?? health.tenantBoundaryReadiness ?? createTokenStreamTenantBoundaryReadiness(stream, options);
  const escalation = options.boundaryEscalation ?? createTokenStreamBoundaryEscalationPacket(stream, {
    ...options,
    health,
    tenantBoundaryReadiness: readiness,
    boundaryIncident: options.boundaryIncident ?? health.boundaryIncident,
    reason: options.reason ?? "token-execution-boundary-control",
  });
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel,
    localOnly: options.localOnly ?? stream?.metadata?.localOnly ?? stream?.metadata?.boundary?.localOnly,
  });
  const schedule = normalizeExecutionBoundarySchedule(options);
  const statusChannel = stableBoundaryValue(options.statusChannel ?? stream?.metadata?.statusChannel ?? boundary.auditChannel);
  const auditReady = escalation.audit.status === "audit-ready" || readiness.audit.status === "audit-ready" || !escalation.audit.required;
  const healthReady = health.ok || (options.allowDegraded === true && health.degradedMode.enabled);
  const enabledReady = schedule.enabled && schedule.schedule !== "disabled";
  const ready = enabledReady
    && readiness.accepted
    && !escalation.blocked
    && healthReady
    && Boolean(statusChannel)
    && auditReady;
  const stages = Object.freeze([
    executionBoundaryStage("lifecycle", enabledReady, enabledReady ? "enabled" : "disabled", enabledReady ? "continue" : "enable-execution-boundary", {
      schedule: schedule.schedule,
    }),
    executionBoundaryStage("tenant-boundary", readiness.accepted, readiness.status, readiness.nextAction, {
      readinessId: readiness.readinessId,
    }),
    executionBoundaryStage("boundary-escalation", !escalation.blocked, escalation.status, escalation.nextAction, {
      commandCount: escalation.commands.length,
    }),
    executionBoundaryStage("token-health", healthReady, health.status, health.nextAction, {
      degraded: health.degradedMode.enabled,
    }),
    executionBoundaryStage("status-channel", Boolean(statusChannel), statusChannel ? "status-ready" : "status-channel-missing", statusChannel ? "continue" : "declare-status-channel", {
      channel: statusChannel,
    }),
    executionBoundaryStage("audit", auditReady, escalation.audit.status, auditReady ? "continue" : "declare-audit-channel", {
      channel: escalation.audit.channel,
    }),
  ]);
  const blockedStage = stages.find((stage) => !stage.accepted) ?? null;
  const phase = ready
    ? "ready"
    : blockedStage?.label === "lifecycle"
      ? "disabled"
      : blockedStage?.label === "token-health" && health.degradedMode.enabled
        ? "degraded"
        : "blocked";
  const controlId = executionBoundaryControlId(stream, boundary, phase);
  const retryable = !ready
    && !escalation.blocked
    && health.retry.maxAttempts > 0
    && schedule.attemptsRemaining > 0
    && schedule.schedule !== "manual"
    && schedule.schedule !== "disabled";
  const retryAfterMs = retryable
    ? Math.max(schedule.retryAfterMs ?? 0, health.retry.retryAfterMs ?? 0)
    : null;

  return Object.freeze({
    schema: "aios.token.stream.execution-boundary-control.v1",
    controlId,
    sourceId: stream?.metadata?.sourceId ?? null,
    cursor: normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
    ready,
    phase,
    status: ready
      ? "execution-boundary-ready"
      : blockedStage?.label === "lifecycle"
        ? "execution-boundary-disabled"
        : blockedStage?.label === "status-channel"
          ? "status-channel-missing"
          : blockedStage?.label === "audit"
            ? "audit-channel-missing"
            : blockedStage?.status ?? "execution-boundary-review",
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
      isolationKey: readiness.boundary.isolationKey,
    }),
    permissions: readiness.permissions,
    schedule,
    stages,
    blockedStage,
    audit: Object.freeze({
      channel: escalation.audit.channel ?? boundary.auditChannel,
      required: escalation.audit.required,
      status: auditReady ? "audit-ready" : "audit-channel-missing",
    }),
    statusChannel,
    retry: Object.freeze({
      retryable,
      strategy: retryable ? health.retry.strategy : "none",
      retryAfterMs,
      attemptsRemaining: retryable ? schedule.attemptsRemaining : 0,
    }),
    commands: Object.freeze([
      Object.freeze({
        id: `${controlId}:hold`,
        kind: ready ? "release-execution-boundary" : "hold-execution-boundary",
        idempotent: true,
        writesProvider: false,
        status: ready ? "ready" : "blocked",
        nextAction: ready ? "handoff-parser" : blockedStage?.nextAction ?? "review-execution-boundary",
      }),
      Object.freeze({
        id: `${controlId}:status`,
        kind: "emit-execution-boundary-status",
        idempotent: true,
        writesProvider: false,
        channel: statusChannel,
        status: statusChannel ? "ready" : "blocked",
        nextAction: statusChannel ? "emit-status" : "declare-status-channel",
      }),
      retryable
        ? Object.freeze({
            id: `${controlId}:retry`,
            kind: "schedule-execution-boundary-retry",
            idempotent: true,
            writesProvider: false,
            retryAfterMs,
            status: "ready",
            nextAction: "schedule-retry",
          })
        : null,
    ].filter(Boolean)),
    controls: Object.freeze({
      canHandoffParser: ready,
      canRunNow: ready && schedule.schedule === "immediate",
      canScheduleRetry: retryable,
      canResume: schedule.enabled && schedule.schedule === "manual" && !escalation.blocked,
      canDisable: schedule.enabled,
      canExportAudit: auditReady,
      canContinueDegraded: !ready && options.allowDegraded === true && health.degradedMode.enabled && !escalation.blocked,
    }),
    exportSummary: Object.freeze({
      controlId,
      status: ready ? "execution-boundary-ready" : "execution-boundary-review",
      phase,
      blockedStage: blockedStage?.label ?? null,
      missing: Object.freeze(stages.filter((stage) => !stage.accepted).map((stage) => stage.label)),
      retryAfterMs,
      nextAction: ready ? "handoff-parser" : blockedStage?.nextAction ?? "review-execution-boundary",
    }),
    nextAction: ready ? "handoff-parser" : blockedStage?.nextAction ?? "review-execution-boundary",
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

function stableJournalId(kind, sourceId, cursor, sequence = 0) {
  return [
    "token-restart-journal",
    kind,
    sourceId ?? "anonymous-source",
    cursor,
    sequence,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function normalizeRestartJournalEntry(entry, index, boundary) {
  const kind = String(entry?.kind ?? "note");
  const cursor = Number.isInteger(entry?.cursor) ? Math.max(0, entry.cursor) : 0;
  const entryBoundary = normalizeBoundaryContext({
    workspace: entry?.workspace ?? entry?.boundary?.workspace ?? boundary.workspace,
    tenant: entry?.tenant ?? entry?.boundary?.tenant ?? boundary.tenant,
    role: entry?.role ?? entry?.boundary?.role ?? boundary.role,
    permissions: entry?.permissions ?? entry?.boundary?.permissions ?? boundary.permissions,
    auditChannel: entry?.auditChannel ?? entry?.boundary?.auditChannel ?? boundary.auditChannel,
    localOnly: entry?.localOnly ?? entry?.boundary?.localOnly ?? boundary.localOnly,
  });
  const payload = Object.freeze(Object.fromEntries(Object.entries(entry?.payload ?? {})
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))));
  const safeId = entry?.id ?? stableJournalId(kind, entry?.sourceId, cursor, index);

  return Object.freeze({
    schema: "aios.token.stream.restart-journal.entry.v1",
    id: safeId,
    sequence: Number.isInteger(entry?.sequence) ? Math.max(0, entry.sequence) : index,
    kind,
    cursor,
    sourceId: entry?.sourceId ?? null,
    boundary: entryBoundary,
    payload,
    status: entry?.status ?? "recorded",
    nextAction: entry?.nextAction ?? "continue",
  });
}

function appliedCommandJournalEntries(stream, boundary) {
  return Object.freeze(Array.from(stream?.metadata?.appliedCommands ?? []).map((id, index) => {
    const [, , kind = "command"] = String(id).split(":");
    return normalizeRestartJournalEntry({
      id,
      kind: `command:${kind}`,
      sequence: index,
      cursor: stream?.cursor ?? 0,
      sourceId: stream?.metadata?.sourceId ?? null,
      boundary,
      payload: Object.freeze({ commandId: id }),
      status: "applied",
      nextAction: "replay-if-missing",
    }, index, boundary);
  }));
}

function journalEntryCounters(entries) {
  const byKind = {};
  const byStatus = {};
  for (const entry of entries ?? []) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
  }

  return Object.freeze({
    total: Array.from(entries ?? []).length,
    byKind: Object.freeze(Object.fromEntries(Object.entries(byKind).sort(([left], [right]) => left.localeCompare(right)))),
    byStatus: Object.freeze(Object.fromEntries(Object.entries(byStatus).sort(([left], [right]) => left.localeCompare(right)))),
  });
}

export function createTokenStreamRestartJournal(stream, options = {}) {
  const tokens = Array.from(stream?.tokens ?? []);
  const boundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  const checkpoint = createTokenCheckpoint(stream, options.reason ?? "token-stream-restart-journal");
  const boundaryReport = createTokenStreamBoundaryReport(stream, {
    workspace: boundary.workspace,
    tenant: boundary.tenant,
    role: boundary.role,
    permissions: options.permissions ?? boundary.permissions,
    auditChannel: options.auditChannel ?? boundary.auditChannel,
    requiredPermissions: options.requiredPermissions ?? [],
  });
  const sourceId = stream?.metadata?.sourceId ?? null;
  const cursor = normalizeCursor(stream?.cursor, tokens.length);
  const baseEntries = [
    normalizeRestartJournalEntry({
      kind: "checkpoint",
      sequence: 0,
      cursor: checkpoint.cursor,
      sourceId,
      boundary,
      payload: Object.freeze({
        restartSafe: checkpoint.restartSafe,
        restoreCommandId: checkpoint.clientState.restoreCommand.id,
      }),
      status: checkpoint.restartSafe ? "restart-safe" : "checkpoint-review",
      nextAction: checkpoint.restartSafe ? "restore-token-cursor" : checkpoint.summary?.nextAction,
    }, 0, boundary),
    normalizeRestartJournalEntry({
      kind: "boundary",
      sequence: 1,
      cursor,
      sourceId,
      boundary,
      payload: Object.freeze({
        status: boundaryReport.status,
        missingPermissions: boundaryReport.missingPermissions.join(","),
      }),
      status: boundaryReport.ok ? "scoped" : boundaryReport.status,
      nextAction: boundaryReport.ok ? "continue" : boundaryReport.nextAction,
    }, 1, boundary),
    normalizeRestartJournalEntry({
      kind: "status",
      sequence: 2,
      cursor,
      sourceId,
      boundary,
      payload: Object.freeze({
        handoff: stream?.metadata?.handoff ?? "parser",
        auditChannel: boundary.auditChannel,
      }),
      status: boundary.auditChannel || options.statusChannel ? "observable" : "status-channel-missing",
      nextAction: boundary.auditChannel || options.statusChannel ? "emit-restart-status" : "declare-status-channel",
    }, 2, boundary),
  ];
  const commandEntries = appliedCommandJournalEntries(stream, boundary).map((entry, index) => Object.freeze({
    ...entry,
    sequence: baseEntries.length + index,
  }));
  const extraEntries = Array.from(options.entries ?? []).map((entry, index) => normalizeRestartJournalEntry(
    {
      ...entry,
      sourceId: entry?.sourceId ?? sourceId,
      cursor: entry?.cursor ?? cursor,
    },
    baseEntries.length + commandEntries.length + index,
    boundary,
  ));
  const entries = Object.freeze([...baseEntries, ...commandEntries, ...extraEntries]
    .map((entry, index) => Object.freeze({ ...entry, sequence: index })));
  const duplicateIds = entries
    .map((entry) => entry.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  const blockedEntries = entries.filter((entry) => ["boundary-review", "permission-review", "status-channel-missing", "checkpoint-review"].includes(entry.status));
  const restartSafe = checkpoint.restartSafe && boundaryReport.ok && duplicateIds.length === 0 && blockedEntries.length === 0;

  return Object.freeze({
    schema: "aios.token.stream.restart-journal.v1",
    sourceId,
    journalId: stableJournalId("stream", sourceId, cursor, entries.length),
    cursor,
    boundary,
    entries,
    counters: journalEntryCounters(entries),
    checkpoint: Object.freeze({
      cursor: checkpoint.cursor,
      restartSafe: checkpoint.restartSafe,
      restoreCommand: checkpoint.clientState.restoreCommand,
    }),
    validation: Object.freeze({
      restartSafe,
      boundaryOk: boundaryReport.ok,
      duplicateIds: Object.freeze([...new Set(duplicateIds)].sort()),
      blockedEntryIds: Object.freeze(blockedEntries.map((entry) => entry.id)),
      missingPermissions: boundaryReport.missingPermissions,
    }),
    audit: Object.freeze({
      channel: boundary.auditChannel ?? options.auditChannel ?? null,
      required: !restartSafe || entries.some((entry) => entry.kind.startsWith("command:")),
      status: boundary.auditChannel || options.auditChannel
        ? "audit-ready"
        : !restartSafe || entries.some((entry) => entry.kind.startsWith("command:"))
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    exportSummary: Object.freeze({
      sourceId,
      journalId: stableJournalId("stream", sourceId, cursor, entries.length),
      entryCount: entries.length,
      restartSafe,
      status: restartSafe ? "restart-journal-ready" : blockedEntries[0]?.status ?? "restart-journal-review",
      nextAction: restartSafe
        ? "persist-restart-journal"
        : blockedEntries[0]?.nextAction ?? (duplicateIds.length > 0 ? "dedupe-restart-journal" : boundaryReport.nextAction),
    }),
    nextAction: restartSafe
      ? "persist-restart-journal"
      : blockedEntries[0]?.nextAction ?? (duplicateIds.length > 0 ? "dedupe-restart-journal" : boundaryReport.nextAction),
  });
}

export function createTokenStreamHistorySnapshot(stream, options = {}) {
  const tokens = Object.freeze(Array.from(stream?.tokens ?? []).map(stableToken));
  const diagnostics = Object.freeze(Array.from(stream?.diagnostics ?? []).map(stableDiagnostic));
  const boundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  const checkpoint = createTokenCheckpoint(stream, options.reason ?? "token-stream-history");
  const boundaryIncident = createTokenStreamBoundaryIncidentReport(stream, options);
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
    boundaryIncident,
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
      restartSafe: checkpoint.restartSafe && !boundaryIncident.blocked,
      boundaryIncident: boundaryIncident.status,
      nextAction: checkpoint.restartSafe && !boundaryIncident.blocked ? "export-token-history" : boundaryIncident.blocked ? boundaryIncident.nextAction : checkpointNextAction,
    }),
    nextAction: checkpoint.restartSafe && !boundaryIncident.blocked ? "export-token-history" : boundaryIncident.blocked ? boundaryIncident.nextAction : checkpointNextAction,
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
      boundaryIncident: health.boundaryIncident.status,
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
      boundaryIncident: health.boundaryIncident.status,
      nextAction: exportReady ? "publish-token-stream-report" : health.nextAction,
    }),
    nextAction: exportReady ? "publish-token-stream-report" : health.nextAction,
  });
}

function timelineArtifactStatus(artifact) {
  return artifact?.status
    ?? artifact?.exportSummary?.status
    ?? (artifact?.accepted === true || artifact?.ready === true ? "ready" : "review");
}

function timelineArtifactAccepted(artifact) {
  if (typeof artifact?.accepted === "boolean") {
    return artifact.accepted;
  }

  if (typeof artifact?.ready === "boolean") {
    return artifact.ready;
  }

  if (typeof artifact?.ok === "boolean") {
    return artifact.ok;
  }

  return !["blocked", "review", "missing", "disabled"].some((part) => timelineArtifactStatus(artifact).includes(part));
}

function timelineArtifactAuditChannel(artifact) {
  return artifact?.audit?.channel
    ?? artifact?.auditChannel
    ?? artifact?.parserHandoff?.auditChannel
    ?? artifact?.sync?.auditChannel
    ?? artifact?.exportSummary?.auditChannel
    ?? null;
}

function normalizeMailchimpTimelineArtifact(artifact, index, stream) {
  const label = String(artifact?.label ?? artifact?.source ?? artifact?.schema ?? `artifact-${index}`).trim() || `artifact-${index}`;
  const status = timelineArtifactStatus(artifact);
  const accepted = timelineArtifactAccepted(artifact);
  const blocked = artifact?.blocked === true || !accepted;
  const retryable = artifact?.retryable === true
    || artifact?.controls?.canRetryAutomatically === true
    || artifact?.controls?.canReplayRestart === true
    || artifact?.controls?.canReplayRestore === true;
  const auditChannel = timelineArtifactAuditChannel(artifact);
  const references = Object.freeze(Object.fromEntries(Object.entries({
    id: artifact?.id ?? artifact?.manifestId ?? artifact?.ledgerId ?? artifact?.gateId ?? artifact?.packetId ?? artifact?.envelopeId,
    syncKey: artifact?.syncKey ?? artifact?.sync?.syncKey ?? artifact?.parserHandoff?.syncKey,
    nextAction: artifact?.nextAction ?? artifact?.exportSummary?.nextAction,
    cursor: Number.isInteger(artifact?.cursor) ? artifact.cursor : normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
    auditChannel,
    blockedGate: artifact?.blockedGate ?? artifact?.exportSummary?.blockedGate ?? artifact?.exportSummary?.firstBlocked,
  }).filter(([, value]) => value !== undefined && value !== null && value !== "")));

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-operational-timeline.artifact.v1",
    index,
    label,
    status,
    accepted,
    blocked,
    retryable,
    severity: blocked ? status.includes("audit") ? "warning" : "error" : "info",
    auditChannel,
    references,
    nextAction: accepted ? "continue" : artifact?.nextAction ?? artifact?.exportSummary?.nextAction ?? "review-mailchimp-artifact",
  });
}

function mailchimpTimelineId(stream, operation, artifacts) {
  const boundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  return [
    "mailchimp-operational-timeline",
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    boundary.role ?? "role",
    operation,
    normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
    artifacts.length,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

export function createTokenStreamMailchimpOperationalTimeline(stream, artifacts = [], options = {}) {
  const operation = String(options.operation ?? "syncAudience").trim() || "syncAudience";
  const requiredPermissions = stableStringSet([
    ...(options.requiredPermissions ?? []),
    operation === "fetchAudience" || operation === "syncAudience" ? "mailchimp.read" : null,
    ["syncAudience", "upsertCampaign", "createCampaign", "scheduleCampaign"].includes(operation) ? "mailchimp.write" : null,
  ].filter(Boolean));
  const health = options.health ?? createTokenStreamHealthReport(stream, {
    ...options,
    requiredPermissions,
    reason: options.reason ?? "mailchimp-operational-timeline",
  });
  const analytics = options.analytics ?? createTokenStreamAnalyticsReport(stream, {
    ...options,
    requiredPermissions,
    reason: options.reason ?? "mailchimp-operational-timeline",
  });
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    requiredPermissions,
    reason: options.reason ?? "mailchimp-operational-timeline",
  });
  const normalizedArtifacts = Object.freeze(Array.from(artifacts ?? [])
    .map((artifact, index) => normalizeMailchimpTimelineArtifact(artifact, index, stream)));
  const baseArtifacts = Object.freeze([
    normalizeMailchimpTimelineArtifact({
      label: "token-health",
      status: health.status,
      accepted: health.ok,
      blocked: !health.ok,
      retryable: health.retry.maxAttempts > 0,
      nextAction: health.nextAction,
      audit: health.boundary.audit,
      cursor: health.cursor,
    }, normalizedArtifacts.length, stream),
    normalizeMailchimpTimelineArtifact({
      label: "token-analytics",
      status: analytics.exportSummary.status,
      accepted: analytics.ok,
      blocked: !analytics.ok,
      nextAction: analytics.nextAction,
      audit: Object.freeze({
        channel: analytics.history?.boundary?.auditChannel
          ?? analytics.boundaryEscalation?.audit?.channel
          ?? stream?.metadata?.auditChannel
          ?? stream?.metadata?.boundary?.auditChannel
          ?? null,
      }),
      cursor: analytics.exportSummary.cursor,
    }, normalizedArtifacts.length + 1, stream),
    normalizeMailchimpTimelineArtifact({
      label: "restart-journal",
      status: restartJournal.exportSummary.status,
      accepted: restartJournal.validation.restartSafe,
      blocked: !restartJournal.validation.restartSafe,
      retryable: restartJournal.validation.blockedEntryIds.length > 0,
      nextAction: restartJournal.nextAction,
      audit: restartJournal.audit,
      id: restartJournal.journalId,
      cursor: restartJournal.cursor,
    }, normalizedArtifacts.length + 2, stream),
  ]);
  const stages = Object.freeze([...normalizedArtifacts, ...baseArtifacts]);
  const blocked = Object.freeze(stages.filter((stage) => stage.blocked));
  const retryable = Object.freeze(stages.filter((stage) => stage.retryable));
  const auditChannels = Object.freeze([...new Set(stages.map((stage) => stage.auditChannel).filter(Boolean))].sort());
  const timelineId = mailchimpTimelineId(stream, operation, stages);
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel,
  });
  const ready = blocked.length === 0 && health.ok && analytics.ok && restartJournal.validation.restartSafe;
  const firstBlocked = blocked[0] ?? null;

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-operational-timeline.v1",
    timelineId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: "mailchimp",
    operation,
    ready,
    status: ready
      ? "mailchimp-operational-timeline-ready"
      : firstBlocked?.status ?? health.status,
    cursor: normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
    }),
    requiredPermissions,
    stages,
    counters: Object.freeze({
      total: stages.length,
      blocked: blocked.length,
      retryable: retryable.length,
      auditChannels: auditChannels.length,
      diagnostics: analytics.counters.diagnosticCount,
      commands: analytics.counters.commandCount,
    }),
    recovery: Object.freeze({
      restartSafe: restartJournal.validation.restartSafe,
      journalId: restartJournal.journalId,
      retryAfterMs: retryable.length > 0 ? health.retry.retryAfterMs : null,
      strategy: ready ? "none" : retryable.length > 0 ? health.retry.strategy : "operator-review",
      restoreCommand: restartJournal.checkpoint.restoreCommand,
    }),
    audit: Object.freeze({
      channels: auditChannels,
      required: blocked.length > 0 || requiredPermissions.length > 0,
      status: auditChannels.length > 0
        ? "audit-ready"
        : blocked.length > 0 || requiredPermissions.length > 0
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    exportSummary: Object.freeze({
      timelineId,
      status: ready ? "mailchimp-operational-timeline-ready" : "mailchimp-operational-timeline-review",
      operation,
      firstBlocked: firstBlocked?.label ?? null,
      blockedCount: blocked.length,
      retryableCount: retryable.length,
      restartSafe: restartJournal.validation.restartSafe,
      nextAction: ready ? "publish-mailchimp-operational-timeline" : firstBlocked?.nextAction ?? health.nextAction,
    }),
    nextAction: ready ? "publish-mailchimp-operational-timeline" : firstBlocked?.nextAction ?? health.nextAction,
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

function stableMailchimpAudienceValue(...values) {
  for (const value of values) {
    const normalized = stableBoundaryValue(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeMailchimpAudienceSyncOptions(options = {}, stream = null) {
  const metadata = stream?.metadata ?? {};
  const boundary = metadata.boundary ?? {};
  const mergeFields = Object.freeze(Object.fromEntries(Object.entries(options.mergeFields ?? metadata.mailchimpMergeFields ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [String(key).trim(), String(value).trim()])
    .filter(([key, value]) => key !== "" && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))));
  const requiredMergeFields = stableStringSet(options.requiredMergeFields ?? ["EMAIL"]);
  const audienceId = stableMailchimpAudienceValue(
    options.audienceId,
    options.listId,
    metadata.mailchimpAudienceId,
    metadata.mailchimpListId,
    boundary.mailchimpAudienceId,
    boundary.mailchimpListId,
  );
  const segmentId = stableMailchimpAudienceValue(
    options.segmentId,
    metadata.mailchimpSegmentId,
    boundary.mailchimpSegmentId,
  );
  const operation = String(options.operation ?? "syncAudience").trim() || "syncAudience";

  return Object.freeze({
    audienceId,
    listId: audienceId,
    segmentId,
    operation,
    adapter: options.adapter ?? `mailchimp.${operation}`,
    acceptedBy: stableBoundaryValue(options.acceptedBy),
    statusChannel: stableBoundaryValue(options.statusChannel),
    auditChannel: stableBoundaryValue(options.auditChannel),
    idempotencyKey: stableBoundaryValue(options.idempotencyKey),
    externalTraceId: stableBoundaryValue(options.externalTraceId),
    scheduledAt: stableBoundaryValue(options.scheduledAt),
    consentField: stableBoundaryValue(options.consentField ?? metadata.mailchimpConsentField),
    consentRequired: options.consentRequired !== false,
    mergeFields,
    requiredMergeFields,
    audienceRevision: stableBoundaryValue(options.audienceRevision ?? metadata.mailchimpAudienceRevision),
    mode: ["preview", "manual", "scheduled", "immediate"].includes(options.mode) ? options.mode : "manual",
    dryRun: options.dryRun !== false,
    allowMutatingSync: options.allowMutatingSync === true,
    enabled: options.enabled !== false,
  });
}

function mailchimpAudienceSyncKey(sync, boundary, stream) {
  return [
    "mailchimp-audience-sync",
    sync.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    boundary.role ?? "role",
    sync.audienceId ?? "audience",
    sync.segmentId ?? "all",
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function mailchimpAudienceScheduleStatus(sync) {
  if (!sync.enabled) {
    return Object.freeze({
      status: "disabled",
      accepted: false,
      nextAction: "enable-mailchimp-audience-sync",
    });
  }

  if (sync.mode === "scheduled" && !sync.scheduledAt) {
    return Object.freeze({
      status: "schedule-missing",
      accepted: false,
      nextAction: "declare-mailchimp-sync-schedule",
    });
  }

  if (sync.mode === "preview") {
    return Object.freeze({
      status: "preview-only",
      accepted: true,
      nextAction: "accept-mailchimp-audience-preview",
    });
  }

  return Object.freeze({
    status: sync.mode === "scheduled" ? "scheduled" : sync.mode === "immediate" ? "ready-now" : "manual",
    accepted: true,
    nextAction: sync.mode === "immediate" ? "run-mailchimp-audience-sync" : "queue-mailchimp-audience-sync",
  });
}

function normalizeMailchimpOperatorGateOptions(options = {}, stream = null) {
  const metadata = stream?.metadata ?? {};
  const providerOptions = normalizeProviderServiceOptions({
    ...options,
    provider: options.provider ?? "mailchimp",
    operation: options.operation ?? "syncAudience",
    adapter: options.adapter ?? `mailchimp.${options.operation ?? "syncAudience"}`,
  });
  const mode = ["preview", "manual", "scheduled", "immediate", "disabled"].includes(options.mode)
    ? options.mode
    : options.enabled === false || providerOptions.enabled === false
      ? "disabled"
      : providerOptions.scheduledAt || options.scheduledAt
        ? "scheduled"
        : "manual";
  const dryRun = options.dryRun ?? metadata.mailchimpDryRun ?? mode === "preview";
  const allowMutatingSync = options.allowMutatingSync ?? metadata.allowMutatingMailchimpSync ?? false;
  const mutating = providerOptions.provider === "mailchimp"
    && ["syncAudience", "upsertCampaign", "createCampaign", "scheduleCampaign"].includes(providerOptions.operation)
    && dryRun === false
    && allowMutatingSync === true;

  return Object.freeze({
    adapter: providerOptions.adapter,
    provider: providerOptions.provider,
    operation: providerOptions.operation,
    mode,
    enabled: mode !== "disabled" && providerOptions.enabled,
    dryRun,
    allowMutatingSync,
    mutating,
    acceptedBy: stableBoundaryValue(options.acceptedBy ?? providerOptions.acceptedBy),
    scheduledAt: stableBoundaryValue(options.scheduledAt ?? providerOptions.scheduledAt),
    statusChannel: stableBoundaryValue(options.statusChannel ?? providerOptions.statusChannel),
    auditChannel: stableBoundaryValue(options.auditChannel ?? providerOptions.auditChannel),
    idempotencyKey: stableBoundaryValue(options.idempotencyKey ?? metadata.idempotencyKey),
    reason: stableBoundaryValue(options.reason) ?? "mailchimp-operator-gate",
  });
}

function mailchimpControlPlaneId(stream, service, boundary, schedule) {
  return [
    "mailchimp-control-plane",
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    boundary.role ?? "role",
    service.operation,
    schedule.mode,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function normalizeMailchimpControlPlaneOptions(options = {}, stream = null) {
  const metadata = stream?.metadata ?? {};
  const service = normalizeProviderServiceOptions({
    ...options,
    provider: "mailchimp",
    operation: options.operation ?? "syncAudience",
    adapter: options.adapter ?? `mailchimp.${options.operation ?? "syncAudience"}`,
    enabled: options.enabled ?? options.mailchimpEnabled,
  });
  const mutating = ["syncAudience", "upsertCampaign", "createCampaign", "scheduleCampaign"].includes(service.operation);
  const dryRun = options.dryRun ?? metadata.mailchimpDryRun ?? true;
  const allowMutatingSync = options.allowMutatingSync ?? metadata.allowMutatingMailchimpSync ?? false;
  const enabled = service.enabled && options.mailchimpEnabled !== false;
  const mode = ["preview", "manual", "scheduled", "immediate", "disabled"].includes(options.mode)
    ? options.mode
    : !enabled
      ? "disabled"
      : options.scheduledAt || service.scheduledAt
        ? "scheduled"
        : mutating ? "manual" : "preview";

  return Object.freeze({
    service,
    schedule: Object.freeze({
      mode: enabled ? mode : "disabled",
      enabled,
      scheduledAt: stableBoundaryValue(options.scheduledAt ?? service.scheduledAt),
      dryRun,
      allowMutatingSync,
      mutating,
      idempotencyKey: stableBoundaryValue(options.idempotencyKey ?? metadata.idempotencyKey),
      acceptedBy: stableBoundaryValue(options.acceptedBy ?? service.acceptedBy),
      statusChannel: stableBoundaryValue(options.statusChannel ?? service.statusChannel),
      auditChannel: stableBoundaryValue(options.auditChannel ?? service.auditChannel),
    }),
  });
}

export function createTokenStreamMailchimpControlPlane(stream, options = {}) {
  const { service, schedule } = normalizeMailchimpControlPlaneOptions(options, stream);
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: schedule.auditChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel,
  });
  const serviceContract = options.serviceContract ?? createTokenStreamProviderServiceContract(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    requiredPermissions: service.requiredPermissions,
    auditChannel: boundary.auditChannel,
    statusChannel: schedule.statusChannel ?? boundary.auditChannel,
    acceptedBy: schedule.acceptedBy,
    enabled: schedule.enabled,
    scheduledAt: schedule.scheduledAt,
    reason: options.reason ?? "mailchimp-control-plane-service",
  });
  const lifecycleManifest = options.lifecycleManifest ?? createTokenStreamProviderLifecycleManifest(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    requiredPermissions: service.requiredPermissions,
    auditChannel: boundary.auditChannel,
    statusChannel: schedule.statusChannel ?? serviceContract.sync.statusChannel,
    acceptedBy: schedule.acceptedBy,
    lifecycleEnabled: schedule.enabled,
    lifecycleSchedule: schedule.mode === "disabled" ? "disabled" : schedule.mode === "preview" ? "manual" : schedule.mode,
    scheduledAt: schedule.scheduledAt,
    serviceContract,
    reason: options.reason ?? "mailchimp-control-plane-lifecycle",
  });
  const operatorGate = options.operatorGate ?? createTokenStreamMailchimpOperatorGate(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    requiredPermissions: service.requiredPermissions,
    auditChannel: boundary.auditChannel,
    statusChannel: schedule.statusChannel ?? serviceContract.sync.statusChannel,
    acceptedBy: schedule.acceptedBy,
    enabled: schedule.enabled,
    mode: schedule.mode,
    scheduledAt: schedule.scheduledAt,
    dryRun: schedule.dryRun,
    allowMutatingSync: schedule.allowMutatingSync,
    idempotencyKey: schedule.idempotencyKey,
    acceptanceSummary: options.acceptanceSummary,
    reason: options.reason ?? "mailchimp-control-plane-operator-gate",
  });
  const previewAcceptance = options.acceptanceSummary ?? serviceContract.acceptance;
  const statusReady = Boolean(schedule.statusChannel ?? serviceContract.sync.statusChannel);
  const auditReady = Boolean(boundary.auditChannel ?? serviceContract.sync.auditChannel) || !serviceContract.acceptance.audit.required;
  const scheduleReady = schedule.mode !== "scheduled" || Boolean(schedule.scheduledAt);
  const mutationAllowed = !schedule.mutating || schedule.dryRun === true || schedule.allowMutatingSync === true;
  const idempotencyReady = !schedule.mutating || schedule.dryRun === true || Boolean(schedule.idempotencyKey);
  const acceptedByReady = schedule.mode === "preview" || Boolean(schedule.acceptedBy);
  const missing = Object.freeze([
    schedule.enabled ? null : "mailchimp-enabled",
    serviceContract.acceptance.accepted ? null : "provider-service-acceptance",
    lifecycleManifest.accepted ? null : "provider-lifecycle",
    operatorGate.accepted ? null : "operator-gate",
    statusReady ? null : "status-channel",
    auditReady ? null : "audit-channel",
    scheduleReady ? null : "schedule",
    mutationAllowed ? null : "mutating-sync-control",
    idempotencyReady ? null : "idempotency-key",
    acceptedByReady ? null : "operator-acceptance",
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const blocked = missing[0] ?? null;
  const controlId = mailchimpControlPlaneId(stream, service, boundary, schedule);

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-control-plane.v1",
    controlId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: service.provider,
    operation: service.operation,
    adapter: service.adapter,
    accepted,
    status: accepted
      ? schedule.mode === "scheduled" ? "scheduled" : schedule.mode === "preview" ? "preview-ready" : "ready"
      : blocked === "mailchimp-enabled"
        ? "disabled"
        : blocked === "status-channel"
          ? "status-review"
          : blocked === "audit-channel"
            ? "audit-review"
            : blocked === "schedule"
              ? "schedule-review"
              : blocked === "mutating-sync-control"
                ? "mutation-control-review"
                : blocked === "idempotency-key"
                  ? "idempotency-review"
                  : blocked === "operator-acceptance"
                    ? "operator-acceptance-required"
                    : blocked === "provider-lifecycle"
                      ? lifecycleManifest.status
                      : operatorGate.status,
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
    }),
    schedule,
    validationSummary: Object.freeze({
      enabled: schedule.enabled,
      serviceAccepted: serviceContract.acceptance.accepted,
      lifecycleReady: lifecycleManifest.accepted,
      operatorGateReady: operatorGate.accepted,
      statusReady,
      auditReady,
      scheduleReady,
      mutationAllowed,
      idempotencyReady,
      operatorAccepted: acceptedByReady,
      missing,
    }),
    controls: Object.freeze({
      canEnable: !schedule.enabled,
      canDisable: schedule.enabled,
      canPreview: schedule.enabled && serviceContract.preview.health.ok,
      canAccept: serviceContract.acceptance.controls.canAccept && statusReady && auditReady,
      canSchedule: schedule.enabled && scheduleReady && mutationAllowed && idempotencyReady,
      canRunNow: accepted && schedule.mode === "immediate",
      canRunScheduled: accepted && schedule.mode === "scheduled",
      canHandoffParser: accepted,
      canEmitStatus: statusReady,
      canExportAudit: auditReady,
    }),
    packets: Object.freeze({
      service: serviceContract.exportSummary,
      lifecycle: lifecycleManifest.exportSummary,
      operatorGate: operatorGate.exportSummary,
      acceptance: previewAcceptance.exportSummary ?? null,
    }),
    exportSummary: Object.freeze({
      controlId,
      status: accepted ? "mailchimp-control-ready" : "mailchimp-control-review",
      mode: schedule.mode,
      blocked,
      missing,
      nextAction: accepted
        ? schedule.mode === "scheduled" ? "schedule-mailchimp-handoff" : "handoff-mailchimp-runtime"
        : blocked === "mailchimp-enabled"
          ? "enable-mailchimp-control-plane"
          : blocked === "status-channel"
            ? "declare-status-channel"
            : blocked === "audit-channel"
              ? "declare-audit-channel"
              : blocked === "schedule"
                ? "declare-mailchimp-schedule"
                : blocked === "mutating-sync-control"
                  ? "enable-mutating-mailchimp-sync-or-dry-run"
                  : blocked === "idempotency-key"
                    ? "declare-idempotency-key"
                    : blocked === "operator-acceptance"
                      ? "accept-mailchimp-runtime-preview"
                      : blocked === "provider-lifecycle"
                        ? lifecycleManifest.nextAction
                        : operatorGate.nextAction,
    }),
    serviceContract,
    lifecycleManifest,
    operatorGate,
    nextAction: accepted
      ? schedule.mode === "scheduled" ? "schedule-mailchimp-handoff" : "handoff-mailchimp-runtime"
      : blocked === "mailchimp-enabled"
        ? "enable-mailchimp-control-plane"
        : blocked === "status-channel"
          ? "declare-status-channel"
          : blocked === "audit-channel"
            ? "declare-audit-channel"
            : blocked === "schedule"
              ? "declare-mailchimp-schedule"
              : blocked === "mutating-sync-control"
                ? "enable-mutating-mailchimp-sync-or-dry-run"
                : blocked === "idempotency-key"
                  ? "declare-idempotency-key"
                  : blocked === "operator-acceptance"
                    ? "accept-mailchimp-runtime-preview"
                    : blocked === "provider-lifecycle"
                      ? lifecycleManifest.nextAction
                      : operatorGate.nextAction,
  });
}

function mailchimpOperatorGateId(stream, gate) {
  const boundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  return [
    "mailchimp-operator-gate",
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    boundary.role ?? "role",
    gate.operation,
    gate.mode,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

export function createTokenStreamMailchimpOperatorGate(stream, options = {}) {
  const gate = normalizeMailchimpOperatorGateOptions(options, stream);
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: gate.auditChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel,
  });
  const requiredPermissions = stableStringSet([
    ...(options.requiredPermissions ?? []),
    gate.operation === "fetchAudience" || gate.operation === "syncAudience" ? "mailchimp.read" : null,
    ["syncAudience", "upsertCampaign", "createCampaign", "scheduleCampaign"].includes(gate.operation) ? "mailchimp.write" : null,
  ].filter(Boolean));
  const boundaryReadiness = createTokenStreamTenantBoundaryReadiness(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions,
  });
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions,
    reason: gate.reason,
  });
  const acceptance = options.acceptanceSummary ?? createTokenStreamProviderAcceptanceSummary(stream, {
    ...options,
    adapter: gate.adapter,
    provider: gate.provider,
    operation: gate.operation,
    permissions: boundary.permissions,
    requiredPermissions,
    auditChannel: boundary.auditChannel,
    statusChannel: gate.statusChannel ?? boundary.auditChannel,
    acceptedBy: gate.acceptedBy,
    enabled: gate.enabled,
    scheduledAt: gate.scheduledAt,
    reason: gate.reason,
  });
  const scheduleReady = gate.mode !== "scheduled" || Boolean(gate.scheduledAt);
  const operatorReady = gate.mode === "preview" || Boolean(gate.acceptedBy);
  const statusReady = Boolean(gate.statusChannel ?? acceptance.preview.statusChannel);
  const auditReady = Boolean(gate.auditChannel ?? acceptance.preview.audit.channel) || acceptance.validationSummary.auditReady;
  const idempotencyReady = !gate.mutating || Boolean(gate.idempotencyKey);
  const missing = Object.freeze([
    gate.enabled ? null : "mailchimp-operator-enabled",
    health.ok ? null : "healthy-token-stream",
    boundaryReadiness.accepted ? null : "tenant-boundary",
    acceptance.validationSummary.capabilitiesAccepted ? null : "provider-capabilities",
    acceptance.validationSummary.previewAccepted || gate.mode === "preview" ? null : "preview-acceptance",
    operatorReady ? null : "operator-acceptance",
    scheduleReady ? null : "schedule",
    statusReady ? null : "status-channel",
    auditReady ? null : "audit-channel",
    idempotencyReady ? null : "idempotency-key",
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const firstMissing = missing[0] ?? null;

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-operator-gate.v1",
    gateId: mailchimpOperatorGateId(stream, gate),
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: gate.provider,
    operation: gate.operation,
    adapter: gate.adapter,
    mode: gate.mode,
    accepted,
    status: accepted
      ? gate.mode === "preview" ? "preview-ready" : "operator-gate-ready"
      : firstMissing === "mailchimp-operator-enabled"
        ? "disabled"
        : firstMissing === "tenant-boundary"
          ? boundaryReadiness.status
          : firstMissing === "provider-capabilities"
            ? "capability-review"
            : firstMissing === "operator-acceptance" || firstMissing === "preview-acceptance"
              ? "operator-acceptance-required"
              : firstMissing === "schedule"
                ? "schedule-review"
                : firstMissing === "idempotency-key"
                  ? "idempotency-review"
                  : firstMissing === "status-channel"
                    ? "status-review"
                    : firstMissing === "audit-channel"
                      ? "audit-review"
                      : health.status,
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      readinessId: boundaryReadiness.readinessId,
    }),
    schedule: Object.freeze({
      mode: gate.mode,
      enabled: gate.enabled,
      scheduledAt: gate.scheduledAt,
      dryRun: gate.dryRun,
      allowMutatingSync: gate.allowMutatingSync,
      mutating: gate.mutating,
    }),
    acceptance: Object.freeze({
      acceptedBy: gate.acceptedBy,
      providerAccepted: acceptance.accepted,
      status: acceptance.status,
      nextAction: acceptance.nextAction,
    }),
    channels: Object.freeze({
      status: gate.statusChannel ?? acceptance.preview.statusChannel,
      audit: gate.auditChannel ?? acceptance.preview.audit.channel,
    }),
    validationSummary: Object.freeze({
      enabled: gate.enabled,
      tokenStreamReady: health.ok,
      boundaryReady: boundaryReadiness.accepted,
      capabilitiesAccepted: acceptance.validationSummary.capabilitiesAccepted,
      previewAccepted: acceptance.validationSummary.previewAccepted || gate.mode === "preview",
      operatorAccepted: operatorReady,
      scheduleReady,
      statusReady,
      auditReady,
      idempotencyReady,
      missing,
    }),
    controls: Object.freeze({
      canEnable: !gate.enabled,
      canDisable: gate.enabled,
      canPreview: health.ok && boundaryReadiness.accepted,
      canAccept: gate.enabled && health.ok && boundaryReadiness.accepted && acceptance.controls.canAccept,
      canSchedule: gate.enabled && gate.mode !== "disabled" && operatorReady && idempotencyReady,
      canRunNow: accepted && gate.mode === "immediate",
      canRunScheduled: accepted && gate.mode === "scheduled",
      canHandoffParser: accepted,
    }),
    exportSummary: Object.freeze({
      gateId: mailchimpOperatorGateId(stream, gate),
      status: accepted ? "mailchimp-operator-gate-ready" : "mailchimp-operator-gate-review",
      mode: gate.mode,
      missing,
      nextAction: accepted
        ? gate.mode === "scheduled" ? "schedule-mailchimp-handoff" : gate.mode === "preview" ? "show-mailchimp-preview" : "handoff-mailchimp-provider"
        : firstMissing === "mailchimp-operator-enabled"
          ? "enable-mailchimp-operator-gate"
          : firstMissing === "tenant-boundary"
            ? boundaryReadiness.nextAction
            : firstMissing === "provider-capabilities"
              ? "align-provider-capabilities"
              : firstMissing === "operator-acceptance" || firstMissing === "preview-acceptance"
                ? "accept-mailchimp-preview"
                : firstMissing === "schedule"
                  ? "declare-mailchimp-schedule"
                  : firstMissing === "status-channel"
                    ? "declare-status-channel"
                    : firstMissing === "audit-channel"
                      ? "declare-audit-channel"
                      : firstMissing === "idempotency-key"
                        ? "declare-idempotency-key"
                        : health.nextAction,
    }),
    nextAction: accepted
      ? gate.mode === "scheduled" ? "schedule-mailchimp-handoff" : gate.mode === "preview" ? "show-mailchimp-preview" : "handoff-mailchimp-provider"
      : firstMissing === "mailchimp-operator-enabled"
        ? "enable-mailchimp-operator-gate"
        : firstMissing === "tenant-boundary"
          ? boundaryReadiness.nextAction
          : firstMissing === "provider-capabilities"
            ? "align-provider-capabilities"
            : firstMissing === "operator-acceptance" || firstMissing === "preview-acceptance"
              ? "accept-mailchimp-preview"
              : firstMissing === "schedule"
                ? "declare-mailchimp-schedule"
                : firstMissing === "status-channel"
                  ? "declare-status-channel"
                  : firstMissing === "audit-channel"
                    ? "declare-audit-channel"
                    : firstMissing === "idempotency-key"
                      ? "declare-idempotency-key"
                      : health.nextAction,
  });
}

function createMailchimpAudienceSyncManifest(sync, serviceContract, executionIntent, schedule, stream) {
  const providedMergeFields = Object.keys(sync.mergeFields);
  const missingMergeFields = Object.freeze(sync.requiredMergeFields
    .filter((field) => !providedMergeFields.includes(field)));
  const consentReady = !sync.consentRequired || Boolean(sync.consentField);
  const revisionReady = sync.dryRun || Boolean(sync.audienceRevision);
  const mutating = sync.allowMutatingSync && !sync.dryRun;
  const payloadFingerprint = [
    sync.audienceId ?? "audience",
    sync.segmentId ?? "all",
    sync.audienceRevision ?? "revision",
    ...Object.entries(sync.mergeFields).map(([key, value]) => `${key}:${value}`),
  ].map((part) => String(part).trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
  const missing = Object.freeze([
    sync.audienceId ? null : "mailchimp-audience-id",
    missingMergeFields.length === 0 ? null : "required-merge-fields",
    consentReady ? null : "consent-field",
    revisionReady ? null : "audience-revision",
    schedule.accepted ? null : schedule.status,
    serviceContract.acceptance.accepted ? null : "preview-acceptance",
    executionIntent.accepted ? null : "execution-intent",
  ].filter(Boolean));
  const accepted = missing.length === 0;

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-audience-sync.manifest.v1",
    manifestId: [
      "mailchimp-sync-manifest",
      serviceContract.sync.syncKey,
      payloadFingerprint,
    ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":"),
    sourceId: stream?.metadata?.sourceId ?? null,
    accepted,
    status: accepted
      ? "manifest-ready"
      : missing.includes("required-merge-fields")
        ? "merge-field-review"
        : missing.includes("consent-field")
          ? "consent-review"
          : missing.includes("audience-revision")
            ? "revision-review"
            : missing.includes("preview-acceptance")
              ? serviceContract.acceptance.status
              : missing.includes("execution-intent")
                ? executionIntent.status
                : schedule.status,
    payload: Object.freeze({
      audienceId: sync.audienceId,
      segmentId: sync.segmentId,
      mergeFields: sync.mergeFields,
      requiredMergeFields: sync.requiredMergeFields,
      missingMergeFields,
      consentField: sync.consentField,
      consentRequired: sync.consentRequired,
      audienceRevision: sync.audienceRevision,
      fingerprint: payloadFingerprint,
    }),
    delivery: Object.freeze({
      mode: sync.mode,
      dryRun: sync.dryRun,
      mutating,
      allowMutatingSync: sync.allowMutatingSync,
      scheduledAt: sync.scheduledAt,
      idempotencyKey: sync.idempotencyKey,
      externalTraceId: sync.externalTraceId ?? executionIntent.sync.externalTraceId,
      statusChannel: executionIntent.sync.statusChannel,
      auditChannel: executionIntent.sync.auditChannel,
    }),
    validationSummary: Object.freeze({
      audienceReady: Boolean(sync.audienceId),
      mergeFieldsReady: missingMergeFields.length === 0,
      consentReady,
      revisionReady,
      scheduleReady: schedule.accepted,
      previewAccepted: serviceContract.acceptance.accepted,
      executionIntentReady: executionIntent.accepted,
      missing,
    }),
    controls: Object.freeze({
      canPreviewPayload: Boolean(sync.audienceId) && missingMergeFields.length === 0,
      canAcceptManifest: accepted && serviceContract.acceptance.controls.canAccept,
      canRunDryRun: accepted && sync.dryRun,
      canRunMutatingSync: accepted && mutating,
      canEmitExternalStatus: Boolean(executionIntent.sync.statusChannel),
    }),
    nextAction: accepted
      ? schedule.nextAction
      : missing.includes("mailchimp-audience-id")
        ? "declare-mailchimp-audience-id"
        : missing.includes("required-merge-fields")
          ? "map-mailchimp-required-fields"
          : missing.includes("consent-field")
            ? "declare-mailchimp-consent-field"
            : missing.includes("audience-revision")
              ? "declare-mailchimp-audience-revision"
              : missing.includes("preview-acceptance")
                ? serviceContract.acceptance.nextAction
                : missing.includes("execution-intent")
                  ? executionIntent.nextAction
                  : schedule.nextAction,
  });
}

export function createTokenStreamMailchimpAudienceSyncContract(stream, options = {}) {
  const syncOptions = normalizeMailchimpAudienceSyncOptions(options, stream);
  const requiredCapabilities = Object.freeze([
    "audit",
    "checkpoint",
    "external-status",
    "provider-read",
    syncOptions.allowMutatingSync ? "provider-write" : null,
    syncOptions.allowMutatingSync ? "idempotency" : null,
  ].filter(Boolean));
  const serviceContract = options.serviceContract ?? createTokenStreamProviderServiceContract(stream, {
    ...options,
    adapter: syncOptions.adapter,
    provider: "mailchimp",
    operation: syncOptions.operation,
    requestedCapabilities: requiredCapabilities,
    requiredPermissions: syncOptions.allowMutatingSync
      ? ["mailchimp.read", "mailchimp.write"]
      : ["mailchimp.read"],
    auditChannel: syncOptions.auditChannel ?? options.auditChannel,
    statusChannel: syncOptions.statusChannel ?? options.statusChannel ?? syncOptions.auditChannel,
    acceptedBy: syncOptions.acceptedBy,
    enabled: syncOptions.enabled,
    scheduledAt: syncOptions.scheduledAt,
    reason: options.reason ?? "mailchimp-audience-sync-contract",
  });
  const executionIntent = options.executionIntent ?? createTokenStreamExecutionIntentPacket(stream, {
    ...options,
    adapter: syncOptions.adapter,
    provider: "mailchimp",
    operation: syncOptions.operation,
    requestedCapabilities: requiredCapabilities,
    requiredPermissions: syncOptions.allowMutatingSync
      ? ["mailchimp.read", "mailchimp.write"]
      : ["mailchimp.read"],
    auditChannel: syncOptions.auditChannel ?? serviceContract.sync.auditChannel,
    statusChannel: syncOptions.statusChannel ?? serviceContract.sync.statusChannel,
    acceptedBy: syncOptions.acceptedBy,
    idempotencyKey: syncOptions.idempotencyKey,
    serviceContract,
    clientRoute: options.clientRoute ?? "mailchimp-audience-sync",
    reason: options.reason ?? "mailchimp-audience-sync-intent",
  });
  const boundary = serviceContract.boundary;
  const schedule = mailchimpAudienceScheduleStatus(syncOptions);
  const syncKey = mailchimpAudienceSyncKey(syncOptions, boundary, stream);
  const mutating = syncOptions.allowMutatingSync && !syncOptions.dryRun;
  const manifest = createMailchimpAudienceSyncManifest(syncOptions, serviceContract, executionIntent, schedule, stream);
  const audienceReady = Boolean(syncOptions.audienceId);
  const dryRunReady = syncOptions.dryRun || syncOptions.allowMutatingSync;
  const idempotencyReady = !mutating || Boolean(syncOptions.idempotencyKey)
    || serviceContract.negotiation.supportedCapabilities.includes("idempotency");
  const missing = Object.freeze([
    audienceReady ? null : "mailchimp-audience-id",
    serviceContract.negotiation.accepted ? null : "provider-capability-negotiation",
    serviceContract.acceptance.accepted ? null : "preview-acceptance",
    executionIntent.accepted ? null : "execution-intent",
    manifest.accepted ? null : manifest.validationSummary.missing[0] ?? "sync-manifest",
    schedule.accepted ? null : schedule.status,
    dryRunReady ? null : "mutating-sync-confirmation",
    idempotencyReady ? null : "idempotency-key",
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const commandId = stableCommandId("mailchimp-audience-sync", stream?.cursor ?? 0, {
    syncKey,
    audienceId: syncOptions.audienceId,
    segmentId: syncOptions.segmentId,
    mode: syncOptions.mode,
  });

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-audience-sync.contract.v1",
    syncKey,
    sourceId: stream?.metadata?.sourceId ?? null,
    accepted,
    status: accepted
      ? "audience-sync-ready"
      : missing.includes("mailchimp-audience-id")
        ? "audience-review"
        : missing.includes("execution-intent")
          ? executionIntent.status
          : missing.includes("preview-acceptance")
            ? serviceContract.acceptance.status
            : missing.includes("mutating-sync-confirmation")
              ? "dry-run-review"
              : missing.includes("idempotency-key")
                ? "idempotency-review"
                : schedule.status,
    audience: Object.freeze({
      audienceId: syncOptions.audienceId,
      listId: syncOptions.listId,
      segmentId: syncOptions.segmentId,
      dryRun: syncOptions.dryRun,
      mutating,
      audienceRevision: syncOptions.audienceRevision,
    }),
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
    }),
    provider: Object.freeze({
      adapter: serviceContract.service.adapter,
      operation: serviceContract.service.operation,
      requiredPermissions: serviceContract.negotiation.requiredPermissions,
      missingPermissions: serviceContract.negotiation.missingPermissions,
    }),
    schedule: Object.freeze({
      mode: syncOptions.mode,
      scheduledAt: syncOptions.scheduledAt,
      status: schedule.status,
      nextAction: schedule.nextAction,
    }),
    sync: Object.freeze({
      syncKey,
      providerSyncKey: serviceContract.sync.syncKey,
      executionIntentKey: executionIntent.intentKey,
      statusChannel: executionIntent.sync.statusChannel,
      auditChannel: executionIntent.sync.auditChannel,
      externalTraceId: syncOptions.externalTraceId ?? executionIntent.sync.externalTraceId,
      checkpointCursor: serviceContract.sync.checkpointCursor,
      manifestId: manifest.manifestId,
    }),
    manifest,
    command: Object.freeze({
      id: commandId,
      kind: "mailchimp-audience-sync",
      idempotent: !mutating || idempotencyReady,
      writesProvider: mutating,
      payloadFingerprint: manifest.payload.fingerprint,
      status: accepted ? "ready" : "blocked",
      nextAction: accepted ? schedule.nextAction : "resolve-mailchimp-audience-sync",
    }),
    validationSummary: Object.freeze({
      audienceReady,
      mergeFieldsReady: manifest.validationSummary.mergeFieldsReady,
      consentReady: manifest.validationSummary.consentReady,
      revisionReady: manifest.validationSummary.revisionReady,
      capabilityReady: serviceContract.negotiation.accepted,
      previewAccepted: serviceContract.acceptance.accepted,
      executionIntentReady: executionIntent.accepted,
      manifestReady: manifest.accepted,
      scheduleReady: schedule.accepted,
      dryRunReady,
      idempotencyReady,
      missing,
    }),
    controls: Object.freeze({
      canPreview: serviceContract.preview.health.ok,
      canAccept: serviceContract.acceptance.controls.canAccept && audienceReady,
      canSchedule: serviceContract.acceptance.controls.canSchedule && audienceReady && schedule.status !== "schedule-missing",
      canRunDryRun: accepted && syncOptions.dryRun,
      canRunMutatingSync: accepted && mutating,
      canEmitStatus: Boolean(executionIntent.sync.statusChannel),
    }),
    serviceContract,
    executionIntent,
    exportSummary: Object.freeze({
      syncKey,
      status: accepted ? "audience-sync-ready" : "audience-sync-review",
      audienceId: syncOptions.audienceId,
      segmentId: syncOptions.segmentId,
      manifestId: manifest.manifestId,
      payloadFingerprint: manifest.payload.fingerprint,
      missing,
      commandId,
      nextAction: accepted
        ? schedule.nextAction
        : missing.includes("mailchimp-audience-id")
          ? "declare-mailchimp-audience-id"
          : missing.includes("execution-intent")
            ? executionIntent.nextAction
            : missing.includes("preview-acceptance")
              ? serviceContract.acceptance.nextAction
              : missing.includes("mutating-sync-confirmation")
                ? "confirm-mutating-mailchimp-sync"
                : missing.includes("idempotency-key")
                  ? "declare-idempotency-key"
                  : schedule.nextAction,
    }),
    nextAction: accepted
      ? schedule.nextAction
      : missing.includes("mailchimp-audience-id")
        ? "declare-mailchimp-audience-id"
        : missing.includes("execution-intent")
          ? executionIntent.nextAction
          : missing.includes("preview-acceptance")
            ? serviceContract.acceptance.nextAction
            : missing.includes("mutating-sync-confirmation")
              ? "confirm-mutating-mailchimp-sync"
              : missing.includes("idempotency-key")
                ? "declare-idempotency-key"
                : schedule.nextAction,
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

function externalHandoffManifestId(service, boundary, stream) {
  return [
    "external-handoff-manifest",
    service.provider,
    service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    boundary.role ?? "role",
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function createProviderExternalHandoffManifest(service, boundary, stream, health, analytics, negotiation, acceptance, syncKey) {
  const checkpointReady = analytics.history.checkpoint.restartSafe;
  const statusReady = Boolean(acceptance.statusChannel);
  const auditReady = !acceptance.audit.required || acceptance.audit.status === "audit-ready";
  const manifestId = externalHandoffManifestId(service, boundary, stream);
  const missing = Object.freeze([
    service.enabled ? null : "service-enabled",
    health.ok ? null : "healthy-token-stream",
    checkpointReady ? null : "restart-safe-checkpoint",
    negotiation.accepted ? null : "capability-negotiation",
    statusReady ? null : "external-status-channel",
    auditReady ? null : "audit-channel",
    acceptance.accepted ? null : "preview-acceptance",
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const handoffCommandId = stableCommandId("external-provider-handoff", analytics.history.cursor, {
    manifestId,
    provider: service.provider,
    operation: service.operation,
    syncKey,
  });
  const observeCommandId = stableCommandId("external-status-observe", analytics.history.cursor, {
    provider: service.provider,
    operation: service.operation,
    statusChannel: acceptance.statusChannel,
  });

  return Object.freeze({
    schema: "aios.token.stream.external-handoff-manifest.v1",
    manifestId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: service.provider,
    operation: service.operation,
    adapter: service.adapter,
    accepted,
    status: accepted
      ? "handoff-manifest-ready"
      : missing.includes("capability-negotiation")
        ? negotiation.status
        : missing.includes("preview-acceptance")
          ? acceptance.status
          : missing.includes("healthy-token-stream")
            ? health.status
            : "handoff-manifest-review",
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
    }),
    sync: Object.freeze({
      syncKey,
      cursor: analytics.history.cursor,
      checkpointCursor: analytics.history.checkpoint.cursor,
      statusChannel: acceptance.statusChannel,
      auditChannel: acceptance.audit.channel,
      externalTraceId: service.externalTraceId ?? syncKey,
    }),
    permissions: Object.freeze({
      required: negotiation.requiredPermissions,
      granted: negotiation.grantedPermissions,
      missing: negotiation.missingPermissions,
    }),
    commands: Object.freeze([
      Object.freeze({
        id: handoffCommandId,
        kind: "external-provider-handoff",
        idempotent: !negotiation.requiredPermissions.includes(`${service.provider}.write`)
          && !negotiation.requiredPermissions.includes("mailchimp.write"),
        writesProvider: negotiation.requiredPermissions.includes("mailchimp.write"),
        statusChannel: acceptance.statusChannel,
        auditChannel: acceptance.audit.channel,
        status: accepted ? "ready" : "blocked",
      }),
      Object.freeze({
        id: observeCommandId,
        kind: "external-status-observe",
        idempotent: true,
        writesProvider: false,
        statusChannel: acceptance.statusChannel,
        auditChannel: acceptance.audit.channel,
        status: statusReady ? "ready" : "blocked",
      }),
    ]),
    validationSummary: Object.freeze({
      healthReady: health.ok,
      analyticsReady: analytics.ok,
      checkpointReady,
      capabilityReady: negotiation.accepted,
      statusReady,
      auditReady,
      previewAccepted: acceptance.accepted,
      missing,
    }),
    controls: Object.freeze({
      canPreview: health.ok,
      canAccept: acceptance.controls.canAccept,
      canPersist: checkpointReady && statusReady,
      canPublishManifest: accepted,
      canHandoffProvider: accepted,
    }),
    exportSummary: Object.freeze({
      manifestId,
      provider: service.provider,
      operation: service.operation,
      status: accepted ? "handoff-manifest-ready" : "handoff-manifest-review",
      accepted,
      syncKey,
      nextAction: accepted
        ? "publish-external-handoff-manifest"
        : missing.includes("healthy-token-stream")
          ? health.nextAction
          : missing.includes("capability-negotiation")
            ? negotiation.nextAction
            : missing.includes("external-status-channel")
              ? "declare-status-channel"
              : missing.includes("audit-channel")
                ? "declare-audit-channel"
                : acceptance.nextAction,
    }),
    nextAction: accepted
      ? "publish-external-handoff-manifest"
      : missing.includes("healthy-token-stream")
        ? health.nextAction
        : missing.includes("capability-negotiation")
          ? negotiation.nextAction
          : missing.includes("external-status-channel")
            ? "declare-status-channel"
            : missing.includes("audit-channel")
              ? "declare-audit-channel"
              : acceptance.nextAction,
  });
}

function executionIntentId(service, boundary, stream, syncKey) {
  return [
    "token-execution-intent",
    service.provider,
    service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    syncKey,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function normalizeExecutionIntentOptions(options = {}) {
  return Object.freeze({
    acceptedBy: stableBoundaryValue(options.acceptedBy),
    statusChannel: stableBoundaryValue(options.statusChannel),
    auditChannel: stableBoundaryValue(options.auditChannel),
    idempotencyKey: stableBoundaryValue(options.idempotencyKey),
    externalTraceId: stableBoundaryValue(options.externalTraceId),
    clientRoute: stableBoundaryValue(options.clientRoute) ?? "provider-handoff",
    enabled: options.enabled !== false,
  });
}

export function createTokenStreamExecutionIntentPacket(stream, options = {}) {
  const service = normalizeProviderServiceOptions(options);
  const intentOptions = normalizeExecutionIntentOptions(options);
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: intentOptions.auditChannel ?? service.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel,
  });
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "execution-intent",
  });
  const serviceContract = options.serviceContract ?? createTokenStreamProviderServiceContract(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: intentOptions.statusChannel ?? service.statusChannel ?? boundary.auditChannel,
    reason: options.reason ?? "execution-intent-service",
  });
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: intentOptions.statusChannel ?? serviceContract.sync.statusChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "execution-intent-restart-journal",
  });
  const boundaryIncident = createTokenStreamBoundaryIncidentReport(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions: service.requiredPermissions,
  });
  const mutatesProvider = service.requiredPermissions.includes("mailchimp.write")
    || service.requiredPermissions.includes(`${service.provider}.write`);
  const statusChannel = intentOptions.statusChannel ?? serviceContract.sync.statusChannel ?? boundary.auditChannel;
  const auditChannel = intentOptions.auditChannel ?? serviceContract.sync.auditChannel ?? boundary.auditChannel;
  const idempotencyReady = !mutatesProvider || Boolean(intentOptions.idempotencyKey)
    || serviceContract.negotiation.supportedCapabilities.includes("idempotency");
  const previewAccepted = serviceContract.acceptance.accepted
    || (service.provider !== "mailchimp" && serviceContract.acceptance.controls.canHandoff);
  const missing = Object.freeze([
    intentOptions.enabled ? null : "execution-enabled",
    health.ok ? null : "healthy-token-stream",
    boundaryIncident.blocked ? "scoped-boundary" : null,
    serviceContract.negotiation.accepted ? null : "provider-capability-negotiation",
    serviceContract.externalHandoffManifest.accepted ? null : "external-handoff-manifest",
    restartJournal.validation.restartSafe ? null : "restart-journal",
    statusChannel ? null : "status-channel",
    auditChannel || !serviceContract.acceptance.audit.required ? null : "audit-channel",
    previewAccepted ? null : "preview-acceptance",
    idempotencyReady ? null : "idempotency-key",
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const intentKey = executionIntentId(service, boundary, stream, serviceContract.sync.syncKey);
  const executeCommandId = stableCommandId("execute-provider-intent", stream?.cursor ?? 0, {
    intentKey,
    provider: service.provider,
    operation: service.operation,
    route: intentOptions.clientRoute,
  });
  const statusCommandId = stableCommandId("observe-provider-intent", stream?.cursor ?? 0, {
    intentKey,
    statusChannel,
  });

  return Object.freeze({
    schema: "aios.token.stream.execution-intent.packet.v1",
    intentKey,
    sourceId: stream?.metadata?.sourceId ?? null,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    accepted,
    status: accepted
      ? "execution-intent-ready"
      : missing.includes("scoped-boundary")
        ? boundaryIncident.status
        : missing.includes("provider-capability-negotiation")
          ? serviceContract.negotiation.status
          : missing.includes("restart-journal")
            ? restartJournal.exportSummary.status
            : missing.includes("status-channel")
              ? "status-review"
              : missing.includes("audit-channel")
                ? "audit-review"
                : missing.includes("idempotency-key")
                  ? "idempotency-review"
                  : "execution-intent-review",
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
      incidentStatus: boundaryIncident.status,
    }),
    sync: Object.freeze({
      syncKey: serviceContract.sync.syncKey,
      manifestId: serviceContract.externalHandoffManifest.manifestId,
      restartJournalId: restartJournal.journalId,
      cursor: normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
      checkpointCursor: restartJournal.checkpoint.cursor,
      statusChannel,
      auditChannel,
      externalTraceId: intentOptions.externalTraceId ?? service.externalTraceId ?? serviceContract.sync.externalTraceId,
      clientRoute: intentOptions.clientRoute,
    }),
    commands: Object.freeze([
      Object.freeze({
        id: executeCommandId,
        kind: "execute-provider-intent",
        idempotent: !mutatesProvider || idempotencyReady,
        writesProvider: mutatesProvider,
        status: accepted ? "ready" : "blocked",
        nextAction: accepted ? "execute-provider-intent" : "resolve-execution-intent",
      }),
      Object.freeze({
        id: statusCommandId,
        kind: "observe-provider-intent",
        idempotent: true,
        writesProvider: false,
        status: statusChannel ? "ready" : "blocked",
        nextAction: statusChannel ? "emit-provider-intent-status" : "declare-status-channel",
      }),
    ]),
    validationSummary: Object.freeze({
      enabled: intentOptions.enabled,
      healthReady: health.ok,
      boundaryReady: !boundaryIncident.blocked,
      capabilityReady: serviceContract.negotiation.accepted,
      manifestReady: serviceContract.externalHandoffManifest.accepted,
      restartReady: restartJournal.validation.restartSafe,
      statusReady: Boolean(statusChannel),
      auditReady: Boolean(auditChannel) || !serviceContract.acceptance.audit.required,
      previewAccepted,
      idempotencyReady,
      missing,
    }),
    controls: Object.freeze({
      canPreview: health.ok && !boundaryIncident.blocked,
      canAccept: serviceContract.acceptance.controls.canAccept && !boundaryIncident.blocked,
      canPersist: restartJournal.validation.restartSafe,
      canReplay: restartJournal.validation.restartSafe && (!mutatesProvider || idempotencyReady),
      canExecute: accepted,
      canEmitStatus: Boolean(statusChannel),
    }),
    health: Object.freeze({
      status: health.status,
      nextAction: health.nextAction,
    }),
    service: Object.freeze({
      status: serviceContract.acceptance.status,
      syncKey: serviceContract.sync.syncKey,
      nextAction: serviceContract.nextAction,
    }),
    restartJournal: restartJournal.exportSummary,
    exportSummary: Object.freeze({
      intentKey,
      status: accepted ? "execution-intent-ready" : "execution-intent-review",
      accepted,
      missing,
      commandIds: Object.freeze([executeCommandId, statusCommandId]),
      nextAction: accepted
        ? "execute-provider-intent"
        : missing.includes("healthy-token-stream")
          ? health.nextAction
          : missing.includes("scoped-boundary")
            ? boundaryIncident.nextAction
            : missing.includes("provider-capability-negotiation")
              ? serviceContract.negotiation.nextAction
              : missing.includes("external-handoff-manifest")
                ? serviceContract.externalHandoffManifest.nextAction
                : missing.includes("restart-journal")
                  ? restartJournal.nextAction
                  : missing.includes("status-channel")
                    ? "declare-status-channel"
                    : missing.includes("audit-channel")
                      ? "declare-audit-channel"
                      : missing.includes("idempotency-key")
                        ? "declare-idempotency-key"
                        : "accept-provider-preview",
    }),
    nextAction: accepted
      ? "execute-provider-intent"
      : missing.includes("healthy-token-stream")
        ? health.nextAction
        : missing.includes("scoped-boundary")
          ? boundaryIncident.nextAction
          : missing.includes("provider-capability-negotiation")
            ? serviceContract.negotiation.nextAction
            : missing.includes("external-handoff-manifest")
              ? serviceContract.externalHandoffManifest.nextAction
              : missing.includes("restart-journal")
                ? restartJournal.nextAction
                : missing.includes("status-channel")
                  ? "declare-status-channel"
                  : missing.includes("audit-channel")
                    ? "declare-audit-channel"
                    : missing.includes("idempotency-key")
                      ? "declare-idempotency-key"
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
  const externalHandoffManifest = createProviderExternalHandoffManifest(
    service,
    boundary,
    stream,
    health,
    analytics,
    negotiation,
    acceptance,
    syncKey,
  );

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
    externalHandoffManifest,
    exportSummary: Object.freeze({
      provider: service.provider,
      operation: service.operation,
      status: acceptance.status,
      accepted: acceptance.accepted,
      syncKey,
      manifestId: externalHandoffManifest.manifestId,
      manifestStatus: externalHandoffManifest.status,
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
      requiresUserAcceptance: requiresAcceptance,
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
    externalHandoffManifest: Object.freeze({
      manifestId: contract.externalHandoffManifest.manifestId,
      status: contract.externalHandoffManifest.status,
      accepted: contract.externalHandoffManifest.accepted,
      commands: contract.externalHandoffManifest.commands,
      nextAction: contract.externalHandoffManifest.nextAction,
    }),
    exportSummary: Object.freeze({
      provider: contract.service.provider,
      operation: contract.service.operation,
      status: accepted ? "ready" : blocker?.status ?? contract.acceptance.status,
      accepted,
      syncKey: contract.sync.syncKey,
      manifestId: contract.externalHandoffManifest.manifestId,
      manifestStatus: contract.externalHandoffManifest.status,
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
      externalHandoffManifest: Object.freeze({
        manifestId: contract.externalHandoffManifest.manifestId,
        status: contract.externalHandoffManifest.status,
        accepted: contract.externalHandoffManifest.accepted,
        nextAction: contract.externalHandoffManifest.nextAction,
      }),
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
    externalHandoffManifest: Object.freeze({
      manifestId: contract.externalHandoffManifest.manifestId,
      status: contract.externalHandoffManifest.status,
      accepted: contract.externalHandoffManifest.accepted,
      validationSummary: contract.externalHandoffManifest.validationSummary,
      commands: contract.externalHandoffManifest.commands,
      exportSummary: contract.externalHandoffManifest.exportSummary,
    }),
    nextAction: nextStep.action,
  });
}

export function createTokenStreamProviderAcceptanceHistory(stream, options = {}) {
  const acceptance = options.acceptanceSummary ?? createTokenStreamProviderAcceptanceSummary(stream, {
    ...options,
    reason: options.reason ?? "provider-acceptance-history",
  });
  const history = createTokenStreamHistorySnapshot(stream, {
    ...options,
    reason: options.reason ?? "provider-acceptance-history",
  });
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    permissions: options.permissions ?? acceptance.preview?.requiredPermissions ?? [],
    requiredPermissions: acceptance.preview?.requiredPermissions ?? options.requiredPermissions ?? [],
    auditChannel: options.auditChannel ?? acceptance.preview?.audit?.channel ?? null,
    statusChannel: options.statusChannel ?? acceptance.preview?.statusChannel ?? null,
    reason: options.reason ?? "provider-acceptance-history",
    entries: [
      Object.freeze({
        kind: "provider-preview",
        cursor: history.cursor,
        payload: Object.freeze({
          provider: acceptance.provider,
          operation: acceptance.operation,
          status: acceptance.status,
          accepted: acceptance.accepted,
        }),
        status: acceptance.accepted ? "accepted" : acceptance.status,
        nextAction: acceptance.nextAction,
      }),
      Object.freeze({
        kind: "provider-acceptance-controls",
        cursor: history.cursor,
        payload: Object.freeze({
          canAccept: acceptance.controls.canAccept,
          canSchedule: acceptance.controls.canSchedule,
          canHandoff: acceptance.controls.canHandoff,
        }),
        status: acceptance.controls.canHandoff ? "handoff-enabled" : "operator-review",
        nextAction: acceptance.nextAction,
      }),
    ],
  });
  const failedSteps = Object.freeze(Array.from(acceptance.failedSteps ?? []));
  const missing = Object.freeze(Array.from(acceptance.validationSummary?.missing ?? []));
  const statusEvents = Object.freeze([
    Object.freeze({
      schema: "aios.token.stream.provider-acceptance-history.event.v1",
      label: "token-history",
      status: history.exportSummary.restartSafe ? "restart-safe" : history.boundaryIncident.status,
      accepted: history.exportSummary.restartSafe,
      cursor: history.cursor,
      nextAction: history.nextAction,
    }),
    Object.freeze({
      schema: "aios.token.stream.provider-acceptance-history.event.v1",
      label: "preview-validation",
      status: missing.length === 0 ? "clear" : "review",
      accepted: missing.length === 0,
      cursor: history.cursor,
      nextAction: missing.length === 0 ? "continue" : acceptance.nextAction,
    }),
    Object.freeze({
      schema: "aios.token.stream.provider-acceptance-history.event.v1",
      label: "operator-acceptance",
      status: acceptance.status,
      accepted: acceptance.accepted,
      cursor: history.cursor,
      nextAction: acceptance.nextAction,
    }),
    Object.freeze({
      schema: "aios.token.stream.provider-acceptance-history.event.v1",
      label: "restart-journal",
      status: restartJournal.exportSummary.status,
      accepted: restartJournal.validation.restartSafe,
      cursor: restartJournal.cursor,
      nextAction: restartJournal.nextAction,
    }),
  ]);
  const blocked = statusEvents.filter((event) => !event.accepted);
  const accepted = acceptance.accepted && blocked.length === 0;

  return Object.freeze({
    schema: "aios.token.stream.provider-acceptance-history.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: acceptance.provider,
    operation: acceptance.operation,
    adapter: acceptance.adapter,
    accepted,
    status: accepted
      ? "acceptance-history-ready"
      : blocked[0]?.status ?? acceptance.status,
    counters: Object.freeze({
      failedSteps: failedSteps.length,
      missing: missing.length,
      timelineEvents: statusEvents.length,
      restartJournalEntries: restartJournal.counters.total,
      diagnosticCount: history.diagnosticCount,
      commandCount: history.counters.commands.total,
    }),
    history: Object.freeze({
      cursor: history.cursor,
      checkpoint: history.checkpoint,
      tokenWindow: history.timeline,
      boundaryIncident: history.boundaryIncident.status,
      restartJournal: restartJournal.exportSummary,
    }),
    timeline: statusEvents,
    acceptance: Object.freeze({
      status: acceptance.status,
      accepted: acceptance.accepted,
      syncKey: acceptance.syncKey,
      missing,
      failedSteps,
      nextStep: acceptance.explanation.nextStep,
    }),
    controls: Object.freeze({
      canPreview: acceptance.controls.canPreview,
      canAccept: acceptance.controls.canAccept && history.exportSummary.restartSafe,
      canSchedule: acceptance.controls.canSchedule && restartJournal.validation.restartSafe,
      canHandoff: accepted,
      canExportHistory: history.exportSummary.restartSafe || Boolean(acceptance.preview?.audit?.channel),
      canReplayRestart: restartJournal.validation.restartSafe,
    }),
    exportSummary: Object.freeze({
      sourceId: stream?.metadata?.sourceId ?? null,
      provider: acceptance.provider,
      operation: acceptance.operation,
      status: accepted ? "acceptance-history-ready" : "acceptance-history-review",
      syncKey: acceptance.syncKey,
      missing,
      firstBlocked: blocked[0]?.label ?? null,
      nextAction: accepted ? "publish-provider-acceptance-history" : blocked[0]?.nextAction ?? acceptance.nextAction,
    }),
    nextAction: accepted ? "publish-provider-acceptance-history" : blocked[0]?.nextAction ?? acceptance.nextAction,
  });
}

export function createTokenStreamMailchimpExportLedger(stream, options = {}) {
  const service = normalizeProviderServiceOptions({
    ...options,
    adapter: options.adapter ?? "mailchimp.syncAudience",
    provider: "mailchimp",
  });
  const requiredPermissions = stableStringSet([
    ...service.requiredPermissions,
    ...(options.requiredPermissions ?? []),
  ]);
  const acceptance = options.acceptanceSummary ?? createTokenStreamProviderAcceptanceSummary(stream, {
    ...options,
    adapter: service.adapter,
    provider: "mailchimp",
    operation: service.operation,
    requiredPermissions,
    reason: options.reason ?? "mailchimp-export-ledger",
  });
  const history = options.acceptanceHistory ?? createTokenStreamProviderAcceptanceHistory(stream, {
    ...options,
    adapter: service.adapter,
    provider: "mailchimp",
    operation: service.operation,
    requiredPermissions,
    acceptanceSummary: acceptance,
    reason: options.reason ?? "mailchimp-export-ledger",
  });
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    adapter: service.adapter,
    provider: "mailchimp",
    operation: service.operation,
    permissions: options.permissions ?? acceptance.preview?.requiredPermissions ?? [],
    requiredPermissions,
    auditChannel: options.auditChannel ?? acceptance.preview?.audit?.channel ?? null,
    statusChannel: options.statusChannel ?? acceptance.preview?.statusChannel ?? null,
    reason: options.reason ?? "mailchimp-export-ledger",
  });
  const exportManifest = options.exportReadinessManifest ?? createTokenStreamExportReadinessManifest(stream, {
    ...options,
    adapter: service.adapter,
    provider: "mailchimp",
    operation: service.operation,
    requiredPermissions,
    acceptanceSummary: acceptance,
    restartJournal,
    mailchimpReadinessLedger: options.mailchimpReadinessLedger ?? Object.freeze({
      schema: "aios.token.stream.mailchimp-readiness-ledger.reference.v1",
      ledgerId: `${history.acceptance.syncKey}:acceptance-ledger`,
      accepted: acceptance.accepted && history.accepted,
      status: acceptance.accepted && history.accepted ? "accepted" : history.status,
      sync: Object.freeze({
        statusChannel: acceptance.preview.statusChannel,
      }),
      audit: Object.freeze({
        channel: acceptance.preview.audit?.channel ?? null,
      }),
      exportSummary: Object.freeze({
        status: acceptance.accepted && history.accepted ? "accepted" : "review",
        nextAction: acceptance.accepted && history.accepted ? "continue" : history.nextAction,
      }),
      nextAction: acceptance.accepted && history.accepted ? "continue" : history.nextAction,
    }),
    reason: options.reason ?? "mailchimp-export-ledger",
  });
  const auditReady = Boolean(acceptance.preview.audit?.channel)
    || acceptance.validationSummary.auditReady
    || exportManifest.validationSummary.auditReady;
  const statusReady = Boolean(acceptance.preview.statusChannel ?? exportManifest.sync.statusChannel);
  const ledgerId = [
    "mailchimp-export-ledger",
    service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    acceptance.syncKey,
    exportManifest.manifestId,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
  const gates = Object.freeze([
    readinessStep("preview-acceptance", acceptance.status, acceptance.accepted, acceptance.nextAction, {
      acceptedBy: acceptance.acceptedBy ?? options.acceptedBy ?? null,
      syncKey: acceptance.syncKey,
    }),
    readinessStep("history-snapshot", history.status, history.accepted, history.nextAction, {
      commandCount: history.counters.commandCount,
      diagnosticCount: history.counters.diagnosticCount,
      firstBlocked: history.exportSummary.firstBlocked,
    }),
    readinessStep("export-manifest", exportManifest.status, exportManifest.ready, exportManifest.nextAction, {
      manifestId: exportManifest.manifestId,
      blockedGates: exportManifest.blockedGates,
    }),
    readinessStep("status-channel", statusReady ? "status-ready" : "status-review", statusReady, statusReady ? "continue" : "declare-status-channel", {
      statusChannel: acceptance.preview.statusChannel ?? exportManifest.sync.statusChannel,
    }),
    readinessStep("audit-channel", auditReady ? "audit-ready" : "audit-review", auditReady, auditReady ? "continue" : "declare-audit-channel", {
      auditChannel: acceptance.preview.audit?.channel ?? exportManifest.sync.auditChannel,
      required: acceptance.preview.audit?.required ?? true,
    }),
  ]);
  const blocker = firstReadinessBlocker(gates);
  const accepted = !blocker && service.provider === "mailchimp";
  const missing = Object.freeze([...new Set([
    service.provider === "mailchimp" ? null : "mailchimp-provider",
    ...gates.filter((gate) => !gate.accepted).map((gate) => gate.label),
    ...Array.from(acceptance.validationSummary.missing ?? []),
    ...Array.from(exportManifest.validationSummary.missing ?? []),
  ].filter(Boolean))].sort());

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-export-ledger.v1",
    ledgerId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: "mailchimp",
    operation: service.operation,
    adapter: service.adapter,
    accepted,
    status: accepted ? "export-ledger-ready" : blocker?.status ?? "export-ledger-review",
    gates,
    missing,
    counters: Object.freeze({
      gateCount: gates.length,
      blockedGateCount: gates.filter((gate) => !gate.accepted).length,
      diagnosticCount: history.counters.diagnosticCount,
      commandCount: history.counters.commandCount,
      restartJournalEntries: history.counters.restartJournalEntries,
    }),
    sync: Object.freeze({
      syncKey: acceptance.syncKey,
      manifestId: exportManifest.manifestId,
      statusChannel: acceptance.preview.statusChannel ?? exportManifest.sync.statusChannel,
      auditChannel: acceptance.preview.audit?.channel ?? exportManifest.sync.auditChannel,
      checkpointCursor: exportManifest.sync.checkpointCursor,
      restartJournalId: exportManifest.sync.restartJournalId,
    }),
    preview: Object.freeze({
      tokenWindow: acceptance.preview.tokenWindow,
      requiredPermissions: acceptance.preview.requiredPermissions,
      missingPermissions: acceptance.preview.missingPermissions,
      failedSteps: acceptance.failedSteps,
      nextStep: acceptance.explanation.nextStep,
    }),
    history: Object.freeze({
      cursor: history.history.cursor,
      checkpoint: history.history.checkpoint,
      timeline: history.timeline,
      restartJournal: history.history.restartJournal,
    }),
    readiness: Object.freeze({
      acceptanceReady: acceptance.accepted,
      historyReady: history.accepted,
      exportReady: exportManifest.ready,
      statusReady,
      auditReady,
      missing,
    }),
    controls: Object.freeze({
      canPreview: acceptance.controls.canPreview,
      canAccept: acceptance.controls.canAccept && history.controls.canAccept,
      canSchedule: acceptance.controls.canSchedule && exportManifest.controls.canEmitStatus,
      canExportLedger: accepted,
      canReplayRestart: history.controls.canReplayRestart || exportManifest.controls.canReplayRestart,
    }),
    acceptance,
    acceptanceHistory: history,
    exportManifest,
    exportSummary: Object.freeze({
      ledgerId,
      status: accepted ? "mailchimp-export-ledger-ready" : "mailchimp-export-ledger-review",
      operation: service.operation,
      syncKey: acceptance.syncKey,
      manifestId: exportManifest.manifestId,
      blockedGate: blocker?.label ?? null,
      missing,
      nextAction: accepted ? "publish-mailchimp-export-ledger" : blocker?.nextAction ?? exportManifest.nextAction,
    }),
    nextAction: accepted ? "publish-mailchimp-export-ledger" : blocker?.nextAction ?? exportManifest.nextAction,
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

export function createTokenStreamClientRuntimeAdoptionSnapshot(stream, options = {}) {
  const service = normalizeProviderServiceOptions({
    ...options,
    adapter: options.adapter ?? options.expectedAdapter ?? "mailchimp.syncAudience",
    provider: options.provider ?? "mailchimp",
  });
  const requiredCapabilities = stableStringSet(options.requestedCapabilities ?? [
    "audit",
    "checkpoint",
    "external-status",
    service.requiredPermissions.includes("mailchimp.write") ? "provider-write" : null,
    service.provider === "mailchimp" ? "provider-read" : null,
    service.requiredPermissions.includes("mailchimp.write") ? "idempotency" : null,
  ].filter(Boolean));
  const snapshotOptions = Object.freeze({
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    requestedCapabilities: requiredCapabilities,
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel ?? null,
    statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel ?? null,
    reason: options.reason ?? "client-runtime-adoption-snapshot",
  });
  const serviceContract = options.serviceContract ?? createTokenStreamProviderServiceContract(stream, snapshotOptions);
  const acceptanceSummary = options.acceptanceSummary ?? createTokenStreamProviderAcceptanceSummary(stream, {
    ...snapshotOptions,
    reason: `${snapshotOptions.reason}:acceptance`,
  });
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...snapshotOptions,
    permissions: serviceContract.boundary.permissions,
    requiredPermissions: serviceContract.negotiation.requiredPermissions,
    auditChannel: serviceContract.sync.auditChannel,
    statusChannel: serviceContract.sync.statusChannel,
    entries: [
      Object.freeze({
        kind: "client-runtime-adoption:preview",
        cursor: serviceContract.sync.cursor,
        payload: Object.freeze({
          provider: service.provider,
          operation: service.operation,
          accepted: acceptanceSummary.accepted,
          status: acceptanceSummary.status,
        }),
        status: acceptanceSummary.accepted ? "accepted" : acceptanceSummary.status,
        nextAction: acceptanceSummary.nextAction,
      }),
    ],
    reason: `${snapshotOptions.reason}:restart-journal`,
  });
  const executionIntent = options.executionIntent ?? createTokenStreamExecutionIntentPacket(stream, {
    ...snapshotOptions,
    serviceContract,
    restartJournal,
    clientRoute: options.clientRoute ?? "client-runtime-adoption",
    idempotencyKey: options.idempotencyKey,
    reason: `${snapshotOptions.reason}:execution-intent`,
  });
  const mailchimpAdoption = service.provider === "mailchimp"
    ? options.mailchimpAdoption ?? createTokenStreamMailchimpAdoptionPacket(stream, {
        ...snapshotOptions,
        serviceContract,
        acceptanceSummary,
        reason: `${snapshotOptions.reason}:mailchimp-adoption`,
      })
    : null;
  const boundaryIncident = createTokenStreamBoundaryIncidentReport(stream, {
    ...snapshotOptions,
    permissions: serviceContract.boundary.permissions,
    requiredPermissions: serviceContract.negotiation.requiredPermissions,
  });
  const mutating = serviceContract.negotiation.requiredPermissions.includes("mailchimp.write")
    || serviceContract.negotiation.requiredPermissions.includes(`${service.provider}.write`);
  const idempotencyReady = !mutating
    || Boolean(options.idempotencyKey)
    || serviceContract.negotiation.supportedCapabilities.includes("idempotency");
  const routeId = [
    "client-runtime-adoption",
    service.provider,
    service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    serviceContract.boundary.workspace ?? "workspace",
    serviceContract.boundary.tenant ?? "tenant",
    serviceContract.sync.syncKey,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
  const missing = Object.freeze([
    serviceContract.preview.health.ok ? null : "healthy-token-stream",
    boundaryIncident.blocked ? "scoped-boundary" : null,
    serviceContract.negotiation.accepted ? null : "provider-capability-negotiation",
    acceptanceSummary.accepted ? null : "preview-acceptance",
    restartJournal.validation.restartSafe ? null : "restart-journal",
    executionIntent.accepted ? null : "execution-intent",
    mailchimpAdoption && !mailchimpAdoption.ready ? "mailchimp-adoption" : null,
    serviceContract.sync.statusChannel ? null : "status-channel",
    serviceContract.acceptance.audit.status === "audit-ready" || !serviceContract.acceptance.audit.required ? null : "audit-channel",
    idempotencyReady ? null : "idempotency-key",
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const blockedGate = missing[0] ?? null;

  return Object.freeze({
    schema: "aios.token.stream.client-runtime-adoption.snapshot.v1",
    snapshotId: routeId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: service.provider,
    operation: service.operation,
    adapter: service.adapter,
    accepted,
    status: accepted
      ? "client-runtime-adoption-ready"
      : blockedGate === "healthy-token-stream"
        ? serviceContract.preview.health.status
        : blockedGate === "scoped-boundary"
          ? boundaryIncident.status
          : blockedGate === "provider-capability-negotiation"
            ? serviceContract.negotiation.status
            : blockedGate === "preview-acceptance"
              ? acceptanceSummary.status
              : blockedGate === "restart-journal"
                ? restartJournal.exportSummary.status
                : blockedGate === "execution-intent"
                  ? executionIntent.status
                  : blockedGate === "mailchimp-adoption"
                    ? mailchimpAdoption.status
                    : blockedGate === "idempotency-key"
                      ? "idempotency-review"
                      : "client-runtime-adoption-review",
    boundary: Object.freeze({
      workspace: serviceContract.boundary.workspace,
      tenant: serviceContract.boundary.tenant,
      role: serviceContract.boundary.role,
      localOnly: serviceContract.boundary.localOnly,
      incidentStatus: boundaryIncident.status,
    }),
    sync: Object.freeze({
      syncKey: serviceContract.sync.syncKey,
      routeId,
      cursor: serviceContract.sync.cursor,
      checkpointCursor: serviceContract.sync.checkpointCursor,
      restartJournalId: restartJournal.journalId,
      executionIntentKey: executionIntent.intentKey,
      statusChannel: serviceContract.sync.statusChannel,
      auditChannel: serviceContract.sync.auditChannel,
      externalTraceId: serviceContract.service.externalTraceId,
    }),
    persistedState: Object.freeze({
      restoreCommand: restartJournal.checkpoint.restoreCommand,
      commandIds: Object.freeze([
        ...executionIntent.commands.map((command) => command.id),
        mailchimpAdoption?.restartPlan.command.id,
      ].filter(Boolean)),
      restartSafe: restartJournal.validation.restartSafe && (!mailchimpAdoption || mailchimpAdoption.restartPlan.restartSafe),
      idempotencyReady,
    }),
    validationSummary: Object.freeze({
      healthReady: serviceContract.preview.health.ok,
      boundaryReady: !boundaryIncident.blocked,
      capabilityReady: serviceContract.negotiation.accepted,
      previewAccepted: acceptanceSummary.accepted,
      restartReady: restartJournal.validation.restartSafe,
      executionIntentReady: executionIntent.accepted,
      mailchimpAdoptionReady: !mailchimpAdoption || mailchimpAdoption.ready,
      statusReady: Boolean(serviceContract.sync.statusChannel),
      auditReady: serviceContract.acceptance.audit.status === "audit-ready" || !serviceContract.acceptance.audit.required,
      idempotencyReady,
      missing,
    }),
    controls: Object.freeze({
      canPreview: serviceContract.preview.health.ok && !boundaryIncident.blocked,
      canAccept: acceptanceSummary.controls.canAccept && !boundaryIncident.blocked,
      canPersist: restartJournal.validation.restartSafe,
      canReplay: restartJournal.validation.restartSafe && idempotencyReady,
      canHandoffClient: accepted,
      canEmitStatus: Boolean(serviceContract.sync.statusChannel),
    }),
    service: serviceContract.exportSummary,
    acceptance: acceptanceSummary.exportSummary ?? Object.freeze({
      status: acceptanceSummary.status,
      syncKey: acceptanceSummary.syncKey,
      nextAction: acceptanceSummary.nextAction,
    }),
    executionIntent: executionIntent.exportSummary,
    mailchimpAdoption: mailchimpAdoption
      ? Object.freeze({
          status: mailchimpAdoption.status,
          ready: mailchimpAdoption.ready,
          missing: mailchimpAdoption.validationSummary.missing,
          command: mailchimpAdoption.restartPlan.command,
          nextAction: mailchimpAdoption.nextAction,
        })
      : null,
    exportSummary: Object.freeze({
      snapshotId: routeId,
      status: accepted ? "client-runtime-adoption-ready" : "client-runtime-adoption-review",
      accepted,
      missing,
      syncKey: serviceContract.sync.syncKey,
      executionIntentKey: executionIntent.intentKey,
      nextAction: accepted
        ? "handoff-client-runtime"
        : blockedGate === "healthy-token-stream"
          ? serviceContract.preview.health.nextAction
          : blockedGate === "scoped-boundary"
            ? boundaryIncident.nextAction
            : blockedGate === "provider-capability-negotiation"
              ? serviceContract.negotiation.nextAction
              : blockedGate === "preview-acceptance"
                ? acceptanceSummary.nextAction
                : blockedGate === "restart-journal"
                  ? restartJournal.nextAction
                  : blockedGate === "execution-intent"
                    ? executionIntent.nextAction
                    : blockedGate === "mailchimp-adoption"
                      ? mailchimpAdoption.nextAction
                      : blockedGate === "status-channel"
                        ? "declare-status-channel"
                        : blockedGate === "audit-channel"
                          ? "declare-audit-channel"
                          : "declare-idempotency-key",
    }),
    nextAction: accepted
      ? "handoff-client-runtime"
      : blockedGate === "healthy-token-stream"
        ? serviceContract.preview.health.nextAction
        : blockedGate === "scoped-boundary"
          ? boundaryIncident.nextAction
          : blockedGate === "provider-capability-negotiation"
            ? serviceContract.negotiation.nextAction
            : blockedGate === "preview-acceptance"
              ? acceptanceSummary.nextAction
              : blockedGate === "restart-journal"
                ? restartJournal.nextAction
                : blockedGate === "execution-intent"
                  ? executionIntent.nextAction
                  : blockedGate === "mailchimp-adoption"
                    ? mailchimpAdoption.nextAction
                    : blockedGate === "status-channel"
                      ? "declare-status-channel"
                      : blockedGate === "audit-channel"
                        ? "declare-audit-channel"
                        : "declare-idempotency-key",
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
  const acceptanceHistory = createTokenStreamProviderAcceptanceHistory(stream, {
    ...sessionOptions,
    acceptanceSummary: acceptance,
    restartJournal: options.restartJournal,
    reason: `${sessionOptions.reason}:acceptance-history`,
  });

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-workflow-session.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: "mailchimp",
    operation: readiness.operation,
    adapter,
    ready: workflowStatus.ready && acceptanceHistory.accepted,
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
    acceptanceHistory,
    readiness: readiness.exportSummary,
    acceptance: Object.freeze({
      accepted: acceptance.accepted,
      status: acceptance.status,
      missing: acceptance.validationSummary.missing,
      controls: acceptance.controls,
      history: acceptanceHistory.exportSummary,
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
      acceptanceHistoryReady: acceptanceHistory.accepted,
      restartSafe: adoption.validationSummary.restartSafe,
      adapterReady: adapterStatus.parserHandoff.accepted,
      commandAuditReady: auditReport.ok,
      missing: Object.freeze([
        ...workflowStatus.missing,
        acceptanceHistory.accepted ? null : acceptanceHistory.exportSummary.firstBlocked ?? "acceptance-history",
      ].filter(Boolean)),
    }),
    controls: Object.freeze({
      canPreview: adoption.controls.canPreview,
      canAccept: acceptance.controls.canAccept && acceptanceHistory.controls.canAccept,
      canPersist: adoption.controls.canPersist && acceptanceHistory.controls.canExportHistory,
      canReplayRestore: auditReport.controls.canRetryFromCheckpoint || acceptanceHistory.controls.canReplayRestart,
      canHandoffParser: workflowStatus.ready && acceptanceHistory.accepted,
      canHandoffClient: workflowStatus.ready && acceptanceHistory.accepted && adoption.controls.canHandoffParser,
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
      status: workflowStatus.ready && acceptanceHistory.accepted ? "workflow-ready" : "workflow-review",
      syncKey: adoption.sync.syncKey,
      missing: Object.freeze([
        ...workflowStatus.missing,
        acceptanceHistory.accepted ? null : acceptanceHistory.exportSummary.firstBlocked ?? "acceptance-history",
      ].filter(Boolean)),
      acceptanceHistory: acceptanceHistory.exportSummary.status,
      nextAction: workflowStatus.ready && !acceptanceHistory.accepted ? acceptanceHistory.nextAction : workflowStatus.nextAction,
    }),
    nextAction: workflowStatus.ready && !acceptanceHistory.accepted ? acceptanceHistory.nextAction : workflowStatus.nextAction,
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

function evidenceGate(label, accepted, status, nextAction, details = {}) {
  return Object.freeze({
    schema: "aios.token.stream.handoff-evidence.gate.v1",
    label,
    accepted: Boolean(accepted),
    status,
    nextAction,
    details: Object.freeze(details),
  });
}

function evidenceReadinessStatus(gates) {
  const blocker = Array.from(gates ?? []).find((gate) => !gate.accepted) ?? null;
  return Object.freeze({
    accepted: !blocker,
    blocker,
    status: blocker ? blocker.status : "evidence-ready",
    nextAction: blocker ? blocker.nextAction : "publish-handoff-evidence",
  });
}

export function createTokenStreamHandoffEvidencePacket(stream, options = {}) {
  const service = createTokenStreamProviderServiceContract(stream, {
    ...options,
    reason: options.reason ?? "token-stream-handoff-evidence",
  });
  const readiness = createTokenStreamProviderReadinessPreview(stream, {
    ...options,
    readinessPreview: undefined,
    adapter: service.service.adapter,
    provider: service.service.provider,
    operation: service.service.operation,
    acceptedBy: service.acceptance.acceptedBy,
    auditChannel: service.acceptance.audit.channel,
    statusChannel: service.acceptance.statusChannel,
    requestedCapabilities: service.negotiation.requestedCapabilities,
    enabled: service.service.enabled,
    reason: `${options.reason ?? "token-stream-handoff-evidence"}:readiness`,
  });
  const acceptance = createTokenStreamProviderAcceptanceSummary(stream, {
    ...options,
    readinessPreview: readiness,
    reason: `${options.reason ?? "token-stream-handoff-evidence"}:acceptance`,
  });
  const adapterStatus = createTokenStreamAdapterStatusPacket(stream, {
    ...options,
    adapter: service.service.adapter,
    provider: service.service.provider,
    operation: service.service.operation,
    acceptedBy: service.acceptance.acceptedBy,
    auditChannel: service.acceptance.audit.channel,
    statusChannel: service.acceptance.statusChannel,
    requestedCapabilities: service.negotiation.requestedCapabilities,
    enabled: service.service.enabled,
    reason: `${options.reason ?? "token-stream-handoff-evidence"}:adapter-status`,
  });
  const restartJournal = createTokenStreamRestartJournal(stream, {
    ...options,
    permissions: service.boundary.permissions,
    requiredPermissions: service.negotiation.requiredPermissions,
    auditChannel: service.acceptance.audit.channel,
    statusChannel: service.acceptance.statusChannel,
    reason: `${options.reason ?? "token-stream-handoff-evidence"}:restart-journal`,
    entries: [
      Object.freeze({
        kind: "handoff-evidence:provider",
        cursor: service.sync.cursor,
        payload: Object.freeze({
          provider: service.service.provider,
          operation: service.service.operation,
          acceptanceStatus: acceptance.status,
          adapterStatus: adapterStatus.status,
        }),
        status: acceptance.accepted && adapterStatus.ready ? "accepted" : "review",
        nextAction: acceptance.accepted ? adapterStatus.nextAction : acceptance.nextAction,
      }),
    ],
  });
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    permissions: service.boundary.permissions,
    auditChannel: service.acceptance.audit.channel,
    requiredPermissions: service.negotiation.requiredPermissions,
    reason: `${options.reason ?? "token-stream-handoff-evidence"}:health`,
  });
  const analytics = createTokenStreamAnalyticsReport(stream, {
    ...options,
    permissions: service.boundary.permissions,
    auditChannel: service.acceptance.audit.channel,
    requiredPermissions: service.negotiation.requiredPermissions,
    reason: `${options.reason ?? "token-stream-handoff-evidence"}:analytics`,
  });
  const gates = Object.freeze([
    evidenceGate("token-health", health.ok, health.status, health.nextAction, {
      cursor: health.cursor,
      diagnosticCount: health.diagnosticCount,
      boundaryIncident: health.boundaryIncident.status,
    }),
    evidenceGate("provider-readiness", readiness.accepted, readiness.status, readiness.nextAction, readiness.explanation.validationSummary),
    evidenceGate("preview-acceptance", acceptance.accepted, acceptance.status, acceptance.nextAction, acceptance.validationSummary),
    evidenceGate("adapter-status", adapterStatus.parserHandoff.accepted, adapterStatus.parserHandoff.status, adapterStatus.parserHandoff.nextAction, {
      blockedGate: adapterStatus.parserHandoff.blockedGate,
      syncKey: adapterStatus.sync.syncKey,
    }),
    evidenceGate("restart-journal", restartJournal.validation.restartSafe, restartJournal.exportSummary.status, restartJournal.nextAction, {
      journalId: restartJournal.journalId,
      blockedEntryIds: restartJournal.validation.blockedEntryIds,
      duplicateIds: restartJournal.validation.duplicateIds,
    }),
    evidenceGate("analytics-export", analytics.ok, analytics.exportSummary.status, analytics.nextAction, {
      tokenCount: analytics.counters.tokenCount,
      commandCount: analytics.counters.commandCount,
      boundaryIncident: analytics.exportSummary.boundaryIncident,
    }),
  ]);
  const readinessStatus = evidenceReadinessStatus(gates);
  const evidenceId = [
    "handoff-evidence",
    service.service.provider,
    service.service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    service.boundary.workspace ?? "workspace",
    service.boundary.tenant ?? "tenant",
    service.sync.cursor,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");

  return Object.freeze({
    schema: "aios.token.stream.handoff-evidence.v1",
    evidenceId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: service.service.provider,
    operation: service.service.operation,
    adapter: service.service.adapter,
    accepted: readinessStatus.accepted,
    status: readinessStatus.status,
    sync: Object.freeze({
      syncKey: service.sync.syncKey,
      cursor: service.sync.cursor,
      checkpointCursor: service.sync.checkpointCursor,
      statusChannel: service.sync.statusChannel,
      auditChannel: service.sync.auditChannel,
      externalTraceId: service.service.externalTraceId,
    }),
    boundary: Object.freeze({
      workspace: service.boundary.workspace,
      tenant: service.boundary.tenant,
      role: service.boundary.role,
      localOnly: service.boundary.localOnly,
    }),
    permissions: Object.freeze({
      required: service.negotiation.requiredPermissions,
      granted: service.negotiation.grantedPermissions,
      missing: service.negotiation.missingPermissions,
    }),
    gates,
    restartJournal: restartJournal.exportSummary,
    analytics: analytics.exportSummary,
    adapterStatus: adapterStatus.exportSummary,
    blocker: readinessStatus.blocker
      ? Object.freeze({
          label: readinessStatus.blocker.label,
          status: readinessStatus.blocker.status,
          nextAction: readinessStatus.blocker.nextAction,
        })
      : null,
    controls: Object.freeze({
      canPublishEvidence: readinessStatus.accepted,
      canRetryFromCheckpoint: restartJournal.checkpoint.restartSafe,
      canHandoffProvider: readinessStatus.accepted && adapterStatus.parserHandoff.accepted,
      canExportAudit: Boolean(service.sync.auditChannel),
    }),
    exportSummary: Object.freeze({
      evidenceId,
      provider: service.service.provider,
      operation: service.service.operation,
      status: readinessStatus.accepted ? "handoff-evidence-ready" : readinessStatus.status,
      accepted: readinessStatus.accepted,
      syncKey: service.sync.syncKey,
      blocker: readinessStatus.blocker?.label ?? null,
      nextAction: readinessStatus.nextAction,
    }),
    nextAction: readinessStatus.nextAction,
  });
}

function mailchimpDecisionGate(label, accepted, status, nextAction, details = {}) {
  return Object.freeze({
    schema: "aios.token.stream.mailchimp-handoff-decision.gate.v1",
    label,
    accepted: Boolean(accepted),
    status: status ?? "unknown",
    nextAction: nextAction ?? "review-mailchimp-handoff",
    details: Object.freeze(details),
  });
}

function mailchimpDecisionStatus(blocker, workflow, evidence, adapterStatus) {
  if (!blocker) {
    return "handoff-approved";
  }

  if (blocker.label === "workflow-session") {
    return workflow.status;
  }

  if (blocker.label === "handoff-evidence") {
    return evidence.status;
  }

  if (blocker.label === "adapter-status") {
    return adapterStatus.parserHandoff.status;
  }

  return blocker.status;
}

export function createTokenStreamMailchimpHandoffDecision(stream, options = {}) {
  const adapter = options.adapter ?? options.expectedAdapter ?? "mailchimp.syncAudience";
  const requestedCapabilities = options.requestedCapabilities ?? [
    "audit",
    "checkpoint",
    "external-status",
    "provider-read",
    "provider-write",
    "idempotency",
  ];
  const decisionOptions = Object.freeze({
    ...options,
    adapter,
    provider: "mailchimp",
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel ?? null,
    statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel ?? null,
    requestedCapabilities,
    acceptedBy: options.acceptedBy,
    enabled: options.enabled ?? options.mailchimpEnabled,
    reason: options.reason ?? "mailchimp-handoff-decision",
  });
  const workflow = options.workflowSession ?? createTokenStreamMailchimpWorkflowSession(stream, decisionOptions);
  const evidence = options.handoffEvidence ?? createTokenStreamHandoffEvidencePacket(stream, {
    ...decisionOptions,
    operation: workflow.operation,
    reason: `${decisionOptions.reason}:evidence`,
  });
  const adapterStatus = options.adapterStatus ?? createTokenStreamAdapterStatusPacket(stream, {
    ...decisionOptions,
    operation: workflow.operation,
    reason: `${decisionOptions.reason}:adapter-status`,
  });
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...decisionOptions,
    requiredPermissions: evidence.permissions.required,
    reason: `${decisionOptions.reason}:restart-journal`,
    entries: [
      Object.freeze({
        kind: "mailchimp-decision:workflow",
        cursor: workflow.sync.cursor,
        payload: Object.freeze({
          status: workflow.status,
          ready: workflow.ready,
          missing: workflow.validationSummary.missing.join(","),
        }),
        status: workflow.ready ? "accepted" : workflow.status,
        nextAction: workflow.nextAction,
      }),
      Object.freeze({
        kind: "mailchimp-decision:evidence",
        cursor: evidence.sync.cursor,
        payload: Object.freeze({
          evidenceId: evidence.evidenceId,
          status: evidence.status,
          accepted: evidence.accepted,
        }),
        status: evidence.accepted ? "accepted" : evidence.status,
        nextAction: evidence.nextAction,
      }),
    ],
  });
  const queue = createTokenStreamNextActionQueue(stream, [
    Object.freeze({
      source: "mailchimp-workflow-session",
      status: workflow.status,
      ready: workflow.ready,
      blocked: !workflow.ready,
      nextAction: workflow.nextAction,
      sync: workflow.sync,
      audit: Object.freeze({ channel: workflow.sync.auditChannel }),
    }),
    Object.freeze({
      source: "mailchimp-handoff-evidence",
      status: evidence.status,
      accepted: evidence.accepted,
      blocked: !evidence.accepted,
      nextAction: evidence.nextAction,
      sync: evidence.sync,
      audit: Object.freeze({ channel: evidence.sync.auditChannel }),
    }),
    Object.freeze({
      source: "mailchimp-adapter-status",
      status: adapterStatus.parserHandoff.status,
      accepted: adapterStatus.parserHandoff.accepted,
      blocked: !adapterStatus.parserHandoff.accepted,
      nextAction: adapterStatus.parserHandoff.nextAction,
      sync: adapterStatus.sync,
      audit: Object.freeze({ channel: adapterStatus.sync.auditChannel }),
    }),
    Object.freeze({
      source: "mailchimp-restart-journal",
      status: restartJournal.exportSummary.status,
      accepted: restartJournal.validation.restartSafe,
      blocked: !restartJournal.validation.restartSafe,
      nextAction: restartJournal.nextAction,
      audit: restartJournal.audit,
    }),
  ], {
    ...decisionOptions,
    includeAnalytics: false,
    reason: `${decisionOptions.reason}:queue`,
    requiredPermissions: evidence.permissions.required,
  });
  const gates = Object.freeze([
    mailchimpDecisionGate("workflow-session", workflow.ready, workflow.status, workflow.nextAction, {
      operation: workflow.operation,
      missing: workflow.validationSummary.missing,
      syncKey: workflow.sync.syncKey,
    }),
    mailchimpDecisionGate("adapter-status", adapterStatus.parserHandoff.accepted, adapterStatus.parserHandoff.status, adapterStatus.parserHandoff.nextAction, {
      blockedGate: adapterStatus.parserHandoff.blockedGate,
      syncKey: adapterStatus.sync.syncKey,
    }),
    mailchimpDecisionGate("handoff-evidence", evidence.accepted, evidence.status, evidence.nextAction, {
      evidenceId: evidence.evidenceId,
      blocker: evidence.blocker?.label ?? null,
    }),
    mailchimpDecisionGate("restart-journal", restartJournal.validation.restartSafe, restartJournal.exportSummary.status, restartJournal.nextAction, {
      journalId: restartJournal.journalId,
      blockedEntryIds: restartJournal.validation.blockedEntryIds,
    }),
    mailchimpDecisionGate("next-action-queue", queue.ready, queue.status, queue.nextAction, {
      blockedCount: queue.counters.blocked,
      retryableCount: queue.counters.retryable,
    }),
  ]);
  const blocker = gates.find((gate) => !gate.accepted) ?? null;
  const accepted = !blocker;
  const status = mailchimpDecisionStatus(blocker, workflow, evidence, adapterStatus);
  const missing = Object.freeze([...new Set([
    ...workflow.validationSummary.missing,
    ...evidence.gates.filter((gate) => !gate.accepted).map((gate) => gate.label),
    ...restartJournal.validation.blockedEntryIds.map((id) => `restart:${id}`),
    ...queue.items.filter((item) => item.blocked).map((item) => item.source),
  ])].sort());
  const decisionId = [
    "mailchimp-handoff-decision",
    workflow.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    workflow.boundary.workspace ?? "workspace",
    workflow.boundary.tenant ?? "tenant",
    workflow.sync.cursor,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-handoff-decision.v1",
    decisionId,
    sourceId: stream?.metadata?.sourceId ?? null,
    accepted,
    status,
    adapter,
    provider: "mailchimp",
    operation: workflow.operation,
    boundary: workflow.boundary,
    sync: Object.freeze({
      syncKey: workflow.sync.syncKey,
      evidenceId: evidence.evidenceId,
      journalId: restartJournal.journalId,
      cursor: workflow.sync.cursor,
      checkpointCursor: workflow.sync.checkpointCursor,
      statusChannel: workflow.sync.statusChannel,
      auditChannel: workflow.sync.auditChannel,
      restoreCommand: workflow.sync.restoreCommand,
    }),
    validationSummary: Object.freeze({
      workflowReady: workflow.ready,
      adapterReady: adapterStatus.parserHandoff.accepted,
      evidenceReady: evidence.accepted,
      restartSafe: restartJournal.validation.restartSafe,
      queueReady: queue.ready,
      missing,
    }),
    gates,
    workflow: workflow.exportSummary,
    adapterStatus: adapterStatus.exportSummary,
    evidence: evidence.exportSummary,
    restartJournal: restartJournal.exportSummary,
    nextActionQueue: queue.exportSummary,
    controls: Object.freeze({
      canPreview: workflow.controls.canPreview,
      canAccept: workflow.controls.canAccept && adapterStatus.acceptance.controls.canAccept,
      canPersist: workflow.controls.canPersist && restartJournal.validation.restartSafe,
      canReplayRestore: workflow.controls.canReplayRestore || queue.controls.canRestoreCheckpoint,
      canPublishEvidence: evidence.controls.canPublishEvidence,
      canHandoffParser: accepted,
      canHandoffClient: accepted && workflow.controls.canHandoffClient,
      canRunNextAction: queue.controls.canRunNext,
    }),
    clientState: Object.freeze({
      ...workflow.clientState,
      decisionId,
      evidenceId: evidence.evidenceId,
      journalId: restartJournal.journalId,
      accepted,
      status,
      missing,
      nextAction: accepted ? "handoff-mailchimp-client" : blocker?.nextAction ?? queue.nextAction,
    }),
    exportSummary: Object.freeze({
      sourceId: stream?.metadata?.sourceId ?? null,
      status: accepted ? "mailchimp-handoff-approved" : "mailchimp-handoff-review",
      decisionId,
      evidenceId: evidence.evidenceId,
      syncKey: workflow.sync.syncKey,
      blockedGate: blocker?.label ?? null,
      missing,
      nextAction: accepted ? "handoff-mailchimp-client" : blocker?.nextAction ?? queue.nextAction,
    }),
    nextAction: accepted ? "handoff-mailchimp-client" : blocker?.nextAction ?? queue.nextAction,
  });
}

function providerHandoffReceiptId(service, boundary, stream, executionIntent, restartJournal) {
  return [
    "provider-handoff-receipt",
    service.provider,
    service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    executionIntent?.intentKey ?? "intent",
    restartJournal?.journalId ?? "journal",
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function providerHandoffReceiptStatus(missing, provider, executionIntent, mailchimpDecision) {
  if (missing.length === 0) {
    return provider === "mailchimp" ? "mailchimp-receipt-ready" : "receipt-ready";
  }

  if (missing.includes("scoped-boundary")) {
    return "boundary-review";
  }

  if (missing.includes("execution-intent")) {
    return executionIntent?.status ?? "execution-intent-review";
  }

  if (missing.includes("mailchimp-decision")) {
    return mailchimpDecision?.status ?? "mailchimp-review";
  }

  if (missing.includes("restart-journal")) {
    return "restart-review";
  }

  if (missing.includes("status-channel")) {
    return "status-review";
  }

  if (missing.includes("audit-channel")) {
    return "audit-review";
  }

  if (missing.includes("idempotency-key")) {
    return "idempotency-review";
  }

  return "receipt-review";
}

function providerHandoffReceiptNextAction(missing, executionIntent, restartJournal, boundaryIncident, mailchimpDecision) {
  if (missing.length === 0) {
    return "persist-provider-handoff-receipt";
  }

  if (missing.includes("scoped-boundary")) {
    return boundaryIncident.nextAction;
  }

  if (missing.includes("execution-intent")) {
    return executionIntent.nextAction;
  }

  if (missing.includes("mailchimp-decision")) {
    return mailchimpDecision?.nextAction ?? "review-mailchimp-handoff";
  }

  if (missing.includes("restart-journal")) {
    return restartJournal.nextAction;
  }

  if (missing.includes("status-channel")) {
    return "declare-status-channel";
  }

  if (missing.includes("audit-channel")) {
    return "declare-audit-channel";
  }

  if (missing.includes("idempotency-key")) {
    return "declare-idempotency-key";
  }

  return "review-provider-handoff-receipt";
}

export function createTokenStreamProviderHandoffReceipt(stream, options = {}) {
  const serviceContract = options.serviceContract ?? createTokenStreamProviderServiceContract(stream, {
    ...options,
    reason: options.reason ?? "provider-handoff-receipt",
  });
  const boundary = serviceContract.boundary;
  const service = serviceContract.service;
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    permissions: boundary.permissions,
    requiredPermissions: serviceContract.negotiation.requiredPermissions,
    auditChannel: serviceContract.acceptance.audit.channel,
    statusChannel: serviceContract.acceptance.statusChannel,
    reason: `${options.reason ?? "provider-handoff-receipt"}:restart-journal`,
  });
  const executionIntent = options.executionIntent ?? createTokenStreamExecutionIntentPacket(stream, {
    ...options,
    serviceContract,
    restartJournal,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    requiredPermissions: serviceContract.negotiation.requiredPermissions,
    auditChannel: serviceContract.acceptance.audit.channel,
    statusChannel: serviceContract.acceptance.statusChannel,
    reason: `${options.reason ?? "provider-handoff-receipt"}:execution-intent`,
  });
  const boundaryIncident = createTokenStreamBoundaryIncidentReport(stream, {
    ...options,
    permissions: boundary.permissions,
    requiredPermissions: serviceContract.negotiation.requiredPermissions,
    auditChannel: serviceContract.acceptance.audit.channel,
  });
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    permissions: boundary.permissions,
    requiredPermissions: serviceContract.negotiation.requiredPermissions,
    auditChannel: serviceContract.acceptance.audit.channel,
    reason: `${options.reason ?? "provider-handoff-receipt"}:health`,
  });
  const mailchimpDecision = service.provider === "mailchimp"
    ? options.mailchimpDecision ?? createTokenStreamMailchimpHandoffDecision(stream, {
        ...options,
        adapter: service.adapter,
        provider: service.provider,
        operation: service.operation,
        permissions: boundary.permissions,
        requiredPermissions: serviceContract.negotiation.requiredPermissions,
        auditChannel: serviceContract.acceptance.audit.channel,
        statusChannel: serviceContract.acceptance.statusChannel,
        restartJournal,
        reason: `${options.reason ?? "provider-handoff-receipt"}:mailchimp-decision`,
      })
    : null;
  const statusChannel = executionIntent.sync.statusChannel ?? serviceContract.sync.statusChannel;
  const auditChannel = executionIntent.sync.auditChannel ?? serviceContract.sync.auditChannel;
  const mutatingCommand = executionIntent.commands.find((command) => command.writesProvider) ?? null;
  const commandIds = Object.freeze([
    ...executionIntent.commands.map((command) => command.id),
    ...(mailchimpDecision ? [mailchimpDecision.decisionId] : []),
  ]);
  const auditReady = Boolean(auditChannel) || !serviceContract.acceptance.audit.required;
  const idempotencyReady = !mutatingCommand || mutatingCommand.idempotent;
  const missing = Object.freeze([
    health.ok ? null : "healthy-token-stream",
    boundaryIncident.blocked ? "scoped-boundary" : null,
    serviceContract.negotiation.accepted ? null : "provider-capability-negotiation",
    serviceContract.acceptance.accepted ? null : "preview-acceptance",
    executionIntent.accepted ? null : "execution-intent",
    restartJournal.validation.restartSafe ? null : "restart-journal",
    statusChannel ? null : "status-channel",
    auditReady ? null : "audit-channel",
    idempotencyReady ? null : "idempotency-key",
    mailchimpDecision && !mailchimpDecision.accepted ? "mailchimp-decision" : null,
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const receiptId = providerHandoffReceiptId(service, boundary, stream, executionIntent, restartJournal);
  const status = providerHandoffReceiptStatus(missing, service.provider, executionIntent, mailchimpDecision);
  const nextAction = providerHandoffReceiptNextAction(missing, executionIntent, restartJournal, boundaryIncident, mailchimpDecision);

  return Object.freeze({
    schema: "aios.token.stream.provider-handoff-receipt.v1",
    receiptId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: service.provider,
    operation: service.operation,
    adapter: service.adapter,
    accepted,
    status,
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
      incidentStatus: boundaryIncident.status,
    }),
    replay: Object.freeze({
      syncKey: serviceContract.sync.syncKey,
      intentKey: executionIntent.intentKey,
      restartJournalId: restartJournal.journalId,
      decisionId: mailchimpDecision?.decisionId ?? null,
      cursor: executionIntent.sync.cursor,
      checkpointCursor: restartJournal.checkpoint.cursor,
      restoreCommand: restartJournal.checkpoint.restoreCommand,
      commandIds,
    }),
    statusHandoff: Object.freeze({
      statusChannel,
      auditChannel,
      externalTraceId: executionIntent.sync.externalTraceId,
      observable: Boolean(statusChannel),
      auditReady,
      nextStatus: accepted ? "provider-handoff-recorded" : status,
    }),
    validationSummary: Object.freeze({
      tokenStreamReady: health.ok,
      boundaryReady: !boundaryIncident.blocked,
      capabilityReady: serviceContract.negotiation.accepted,
      previewAccepted: serviceContract.acceptance.accepted,
      executionIntentReady: executionIntent.accepted,
      restartSafe: restartJournal.validation.restartSafe,
      statusReady: Boolean(statusChannel),
      auditReady,
      idempotencyReady,
      mailchimpDecisionReady: mailchimpDecision?.accepted ?? true,
      missing,
    }),
    controls: Object.freeze({
      canPersistReceipt: accepted,
      canReplay: restartJournal.validation.restartSafe && idempotencyReady,
      canEmitStatus: Boolean(statusChannel),
      canExportAudit: Boolean(auditChannel),
      canHandoffProvider: accepted,
    }),
    artifacts: Object.freeze({
      serviceStatus: serviceContract.exportSummary.status,
      executionIntentStatus: executionIntent.exportSummary.status,
      restartJournalStatus: restartJournal.exportSummary.status,
      boundaryIncident: boundaryIncident.status,
      health: health.status,
      mailchimpDecision: mailchimpDecision?.exportSummary.status ?? "not-required",
    }),
    exportSummary: Object.freeze({
      receiptId,
      status: accepted ? "provider-handoff-receipt-ready" : status,
      accepted,
      provider: service.provider,
      operation: service.operation,
      syncKey: serviceContract.sync.syncKey,
      intentKey: executionIntent.intentKey,
      restartJournalId: restartJournal.journalId,
      missing,
      nextAction,
    }),
    nextAction,
  });
}

function externalStatusReceiptId(receipt, stream, statusChannel) {
  return [
    "provider-external-status-receipt",
    receipt.provider,
    receipt.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    receipt.replay.syncKey,
    statusChannel ?? "status",
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function normalizeExternalStatusEvent(event, index, receipt, statusChannel) {
  const status = String(event?.status ?? (receipt.accepted ? "provider-handoff-recorded" : receipt.status));
  const channel = stableBoundaryValue(event?.channel ?? statusChannel);
  const cursor = Number.isInteger(event?.cursor) ? Math.max(0, event.cursor) : receipt.replay.cursor;
  const payload = Object.freeze(Object.fromEntries(Object.entries(event?.payload ?? {})
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))));

  return Object.freeze({
    schema: "aios.token.stream.external-status.event.v1",
    id: event?.id ?? [
      receipt.receiptId,
      "status-event",
      index,
      status,
      channel ?? "channel",
    ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":"),
    sequence: Number.isInteger(event?.sequence) ? Math.max(0, event.sequence) : index,
    channel,
    status,
    cursor,
    externalTraceId: event?.externalTraceId ?? receipt.statusHandoff.externalTraceId,
    idempotencyKey: event?.idempotencyKey ?? null,
    payload,
    observed: event?.observed === true,
    acknowledged: event?.acknowledged === true,
    nextAction: event?.nextAction ?? (channel ? "emit-provider-status" : "declare-status-channel"),
  });
}

function externalStatusEventCounters(events) {
  const byStatus = {};
  let observed = 0;
  let acknowledged = 0;

  for (const event of events ?? []) {
    byStatus[event.status] = (byStatus[event.status] ?? 0) + 1;
    if (event.observed) {
      observed += 1;
    }
    if (event.acknowledged) {
      acknowledged += 1;
    }
  }

  return Object.freeze({
    total: Array.from(events ?? []).length,
    observed,
    acknowledged,
    pending: Math.max(0, Array.from(events ?? []).length - acknowledged),
    byStatus: Object.freeze(Object.fromEntries(Object.entries(byStatus).sort(([left], [right]) => left.localeCompare(right)))),
  });
}

export function createTokenStreamExternalProviderStatusReceipt(stream, options = {}) {
  const receipt = options.handoffReceipt ?? createTokenStreamProviderHandoffReceipt(stream, {
    ...options,
    reason: options.reason ?? "external-provider-status-receipt",
  });
  const statusChannel = stableBoundaryValue(options.statusChannel ?? receipt.statusHandoff.statusChannel);
  const auditChannel = stableBoundaryValue(options.auditChannel ?? receipt.statusHandoff.auditChannel);
  const baseEvents = [
    normalizeExternalStatusEvent({
      channel: statusChannel,
      status: receipt.accepted ? "provider-handoff-recorded" : receipt.status,
      cursor: receipt.replay.cursor,
      externalTraceId: receipt.statusHandoff.externalTraceId,
      payload: Object.freeze({
        receiptId: receipt.receiptId,
        provider: receipt.provider,
        operation: receipt.operation,
        syncKey: receipt.replay.syncKey,
      }),
      observed: receipt.accepted,
      acknowledged: false,
      nextAction: statusChannel ? "emit-provider-status" : "declare-status-channel",
    }, 0, receipt, statusChannel),
    normalizeExternalStatusEvent({
      channel: auditChannel,
      status: receipt.validationSummary.auditReady ? "audit-ready" : "audit-channel-missing",
      cursor: receipt.replay.checkpointCursor,
      externalTraceId: receipt.statusHandoff.externalTraceId,
      payload: Object.freeze({
        receiptId: receipt.receiptId,
        restartJournalId: receipt.replay.restartJournalId,
        missing: receipt.validationSummary.missing.join(","),
      }),
      observed: receipt.validationSummary.auditReady,
      acknowledged: false,
      nextAction: auditChannel ? "emit-provider-audit-status" : "declare-audit-channel",
    }, 1, receipt, statusChannel),
  ];
  const optionEvents = Array.from(options.statusEvents ?? []).map((event, index) => normalizeExternalStatusEvent(
    event,
    baseEvents.length + index,
    receipt,
    statusChannel,
  ));
  const events = Object.freeze([...baseEvents, ...optionEvents]
    .map((event, index) => Object.freeze({ ...event, sequence: index })));
  const duplicateEventIds = Object.freeze([...new Set(events
    .map((event) => event.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index))].sort());
  const statusObserved = events.some((event) => event.channel === statusChannel && event.observed);
  const auditObserved = !receipt.statusHandoff.auditReady || events.some((event) => event.channel === auditChannel && event.observed);
  const missing = Object.freeze([
    receipt.accepted ? null : "provider-handoff-receipt",
    statusChannel ? null : "status-channel",
    receipt.statusHandoff.auditReady ? null : "audit-channel",
    statusObserved ? null : "provider-status-observation",
    auditObserved ? null : "audit-status-observation",
    duplicateEventIds.length === 0 ? null : "unique-status-events",
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const receiptId = externalStatusReceiptId(receipt, stream, statusChannel);
  const blockedGate = missing[0] ?? null;

  return Object.freeze({
    schema: "aios.token.stream.external-provider-status-receipt.v1",
    receiptId,
    providerReceiptId: receipt.receiptId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: receipt.provider,
    operation: receipt.operation,
    adapter: receipt.adapter,
    accepted,
    status: accepted
      ? "external-status-receipt-ready"
      : blockedGate === "provider-handoff-receipt"
        ? receipt.status
        : blockedGate === "status-channel"
          ? "status-review"
          : blockedGate === "audit-channel"
            ? "audit-review"
            : blockedGate === "unique-status-events"
              ? "status-event-dedupe-review"
              : "status-observation-review",
    channels: Object.freeze({
      status: statusChannel,
      audit: auditChannel,
      externalTraceId: receipt.statusHandoff.externalTraceId,
    }),
    sync: Object.freeze({
      syncKey: receipt.replay.syncKey,
      intentKey: receipt.replay.intentKey,
      restartJournalId: receipt.replay.restartJournalId,
      checkpointCursor: receipt.replay.checkpointCursor,
      restoreCommand: receipt.replay.restoreCommand,
      commandIds: receipt.replay.commandIds,
    }),
    events,
    counters: externalStatusEventCounters(events),
    validationSummary: Object.freeze({
      receiptReady: receipt.accepted,
      statusReady: Boolean(statusChannel),
      auditReady: receipt.statusHandoff.auditReady,
      statusObserved,
      auditObserved,
      duplicateEventIds,
      missing,
    }),
    controls: Object.freeze({
      canEmitStatus: Boolean(statusChannel),
      canEmitAudit: Boolean(auditChannel),
      canAcknowledgeReceipt: accepted,
      canReplayStatus: receipt.controls.canReplay && duplicateEventIds.length === 0,
      canHandoffProvider: accepted && receipt.controls.canHandoffProvider,
    }),
    exportSummary: Object.freeze({
      receiptId,
      providerReceiptId: receipt.receiptId,
      status: accepted ? "external-status-receipt-ready" : "external-status-receipt-review",
      provider: receipt.provider,
      operation: receipt.operation,
      eventCount: events.length,
      pendingCount: externalStatusEventCounters(events).pending,
      missing,
      nextAction: accepted
        ? "acknowledge-provider-status-receipt"
        : blockedGate === "provider-handoff-receipt"
          ? receipt.nextAction
          : blockedGate === "status-channel"
            ? "declare-status-channel"
            : blockedGate === "audit-channel"
              ? "declare-audit-channel"
              : blockedGate === "unique-status-events"
                ? "dedupe-provider-status-events"
                : "observe-provider-status",
    }),
    receipt,
    nextAction: accepted
      ? "acknowledge-provider-status-receipt"
      : blockedGate === "provider-handoff-receipt"
        ? receipt.nextAction
        : blockedGate === "status-channel"
          ? "declare-status-channel"
          : blockedGate === "audit-channel"
            ? "declare-audit-channel"
            : blockedGate === "unique-status-events"
              ? "dedupe-provider-status-events"
              : "observe-provider-status",
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

function normalizeActionQueueInput(input, index, stream) {
  const summary = input?.exportSummary ?? input?.summary ?? input ?? {};
  const source = String(input?.source ?? summary.source ?? input?.schema ?? `artifact:${index}`);
  const status = String(input?.status ?? summary.status ?? "unknown");
  const nextAction = input?.nextAction ?? summary.nextAction ?? "continue";
  const accepted = input?.accepted ?? input?.ready ?? input?.ok ?? summary.accepted ?? summary.ready ?? summary.ok ?? false;
  const blocked = input?.blocked === true
    || input?.ok === false
    || input?.ready === false
    || status.includes("blocked")
    || status.includes("review")
    || status.includes("missing");
  const retryable = Boolean(input?.retryable ?? input?.recovery?.retryable ?? input?.retry?.maxAttempts > 0);
  const auditChannel = input?.audit?.channel
    ?? input?.acceptance?.audit?.channel
    ?? input?.sync?.auditChannel
    ?? stream?.metadata?.auditChannel
    ?? stream?.metadata?.boundary?.auditChannel
    ?? null;
  const cursor = Number.isInteger(input?.cursor)
    ? input.cursor
    : Number.isInteger(summary.cursor)
      ? summary.cursor
      : normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length);
  const severity = blocked
    ? status.includes("permission") || status.includes("boundary") || status.includes("blocked") ? "error" : "warning"
    : accepted
      ? "info"
      : "notice";

  return Object.freeze({
    schema: "aios.token.stream.next-action-queue.item.v1",
    id: stableCommandId("next-action", cursor, {
      source,
      status,
      nextAction,
      index,
    }),
    index,
    source,
    status,
    nextAction,
    cursor,
    accepted: Boolean(accepted) && !blocked,
    blocked,
    retryable,
    severity,
    auditChannel,
    controls: Object.freeze({
      canRetry: retryable && blocked,
      canAudit: Boolean(auditChannel),
      canContinue: !blocked,
    }),
  });
}

function actionQueuePriority(item) {
  if (item.blocked && item.severity === "error") {
    return 0;
  }

  if (item.blocked) {
    return 1;
  }

  if (item.retryable) {
    return 2;
  }

  if (!item.accepted) {
    return 3;
  }

  return 4;
}

export function createTokenStreamNextActionQueue(stream, artifacts = [], options = {}) {
  const health = options.includeHealth === false
    ? null
    : createTokenStreamHealthReport(stream, {
        ...options,
        reason: options.reason ?? "token-stream-next-action-queue",
      });
  const analytics = options.includeAnalytics === false
    ? null
    : createTokenStreamAnalyticsReport(stream, {
        ...options,
        reason: options.reason ?? "token-stream-next-action-queue",
      });
  const checkpoint = createTokenCheckpoint(stream, options.reason ?? "token-stream-next-action-queue");
  const boundaryIncident = createTokenStreamBoundaryIncidentReport(stream, options);
  const rawItems = [
    health ? Object.freeze({ source: "token-health", ...health }) : null,
    analytics ? Object.freeze({ source: "token-analytics", ...analytics.exportSummary, ok: analytics.ok, nextAction: analytics.nextAction }) : null,
    Object.freeze({
      source: "token-boundary",
      status: boundaryIncident.status,
      blocked: boundaryIncident.blocked,
      nextAction: boundaryIncident.nextAction,
      audit: boundaryIncident.audit,
      cursor: boundaryIncident.cursor,
    }),
    ...Array.from(artifacts ?? []),
  ].filter(Boolean);
  const items = Object.freeze(rawItems
    .map((item, index) => normalizeActionQueueInput(item, index, stream))
    .sort((left, right) => actionQueuePriority(left) - actionQueuePriority(right)
      || left.index - right.index
      || left.source.localeCompare(right.source)));
  const blocked = items.filter((item) => item.blocked);
  const retryable = items.filter((item) => item.retryable);
  const auditMissing = items.filter((item) => item.blocked && !item.auditChannel);
  const first = items[0] ?? null;
  const ready = blocked.length === 0 && checkpoint.restartSafe;

  return Object.freeze({
    schema: "aios.token.stream.next-action-queue.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    ready,
    status: ready
      ? "ready"
      : blocked.length > 0
        ? blocked[0].status
        : checkpoint.restartSafe
          ? "pending"
          : "checkpoint-review",
    cursor: normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
    checkpoint: Object.freeze({
      cursor: checkpoint.cursor,
      restartSafe: checkpoint.restartSafe,
      restoreCommand: checkpoint.clientState.restoreCommand,
    }),
    counters: Object.freeze({
      total: items.length,
      blocked: blocked.length,
      retryable: retryable.length,
      auditMissing: auditMissing.length,
      accepted: items.filter((item) => item.accepted).length,
    }),
    items,
    controls: Object.freeze({
      canRunNext: ready || Boolean(first && !first.blocked),
      canRetry: retryable.length > 0,
      canExportAudit: items.some((item) => item.controls.canAudit),
      canRestoreCheckpoint: Boolean(checkpoint.clientState.restoreCommand),
    }),
    exportSummary: Object.freeze({
      sourceId: stream?.metadata?.sourceId ?? null,
      status: ready ? "next-action-ready" : blocked[0]?.status ?? "next-action-review",
      nextAction: ready ? "continue" : first?.nextAction ?? "review-next-action-queue",
      blockedCount: blocked.length,
      retryableCount: retryable.length,
      checkpointRestartSafe: checkpoint.restartSafe,
    }),
    nextAction: ready ? "continue" : first?.nextAction ?? "review-next-action-queue",
  });
}

function operatorLaneMode(queue, options = {}) {
  const requested = String(options.mode ?? options.workflowMode ?? "").trim();
  if (["preview", "acceptance", "schedule", "handoff", "recovery"].includes(requested)) {
    return requested;
  }

  if (queue.counters.blocked > 0) {
    return queue.counters.retryable > 0 ? "recovery" : "acceptance";
  }

  if (options.scheduledAt || options.schedule === "manual" || options.schedule === "scheduled") {
    return "schedule";
  }

  return queue.ready ? "handoff" : "preview";
}

function operatorDecisionForQueue(queue, mode, stream, options = {}) {
  const firstBlocked = queue.items.find((item) => item.blocked) ?? null;
  const firstRetryable = queue.items.find((item) => item.retryable) ?? null;
  const firstPending = queue.items.find((item) => !item.accepted) ?? null;
  const primary = firstBlocked ?? firstRetryable ?? firstPending ?? queue.items[0] ?? null;
  const provider = stableBoundaryValue(options.provider) ?? stableBoundaryValue(options.adapter)?.split(".")[0] ?? "runtime";
  const operation = stableBoundaryValue(options.operation)
    ?? stableBoundaryValue(options.adapter)?.split(".").slice(1).join(".")
    ?? "run";
  const statusChannel = stableBoundaryValue(options.statusChannel)
    ?? stream?.metadata?.auditChannel
    ?? stream?.metadata?.boundary?.auditChannel
    ?? null;
  const auditChannel = stableBoundaryValue(options.auditChannel)
    ?? stream?.metadata?.auditChannel
    ?? stream?.metadata?.boundary?.auditChannel
    ?? null;
  const disabled = options.enabled === false || options.lifecycleEnabled === false;
  const scheduleRequired = mode === "schedule" || Boolean(options.scheduledAt);
  const scheduleReady = !scheduleRequired || Boolean(options.scheduledAt) || options.schedule === "manual";
  const acceptedBy = stableBoundaryValue(options.acceptedBy);
  const requiresAcceptance = options.requiresAcceptance ?? provider === "mailchimp";
  const acceptanceReady = !requiresAcceptance || Boolean(acceptedBy);
  const statusReady = Boolean(statusChannel);
  const auditReady = Boolean(auditChannel) || queue.counters.auditMissing === 0;
  const missing = Object.freeze([
    disabled ? "workflow-enabled" : null,
    queue.checkpoint.restartSafe ? null : "restart-safe-checkpoint",
    queue.counters.blocked === 0 ? null : primary?.source ?? "next-action-blocker",
    acceptanceReady ? null : "operator-acceptance",
    statusReady ? null : "status-channel",
    auditReady ? null : "audit-channel",
    scheduleReady ? null : "schedule",
  ].filter(Boolean));
  const accepted = missing.length === 0 && queue.ready;
  const commandId = stableCommandId("operator-decision", queue.cursor, {
    mode,
    provider,
    operation,
    source: primary?.source,
    action: primary?.nextAction,
  });

  return Object.freeze({
    schema: "aios.token.stream.operator-decision.v1",
    commandId,
    accepted,
    mode,
    provider,
    operation,
    status: disabled
      ? "disabled"
      : accepted
        ? "accepted"
        : missing.includes("operator-acceptance")
          ? "awaiting-acceptance"
          : missing.includes("status-channel")
            ? "status-review"
            : missing.includes("audit-channel")
              ? "audit-review"
              : missing.includes("schedule")
                ? "schedule-review"
                : queue.status,
    sourceId: stream?.metadata?.sourceId ?? null,
    cursor: queue.cursor,
    primaryAction: primary
      ? Object.freeze({
          source: primary.source,
          status: primary.status,
          nextAction: primary.nextAction,
          retryable: primary.retryable,
          auditChannel: primary.auditChannel,
        })
      : null,
    sync: Object.freeze({
      statusChannel,
      auditChannel,
      scheduledAt: stableBoundaryValue(options.scheduledAt),
      externalTraceId: stableBoundaryValue(options.externalTraceId) ?? commandId,
      checkpointCursor: queue.checkpoint.cursor,
    }),
    validationSummary: Object.freeze({
      enabled: !disabled,
      queueReady: queue.ready,
      checkpointReady: queue.checkpoint.restartSafe,
      acceptanceReady,
      statusReady,
      auditReady,
      scheduleReady,
      blockedCount: queue.counters.blocked,
      retryableCount: queue.counters.retryable,
      missing,
    }),
    controls: Object.freeze({
      canEnable: disabled,
      canDisable: !disabled,
      canPreview: !disabled && queue.items.length > 0,
      canAccept: !disabled && queue.counters.blocked === 0 && statusReady,
      canRetry: !disabled && queue.counters.retryable > 0,
      canSchedule: !disabled && queue.counters.blocked === 0 && acceptanceReady,
      canRunNow: accepted && mode !== "schedule",
      canHandoff: accepted,
      canEmitStatus: statusReady,
      canExportAudit: auditReady,
    }),
    nextStep: Object.freeze({
      label: accepted ? "Provider handoff" : primary?.nextAction ?? "review-operator-decision",
      action: accepted
        ? "handoff-provider"
        : disabled
          ? "enable-provider-workflow"
          : missing.includes("operator-acceptance")
            ? "accept-provider-preview"
            : missing.includes("status-channel")
              ? "declare-status-channel"
              : missing.includes("audit-channel")
                ? "declare-audit-channel"
                : missing.includes("schedule")
                  ? "declare-provider-schedule"
                  : primary?.nextAction ?? "review-operator-decision",
      retryable: Boolean(primary?.retryable),
      requiresOperator: !accepted,
    }),
    nextAction: accepted
      ? "handoff-provider"
      : disabled
        ? "enable-provider-workflow"
        : missing.includes("operator-acceptance")
          ? "accept-provider-preview"
          : missing.includes("status-channel")
            ? "declare-status-channel"
            : missing.includes("audit-channel")
              ? "declare-audit-channel"
              : missing.includes("schedule")
                ? "declare-provider-schedule"
                : primary?.nextAction ?? "review-operator-decision",
  });
}

export function createTokenStreamOperatorDecisionLane(stream, artifacts = [], options = {}) {
  const laneArtifacts = Array.from(artifacts ?? []);
  const queue = options.nextActionQueue && laneArtifacts.length === 0
    ? options.nextActionQueue
    : createTokenStreamNextActionQueue(stream, laneArtifacts, {
        ...options,
        reason: options.reason ?? "token-stream-operator-decision-lane",
      });
  const mode = operatorLaneMode(queue, options);
  const decision = operatorDecisionForQueue(queue, mode, stream, options);
  const blocked = queue.items.filter((item) => item.blocked);
  const retryable = queue.items.filter((item) => item.retryable);
  const lanes = Object.freeze([
    Object.freeze({
      schema: "aios.token.stream.operator-decision-lane.item.v1",
      label: "blocked",
      count: blocked.length,
      active: blocked.length > 0,
      action: blocked[0]?.nextAction ?? "continue",
      sources: Object.freeze(blocked.map((item) => item.source)),
    }),
    Object.freeze({
      schema: "aios.token.stream.operator-decision-lane.item.v1",
      label: "retryable",
      count: retryable.length,
      active: blocked.length === 0 && retryable.length > 0,
      action: retryable[0]?.nextAction ?? "continue",
      sources: Object.freeze(retryable.map((item) => item.source)),
    }),
    Object.freeze({
      schema: "aios.token.stream.operator-decision-lane.item.v1",
      label: mode,
      count: queue.items.length,
      active: blocked.length === 0,
      action: decision.nextAction,
      sources: Object.freeze(queue.items.map((item) => item.source)),
    }),
  ]);

  return Object.freeze({
    schema: "aios.token.stream.operator-decision-lane.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    ready: decision.accepted,
    status: decision.accepted ? "decision-ready" : decision.status,
    mode,
    queue,
    decision,
    lanes,
    controls: decision.controls,
    exportSummary: Object.freeze({
      sourceId: stream?.metadata?.sourceId ?? null,
      status: decision.accepted ? "operator-decision-ready" : "operator-decision-review",
      mode,
      commandId: decision.commandId,
      blockedCount: queue.counters.blocked,
      retryableCount: queue.counters.retryable,
      missing: decision.validationSummary.missing,
      nextAction: decision.nextAction,
    }),
    nextAction: decision.nextAction,
  });
}

function clientHandoffBlockerFrom(packetParts) {
  return Object.freeze(Array.from(packetParts ?? [])
    .filter((part) => part && part.accepted === false)
    .sort((left, right) => (left.priority ?? 99) - (right.priority ?? 99))[0] ?? null);
}

function clientHandoffPart(label, priority, accepted, status, nextAction, details = {}) {
  return Object.freeze({
    schema: "aios.token.stream.client-handoff.part.v1",
    label,
    priority,
    accepted: Boolean(accepted),
    status: status ?? "unknown",
    nextAction: nextAction ?? "review-client-handoff",
    details: Object.freeze(details),
  });
}

export function createTokenStreamClientHandoffPacket(stream, options = {}) {
  const service = options.serviceContract ?? createTokenStreamProviderServiceContract(stream, {
    ...options,
    reason: options.reason ?? "client-handoff-packet",
  });
  const readiness = options.readinessPreview ?? createTokenStreamProviderReadinessPreview(stream, {
    ...options,
    adapter: service.service.adapter,
    provider: service.service.provider,
    operation: service.service.operation,
    permissions: service.boundary.permissions,
    auditChannel: service.acceptance.audit.channel,
    statusChannel: service.acceptance.statusChannel,
    acceptedBy: service.acceptance.acceptedBy,
    requestedCapabilities: service.negotiation.requestedCapabilities,
    enabled: service.service.enabled,
    reason: `${options.reason ?? "client-handoff-packet"}:readiness`,
  });
  const acceptance = options.acceptanceSummary ?? createTokenStreamProviderAcceptanceSummary(stream, {
    ...options,
    readinessPreview: readiness,
    reason: `${options.reason ?? "client-handoff-packet"}:acceptance`,
  });
  const adapterStatus = options.adapterStatus ?? createTokenStreamAdapterStatusPacket(stream, {
    ...options,
    adapter: service.service.adapter,
    provider: service.service.provider,
    operation: service.service.operation,
    permissions: service.boundary.permissions,
    auditChannel: service.acceptance.audit.channel,
    statusChannel: service.acceptance.statusChannel,
    acceptedBy: service.acceptance.acceptedBy,
    requestedCapabilities: service.negotiation.requestedCapabilities,
    enabled: service.service.enabled,
    reason: `${options.reason ?? "client-handoff-packet"}:adapter-status`,
  });
  const evidence = options.handoffEvidence ?? createTokenStreamHandoffEvidencePacket(stream, {
    ...options,
    adapter: service.service.adapter,
    provider: service.service.provider,
    operation: service.service.operation,
    permissions: service.boundary.permissions,
    auditChannel: service.acceptance.audit.channel,
    statusChannel: service.acceptance.statusChannel,
    acceptedBy: service.acceptance.acceptedBy,
    requestedCapabilities: service.negotiation.requestedCapabilities,
    enabled: service.service.enabled,
    reason: `${options.reason ?? "client-handoff-packet"}:evidence`,
  });
  const mailchimpDecision = service.service.provider === "mailchimp"
    ? options.mailchimpDecision ?? createTokenStreamMailchimpHandoffDecision(stream, {
        ...options,
        adapter: service.service.adapter,
        provider: service.service.provider,
        operation: service.service.operation,
        permissions: service.boundary.permissions,
        auditChannel: service.acceptance.audit.channel,
        statusChannel: service.acceptance.statusChannel,
        acceptedBy: service.acceptance.acceptedBy,
        requestedCapabilities: service.negotiation.requestedCapabilities,
        adapterStatus,
        handoffEvidence: evidence,
        restartJournal: options.restartJournal,
        reason: `${options.reason ?? "client-handoff-packet"}:mailchimp-decision`,
      })
    : null;
  const queue = createTokenStreamNextActionQueue(stream, [
    clientHandoffPart("provider-readiness", 10, readiness.accepted, readiness.status, readiness.nextAction, readiness.explanation.validationSummary),
    clientHandoffPart("preview-acceptance", 20, acceptance.accepted, acceptance.status, acceptance.nextAction, acceptance.validationSummary),
    clientHandoffPart("adapter-status", 30, adapterStatus.parserHandoff.accepted, adapterStatus.parserHandoff.status, adapterStatus.parserHandoff.nextAction, {
      blockedGate: adapterStatus.parserHandoff.blockedGate,
      syncKey: adapterStatus.sync.syncKey,
    }),
    clientHandoffPart("handoff-evidence", 40, evidence.accepted, evidence.status, evidence.nextAction, {
      evidenceId: evidence.evidenceId,
      blocker: evidence.blocker?.label ?? null,
    }),
    mailchimpDecision
      ? clientHandoffPart("mailchimp-decision", 50, mailchimpDecision.accepted, mailchimpDecision.status, mailchimpDecision.nextAction, {
          decisionId: mailchimpDecision.decisionId,
          blockedGate: mailchimpDecision.exportSummary.blockedGate,
        })
      : null,
  ].filter(Boolean), {
    ...options,
    includeAnalytics: false,
    permissions: service.boundary.permissions,
    requiredPermissions: service.negotiation.requiredPermissions,
    auditChannel: service.acceptance.audit.channel,
    reason: `${options.reason ?? "client-handoff-packet"}:queue`,
  });
  const parts = Object.freeze([
    clientHandoffPart("token-stream", 0, queue.checkpoint.restartSafe && queue.counters.blocked === 0, queue.status, queue.nextAction, {
      checkpointCursor: queue.checkpoint.cursor,
      restartSafe: queue.checkpoint.restartSafe,
    }),
    clientHandoffPart("provider-readiness", 10, readiness.accepted, readiness.status, readiness.nextAction, readiness.explanation.validationSummary),
    clientHandoffPart("preview-acceptance", 20, acceptance.accepted, acceptance.status, acceptance.nextAction, acceptance.validationSummary),
    clientHandoffPart("adapter-status", 30, adapterStatus.parserHandoff.accepted, adapterStatus.parserHandoff.status, adapterStatus.parserHandoff.nextAction, {
      blockedGate: adapterStatus.parserHandoff.blockedGate,
    }),
    clientHandoffPart("handoff-evidence", 40, evidence.accepted, evidence.status, evidence.nextAction, {
      evidenceId: evidence.evidenceId,
      blocker: evidence.blocker?.label ?? null,
    }),
    mailchimpDecision
      ? clientHandoffPart("mailchimp-decision", 50, mailchimpDecision.accepted, mailchimpDecision.status, mailchimpDecision.nextAction, {
          decisionId: mailchimpDecision.decisionId,
          missing: mailchimpDecision.validationSummary.missing,
        })
      : null,
  ].filter(Boolean));
  const blocker = clientHandoffBlockerFrom(parts);
  const accepted = !blocker && queue.ready;
  const missing = Object.freeze([...new Set(parts
    .filter((part) => !part.accepted)
    .flatMap((part) => [
      part.label,
      ...(Array.isArray(part.details?.missing) ? part.details.missing : []),
    ]))].sort());

  return Object.freeze({
    schema: "aios.token.stream.client-handoff-packet.v1",
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: service.service.provider,
    operation: service.service.operation,
    adapter: service.service.adapter,
    accepted,
    ready: accepted,
    status: accepted ? "client-handoff-ready" : blocker?.status ?? queue.status,
    boundary: Object.freeze({
      workspace: service.boundary.workspace,
      tenant: service.boundary.tenant,
      role: service.boundary.role,
      localOnly: service.boundary.localOnly,
    }),
    sync: Object.freeze({
      syncKey: service.sync.syncKey,
      cursor: service.sync.cursor,
      checkpointCursor: service.sync.checkpointCursor,
      statusChannel: service.sync.statusChannel,
      auditChannel: service.sync.auditChannel,
      manifestId: service.externalHandoffManifest.manifestId,
      evidenceId: evidence.evidenceId,
      decisionId: mailchimpDecision?.decisionId ?? null,
      restoreCommand: adapterStatus.sync.restoreCommand,
    }),
    validationSummary: Object.freeze({
      tokenStreamReady: queue.checkpoint.restartSafe && queue.counters.blocked === 0,
      providerReady: readiness.accepted,
      previewAccepted: acceptance.accepted,
      adapterReady: adapterStatus.parserHandoff.accepted,
      evidenceReady: evidence.accepted,
      mailchimpDecisionReady: mailchimpDecision?.accepted ?? true,
      missing,
    }),
    parts,
    blocker: blocker
      ? Object.freeze({
          label: blocker.label,
          status: blocker.status,
          nextAction: blocker.nextAction,
        })
      : null,
    nextActionQueue: queue.exportSummary,
    routeContract: Object.freeze({
      method: "POST",
      action: accepted ? "handoff-provider-client" : blocker?.nextAction ?? queue.nextAction,
      idempotencyKey: `${service.sync.syncKey}:client-handoff`,
      requiresOperator: !accepted && (
        blocker?.label === "preview-acceptance"
        || blocker?.label === "mailchimp-decision"
        || acceptance.explanation.nextStep.requiresOperator
      ),
      retryable: !accepted && (queue.counters.retryable > 0 || acceptance.explanation.nextStep.retryable),
    }),
    controls: Object.freeze({
      canPreview: acceptance.controls.canPreview,
      canAccept: acceptance.controls.canAccept,
      canPublishEvidence: evidence.controls.canPublishEvidence,
      canRunNextAction: queue.controls.canRunNext,
      canRestoreCheckpoint: queue.controls.canRestoreCheckpoint,
      canHandoffClient: accepted,
    }),
    exportSummary: Object.freeze({
      sourceId: stream?.metadata?.sourceId ?? null,
      status: accepted ? "client-handoff-ready" : "client-handoff-review",
      provider: service.service.provider,
      operation: service.service.operation,
      syncKey: service.sync.syncKey,
      blockedGate: blocker?.label ?? null,
      missing,
      nextAction: accepted ? "handoff-provider-client" : blocker?.nextAction ?? queue.nextAction,
    }),
    nextAction: accepted ? "handoff-provider-client" : blocker?.nextAction ?? queue.nextAction,
  });
}

function clientLaunchGateId(stream, provider, operation, syncKey) {
  return [
    "token-client-launch-gate",
    provider,
    operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    syncKey,
    normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function clientLaunchChecklistItem(label, accepted, status, nextAction, details = {}) {
  return Object.freeze({
    schema: "aios.token.stream.client-launch-gate.item.v1",
    label,
    accepted: Boolean(accepted),
    status,
    nextAction,
    details: Object.freeze(details),
  });
}

function clientLaunchBlocker(items) {
  return Array.from(items ?? []).find((item) => !item.accepted) ?? null;
}

export function createTokenStreamClientLaunchGate(stream, options = {}) {
  const handoff = options.clientHandoffPacket ?? createTokenStreamClientHandoffPacket(stream, {
    ...options,
    reason: options.reason ?? "client-launch-gate",
  });
  const operations = options.operationsPacket ?? createTokenStreamOperationsPacket(stream, [
    Object.freeze({
      source: "client-handoff",
      accepted: handoff.accepted,
      status: handoff.status,
      blocked: !handoff.accepted,
      retryable: handoff.routeContract.retryable,
      nextAction: handoff.nextAction,
      audit: Object.freeze({
        channel: handoff.sync.auditChannel,
      }),
      references: Object.freeze({
        syncKey: handoff.sync.syncKey,
        blockedGate: handoff.exportSummary.blockedGate,
      }),
      controls: Object.freeze({
        canRetry: handoff.routeContract.retryable,
        canContinueDegraded: false,
        canExportAudit: Boolean(handoff.sync.auditChannel),
      }),
    }),
  ], {
    ...options,
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: handoff.sync.auditChannel,
    reason: `${options.reason ?? "client-launch-gate"}:operations`,
  });
  const statusReady = Boolean(handoff.sync.statusChannel);
  const auditReady = Boolean(handoff.sync.auditChannel) || !handoff.routeContract.requiresOperator;
  const routeReady = handoff.accepted && !handoff.routeContract.requiresOperator;
  const operationsReady = operations.ready;
  const items = Object.freeze([
    clientLaunchChecklistItem("client-handoff", handoff.accepted, handoff.status, handoff.nextAction, {
      blockedGate: handoff.exportSummary.blockedGate,
      missing: handoff.validationSummary.missing,
    }),
    clientLaunchChecklistItem("status-channel", statusReady, statusReady ? "status-ready" : "status-review", statusReady ? "continue" : "declare-status-channel", {
      statusChannel: handoff.sync.statusChannel,
    }),
    clientLaunchChecklistItem("audit-channel", auditReady, auditReady ? "audit-ready" : "audit-review", auditReady ? "continue" : "declare-audit-channel", {
      auditChannel: handoff.sync.auditChannel,
      requiresOperator: handoff.routeContract.requiresOperator,
    }),
    clientLaunchChecklistItem("operation-packet", operationsReady, operations.status, operations.nextAction, {
      packetId: operations.packetId,
      blockedCount: operations.counters.blocked,
      retryableCount: operations.counters.retryable,
    }),
    clientLaunchChecklistItem("route-intent", routeReady, routeReady ? "route-ready" : "route-review", routeReady ? "launch-client-route" : handoff.nextAction, {
      method: handoff.routeContract.method,
      action: handoff.routeContract.action,
      idempotencyKey: handoff.routeContract.idempotencyKey,
    }),
  ]);
  const blocker = clientLaunchBlocker(items);
  const accepted = !blocker;
  const launchGateId = clientLaunchGateId(stream, handoff.provider, handoff.operation, handoff.sync.syncKey);
  const missing = Object.freeze([...new Set(items
    .filter((item) => !item.accepted)
    .flatMap((item) => [
      item.label,
      ...(Array.isArray(item.details?.missing) ? item.details.missing : []),
    ]))].sort());

  return Object.freeze({
    schema: "aios.token.stream.client-launch-gate.v1",
    launchGateId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: handoff.provider,
    operation: handoff.operation,
    adapter: handoff.adapter,
    accepted,
    status: accepted ? "client-launch-ready" : blocker?.status ?? "client-launch-review",
    boundary: handoff.boundary,
    sync: Object.freeze({
      syncKey: handoff.sync.syncKey,
      manifestId: handoff.sync.manifestId,
      evidenceId: handoff.sync.evidenceId,
      decisionId: handoff.sync.decisionId,
      statusChannel: handoff.sync.statusChannel,
      auditChannel: handoff.sync.auditChannel,
      restoreCommand: handoff.sync.restoreCommand,
      operationsPacketId: operations.packetId,
    }),
    validationSummary: Object.freeze({
      clientHandoffReady: handoff.accepted,
      statusReady,
      auditReady,
      operationsReady,
      routeReady,
      missing,
    }),
    checklist: items,
    blocker: blocker
      ? Object.freeze({
          label: blocker.label,
          status: blocker.status,
          nextAction: blocker.nextAction,
        })
      : null,
    controls: Object.freeze({
      canPreview: handoff.controls.canPreview,
      canAccept: handoff.controls.canAccept,
      canRestoreCheckpoint: handoff.controls.canRestoreCheckpoint,
      canEmitStatus: statusReady,
      canExportAudit: Boolean(handoff.sync.auditChannel),
      canLaunchClient: accepted,
      canRetry: !accepted && operations.recovery.strategy !== "operator-review",
    }),
    routeContract: Object.freeze({
      ...handoff.routeContract,
      action: accepted ? "launch-client-route" : blocker?.nextAction ?? handoff.routeContract.action,
      launchGateId,
      requiresOperator: !accepted && (handoff.routeContract.requiresOperator || blocker?.label === "audit-channel"),
      retryable: !accepted && (handoff.routeContract.retryable || operations.recovery.strategy !== "operator-review"),
    }),
    operations: operations.exportSummary,
    exportSummary: Object.freeze({
      launchGateId,
      status: accepted ? "client-launch-ready" : "client-launch-review",
      provider: handoff.provider,
      operation: handoff.operation,
      syncKey: handoff.sync.syncKey,
      blockedGate: blocker?.label ?? null,
      missing,
      nextAction: accepted ? "launch-client-route" : blocker?.nextAction ?? handoff.nextAction,
    }),
    nextAction: accepted ? "launch-client-route" : blocker?.nextAction ?? handoff.nextAction,
  });
}

function mailchimpRoutePhase(label, accepted, status, nextAction, details = {}) {
  return Object.freeze({
    schema: "aios.token.stream.mailchimp-route.phase.v1",
    label,
    accepted: Boolean(accepted),
    status,
    nextAction,
    details: Object.freeze(details),
  });
}

function mailchimpRouteHeadline(provider, operation, accepted, blocker) {
  if (accepted) {
    return `${provider}.${operation} is ready for client handoff.`;
  }

  return `${provider}.${operation} is waiting on ${blocker?.nextAction ?? "review-mailchimp-route"}.`;
}

export function createTokenStreamMailchimpClientRouteState(stream, options = {}) {
  const service = createTokenStreamProviderServiceContract(stream, {
    ...options,
    adapter: options.adapter ?? options.expectedAdapter ?? "mailchimp.syncAudience",
    provider: "mailchimp",
    operation: options.operation,
    reason: options.reason ?? "mailchimp-client-route-state",
  });
  const routeOptions = Object.freeze({
    ...options,
    adapter: service.service.adapter,
    provider: "mailchimp",
    operation: service.service.operation,
    permissions: service.boundary.permissions,
    auditChannel: service.acceptance.audit.channel,
    statusChannel: service.acceptance.statusChannel,
    acceptedBy: service.acceptance.acceptedBy,
    requestedCapabilities: service.negotiation.requestedCapabilities,
    reason: options.reason ?? "mailchimp-client-route-state",
  });
  const readiness = options.readinessPreview ?? createTokenStreamProviderReadinessPreview(stream, routeOptions);
  const acceptance = options.acceptanceSummary ?? createTokenStreamProviderAcceptanceSummary(stream, {
    ...routeOptions,
    readinessPreview: readiness,
  });
  const workflow = options.workflowSession ?? createTokenStreamMailchimpWorkflowSession(stream, routeOptions);
  const decision = options.mailchimpDecision ?? createTokenStreamMailchimpHandoffDecision(stream, {
    ...routeOptions,
    workflowSession: workflow,
  });
  const clientHandoff = options.clientHandoffPacket ?? createTokenStreamClientHandoffPacket(stream, {
    ...routeOptions,
    serviceContract: service,
    readinessPreview: readiness,
    acceptanceSummary: acceptance,
    mailchimpDecision: decision,
  });
  const resumption = options.resumptionManifest ?? createTokenStreamResumptionManifest(stream, {
    ...routeOptions,
    adapter: service.service.adapter,
    provider: "mailchimp",
    operation: service.service.operation,
    clientHandoffPacket: clientHandoff,
  });
  const phases = Object.freeze([
    mailchimpRoutePhase("preview", readiness.accepted, readiness.status, readiness.nextAction, readiness.explanation.validationSummary),
    mailchimpRoutePhase("acceptance", acceptance.accepted, acceptance.status, acceptance.nextAction, acceptance.validationSummary),
    mailchimpRoutePhase("workflow", workflow.ready, workflow.status, workflow.nextAction, workflow.validationSummary),
    mailchimpRoutePhase("decision", decision.accepted, decision.status, decision.nextAction, decision.validationSummary),
    mailchimpRoutePhase("client-handoff", clientHandoff.accepted, clientHandoff.status, clientHandoff.nextAction, clientHandoff.validationSummary),
    mailchimpRoutePhase("resumption", resumption.ready, resumption.status, resumption.nextAction, {
      manifestId: resumption.manifestId,
      firstBlocked: resumption.exportSummary.firstBlocked,
    }),
  ]);
  const blocker = phases.find((phase) => !phase.accepted) ?? null;
  const accepted = !blocker;
  const missing = Object.freeze([...new Set(phases
    .filter((phase) => !phase.accepted)
    .flatMap((phase) => [
      phase.label,
      ...(Array.isArray(phase.details?.missing) ? phase.details.missing : []),
    ]))].sort());
  const routeStateId = [
    "mailchimp-client-route",
    service.service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    service.boundary.workspace ?? "workspace",
    service.boundary.tenant ?? "tenant",
    service.sync.cursor,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-client-route-state.v1",
    routeStateId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: "mailchimp",
    operation: service.service.operation,
    adapter: service.service.adapter,
    accepted,
    ready: accepted,
    status: accepted ? "route-ready" : blocker.status,
    headline: mailchimpRouteHeadline("mailchimp", service.service.operation, accepted, blocker),
    boundary: Object.freeze({
      workspace: service.boundary.workspace,
      tenant: service.boundary.tenant,
      role: service.boundary.role,
      localOnly: service.boundary.localOnly,
    }),
    sync: Object.freeze({
      syncKey: service.sync.syncKey,
      routeStateId,
      decisionId: decision.decisionId,
      manifestId: resumption.manifestId,
      cursor: service.sync.cursor,
      checkpointCursor: service.sync.checkpointCursor,
      statusChannel: service.sync.statusChannel,
      auditChannel: service.sync.auditChannel,
      restoreCommand: clientHandoff.sync.restoreCommand,
    }),
    phases,
    blocker: blocker
      ? Object.freeze({
          label: blocker.label,
          status: blocker.status,
          nextAction: blocker.nextAction,
        })
      : null,
    validationSummary: Object.freeze({
      previewReady: readiness.accepted,
      acceptanceReady: acceptance.accepted,
      workflowReady: workflow.ready,
      decisionReady: decision.accepted,
      clientHandoffReady: clientHandoff.accepted,
      resumptionReady: resumption.ready,
      missing,
    }),
    routeContract: Object.freeze({
      method: "POST",
      action: accepted ? "launch-mailchimp-client-route" : blocker.nextAction,
      idempotencyKey: `${service.sync.syncKey}:mailchimp-route`,
      requiresOperator: !accepted && (blocker.label === "acceptance" || blocker.label === "decision"),
      retryable: !accepted && (workflow.validationSummary.restartSafe || resumption.controls.canRetryAutomatically),
    }),
    controls: Object.freeze({
      canPreview: readiness.serviceContract.preview.health.ok,
      canAccept: acceptance.controls.canAccept,
      canResume: resumption.controls.canResume,
      canRestoreCheckpoint: resumption.controls.canReplayRestore,
      canEmitStatus: Boolean(service.sync.statusChannel),
      canLaunchClientRoute: accepted,
    }),
    clientState: Object.freeze({
      ...clientHandoff.clientState,
      routeStateId,
      routeStatus: accepted ? "route-ready" : blocker.status,
      routeNextAction: accepted ? "launch-mailchimp-client-route" : blocker.nextAction,
      missing,
    }),
    exportSummary: Object.freeze({
      routeStateId,
      status: accepted ? "mailchimp-client-route-ready" : "mailchimp-client-route-review",
      syncKey: service.sync.syncKey,
      blockedPhase: blocker?.label ?? null,
      missing,
      nextAction: accepted ? "launch-mailchimp-client-route" : blocker.nextAction,
    }),
    nextAction: accepted ? "launch-mailchimp-client-route" : blocker.nextAction,
  });
}

function resumptionManifestGate(label, accepted, status, nextAction, details = {}) {
  return Object.freeze({
    schema: "aios.token.stream.resumption-manifest.gate.v1",
    label,
    accepted: Boolean(accepted),
    blocked: !accepted,
    status: status ?? (accepted ? "accepted" : "review"),
    nextAction: accepted ? "continue" : nextAction ?? "review-resumption-gate",
    details: Object.freeze(details),
  });
}

export function createTokenStreamResumptionManifest(stream, options = {}) {
  const adapter = options.adapter ?? null;
  const provider = options.provider ?? (adapter ? String(adapter).split(".")[0] : "runtime");
  const operation = options.operation ?? (adapter ? String(adapter).split(".").slice(1).join(".") || "run" : "run");
  const requiredPermissions = stableStringSet(options.requiredPermissions ?? []);
  const boundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  const auditChannel = options.auditChannel ?? boundary.auditChannel ?? null;
  const statusChannel = options.statusChannel ?? auditChannel;
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    auditChannel,
    statusChannel,
    requiredPermissions,
    reason: options.reason ?? "token-stream-resumption-manifest",
  });
  const health = options.health ?? createTokenStreamHealthReport(stream, {
    ...options,
    auditChannel,
    requiredPermissions,
    reason: options.reason ?? "token-stream-resumption-manifest",
  });
  const analytics = options.analytics ?? createTokenStreamAnalyticsReport(stream, {
    ...options,
    auditChannel,
    requiredPermissions,
    reason: options.reason ?? "token-stream-resumption-manifest",
  });
  const clientHandoff = adapter
    ? options.clientHandoffPacket ?? createTokenStreamClientHandoffPacket(stream, {
        ...options,
        adapter,
        provider,
        operation,
        permissions: options.permissions ?? boundary.permissions,
        requiredPermissions,
        auditChannel,
        statusChannel,
        restartJournal,
        reason: options.reason ?? "token-stream-resumption-manifest",
      })
    : null;
  const gates = Object.freeze([
    resumptionManifestGate("checkpoint", restartJournal.checkpoint.restartSafe, restartJournal.checkpoint.restartSafe ? "restart-safe" : "checkpoint-review", restartJournal.nextAction, {
      cursor: restartJournal.checkpoint.cursor,
      restoreCommandId: restartJournal.checkpoint.restoreCommand.id,
    }),
    resumptionManifestGate("restart-journal", restartJournal.validation.restartSafe, restartJournal.exportSummary.status, restartJournal.nextAction, {
      journalId: restartJournal.journalId,
      blockedEntryIds: restartJournal.validation.blockedEntryIds,
      duplicateIds: restartJournal.validation.duplicateIds,
    }),
    resumptionManifestGate("boundary-health", health.ok && !health.boundaryIncident.blocked, health.boundaryIncident.blocked ? health.boundaryIncident.status : health.status, health.nextAction, {
      boundaryStatus: health.boundary.status,
      incidentId: health.boundaryIncident.incidentId,
      missingPermissions: health.boundary.missingPermissions,
    }),
    resumptionManifestGate("analytics-export", analytics.ok, analytics.exportSummary.status, analytics.nextAction, {
      tokenCount: analytics.counters.tokenCount,
      commandCount: analytics.counters.commandCount,
      diagnosticCount: analytics.counters.diagnosticCount,
    }),
    resumptionManifestGate("status-audit", Boolean(statusChannel) && (restartJournal.audit.status === "audit-ready" || !restartJournal.audit.required), statusChannel ? restartJournal.audit.status : "status-channel-missing", statusChannel ? restartJournal.nextAction : "declare-status-channel", {
      statusChannel,
      auditChannel,
      auditRequired: restartJournal.audit.required,
    }),
    clientHandoff
      ? resumptionManifestGate("client-handoff", clientHandoff.accepted, clientHandoff.status, clientHandoff.nextAction, {
          provider: clientHandoff.provider,
          operation: clientHandoff.operation,
          syncKey: clientHandoff.sync.syncKey,
          blockedGate: clientHandoff.blocker?.label ?? null,
        })
      : null,
  ].filter(Boolean));
  const blocked = gates.filter((gate) => gate.blocked);
  const firstBlocked = blocked[0] ?? null;
  const manifestId = [
    "token-resumption-manifest",
    provider,
    operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    restartJournal.cursor,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");

  return Object.freeze({
    schema: "aios.token.stream.resumption-manifest.v1",
    manifestId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider,
    operation,
    adapter,
    ready: blocked.length === 0,
    status: blocked.length === 0 ? "resumption-ready" : firstBlocked.status,
    boundary,
    sync: Object.freeze({
      cursor: restartJournal.cursor,
      journalId: restartJournal.journalId,
      statusChannel,
      auditChannel,
      restoreCommand: restartJournal.checkpoint.restoreCommand,
      clientSyncKey: clientHandoff?.sync.syncKey ?? null,
    }),
    gates,
    restartJournal: restartJournal.exportSummary,
    health: Object.freeze({
      ok: health.ok,
      status: health.status,
      boundaryIncident: health.boundaryIncident.status,
      retry: health.retry,
    }),
    analytics: analytics.exportSummary,
    clientHandoff: clientHandoff?.exportSummary ?? null,
    controls: Object.freeze({
      canResume: blocked.length === 0,
      canReplayRestore: restartJournal.checkpoint.restartSafe,
      canExportAudit: Boolean(auditChannel),
      canHandoffClient: Boolean(clientHandoff?.accepted),
      canRetryAutomatically: blocked.length === 0 || health.retry.maxAttempts > 0,
    }),
    exportSummary: Object.freeze({
      manifestId,
      status: blocked.length === 0 ? "resumption-ready" : "resumption-review",
      blockedCount: blocked.length,
      firstBlocked: firstBlocked?.label ?? null,
      nextAction: blocked.length === 0 ? "resume-runtime-handoff" : firstBlocked.nextAction,
    }),
    nextAction: blocked.length === 0 ? "resume-runtime-handoff" : firstBlocked.nextAction,
  });
}

function resumptionStatusPhase(manifest, health, restartJournal) {
  if (!manifest.ready) {
    return manifest.exportSummary.firstBlocked === "status-audit"
      ? "awaiting-status-channel"
      : manifest.exportSummary.firstBlocked === "boundary-health"
        ? "awaiting-boundary-repair"
        : manifest.exportSummary.firstBlocked === "restart-journal"
          ? "awaiting-journal-repair"
          : "awaiting-resumption-gate";
  }

  if (health.status === "degraded") {
    return "resume-degraded";
  }

  return restartJournal.validation.restartSafe ? "resume-ready" : "awaiting-checkpoint";
}

export function createTokenStreamResumptionStatusEnvelope(stream, options = {}) {
  const boundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  const requiredPermissions = stableStringSet(options.requiredPermissions ?? []);
  const auditChannel = options.auditChannel ?? boundary.auditChannel ?? null;
  const statusChannel = options.statusChannel ?? auditChannel;
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    auditChannel,
    statusChannel,
    requiredPermissions,
    reason: options.reason ?? "token-stream-resumption-status",
  });
  const health = options.health ?? createTokenStreamHealthReport(stream, {
    ...options,
    auditChannel,
    statusChannel,
    requiredPermissions,
    reason: options.reason ?? "token-stream-resumption-status",
  });
  const analytics = options.analytics ?? createTokenStreamAnalyticsReport(stream, {
    ...options,
    auditChannel,
    statusChannel,
    requiredPermissions,
    reason: options.reason ?? "token-stream-resumption-status",
  });
  const manifest = options.resumptionManifest ?? createTokenStreamResumptionManifest(stream, {
    ...options,
    auditChannel,
    statusChannel,
    requiredPermissions,
    restartJournal,
    health,
    analytics,
    reason: options.reason ?? "token-stream-resumption-status",
  });
  const phase = resumptionStatusPhase(manifest, health, restartJournal);
  const tokenCount = Array.from(stream?.tokens ?? []).length;
  const cursor = normalizeCursor(stream?.cursor, tokenCount);
  const replaySafe = manifest.ready
    && restartJournal.validation.restartSafe
    && !health.boundaryIncident.blocked
    && (health.retry.maxAttempts === 0 || health.retry.strategy !== "manual-boundary-correction");
  const missing = Object.freeze([
    manifest.ready ? null : manifest.exportSummary.firstBlocked ?? "resumption-manifest",
    restartJournal.validation.restartSafe ? null : "restart-journal",
    health.ok ? null : "token-health",
    analytics.ok ? null : "analytics-export",
    statusChannel ? null : "status-channel",
    auditChannel || !restartJournal.audit.required ? null : "audit-channel",
  ].filter(Boolean));
  const envelopeId = [
    "token-resumption-status",
    options.provider ?? manifest.provider ?? "runtime",
    options.operation ?? manifest.operation ?? "run",
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    cursor,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");

  return Object.freeze({
    schema: "aios.token.stream.resumption-status-envelope.v1",
    envelopeId,
    sourceId: stream?.metadata?.sourceId ?? null,
    phase,
    ready: manifest.ready && missing.length === 0,
    replaySafe,
    status: manifest.ready && missing.length === 0
      ? "resumption-status-ready"
      : phase,
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
    }),
    cursor: Object.freeze({
      current: cursor,
      tokenCount,
      checkpoint: restartJournal.checkpoint.cursor,
      eof: currentToken(stream).type === TOKEN_TYPES.EOF,
    }),
    restore: Object.freeze({
      command: restartJournal.checkpoint.restoreCommand,
      journalId: restartJournal.journalId,
      manifestId: manifest.manifestId,
      restartSafe: restartJournal.validation.restartSafe,
      blockedEntryIds: restartJournal.validation.blockedEntryIds,
    }),
    channels: Object.freeze({
      status: statusChannel,
      audit: auditChannel,
      auditStatus: restartJournal.audit.status,
    }),
    counters: Object.freeze({
      tokens: tokenCount,
      diagnostics: analytics.counters.diagnosticCount,
      commands: analytics.counters.commandCount,
      blockedGates: manifest.exportSummary.blockedCount,
      missing: missing.length,
    }),
    health: Object.freeze({
      status: health.status,
      retry: health.retry,
      boundaryIncident: health.boundaryIncident.status,
      tenantBoundary: health.tenantBoundaryReadiness.status,
    }),
    manifest: manifest.exportSummary,
    missing,
    controls: Object.freeze({
      canResume: manifest.ready && missing.length === 0,
      canReplay: replaySafe,
      canEmitStatus: Boolean(statusChannel),
      canExportAudit: Boolean(auditChannel),
      canRetry: health.retry.maxAttempts > 0 && !health.boundaryIncident.blocked,
    }),
    exportSummary: Object.freeze({
      envelopeId,
      status: manifest.ready && missing.length === 0 ? "resumption-status-ready" : "resumption-status-review",
      phase,
      firstMissing: missing[0] ?? null,
      nextAction: manifest.ready && missing.length === 0
        ? "resume-runtime-handoff"
        : missing.includes("status-channel")
          ? "declare-status-channel"
          : missing.includes("audit-channel")
            ? "declare-audit-channel"
            : manifest.nextAction ?? health.nextAction,
    }),
    nextAction: manifest.ready && missing.length === 0
      ? "resume-runtime-handoff"
      : missing.includes("status-channel")
        ? "declare-status-channel"
        : missing.includes("audit-channel")
          ? "declare-audit-channel"
          : manifest.nextAction ?? health.nextAction,
  });
}

export function createTokenStreamRestartStatusReconciliation(stream, options = {}) {
  const boundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  const requiredPermissions = stableStringSet(options.requiredPermissions ?? []);
  const auditChannel = options.auditChannel ?? boundary.auditChannel ?? null;
  const statusChannel = options.statusChannel ?? auditChannel;
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    auditChannel,
    statusChannel,
    requiredPermissions,
    reason: options.reason ?? "token-stream-restart-status-reconciliation",
  });
  const health = options.health ?? createTokenStreamHealthReport(stream, {
    ...options,
    auditChannel,
    statusChannel,
    requiredPermissions,
    reason: options.reason ?? "token-stream-restart-status-reconciliation",
  });
  const analytics = options.analytics ?? createTokenStreamAnalyticsReport(stream, {
    ...options,
    auditChannel,
    statusChannel,
    requiredPermissions,
    reason: options.reason ?? "token-stream-restart-status-reconciliation",
  });
  const manifest = options.resumptionManifest ?? createTokenStreamResumptionManifest(stream, {
    ...options,
    auditChannel,
    statusChannel,
    requiredPermissions,
    restartJournal,
    health,
    analytics,
    reason: options.reason ?? "token-stream-restart-status-reconciliation",
  });
  const envelope = options.statusEnvelope ?? createTokenStreamResumptionStatusEnvelope(stream, {
    ...options,
    auditChannel,
    statusChannel,
    requiredPermissions,
    restartJournal,
    health,
    analytics,
    resumptionManifest: manifest,
    reason: options.reason ?? "token-stream-restart-status-reconciliation",
  });
  const statusEvents = Object.freeze(Array.from(options.statusEvents ?? [])
    .map((event, index) => Object.freeze({
      schema: "aios.token.stream.restart-status-event.v1",
      sequence: Number.isInteger(event?.sequence) ? event.sequence : index,
      channel: event?.channel ?? statusChannel,
      status: event?.status ?? "unknown",
      cursor: Number.isInteger(event?.cursor)
        ? normalizeCursor(event.cursor, Array.from(stream?.tokens ?? []).length)
        : envelope.cursor.current,
      idempotencyKey: event?.idempotencyKey ?? options.idempotencyKey ?? null,
      accepted: event?.accepted !== false,
    })));
  const expectedStatuses = stableStringSet(options.expectedStatuses ?? [
    manifest.ready ? "resumption-ready" : manifest.status,
    envelope.ready ? "resumption-status-ready" : envelope.phase,
  ]);
  const observedStatuses = stableStringSet(statusEvents.map((event) => event.status));
  const statusCoverage = Object.freeze(expectedStatuses.map((status) => Object.freeze({
    status,
    observed: observedStatuses.includes(status)
      || statusEvents.some((event) => String(event.status).includes(status) || String(status).includes(event.status)),
  })));
  const missingStatuses = Object.freeze(statusCoverage.filter((entry) => !entry.observed).map((entry) => entry.status));
  const idempotencyStatusKeys = statusEvents
    .map((event) => event.idempotencyKey ? `${event.idempotencyKey}:${event.status}` : null)
    .filter(Boolean);
  const duplicateIdempotencyKeys = Object.freeze([...new Set(idempotencyStatusKeys
    .filter((key, index, keys) => keys.indexOf(key) !== index))].sort());
  const missing = Object.freeze([
    manifest.ready ? null : manifest.exportSummary.firstBlocked ?? "resumption-manifest",
    envelope.ready ? null : envelope.exportSummary.firstMissing ?? "resumption-status-envelope",
    restartJournal.validation.restartSafe ? null : "restart-journal",
    health.ok ? null : "token-health",
    analytics.ok ? null : "analytics-export",
    statusChannel ? null : "status-channel",
    auditChannel || !restartJournal.audit.required ? null : "audit-channel",
    missingStatuses.length === 0 ? null : "status-observation",
    duplicateIdempotencyKeys.length === 0 ? null : "duplicate-idempotency-status",
  ].filter(Boolean));
  const accepted = missing.length === 0;
  const reconciliationId = [
    "token-restart-status-reconciliation",
    options.provider ?? manifest.provider ?? "runtime",
    options.operation ?? manifest.operation ?? "run",
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    envelope.cursor.current,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");

  return Object.freeze({
    schema: "aios.token.stream.restart-status-reconciliation.v1",
    reconciliationId,
    sourceId: stream?.metadata?.sourceId ?? null,
    accepted,
    status: accepted
      ? "restart-status-reconciled"
      : missing.includes("status-observation")
        ? "status-observation-review"
        : missing.includes("duplicate-idempotency-status")
          ? "idempotency-status-review"
          : envelope.status,
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
    }),
    channels: envelope.channels,
    restore: envelope.restore,
    expectedStatuses,
    observedStatuses,
    statusCoverage,
    statusEvents,
    missingStatuses,
    duplicateIdempotencyKeys,
    missing,
    validationSummary: Object.freeze({
      manifestReady: manifest.ready,
      envelopeReady: envelope.ready,
      restartJournalReady: restartJournal.validation.restartSafe,
      healthReady: health.ok,
      analyticsReady: analytics.ok,
      statusReady: Boolean(statusChannel),
      auditReady: Boolean(auditChannel) || !restartJournal.audit.required,
      observationsReady: missingStatuses.length === 0,
      idempotencyReady: duplicateIdempotencyKeys.length === 0,
      missing,
    }),
    controls: Object.freeze({
      canResume: accepted && envelope.controls.canResume,
      canReplay: accepted && envelope.controls.canReplay,
      canEmitStatus: Boolean(statusChannel),
      canExportAudit: Boolean(auditChannel),
      canAcceptObservedStatus: missingStatuses.length === 0 && duplicateIdempotencyKeys.length === 0,
    }),
    exportSummary: Object.freeze({
      reconciliationId,
      status: accepted ? "restart-status-reconciled" : "restart-status-review",
      firstMissing: missing[0] ?? null,
      missingStatuses,
      observedCount: statusEvents.length,
      nextAction: accepted
        ? "resume-runtime-handoff"
        : missing.includes("status-channel")
          ? "declare-status-channel"
          : missing.includes("audit-channel")
            ? "declare-audit-channel"
            : missing.includes("status-observation")
              ? "emit-restart-status-observation"
              : missing.includes("duplicate-idempotency-status")
                ? "dedupe-idempotency-status-events"
                : envelope.nextAction,
    }),
    nextAction: accepted
      ? "resume-runtime-handoff"
      : missing.includes("status-channel")
        ? "declare-status-channel"
        : missing.includes("audit-channel")
          ? "declare-audit-channel"
          : missing.includes("status-observation")
            ? "emit-restart-status-observation"
            : missing.includes("duplicate-idempotency-status")
              ? "dedupe-idempotency-status-events"
              : envelope.nextAction,
  });
}

function mailchimpReadinessLedgerId(service, stream, syncKey) {
  const boundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  return [
    "mailchimp-readiness-ledger",
    service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    syncKey ?? "sync",
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function readinessLedgerGate(label, accepted, status, nextAction, details = {}) {
  return Object.freeze({
    schema: "aios.token.stream.mailchimp-readiness-ledger.gate.v1",
    label,
    accepted: Boolean(accepted),
    status,
    nextAction,
    details: Object.freeze(details),
  });
}

function readinessGateCounters(gates) {
  const byStatus = {};
  for (const gate of gates ?? []) {
    byStatus[gate.status] = (byStatus[gate.status] ?? 0) + 1;
  }

  return Object.freeze({
    total: Array.from(gates ?? []).length,
    accepted: Array.from(gates ?? []).filter((gate) => gate.accepted).length,
    blocked: Array.from(gates ?? []).filter((gate) => !gate.accepted).length,
    byStatus: Object.freeze(Object.fromEntries(Object.entries(byStatus).sort(([left], [right]) => left.localeCompare(right)))),
  });
}

export function createTokenStreamMailchimpReadinessLedger(stream, options = {}) {
  const service = normalizeProviderServiceOptions({
    ...options,
    provider: "mailchimp",
    adapter: options.adapter ?? `mailchimp.${options.operation ?? "syncAudience"}`,
    operation: options.operation ?? "syncAudience",
  });
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel,
  });
  const serviceContract = options.serviceContract ?? createTokenStreamProviderServiceContract(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: options.statusChannel ?? boundary.auditChannel,
    reason: options.reason ?? "mailchimp-readiness-ledger-service",
  });
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "mailchimp-readiness-ledger-health",
  });
  const analytics = createTokenStreamAnalyticsReport(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "mailchimp-readiness-ledger-analytics",
  });
  const acceptanceSummary = options.acceptanceSummary ?? createTokenStreamProviderAcceptanceSummary(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: options.statusChannel ?? boundary.auditChannel,
    reason: options.reason ?? "mailchimp-readiness-ledger-acceptance",
  });
  const adapterStatus = options.adapterStatus ?? createTokenStreamAdapterStatusPacket(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: options.statusChannel ?? boundary.auditChannel,
    reason: options.reason ?? "mailchimp-readiness-ledger-adapter-status",
  });
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: options.statusChannel ?? serviceContract.sync.statusChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "mailchimp-readiness-ledger-restart-journal",
  });
  const handoffEvidence = options.handoffEvidence ?? createTokenStreamHandoffEvidencePacket(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: options.statusChannel ?? boundary.auditChannel,
    reason: options.reason ?? "mailchimp-readiness-ledger-evidence",
  });
  const mailchimpDecision = options.mailchimpDecision ?? createTokenStreamMailchimpHandoffDecision(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: options.statusChannel ?? boundary.auditChannel,
    adapterStatus,
    handoffEvidence,
    restartJournal,
    reason: options.reason ?? "mailchimp-readiness-ledger-decision",
  });
  const executionIntent = options.executionIntent ?? createTokenStreamExecutionIntentPacket(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: options.statusChannel ?? boundary.auditChannel,
    serviceContract,
    restartJournal,
    reason: options.reason ?? "mailchimp-readiness-ledger-execution-intent",
  });
  const resumptionManifest = options.resumptionManifest ?? createTokenStreamResumptionManifest(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: options.statusChannel ?? boundary.auditChannel,
    restartJournal,
    health,
    analytics,
    reason: options.reason ?? "mailchimp-readiness-ledger-resumption",
  });
  const mutating = service.requiredPermissions.includes("mailchimp.write");
  const idempotencyKey = stableBoundaryValue(options.idempotencyKey);
  const idempotencyReady = !mutating || Boolean(idempotencyKey);
  const gates = Object.freeze([
    readinessLedgerGate("token-health", health.ok, health.status, health.nextAction, {
      cursor: health.cursor,
      retry: health.retry,
      boundaryIncident: health.boundaryIncident.status,
    }),
    readinessLedgerGate("analytics-export", analytics.ok, analytics.exportSummary.status, analytics.nextAction, {
      tokenCount: analytics.counters.tokenCount,
      diagnosticCount: analytics.counters.diagnosticCount,
      commandCount: analytics.counters.commandCount,
    }),
    readinessLedgerGate("provider-capabilities", serviceContract.negotiation.accepted, serviceContract.negotiation.status, serviceContract.negotiation.nextAction, {
      requestedCapabilities: serviceContract.negotiation.requestedCapabilities,
      missingPermissions: serviceContract.negotiation.missingPermissions,
      unsupportedCapabilities: serviceContract.negotiation.unsupportedCapabilities,
    }),
    readinessLedgerGate("preview-acceptance", acceptanceSummary.accepted, acceptanceSummary.status, acceptanceSummary.nextAction, {
      acceptedBy: acceptanceSummary.acceptedBy,
      missing: acceptanceSummary.validationSummary.missing,
      requiresUserAcceptance: serviceContract.acceptance.requiresUserAcceptance,
    }),
    readinessLedgerGate("adapter-status", adapterStatus.parserHandoff.accepted, adapterStatus.parserHandoff.status, adapterStatus.nextAction, {
      blockedGate: adapterStatus.parserHandoff.blockedGate,
      syncKey: adapterStatus.sync.syncKey,
    }),
    readinessLedgerGate("handoff-evidence", handoffEvidence.accepted, handoffEvidence.exportSummary.status, handoffEvidence.nextAction, {
      evidenceId: handoffEvidence.evidenceId,
      blockedGate: handoffEvidence.exportSummary.blockedGate,
    }),
    readinessLedgerGate("mailchimp-decision", mailchimpDecision.accepted, mailchimpDecision.status, mailchimpDecision.nextAction, {
      decisionId: mailchimpDecision.decisionId,
      blockedGate: mailchimpDecision.blockedGate,
    }),
    readinessLedgerGate("execution-intent", executionIntent.accepted, executionIntent.status, executionIntent.nextAction, {
      intentKey: executionIntent.intentKey,
      missing: executionIntent.validationSummary.missing,
    }),
    readinessLedgerGate("resumption-manifest", resumptionManifest.ready, resumptionManifest.status, resumptionManifest.nextAction, {
      manifestId: resumptionManifest.manifestId,
      firstBlocked: resumptionManifest.exportSummary.firstBlocked,
    }),
    readinessLedgerGate("idempotency", idempotencyReady, idempotencyReady ? "idempotent" : "idempotency-review", idempotencyReady ? "continue" : "declare-idempotency-key", {
      mutating,
      idempotencyKey,
    }),
  ]);
  const blockedGate = gates.find((gate) => !gate.accepted) ?? null;
  const counters = readinessGateCounters(gates);
  const accepted = counters.blocked === 0;
  const ledgerId = mailchimpReadinessLedgerId(service, stream, serviceContract.sync.syncKey);
  const retryable = !accepted && health.retry.maxAttempts > 0 && blockedGate?.label !== "idempotency";

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-readiness-ledger.v1",
    ledgerId,
    sourceId: stream?.metadata?.sourceId ?? null,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    accepted,
    status: accepted ? "mailchimp-ready" : blockedGate.status,
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
    }),
    sync: Object.freeze({
      syncKey: serviceContract.sync.syncKey,
      cursor: serviceContract.sync.cursor,
      checkpointCursor: serviceContract.sync.checkpointCursor,
      statusChannel: serviceContract.sync.statusChannel,
      auditChannel: serviceContract.sync.auditChannel,
      restartJournalId: restartJournal.journalId,
      executionIntentId: executionIntent.intentKey,
      resumptionManifestId: resumptionManifest.manifestId,
    }),
    gates,
    blockedGate,
    counters,
    idempotency: Object.freeze({
      mutating,
      ready: idempotencyReady,
      key: idempotencyKey,
      nextAction: idempotencyReady ? "continue" : "declare-idempotency-key",
    }),
    audit: Object.freeze({
      channel: serviceContract.sync.auditChannel ?? restartJournal.audit.channel,
      required: serviceContract.acceptance.audit.required || restartJournal.audit.required,
      status: serviceContract.acceptance.audit.status === "audit-ready" || restartJournal.audit.status === "audit-ready"
        ? "audit-ready"
        : serviceContract.acceptance.audit.required || restartJournal.audit.required
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    controls: Object.freeze({
      canHandoffProvider: accepted,
      canRetryAutomatically: retryable,
      canExportAudit: Boolean(serviceContract.sync.auditChannel ?? restartJournal.audit.channel),
      canRunDegraded: !accepted && health.degradedMode.enabled && blockedGate?.label === "analytics-export",
      canReplayRestore: restartJournal.checkpoint.restartSafe,
      canEmitStatus: Boolean(serviceContract.sync.statusChannel),
    }),
    packets: Object.freeze({
      service: serviceContract.exportSummary,
      acceptance: acceptanceSummary.exportSummary,
      adapterStatus: adapterStatus.exportSummary,
      handoffEvidence: handoffEvidence.exportSummary,
      mailchimpDecision: mailchimpDecision.exportSummary,
      executionIntent: executionIntent.exportSummary,
      resumptionManifest: resumptionManifest.exportSummary,
      restartJournal: restartJournal.exportSummary,
    }),
    exportSummary: Object.freeze({
      ledgerId,
      status: accepted ? "mailchimp-readiness-ready" : "mailchimp-readiness-review",
      accepted,
      blockedGate: blockedGate?.label ?? null,
      blockedStatus: blockedGate?.status ?? null,
      nextAction: accepted ? "handoff-mailchimp-adapter" : blockedGate.nextAction,
    }),
    nextAction: accepted ? "handoff-mailchimp-adapter" : blockedGate.nextAction,
  });
}

function mailchimpRecoveryEnvelopeId(service, stream, ledger, restartJournal) {
  const boundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  return [
    "mailchimp-recovery-envelope",
    service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    ledger?.ledgerId ?? "ledger",
    restartJournal?.journalId ?? "journal",
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function mailchimpRecoveryBackoff(ledger, health, restartJournal, options = {}) {
  if (ledger.accepted) {
    return Object.freeze({
      strategy: "none",
      retryAfterMs: 0,
      maxAttempts: 0,
      reason: "mailchimp-ready",
    });
  }

  if (ledger.blockedGate?.label === "idempotency") {
    return Object.freeze({
      strategy: "manual-idempotency",
      retryAfterMs: null,
      maxAttempts: 0,
      reason: ledger.blockedGate.status,
    });
  }

  if (ledger.blockedGate?.label === "preview-acceptance") {
    return Object.freeze({
      strategy: "operator-acceptance",
      retryAfterMs: null,
      maxAttempts: 0,
      reason: ledger.blockedGate.status,
    });
  }

  if (restartJournal.validation.restartSafe && health.retry.maxAttempts > 0) {
    return Object.freeze({
      strategy: "restart-journal-replay",
      retryAfterMs: health.retry.retryAfterMs ?? 250,
      maxAttempts: Math.min(3, Math.max(1, health.retry.maxAttempts)),
      reason: ledger.blockedGate?.status ?? health.status,
    });
  }

  return Object.freeze({
    strategy: "manual-recovery",
    retryAfterMs: Number.isInteger(options.retryAfterMs) ? Math.max(0, options.retryAfterMs) : 500,
    maxAttempts: 0,
    reason: ledger.blockedGate?.status ?? restartJournal.exportSummary.status,
  });
}

export function createTokenStreamMailchimpRecoveryEnvelope(stream, options = {}) {
  const service = normalizeProviderServiceOptions({
    ...options,
    provider: "mailchimp",
    adapter: options.adapter ?? `mailchimp.${options.operation ?? "syncAudience"}`,
    operation: options.operation ?? "syncAudience",
  });
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel,
  });
  const health = options.health ?? createTokenStreamHealthReport(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "mailchimp-recovery-envelope",
  });
  const analytics = options.analytics ?? createTokenStreamAnalyticsReport(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "mailchimp-recovery-envelope",
  });
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: options.statusChannel ?? boundary.auditChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "mailchimp-recovery-envelope",
  });
  const ledger = options.mailchimpReadinessLedger ?? createTokenStreamMailchimpReadinessLedger(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: options.statusChannel ?? boundary.auditChannel,
    health,
    analytics,
    restartJournal,
    reason: options.reason ?? "mailchimp-recovery-envelope",
  });
  const resumptionManifest = options.resumptionManifest ?? createTokenStreamResumptionManifest(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: options.statusChannel ?? ledger.sync.statusChannel ?? boundary.auditChannel,
    health,
    analytics,
    restartJournal,
    reason: options.reason ?? "mailchimp-recovery-envelope",
  });
  const exportManifest = options.exportReadinessManifest ?? createTokenStreamExportReadinessManifest(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: options.statusChannel ?? ledger.sync.statusChannel ?? boundary.auditChannel,
    health,
    analytics,
    restartJournal,
    mailchimpReadinessLedger: ledger,
    reason: options.reason ?? "mailchimp-recovery-envelope",
  });
  const recoveryBackoff = mailchimpRecoveryBackoff(ledger, health, restartJournal, options);
  const replaySafe = restartJournal.validation.restartSafe
    && resumptionManifest.ready
    && (!ledger.idempotency.mutating || ledger.idempotency.ready);
  const degradedAllowed = !ledger.accepted
    && health.degradedMode.enabled
    && ledger.controls.canRunDegraded
    && restartJournal.validation.restartSafe;
  const missing = Object.freeze([
    health.ok || degradedAllowed ? null : "token-health",
    analytics.ok ? null : "analytics-export",
    restartJournal.validation.restartSafe ? null : "restart-journal",
    resumptionManifest.ready ? null : "resumption-manifest",
    exportManifest.ready ? null : "export-readiness",
    ledger.accepted || degradedAllowed ? null : ledger.blockedGate?.label ?? "mailchimp-readiness",
    ledger.idempotency.ready ? null : "idempotency-key",
    ledger.audit.status === "audit-ready" || !ledger.audit.required ? null : "audit-channel",
    ledger.sync.statusChannel ? null : "status-channel",
  ].filter(Boolean));
  const accepted = missing.length === 0 && ledger.accepted && replaySafe;
  const status = accepted
    ? "mailchimp-recovery-ready"
    : degradedAllowed
      ? "mailchimp-recovery-degraded"
      : missing.includes("idempotency-key")
        ? "idempotency-review"
        : missing.includes("restart-journal")
          ? restartJournal.exportSummary.status
          : missing.includes("resumption-manifest")
            ? resumptionManifest.status
            : ledger.status;
  const envelopeId = mailchimpRecoveryEnvelopeId(service, stream, ledger, restartJournal);

  return Object.freeze({
    schema: "aios.token.stream.mailchimp-recovery-envelope.v1",
    envelopeId,
    sourceId: stream?.metadata?.sourceId ?? null,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    accepted,
    status,
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
    }),
    sync: Object.freeze({
      syncKey: ledger.sync.syncKey,
      statusChannel: ledger.sync.statusChannel,
      auditChannel: ledger.sync.auditChannel,
      restartJournalId: restartJournal.journalId,
      resumptionManifestId: resumptionManifest.manifestId,
      exportManifestId: exportManifest.manifestId,
      checkpointCursor: restartJournal.checkpoint.cursor,
    }),
    recovery: Object.freeze({
      replaySafe,
      degradedAllowed,
      backoff: recoveryBackoff,
      restoreCommand: restartJournal.checkpoint.restoreCommand,
      blockedGate: ledger.blockedGate,
      nextReplayAction: replaySafe ? "replay-mailchimp-handoff" : restartJournal.nextAction,
    }),
    validationSummary: Object.freeze({
      healthReady: health.ok,
      analyticsReady: analytics.ok,
      restartReady: restartJournal.validation.restartSafe,
      resumptionReady: resumptionManifest.ready,
      exportReady: exportManifest.ready,
      readinessAccepted: ledger.accepted,
      idempotencyReady: ledger.idempotency.ready,
      auditReady: ledger.audit.status === "audit-ready" || !ledger.audit.required,
      statusReady: Boolean(ledger.sync.statusChannel),
      missing,
    }),
    counters: Object.freeze({
      tokenCount: analytics.counters.tokenCount,
      diagnosticCount: analytics.counters.diagnosticCount,
      commandCount: analytics.counters.commandCount,
      ledgerBlocked: ledger.counters.blocked,
      restartEntries: restartJournal.counters.total,
      resumptionBlocked: resumptionManifest.exportSummary.blockedCount ?? 0,
    }),
    packets: Object.freeze({
      health: Object.freeze({
        status: health.status,
        retry: health.retry,
        nextAction: health.nextAction,
      }),
      analytics: analytics.exportSummary,
      readinessLedger: ledger.exportSummary,
      restartJournal: restartJournal.exportSummary,
      resumptionManifest: resumptionManifest.exportSummary,
      exportReadiness: exportManifest.exportSummary,
    }),
    controls: Object.freeze({
      canReplay: replaySafe,
      canRetryAutomatically: recoveryBackoff.maxAttempts > 0,
      canRunDegraded: degradedAllowed,
      canEmitStatus: Boolean(ledger.sync.statusChannel),
      canExportAudit: Boolean(ledger.audit.channel),
      canHandoffMailchimp: accepted,
    }),
    exportSummary: Object.freeze({
      envelopeId,
      status: accepted ? "mailchimp-recovery-ready" : status,
      accepted,
      missing,
      retryAfterMs: recoveryBackoff.retryAfterMs,
      maxAttempts: recoveryBackoff.maxAttempts,
      nextAction: accepted
        ? "handoff-mailchimp-adapter"
        : degradedAllowed
          ? "handoff-mailchimp-degraded"
          : missing.includes("idempotency-key")
            ? "declare-idempotency-key"
            : ledger.nextAction,
    }),
    nextAction: accepted
      ? "handoff-mailchimp-adapter"
      : degradedAllowed
        ? "handoff-mailchimp-degraded"
        : missing.includes("idempotency-key")
          ? "declare-idempotency-key"
          : ledger.nextAction,
  });
}

function exportReadinessManifestId(stream, provider, operation) {
  const boundary = normalizeBoundaryContext(stream?.metadata?.boundary ?? stream?.metadata ?? {});
  return [
    "token-export-readiness",
    provider,
    operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

export function createTokenStreamExportReadinessManifest(stream, options = {}) {
  const service = normalizeProviderServiceOptions(options);
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel,
  });
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "token-stream-export-readiness",
  });
  const analytics = createTokenStreamAnalyticsReport(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "token-stream-export-readiness",
  });
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "token-stream-export-readiness",
  });
  const mailchimpLedger = service.provider === "mailchimp"
    ? options.mailchimpReadinessLedger ?? createTokenStreamMailchimpReadinessLedger(stream, {
        ...options,
        adapter: service.adapter,
        provider: service.provider,
        operation: service.operation,
        permissions: boundary.permissions,
        auditChannel: boundary.auditChannel,
        restartJournal,
        reason: options.reason ?? "token-stream-export-readiness",
      })
    : null;
  const statusChannel = options.statusChannel ?? boundary.auditChannel ?? mailchimpLedger?.sync?.statusChannel ?? null;
  const auditChannel = boundary.auditChannel ?? mailchimpLedger?.audit?.channel ?? null;
  const gates = Object.freeze([
    Object.freeze({
      schema: "aios.token.stream.export-readiness.gate.v1",
      label: "token-health",
      accepted: health.ok,
      status: health.status,
      nextAction: health.ok ? "continue" : health.nextAction,
    }),
    Object.freeze({
      schema: "aios.token.stream.export-readiness.gate.v1",
      label: "analytics",
      accepted: analytics.ok,
      status: analytics.exportSummary.status,
      nextAction: analytics.ok ? "continue" : analytics.nextAction,
    }),
    Object.freeze({
      schema: "aios.token.stream.export-readiness.gate.v1",
      label: "restart-journal",
      accepted: restartJournal.validation.restartSafe,
      status: restartJournal.exportSummary.status,
      nextAction: restartJournal.validation.restartSafe ? "continue" : restartJournal.nextAction,
    }),
    Object.freeze({
      schema: "aios.token.stream.export-readiness.gate.v1",
      label: "status-channel",
      accepted: Boolean(statusChannel),
      status: statusChannel ? "observable" : "status-channel-missing",
      nextAction: statusChannel ? "continue" : "declare-status-channel",
    }),
    Object.freeze({
      schema: "aios.token.stream.export-readiness.gate.v1",
      label: "mailchimp-readiness",
      accepted: service.provider !== "mailchimp" || mailchimpLedger.accepted,
      status: service.provider !== "mailchimp" ? "not-required" : mailchimpLedger.status,
      nextAction: service.provider !== "mailchimp" ? "continue" : mailchimpLedger.nextAction,
    }),
  ]);
  const blocked = gates.filter((gate) => !gate.accepted);
  const manifestId = exportReadinessManifestId(stream, service.provider, service.operation);

  return Object.freeze({
    schema: "aios.token.stream.export-readiness-manifest.v1",
    manifestId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: service.provider,
    operation: service.operation,
    adapter: service.adapter,
    ready: blocked.length === 0,
    status: blocked.length === 0 ? "export-ready" : blocked[0].status,
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
    }),
    sync: Object.freeze({
      cursor: analytics.history.cursor,
      checkpointCursor: analytics.history.checkpoint.cursor,
      restartJournalId: restartJournal.journalId,
      mailchimpLedgerId: mailchimpLedger?.ledgerId ?? null,
      statusChannel,
      auditChannel,
    }),
    counters: Object.freeze({
      gates: gates.length,
      blocked: blocked.length,
      tokenCount: analytics.counters.tokenCount,
      diagnosticCount: analytics.counters.diagnosticCount,
      commandCount: analytics.counters.commandCount,
      restartEntries: restartJournal.counters.total,
    }),
    gates,
    blockedGates: Object.freeze(blocked.map((gate) => gate.label)),
    validationSummary: Object.freeze({
      tokenHealthReady: health.ok,
      analyticsReady: analytics.ok,
      restartReady: restartJournal.validation.restartSafe,
      statusReady: Boolean(statusChannel),
      auditReady: Boolean(auditChannel) || !blocked.some((gate) => gate.label === "audit"),
      mailchimpReady: service.provider !== "mailchimp" || mailchimpLedger?.accepted === true,
      missing: Object.freeze(blocked.map((gate) => gate.label)),
    }),
    packets: Object.freeze({
      analytics: analytics.exportSummary,
      health: Object.freeze({
        status: health.status,
        cursor: health.cursor,
        nextAction: health.nextAction,
      }),
      restartJournal: restartJournal.exportSummary,
      mailchimpReadiness: mailchimpLedger?.exportSummary ?? null,
    }),
    controls: Object.freeze({
      canExport: blocked.length === 0,
      canReplayRestart: restartJournal.validation.restartSafe,
      canEmitStatus: Boolean(statusChannel),
      canExportAudit: Boolean(auditChannel),
      canHandoffMailchimp: service.provider === "mailchimp" && mailchimpLedger?.accepted === true,
    }),
    exportSummary: Object.freeze({
      manifestId,
      status: blocked.length === 0 ? "token-export-ready" : "token-export-review",
      provider: service.provider,
      operation: service.operation,
      blockedCount: blocked.length,
      firstBlocked: blocked[0]?.label ?? null,
      nextAction: blocked.length === 0 ? "publish-token-export-manifest" : blocked[0].nextAction,
    }),
    nextAction: blocked.length === 0 ? "publish-token-export-manifest" : blocked[0].nextAction,
  });
}

function lifecycleManifestId(stream, service, boundary) {
  return [
    "token-provider-lifecycle",
    service.provider,
    service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    boundary.workspace ?? "workspace",
    boundary.tenant ?? "tenant",
    boundary.role ?? "role",
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function normalizeProviderLifecycleSettings(options = {}) {
  const enabled = options.enabled !== false && options.lifecycleEnabled !== false;
  const mode = ["strict", "recover", "degraded"].includes(options.lifecycleMode)
    ? options.lifecycleMode
    : options.mode && ["strict", "recover", "degraded"].includes(options.mode)
      ? options.mode
      : "recover";
  const schedule = ["immediate", "on-source-update", "manual", "disabled"].includes(options.lifecycleSchedule)
    ? options.lifecycleSchedule
    : ["immediate", "on-source-update", "manual", "disabled"].includes(options.schedule)
      ? options.schedule
      : enabled ? "immediate" : "disabled";
  const maxAttempts = Number.isInteger(options.maxAttempts)
    ? Math.min(Math.max(0, options.maxAttempts), 10)
    : mode === "strict" ? 0 : 2;
  const retryAfterMs = Number.isInteger(options.retryAfterMs)
    ? Math.min(Math.max(0, options.retryAfterMs), 60000)
    : schedule === "immediate" ? 0 : 250;

  return Object.freeze({
    enabled,
    mode,
    schedule: enabled ? schedule : "disabled",
    maxAttempts: enabled ? maxAttempts : 0,
    retryAfterMs: enabled ? retryAfterMs : null,
    acceptedBy: stableBoundaryValue(options.acceptedBy),
    scheduledAt: stableBoundaryValue(options.scheduledAt),
    statusChannel: stableBoundaryValue(options.statusChannel),
    auditChannel: stableBoundaryValue(options.auditChannel),
  });
}

function lifecycleSettingDiagnostics(settings, service, boundary) {
  const diagnostics = [];

  if (!settings.enabled && settings.schedule !== "disabled") {
    diagnostics.push(stableDiagnostic(createDiagnostic(
      "TOKEN_PROVIDER_LIFECYCLE_DISABLED_SCHEDULE",
      "Disabled provider lifecycle must use disabled scheduling.",
      { line: 1, column: 1, offset: 0 },
      "warning",
    )));
  }

  if (settings.mode === "strict" && settings.maxAttempts > 0) {
    diagnostics.push(stableDiagnostic(createDiagnostic(
      "TOKEN_PROVIDER_LIFECYCLE_STRICT_RETRY",
      "Strict provider lifecycle should not retry provider handoff.",
      { line: 1, column: 1, offset: 0 },
      "warning",
    )));
  }

  if (service.provider === "mailchimp" && settings.enabled && !settings.acceptedBy) {
    diagnostics.push(stableDiagnostic(createDiagnostic(
      "TOKEN_PROVIDER_LIFECYCLE_ACCEPTANCE_REQUIRED",
      "Mailchimp provider lifecycle requires preview acceptance before handoff.",
      { line: 1, column: 1, offset: 0 },
      "info",
    )));
  }

  if (service.requiredPermissions.length > 0 && !boundary.auditChannel && !settings.auditChannel) {
    diagnostics.push(stableDiagnostic(createDiagnostic(
      "TOKEN_PROVIDER_LIFECYCLE_AUDIT_REQUIRED",
      "Provider lifecycle with external permissions requires an audit channel.",
      { line: 1, column: 1, offset: 0 },
      "warning",
    )));
  }

  return Object.freeze(diagnostics);
}

function lifecycleControlState(settings, exportReadiness, restartJournal, serviceContract) {
  const exportReady = exportReadiness.ready;
  const restartReady = restartJournal.validation.restartSafe;
  const accepted = serviceContract.acceptance.accepted;
  const manual = settings.schedule === "manual";
  const disabled = !settings.enabled || settings.schedule === "disabled";

  return Object.freeze({
    canEnable: disabled,
    canDisable: !disabled,
    canPreview: settings.enabled && serviceContract.preview.health.ok,
    canAcceptPreview: serviceContract.acceptance.controls.canAccept,
    canRunNow: settings.enabled && !manual && exportReady && restartReady && accepted,
    canSchedule: settings.enabled && !disabled && exportReady,
    canResume: settings.enabled && manual && exportReady,
    canRetry: settings.enabled && !manual && !disabled && restartReady && settings.maxAttempts > 0,
    canExportAudit: Boolean(serviceContract.sync.auditChannel ?? restartJournal.audit.channel),
    canEmitStatus: Boolean(serviceContract.sync.statusChannel),
  });
}

export function createTokenStreamProviderLifecycleManifest(stream, options = {}) {
  const service = normalizeProviderServiceOptions(options);
  const settings = normalizeProviderLifecycleSettings(options);
  const boundary = normalizeBoundaryContext({
    ...(stream?.metadata?.boundary ?? stream?.metadata ?? {}),
    permissions: options.permissions ?? stream?.metadata?.permissions ?? stream?.metadata?.boundary?.permissions ?? [],
    auditChannel: settings.auditChannel ?? service.auditChannel ?? stream?.metadata?.auditChannel ?? stream?.metadata?.boundary?.auditChannel,
  });
  const serviceContract = options.serviceContract ?? createTokenStreamProviderServiceContract(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: settings.statusChannel ?? service.statusChannel ?? boundary.auditChannel,
    acceptedBy: settings.acceptedBy,
    enabled: settings.enabled,
    scheduledAt: settings.scheduledAt,
    reason: options.reason ?? "provider-lifecycle-service",
  });
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: settings.statusChannel ?? serviceContract.sync.statusChannel,
    requiredPermissions: service.requiredPermissions,
    reason: options.reason ?? "provider-lifecycle-restart-journal",
    entries: [
      Object.freeze({
        kind: "provider-lifecycle",
        cursor: stream?.cursor ?? 0,
        payload: Object.freeze({
          enabled: settings.enabled,
          mode: settings.mode,
          schedule: settings.schedule,
          acceptedBy: settings.acceptedBy,
        }),
        status: settings.enabled ? "enabled" : "disabled",
        nextAction: settings.enabled ? "continue" : "enable-provider-lifecycle",
      }),
    ],
  });
  const exportReadiness = options.exportReadinessManifest ?? createTokenStreamExportReadinessManifest(stream, {
    ...options,
    adapter: service.adapter,
    provider: service.provider,
    operation: service.operation,
    permissions: boundary.permissions,
    auditChannel: boundary.auditChannel,
    statusChannel: settings.statusChannel ?? serviceContract.sync.statusChannel,
    restartJournal,
    reason: options.reason ?? "provider-lifecycle-export-readiness",
  });
  const diagnostics = lifecycleSettingDiagnostics(settings, service, boundary);
  const controls = lifecycleControlState(settings, exportReadiness, restartJournal, serviceContract);
  const missing = Object.freeze([
    settings.enabled ? null : "provider-lifecycle-enabled",
    serviceContract.acceptance.accepted ? null : "provider-preview-acceptance",
    exportReadiness.ready ? null : exportReadiness.exportSummary.firstBlocked ?? "export-readiness",
    restartJournal.validation.restartSafe ? null : "restart-journal",
    serviceContract.sync.statusChannel ? null : "status-channel",
    serviceContract.acceptance.audit.required && serviceContract.acceptance.audit.status !== "audit-ready" ? "audit-channel" : null,
    diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "lifecycle-settings" : null,
  ].filter(Boolean));
  const accepted = missing.length === 0 && settings.schedule !== "disabled";
  const manifestId = lifecycleManifestId(stream, service, boundary);
  const blocked = missing[0] ?? null;

  return Object.freeze({
    schema: "aios.token.stream.provider-lifecycle-manifest.v1",
    manifestId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: service.provider,
    operation: service.operation,
    adapter: service.adapter,
    accepted,
    status: accepted
      ? "provider-lifecycle-ready"
      : blocked === "provider-lifecycle-enabled"
        ? "lifecycle-disabled"
        : blocked === "provider-preview-acceptance"
          ? serviceContract.acceptance.status
          : blocked === "restart-journal"
            ? restartJournal.exportSummary.status
            : blocked === "status-channel"
              ? "status-review"
              : blocked === "audit-channel"
                ? "audit-review"
                : exportReadiness.status,
    settings,
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
      localOnly: boundary.localOnly,
    }),
    sync: Object.freeze({
      syncKey: serviceContract.sync.syncKey,
      cursor: serviceContract.sync.cursor,
      checkpointCursor: restartJournal.checkpoint.cursor,
      restartJournalId: restartJournal.journalId,
      exportManifestId: exportReadiness.manifestId,
      statusChannel: serviceContract.sync.statusChannel,
      auditChannel: serviceContract.sync.auditChannel,
    }),
    validationSummary: Object.freeze({
      enabled: settings.enabled,
      previewAccepted: serviceContract.acceptance.accepted,
      exportReady: exportReadiness.ready,
      restartReady: restartJournal.validation.restartSafe,
      statusReady: Boolean(serviceContract.sync.statusChannel),
      auditReady: !serviceContract.acceptance.audit.required || serviceContract.acceptance.audit.status === "audit-ready",
      diagnostics,
      missing,
    }),
    controls,
    packets: Object.freeze({
      service: serviceContract.exportSummary,
      exportReadiness: exportReadiness.exportSummary,
      restartJournal: restartJournal.exportSummary,
    }),
    exportSummary: Object.freeze({
      manifestId,
      status: accepted ? "provider-lifecycle-ready" : "provider-lifecycle-review",
      provider: service.provider,
      operation: service.operation,
      schedule: settings.schedule,
      blocked,
      missing,
      nextAction: accepted
        ? "handoff-provider-lifecycle"
        : blocked === "provider-lifecycle-enabled"
          ? "enable-provider-lifecycle"
          : blocked === "provider-preview-acceptance"
            ? serviceContract.acceptance.nextAction
            : blocked === "restart-journal"
              ? restartJournal.nextAction
              : blocked === "status-channel"
                ? "declare-status-channel"
                : blocked === "audit-channel"
                  ? "declare-audit-channel"
                  : exportReadiness.nextAction,
    }),
    nextAction: accepted
      ? "handoff-provider-lifecycle"
      : blocked === "provider-lifecycle-enabled"
        ? "enable-provider-lifecycle"
        : blocked === "provider-preview-acceptance"
          ? serviceContract.acceptance.nextAction
          : blocked === "restart-journal"
            ? restartJournal.nextAction
            : blocked === "status-channel"
              ? "declare-status-channel"
              : blocked === "audit-channel"
                ? "declare-audit-channel"
                : exportReadiness.nextAction,
  });
}

function normalizeOperationsPacketEntry(entry, index, stream) {
  const status = String(entry?.status ?? "unknown");
  const accepted = entry?.accepted ?? entry?.ready ?? entry?.ok ?? false;
  const blocked = entry?.blocked === true
    || accepted === false
    || status.includes("blocked")
    || status.includes("review")
    || status.includes("missing");
  const retryable = Boolean(entry?.retryable ?? entry?.controls?.canRetry ?? entry?.controls?.canResume);
  const auditChannel = entry?.audit?.channel
    ?? entry?.auditChannel
    ?? entry?.sync?.auditChannel
    ?? stream?.metadata?.auditChannel
    ?? null;

  return Object.freeze({
    schema: "aios.token.stream.operations-packet.entry.v1",
    id: [
      "token-ops-entry",
      stream?.metadata?.sourceId ?? "anonymous-source",
      entry?.source ?? entry?.label ?? "artifact",
      status,
      index,
    ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":"),
    index,
    source: String(entry?.source ?? entry?.label ?? `artifact-${index}`),
    status,
    accepted: Boolean(accepted) && !blocked,
    blocked,
    retryable,
    nextAction: entry?.nextAction ?? entry?.exportSummary?.nextAction ?? "review-operation",
    cursor: Number.isInteger(entry?.cursor) ? entry.cursor : normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
    auditChannel,
    severity: blocked
      ? status.includes("permission") || status.includes("boundary") ? "error" : "warning"
      : "info",
    references: Object.freeze(entry?.references ?? {}),
    controls: Object.freeze({
      canRun: !blocked,
      canRetry: retryable && blocked,
      canExportAudit: Boolean(auditChannel),
      canContinueDegraded: Boolean(entry?.controls?.canContinueDegraded) && !status.includes("boundary"),
    }),
  });
}

export function createTokenStreamOperationsPacket(stream, artifacts = [], options = {}) {
  const health = options.health ?? createTokenStreamHealthReport(stream, {
    ...options,
    reason: options.reason ?? "token-stream-operations-packet",
  });
  const analytics = options.analytics ?? createTokenStreamAnalyticsReport(stream, {
    ...options,
    reason: options.reason ?? "token-stream-operations-packet",
  });
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    reason: options.reason ?? "token-stream-operations-packet",
  });
  const nextActionQueue = options.nextActionQueue ?? createTokenStreamNextActionQueue(stream, artifacts, {
    ...options,
    reason: options.reason ?? "token-stream-operations-packet",
    includeHealth: false,
    includeAnalytics: false,
  });
  const baseEntries = [
    Object.freeze({
      source: "token-health",
      status: health.status,
      ok: health.ok,
      blocked: !health.ok,
      retryable: health.retry.maxAttempts > 0,
      nextAction: health.nextAction,
      cursor: health.cursor,
      audit: health.boundary.audit,
    }),
    Object.freeze({
      source: "token-analytics",
      status: analytics.exportSummary.status,
      ok: analytics.ok,
      blocked: !analytics.ok,
      nextAction: analytics.nextAction,
      cursor: analytics.exportSummary.cursor,
      audit: analytics.boundaryIncident?.audit,
    }),
    Object.freeze({
      source: "restart-journal",
      status: restartJournal.exportSummary.status,
      accepted: restartJournal.validation.restartSafe,
      blocked: !restartJournal.validation.restartSafe,
      retryable: restartJournal.validation.blockedEntryIds.length > 0,
      nextAction: restartJournal.nextAction,
      cursor: restartJournal.cursor,
      audit: restartJournal.audit,
      references: Object.freeze({
        journalId: restartJournal.journalId,
        blockedEntryIds: restartJournal.validation.blockedEntryIds,
      }),
    }),
    Object.freeze({
      source: "next-action-queue",
      status: nextActionQueue.exportSummary.status,
      accepted: nextActionQueue.ready,
      blocked: !nextActionQueue.ready,
      retryable: nextActionQueue.counters.retryable > 0,
      nextAction: nextActionQueue.nextAction,
      cursor: nextActionQueue.cursor,
      references: Object.freeze({
        blockedCount: nextActionQueue.counters.blocked,
        retryableCount: nextActionQueue.counters.retryable,
      }),
    }),
    ...Array.from(artifacts ?? []),
  ];
  const entries = Object.freeze(baseEntries
    .map((entry, index) => normalizeOperationsPacketEntry(entry, index, stream))
    .sort((left, right) => (
      (left.blocked ? left.severity === "error" ? 0 : 1 : 2)
      - (right.blocked ? right.severity === "error" ? 0 : 1 : 2)
    ) || left.index - right.index));
  const blocked = entries.filter((entry) => entry.blocked);
  const retryable = entries.filter((entry) => entry.retryable);
  const auditChannels = Object.freeze([...new Set(entries.map((entry) => entry.auditChannel).filter(Boolean))].sort());
  const packetId = [
    "token-operations",
    stream?.metadata?.sourceId ?? "anonymous-source",
    stream?.metadata?.handoff ?? "parser",
    normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
    entries.length,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");

  return Object.freeze({
    schema: "aios.token.stream.operations-packet.v1",
    packetId,
    sourceId: stream?.metadata?.sourceId ?? null,
    ready: blocked.length === 0,
    status: blocked.length === 0 ? "operations-ready" : blocked[0].status,
    cursor: normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
    entries,
    counters: Object.freeze({
      total: entries.length,
      blocked: blocked.length,
      retryable: retryable.length,
      auditReady: auditChannels.length,
      accepted: entries.filter((entry) => entry.accepted).length,
    }),
    recovery: Object.freeze({
      restartSafe: restartJournal.validation.restartSafe,
      journalId: restartJournal.journalId,
      retryAfterMs: health.retry.retryAfterMs,
      strategy: blocked.length === 0
        ? "none"
        : retryable.length > 0
          ? health.retry.strategy
          : "operator-review",
      restoreCommand: restartJournal.checkpoint.restoreCommand,
    }),
    audit: Object.freeze({
      channels: auditChannels,
      required: blocked.length > 0 || entries.some((entry) => entry.controls.canExportAudit),
      status: auditChannels.length > 0
        ? "audit-ready"
        : blocked.length > 0
          ? "audit-channel-missing"
          : "audit-optional",
    }),
    exportSummary: Object.freeze({
      packetId,
      status: blocked.length === 0 ? "operations-ready" : "operations-review",
      firstBlocked: blocked[0]?.source ?? null,
      blockedCount: blocked.length,
      retryableCount: retryable.length,
      nextAction: blocked[0]?.nextAction ?? "continue",
    }),
    nextAction: blocked[0]?.nextAction ?? "continue",
  });
}

function workflowStage(label, artifact, accepted, nextAction, references = {}) {
  const status = artifact?.exportSummary?.status
    ?? artifact?.status
    ?? (accepted ? "ready" : "review");

  return Object.freeze({
    schema: "aios.token.stream.workflow-handoff.stage.v1",
    label,
    status,
    accepted: Boolean(accepted),
    nextAction: accepted ? "continue" : nextAction ?? artifact?.nextAction ?? "review-workflow-stage",
    references: Object.freeze(references),
  });
}

function firstWorkflowBlocker(stages) {
  return Array.from(stages ?? []).find((stage) => !stage.accepted) ?? null;
}

export function createTokenStreamWorkflowHandoffManifest(stream, options = {}) {
  const serviceContract = options.serviceContract ?? createTokenStreamProviderServiceContract(stream, {
    ...options,
    reason: options.reason ?? "workflow-handoff-manifest",
  });
  const readinessPreview = options.readinessPreview ?? createTokenStreamProviderReadinessPreview(stream, {
    ...options,
    serviceContract,
    reason: `${options.reason ?? "workflow-handoff-manifest"}:readiness`,
  });
  const acceptanceSummary = options.acceptanceSummary ?? createTokenStreamProviderAcceptanceSummary(stream, {
    ...options,
    readinessPreview,
    reason: `${options.reason ?? "workflow-handoff-manifest"}:acceptance`,
  });
  const adoptionSnapshot = options.adoptionSnapshot ?? createTokenStreamClientRuntimeAdoptionSnapshot(stream, {
    ...options,
    serviceContract,
    acceptanceSummary,
    reason: `${options.reason ?? "workflow-handoff-manifest"}:client-adoption`,
  });
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    permissions: serviceContract.boundary.permissions,
    requiredPermissions: serviceContract.negotiation.requiredPermissions,
    auditChannel: serviceContract.sync.auditChannel,
    statusChannel: serviceContract.sync.statusChannel,
    entries: [
      Object.freeze({
        kind: "workflow-handoff:preview",
        cursor: serviceContract.sync.cursor,
        payload: Object.freeze({
          provider: serviceContract.service.provider,
          operation: serviceContract.service.operation,
          accepted: acceptanceSummary.accepted,
        }),
        status: acceptanceSummary.accepted ? "accepted" : acceptanceSummary.status,
        nextAction: acceptanceSummary.nextAction,
      }),
      Object.freeze({
        kind: "workflow-handoff:client-adoption",
        cursor: adoptionSnapshot.sync.cursor,
        payload: Object.freeze({
          snapshotId: adoptionSnapshot.snapshotId,
          accepted: adoptionSnapshot.accepted,
        }),
        status: adoptionSnapshot.status,
        nextAction: adoptionSnapshot.nextAction,
      }),
    ],
    reason: `${options.reason ?? "workflow-handoff-manifest"}:restart-journal`,
  });
  const lifecycleManifest = options.lifecycleManifest ?? createTokenStreamProviderLifecycleManifest(stream, {
    ...options,
    serviceContract,
    restartJournal,
    reason: `${options.reason ?? "workflow-handoff-manifest"}:provider-lifecycle`,
  });
  const operationsPacket = options.operationsPacket ?? createTokenStreamOperationsPacket(stream, [
    serviceContract.exportSummary,
    readinessPreview.exportSummary,
    acceptanceSummary.exportSummary,
    adoptionSnapshot,
    lifecycleManifest.exportSummary,
  ], {
    ...options,
    restartJournal,
    reason: `${options.reason ?? "workflow-handoff-manifest"}:operations`,
  });
  const stages = Object.freeze([
    workflowStage("service-contract", serviceContract, serviceContract.acceptance.accepted, serviceContract.nextAction, {
      syncKey: serviceContract.sync.syncKey,
      manifestId: serviceContract.externalHandoffManifest.manifestId,
    }),
    workflowStage("readiness-preview", readinessPreview, readinessPreview.accepted, readinessPreview.nextAction, {
      syncKey: readinessPreview.sync.syncKey,
      manifestId: readinessPreview.externalHandoffManifest.manifestId,
    }),
    workflowStage("preview-acceptance", acceptanceSummary, acceptanceSummary.accepted, acceptanceSummary.nextAction, {
      syncKey: acceptanceSummary.syncKey,
      decision: acceptanceSummary.status,
    }),
    workflowStage("client-runtime-adoption", adoptionSnapshot, adoptionSnapshot.accepted, adoptionSnapshot.nextAction, {
      snapshotId: adoptionSnapshot.snapshotId,
      routeId: adoptionSnapshot.sync.routeId,
    }),
    workflowStage("restart-journal", restartJournal, restartJournal.validation.restartSafe, restartJournal.nextAction, {
      journalId: restartJournal.journalId,
      blockedEntryIds: restartJournal.validation.blockedEntryIds,
    }),
    workflowStage("provider-lifecycle", lifecycleManifest, lifecycleManifest.accepted, lifecycleManifest.nextAction, {
      manifestId: lifecycleManifest.manifestId,
      schedule: lifecycleManifest.settings.schedule,
    }),
    workflowStage("operations", operationsPacket, operationsPacket.ready, operationsPacket.nextAction, {
      packetId: operationsPacket.packetId,
      blockedCount: operationsPacket.counters.blocked,
    }),
  ]);
  const blocker = firstWorkflowBlocker(stages);
  const missing = Object.freeze([
    ...Array.from(acceptanceSummary.validationSummary?.missing ?? []),
    ...Array.from(adoptionSnapshot.validationSummary.missing ?? []),
    ...Array.from(lifecycleManifest.validationSummary.missing ?? []),
    operationsPacket.ready ? null : "operations-packet",
  ].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).sort());
  const accepted = !blocker && missing.length === 0;
  const manifestId = [
    "token-workflow-handoff",
    serviceContract.service.provider,
    serviceContract.service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    serviceContract.boundary.workspace ?? "workspace",
    serviceContract.boundary.tenant ?? "tenant",
    serviceContract.sync.syncKey,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");

  return Object.freeze({
    schema: "aios.token.stream.workflow-handoff.manifest.v1",
    manifestId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: serviceContract.service.provider,
    operation: serviceContract.service.operation,
    adapter: serviceContract.service.adapter,
    accepted,
    status: accepted ? "workflow-handoff-ready" : blocker?.status ?? "workflow-handoff-review",
    boundary: Object.freeze({
      workspace: serviceContract.boundary.workspace,
      tenant: serviceContract.boundary.tenant,
      role: serviceContract.boundary.role,
      localOnly: serviceContract.boundary.localOnly,
    }),
    sync: Object.freeze({
      syncKey: serviceContract.sync.syncKey,
      cursor: serviceContract.sync.cursor,
      checkpointCursor: serviceContract.sync.checkpointCursor,
      routeId: adoptionSnapshot.sync.routeId,
      restartJournalId: restartJournal.journalId,
      operationsPacketId: operationsPacket.packetId,
      statusChannel: serviceContract.sync.statusChannel,
      auditChannel: serviceContract.sync.auditChannel,
    }),
    stages,
    validationSummary: Object.freeze({
      serviceAccepted: serviceContract.acceptance.accepted,
      previewReady: readinessPreview.accepted,
      previewAccepted: acceptanceSummary.accepted,
      clientAdoptionReady: adoptionSnapshot.accepted,
      restartReady: restartJournal.validation.restartSafe,
      lifecycleReady: lifecycleManifest.accepted,
      operationsReady: operationsPacket.ready,
      missing,
      blockedStage: blocker?.label ?? null,
    }),
    controls: Object.freeze({
      canPreview: readinessPreview.explanation.validationSummary.tokenStreamReady,
      canAccept: acceptanceSummary.controls.canAccept && !blocker,
      canPersist: restartJournal.validation.restartSafe,
      canReplay: adoptionSnapshot.persistedState.restartSafe && adoptionSnapshot.persistedState.idempotencyReady,
      canLaunchClient: adoptionSnapshot.controls.canHandoffClient && lifecycleManifest.controls.canRunNow,
      canEmitStatus: Boolean(serviceContract.sync.statusChannel),
      canExportAudit: Boolean(serviceContract.sync.auditChannel) || operationsPacket.audit.channels.length > 0,
    }),
    packets: Object.freeze({
      service: serviceContract.exportSummary,
      readiness: readinessPreview.exportSummary,
      acceptance: acceptanceSummary.exportSummary,
      adoption: adoptionSnapshot.executionIntent,
      lifecycle: lifecycleManifest.exportSummary,
      operations: operationsPacket.exportSummary,
    }),
    nextStep: Object.freeze({
      label: accepted ? "workflow-handoff" : blocker?.label ?? "workflow-handoff",
      action: accepted ? "launch-client-workflow" : blocker?.nextAction ?? "review-workflow-handoff",
      requiresOperator: !accepted && ["preview-acceptance", "provider-lifecycle", "operations"].includes(blocker?.label),
      retryable: !accepted && ["restart-journal", "operations"].includes(blocker?.label),
    }),
    exportSummary: Object.freeze({
      manifestId,
      status: accepted ? "workflow-handoff-ready" : "workflow-handoff-review",
      provider: serviceContract.service.provider,
      operation: serviceContract.service.operation,
      blockedStage: blocker?.label ?? null,
      missing,
      nextAction: accepted ? "launch-client-workflow" : blocker?.nextAction ?? "review-workflow-handoff",
    }),
    nextAction: accepted ? "launch-client-workflow" : blocker?.nextAction ?? "review-workflow-handoff",
  });
}

function workflowStatusCommandId(manifest, phase) {
  return [
    "token-workflow-status",
    manifest.provider,
    manifest.operation,
    manifest.sourceId ?? "anonymous-source",
    manifest.sync?.routeId ?? manifest.sync?.syncKey ?? "route",
    phase,
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function workflowStatusStage(stage) {
  return Object.freeze({
    schema: "aios.token.stream.client-workflow-status.stage.v1",
    label: stage.label,
    accepted: stage.accepted,
    status: stage.status,
    nextAction: stage.nextAction,
    references: stage.references,
  });
}

export function createTokenStreamClientWorkflowStatusEnvelope(stream, options = {}) {
  const manifest = options.workflowHandoffManifest ?? createTokenStreamWorkflowHandoffManifest(stream, {
    ...options,
    reason: options.reason ?? "client-workflow-status",
  });
  const checkpoint = createTokenCheckpoint(stream, `${options.reason ?? "client-workflow-status"}:checkpoint`);
  const restartJournal = options.restartJournal ?? createTokenStreamRestartJournal(stream, {
    ...options,
    auditChannel: manifest.sync.auditChannel,
    statusChannel: manifest.sync.statusChannel,
    entries: [
      Object.freeze({
        kind: "client-workflow-status:manifest",
        cursor: manifest.sync.cursor,
        payload: Object.freeze({
          manifestId: manifest.manifestId,
          status: manifest.status,
          accepted: manifest.accepted,
        }),
        status: manifest.accepted ? "accepted" : manifest.status,
        nextAction: manifest.nextAction,
      }),
      Object.freeze({
        kind: "client-workflow-status:stage",
        cursor: manifest.sync.cursor,
        payload: Object.freeze({
          blockedStage: manifest.validationSummary.blockedStage,
          missing: manifest.validationSummary.missing.join(","),
        }),
        status: manifest.validationSummary.blockedStage ? "blocked" : "clear",
        nextAction: manifest.nextAction,
      }),
    ],
    reason: `${options.reason ?? "client-workflow-status"}:restart-journal`,
  });
  const blockedStages = Object.freeze(manifest.stages.filter((stage) => !stage.accepted).map(workflowStatusStage));
  const allStages = Object.freeze(manifest.stages.map(workflowStatusStage));
  const statusChannelReady = Boolean(manifest.sync.statusChannel);
  const auditReady = Boolean(manifest.sync.auditChannel) || !blockedStages.some((stage) => stage.status.includes("audit"));
  const restartReady = restartJournal.validation.restartSafe && checkpoint.restartSafe;
  const launchReady = manifest.accepted && statusChannelReady && restartReady;
  const missing = Object.freeze([
    manifest.accepted ? null : manifest.validationSummary.blockedStage ?? "workflow-handoff",
    statusChannelReady ? null : "status-channel",
    auditReady ? null : "audit-channel",
    restartReady ? null : "restart-safe-state",
    ...manifest.validationSummary.missing,
  ].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).sort());
  const phase = launchReady
    ? "ready"
    : blockedStages.length > 0
      ? "blocked"
      : restartReady
        ? "waiting"
        : "recovering";
  const envelopeId = workflowStatusCommandId(manifest, phase);

  return Object.freeze({
    schema: "aios.token.stream.client-workflow-status-envelope.v1",
    envelopeId,
    sourceId: manifest.sourceId,
    provider: manifest.provider,
    operation: manifest.operation,
    adapter: manifest.adapter,
    ready: launchReady,
    phase,
    status: launchReady
      ? "client-workflow-ready"
      : blockedStages.length > 0
        ? blockedStages[0].status
        : !statusChannelReady
          ? "status-channel-missing"
          : !restartReady
            ? restartJournal.exportSummary.status
            : "client-workflow-review",
    sync: Object.freeze({
      manifestId: manifest.manifestId,
      routeId: manifest.sync.routeId,
      syncKey: manifest.sync.syncKey,
      cursor: manifest.sync.cursor,
      checkpointCursor: checkpoint.cursor,
      restartJournalId: restartJournal.journalId,
      operationsPacketId: manifest.sync.operationsPacketId,
      statusChannel: manifest.sync.statusChannel,
      auditChannel: manifest.sync.auditChannel,
    }),
    stages: allStages,
    blockedStages,
    validationSummary: Object.freeze({
      workflowAccepted: manifest.accepted,
      statusChannelReady,
      auditReady,
      restartReady,
      launchReady,
      missing,
      blockedStage: blockedStages[0]?.label ?? manifest.validationSummary.blockedStage,
    }),
    commands: Object.freeze([
      Object.freeze({
        id: workflowStatusCommandId(manifest, "emit"),
        kind: "emit-client-workflow-status",
        idempotent: true,
        writesProvider: false,
        status: statusChannelReady ? "ready" : "blocked",
        channel: manifest.sync.statusChannel,
        nextAction: statusChannelReady ? "emit-client-workflow-status" : "declare-status-channel",
      }),
      Object.freeze({
        id: workflowStatusCommandId(manifest, "restore"),
        kind: "restore-client-workflow",
        idempotent: true,
        writesProvider: false,
        status: restartReady ? "ready" : "blocked",
        command: checkpoint.clientState.restoreCommand,
        nextAction: restartReady ? "restore-token-cursor" : restartJournal.nextAction,
      }),
      Object.freeze({
        id: workflowStatusCommandId(manifest, "launch"),
        kind: "launch-client-workflow",
        idempotent: manifest.controls.canReplay,
        writesProvider: manifest.provider !== "runtime",
        status: launchReady ? "ready" : "blocked",
        nextAction: launchReady ? "launch-client-workflow" : manifest.nextAction,
      }),
    ]),
    controls: Object.freeze({
      canLaunchClient: launchReady,
      canEmitStatus: statusChannelReady,
      canReplayRestore: restartReady,
      canExportAudit: Boolean(manifest.sync.auditChannel),
      canContinueDegraded: !launchReady && missing.length === 1 && missing[0] === "audit-channel",
    }),
    exportSummary: Object.freeze({
      envelopeId,
      manifestId: manifest.manifestId,
      status: launchReady ? "client-workflow-ready" : "client-workflow-review",
      phase,
      blockedStage: blockedStages[0]?.label ?? manifest.validationSummary.blockedStage,
      missing,
      nextAction: launchReady
        ? "launch-client-workflow"
        : !statusChannelReady
          ? "declare-status-channel"
          : !restartReady
            ? restartJournal.nextAction
            : manifest.nextAction,
    }),
    manifest,
    restartJournal,
    nextAction: launchReady
      ? "launch-client-workflow"
      : !statusChannelReady
        ? "declare-status-channel"
        : !restartReady
          ? restartJournal.nextAction
          : manifest.nextAction,
  });
}

export function createTokenStreamRouteReadinessContract(stream, options = {}) {
  const routeId = [
    "token-route-readiness",
    options.clientRoute ?? options.route ?? "client-workflow",
    stream?.metadata?.sourceId ?? "anonymous-source",
    options.provider ?? options.adapter ?? "runtime",
    normalizeCursor(stream?.cursor, Array.from(stream?.tokens ?? []).length),
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
  const workflowStatus = options.workflowStatusEnvelope ?? createTokenStreamClientWorkflowStatusEnvelope(stream, {
    ...options,
    reason: options.reason ?? "route-readiness-workflow-status",
  });
  const acceptance = options.acceptanceSummary ?? createTokenStreamProviderAcceptanceSummary(stream, {
    ...options,
    reason: options.reason ?? "route-readiness-acceptance",
  });
  const boundary = createTokenStreamBoundaryReport(stream, {
    ...options,
    requiredPermissions: options.requiredPermissions ?? acceptance.serviceContract?.preview?.requiredPermissions ?? [],
  });
  const checkpoint = createTokenCheckpoint(stream, `${options.reason ?? "route-readiness"}:checkpoint`);
  const stages = Object.freeze([
    Object.freeze({
      schema: "aios.token.stream.route-readiness.stage.v1",
      label: "boundary",
      accepted: boundary.ok,
      status: boundary.status,
      nextAction: boundary.nextAction,
      references: Object.freeze({
        workspace: boundary.boundary.workspace,
        tenant: boundary.boundary.tenant,
        role: boundary.boundary.role,
        missingPermissions: boundary.missingPermissions,
      }),
    }),
    Object.freeze({
      schema: "aios.token.stream.route-readiness.stage.v1",
      label: "preview-acceptance",
      accepted: acceptance.accepted,
      status: acceptance.status,
      nextAction: acceptance.nextAction,
      references: Object.freeze({
        provider: acceptance.provider,
        operation: acceptance.operation,
        missing: acceptance.validationSummary.missing,
      }),
    }),
    Object.freeze({
      schema: "aios.token.stream.route-readiness.stage.v1",
      label: "workflow-status",
      accepted: workflowStatus.ready,
      status: workflowStatus.status,
      nextAction: workflowStatus.nextAction,
      references: Object.freeze({
        envelopeId: workflowStatus.envelopeId,
        manifestId: workflowStatus.sync.manifestId,
        phase: workflowStatus.phase,
        missing: workflowStatus.validationSummary.missing,
      }),
    }),
    Object.freeze({
      schema: "aios.token.stream.route-readiness.stage.v1",
      label: "restart-checkpoint",
      accepted: checkpoint.restartSafe,
      status: checkpoint.restartSafe ? "restart-safe" : "restart-review",
      nextAction: checkpoint.restartSafe ? "continue" : "reload-token-checkpoint",
      references: Object.freeze({
        cursor: checkpoint.cursor,
        restoreCommand: checkpoint.clientState.restoreCommand,
      }),
    }),
  ]);
  const blocked = stages.find((stage) => !stage.accepted) ?? null;
  const missing = Object.freeze([...new Set([
    ...stages.filter((stage) => !stage.accepted).map((stage) => stage.label),
    ...Array.from(acceptance.validationSummary.missing ?? []),
    ...Array.from(workflowStatus.validationSummary.missing ?? []),
    ...Array.from(boundary.missingPermissions ?? []),
  ].filter(Boolean))].sort());
  const actionQueue = createTokenStreamNextActionQueue(stream, stages.map((stage) => Object.freeze({
    source: `route-readiness:${stage.label}`,
    status: stage.status,
    accepted: stage.accepted,
    blocked: !stage.accepted,
    retryable: stage.label === "restart-checkpoint" || stage.label === "workflow-status",
    nextAction: stage.nextAction,
    cursor: checkpoint.cursor,
    audit: boundary.audit,
  })), {
    ...options,
    reason: options.reason ?? "route-readiness-action-queue",
  });
  const accepted = !blocked && missing.length === 0;

  return Object.freeze({
    schema: "aios.token.stream.route-readiness.contract.v1",
    routeId,
    sourceId: stream?.metadata?.sourceId ?? null,
    route: options.clientRoute ?? options.route ?? "client-workflow",
    provider: acceptance.provider,
    operation: acceptance.operation,
    accepted,
    status: accepted ? "route-ready" : blocked?.status ?? "route-review",
    cursor: checkpoint.cursor,
    boundary: Object.freeze({
      workspace: boundary.boundary.workspace,
      tenant: boundary.boundary.tenant,
      role: boundary.boundary.role,
      status: boundary.status,
    }),
    sync: Object.freeze({
      envelopeId: workflowStatus.envelopeId,
      manifestId: workflowStatus.sync.manifestId,
      routeId: workflowStatus.sync.routeId,
      statusChannel: workflowStatus.sync.statusChannel,
      auditChannel: workflowStatus.sync.auditChannel,
      checkpointCursor: checkpoint.cursor,
    }),
    stages,
    validationSummary: Object.freeze({
      boundaryReady: boundary.ok,
      previewAccepted: acceptance.accepted,
      workflowReady: workflowStatus.ready,
      restartSafe: checkpoint.restartSafe,
      blockedStage: blocked?.label ?? null,
      missing,
    }),
    controls: Object.freeze({
      canPreview: boundary.ok && acceptance.controls.canPreview,
      canAccept: boundary.ok && acceptance.controls.canAccept,
      canLaunchRoute: accepted && workflowStatus.controls.canLaunchClient,
      canEmitStatus: workflowStatus.controls.canEmitStatus,
      canReplayRestore: workflowStatus.controls.canReplayRestore && checkpoint.restartSafe,
      canExportAudit: Boolean(boundary.audit.channel ?? workflowStatus.sync.auditChannel),
    }),
    actionQueue: actionQueue.exportSummary,
    nextStep: Object.freeze({
      label: accepted ? "route-launch" : blocked?.label ?? "route-readiness",
      action: accepted ? "launch-client-route" : blocked?.nextAction ?? actionQueue.nextAction,
      requiresOperator: !accepted && ["preview-acceptance", "workflow-status"].includes(blocked?.label),
      retryable: !accepted && ["workflow-status", "restart-checkpoint"].includes(blocked?.label),
    }),
    exportSummary: Object.freeze({
      routeId,
      status: accepted ? "route-ready" : "route-review",
      blockedStage: blocked?.label ?? null,
      missing,
      nextAction: accepted ? "launch-client-route" : blocked?.nextAction ?? actionQueue.nextAction,
    }),
    workflowStatus,
    acceptance,
    checkpoint,
    nextAction: accepted ? "launch-client-route" : blocked?.nextAction ?? actionQueue.nextAction,
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
