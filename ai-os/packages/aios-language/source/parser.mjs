import { lex } from "./lexer.mjs";
import { TOKEN_TYPES, createDiagnostic, summarizeTokenState, tokenLabel } from "./tokens.mjs";

function parserState(source, options = {}) {
  const lexed = lex(source, options);
  return {
    tokens: lexed.tokens,
    diagnostics: [...lexed.diagnostics],
    boundary: lexed.boundary,
    tokenSnapshot: lexed.snapshot,
    lexHealth: lexed.health,
    current: 0,
  };
}

function current(state) {
  return state.tokens[state.current] ?? state.tokens[state.tokens.length - 1];
}

function previous(state) {
  return state.tokens[Math.max(0, state.current - 1)];
}

function atEnd(state) {
  return current(state)?.type === TOKEN_TYPES.EOF;
}

function advance(state) {
  if (!atEnd(state)) {
    state.current += 1;
  }
  return previous(state);
}

function check(state, type, value) {
  const token = current(state);
  if (!token || token.type !== type) {
    return false;
  }
  return value === undefined || token.value === value;
}

function match(state, type, value) {
  if (!check(state, type, value)) {
    return false;
  }
  advance(state);
  return true;
}

function expect(state, type, value, code, message) {
  if (check(state, type, value)) {
    return advance(state);
  }

  const token = current(state);
  state.diagnostics.push(createDiagnostic(code, `${message} Found ${tokenLabel(token)}.`, token));
  return null;
}

function expectKeyword(state, value, code, message) {
  return expect(state, TOKEN_TYPES.KEYWORD, value, code, message);
}

function expectSymbol(state, value, code, message) {
  return expect(state, TOKEN_TYPES.SYMBOL, value, code, message);
}

function parseName(state, code, message) {
  if (check(state, TOKEN_TYPES.IDENTIFIER) || check(state, TOKEN_TYPES.KEYWORD)) {
    return advance(state).value;
  }

  const token = current(state);
  state.diagnostics.push(createDiagnostic(code, `${message} Found ${tokenLabel(token)}.`, token));
  return null;
}

function parseQualifiedName(state, code, message) {
  const parts = [];
  const first = parseName(state, code, message);
  if (!first) {
    return null;
  }
  parts.push(first);

  while (match(state, TOKEN_TYPES.SYMBOL, ".")) {
    const next = parseName(state, code, "Expected name after '.'.");
    if (!next) {
      break;
    }
    parts.push(next);
  }

  return parts.join(".");
}

function parseLiteral(state) {
  if (check(state, TOKEN_TYPES.STRING)) {
    return { type: "StringLiteral", value: advance(state).value };
  }

  if (check(state, TOKEN_TYPES.NUMBER)) {
    const token = advance(state);
    return { type: "NumberLiteral", value: token.numericValue };
  }

  if (check(state, TOKEN_TYPES.SYMBOL, "{")) {
    return parseObject(state);
  }

  if (check(state, TOKEN_TYPES.SYMBOL, "[")) {
    return parseArray(state);
  }

  const name = parseQualifiedName(state, "PARSE_EXPECTED_LITERAL", "Expected literal value.");
  return name ? { type: "IdentifierLiteral", value: name } : { type: "MissingLiteral", value: null };
}

function parseArray(state) {
  const entries = [];
  expectSymbol(state, "[", "PARSE_EXPECTED_ARRAY", "Expected '[' to start array.");

  while (!atEnd(state) && !check(state, TOKEN_TYPES.SYMBOL, "]")) {
    entries.push(parseLiteral(state));
    match(state, TOKEN_TYPES.SYMBOL, ",");
  }

  expectSymbol(state, "]", "PARSE_EXPECTED_ARRAY_END", "Expected ']' after array.");
  return { type: "ArrayExpression", entries };
}

function parseObject(state) {
  const entries = [];
  expectSymbol(state, "{", "PARSE_EXPECTED_OBJECT", "Expected '{' to start object.");

  while (!atEnd(state) && !check(state, TOKEN_TYPES.SYMBOL, "}")) {
    const key = parseName(state, "PARSE_EXPECTED_OBJECT_KEY", "Expected object key.");
    expectSymbol(state, ":", "PARSE_EXPECTED_COLON", "Expected ':' after object key.");
    entries.push({ key, value: parseLiteral(state) });
    match(state, TOKEN_TYPES.SYMBOL, ",");
  }

  expectSymbol(state, "}", "PARSE_EXPECTED_OBJECT_END", "Expected '}' after object.");
  return { type: "ObjectExpression", entries };
}

function parseCapability(state) {
  expectKeyword(state, "capability", "PARSE_EXPECTED_CAPABILITY", "Expected capability clause.");
  const name = parseQualifiedName(state, "PARSE_EXPECTED_CAPABILITY_NAME", "Expected capability name.");
  let scope = null;

  if (match(state, TOKEN_TYPES.KEYWORD, "scope")) {
    const literal = parseLiteral(state);
    scope = literal.value;
  }

  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after capability clause.");
  return { type: "CapabilityClause", name, scope };
}

function parseWorkspace(state) {
  expectKeyword(state, "workspace", "PARSE_EXPECTED_WORKSPACE", "Expected workspace clause.");
  const workspace = parseLiteral(state);
  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after workspace clause.");
  return { type: "WorkspaceClause", workspace: workspace.value };
}

function parseTenant(state) {
  expectKeyword(state, "tenant", "PARSE_EXPECTED_TENANT", "Expected tenant clause.");
  const tenant = parseLiteral(state);
  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after tenant clause.");
  return { type: "TenantClause", tenant: tenant.value };
}

function parseRole(state) {
  expectKeyword(state, "role", "PARSE_EXPECTED_ROLE", "Expected role clause.");
  const role = parseLiteral(state);
  let permissions = { type: "ArrayExpression", entries: [] };

  if (match(state, TOKEN_TYPES.KEYWORD, "permissions")) {
    permissions = parseLiteral(state);
    if (permissions.type !== "ArrayExpression") {
      state.diagnostics.push(createDiagnostic(
        "PARSE_EXPECTED_PERMISSION_ARRAY",
        "Expected permissions to be an array literal.",
        previous(state),
      ));
      permissions = { type: "ArrayExpression", entries: [permissions] };
    }
  }

  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after role clause.");
  return { type: "RoleClause", role: role.value, permissions };
}

function parseMemory(state) {
  expectKeyword(state, "memory", "PARSE_EXPECTED_MEMORY", "Expected memory clause.");
  const name = parseQualifiedName(state, "PARSE_EXPECTED_MEMORY_NAME", "Expected memory binding name.");
  let alias = name;

  if (match(state, TOKEN_TYPES.KEYWORD, "as")) {
    alias = parseName(state, "PARSE_EXPECTED_MEMORY_ALIAS", "Expected memory alias.");
  }

  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after memory clause.");
  return { type: "MemoryClause", name, alias };
}

function parseVerify(state) {
  expectKeyword(state, "verify", "PARSE_EXPECTED_VERIFY", "Expected verify clause.");
  expectKeyword(state, "truth", "PARSE_EXPECTED_TRUTH", "Expected 'truth' after verify.");
  const boundary = parseLiteral(state);
  let minConfidence = null;

  if (match(state, TOKEN_TYPES.IDENTIFIER, "minConfidence")) {
    minConfidence = parseLiteral(state).value;
  }

  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after verify clause.");
  return { type: "VerifyClause", boundary: boundary.value, minConfidence };
}

function parseHandoff(state) {
  expectKeyword(state, "handoff", "PARSE_EXPECTED_HANDOFF", "Expected handoff clause.");
  expectKeyword(state, "adapter", "PARSE_EXPECTED_ADAPTER", "Expected adapter target.");
  const adapter = parseQualifiedName(state, "PARSE_EXPECTED_ADAPTER_NAME", "Expected adapter name.");
  let parameters = { type: "ObjectExpression", entries: [] };

  if (match(state, TOKEN_TYPES.KEYWORD, "with")) {
    parameters = parseObject(state);
  }

  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after handoff clause.");
  return { type: "HandoffClause", adapter, parameters };
}

function parseStatus(state) {
  expectKeyword(state, "status", "PARSE_EXPECTED_STATUS", "Expected status clause.");
  expectKeyword(state, "emits", "PARSE_EXPECTED_EMITS", "Expected emits target.");
  const channel = parseLiteral(state);
  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after status clause.");
  return { type: "StatusClause", channel: channel.value };
}

function parseRollback(state) {
  expectKeyword(state, "on", "PARSE_EXPECTED_ON", "Expected rollback clause.");
  expectKeyword(state, "error", "PARSE_EXPECTED_ERROR", "Expected error condition.");
  expectKeyword(state, "rollback", "PARSE_EXPECTED_ROLLBACK", "Expected rollback action.");
  const target = parseLiteral(state);
  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after rollback clause.");
  return { type: "RollbackClause", target: target.value };
}

function parseIdempotency(state) {
  expectKeyword(state, "idempotency", "PARSE_EXPECTED_IDEMPOTENCY", "Expected idempotency clause.");
  expectKeyword(state, "key", "PARSE_EXPECTED_IDEMPOTENCY_KEY", "Expected key after idempotency.");
  const key = parseLiteral(state);
  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after idempotency clause.");
  return { type: "IdempotencyClause", key: key.value };
}

function parseRecover(state) {
  expectKeyword(state, "recover", "PARSE_EXPECTED_RECOVER", "Expected recover clause.");
  expectKeyword(state, "from", "PARSE_EXPECTED_FROM", "Expected from after recover.");
  const checkpoint = parseLiteral(state);
  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after recover clause.");
  return { type: "RecoverClause", checkpoint: checkpoint.value };
}

function parseRetry(state) {
  expectKeyword(state, "retry", "PARSE_EXPECTED_RETRY", "Expected retry clause.");
  let maxAttempts = 0;
  let backoff = "none";

  if (match(state, TOKEN_TYPES.KEYWORD, "max")) {
    maxAttempts = parseLiteral(state).value;
  }

  if (match(state, TOKEN_TYPES.KEYWORD, "backoff")) {
    backoff = parseLiteral(state).value;
  }

  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after retry clause.");
  return { type: "RetryClause", maxAttempts, backoff };
}

function parseDegraded(state) {
  expectKeyword(state, "degraded", "PARSE_EXPECTED_DEGRADED", "Expected degraded clause.");
  expectKeyword(state, "status", "PARSE_EXPECTED_STATUS", "Expected status after degraded.");
  const status = parseLiteral(state);
  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after degraded clause.");
  return { type: "DegradedClause", status: status.value };
}

function parseAudit(state) {
  expectKeyword(state, "audit", "PARSE_EXPECTED_AUDIT", "Expected audit clause.");
  expectKeyword(state, "emits", "PARSE_EXPECTED_EMITS", "Expected emits target.");
  const channel = parseLiteral(state);
  expectSymbol(state, ";", "PARSE_EXPECTED_SEMICOLON", "Expected ';' after audit clause.");
  return { type: "AuditClause", channel: channel.value };
}

function synchronize(state) {
  while (!atEnd(state)) {
    if (previous(state)?.value === ";") {
      return;
    }
    if (check(state, TOKEN_TYPES.KEYWORD)) {
      return;
    }
    advance(state);
  }
}

function parseJobClause(state) {
  const token = current(state);

  try {
    if (check(state, TOKEN_TYPES.KEYWORD, "workspace")) return parseWorkspace(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "tenant")) return parseTenant(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "role")) return parseRole(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "capability")) return parseCapability(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "memory")) return parseMemory(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "verify")) return parseVerify(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "handoff")) return parseHandoff(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "status")) return parseStatus(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "on")) return parseRollback(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "idempotency")) return parseIdempotency(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "recover")) return parseRecover(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "retry")) return parseRetry(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "degraded")) return parseDegraded(state);
    if (check(state, TOKEN_TYPES.KEYWORD, "audit")) return parseAudit(state);

    state.diagnostics.push(createDiagnostic("PARSE_UNKNOWN_JOB_CLAUSE", `Unknown job clause ${tokenLabel(token)}.`, token));
    advance(state);
    synchronize(state);
    return { type: "UnknownClause", value: token.value };
  } catch (error) {
    state.diagnostics.push(createDiagnostic("PARSE_RECOVERY", error.message, token));
    synchronize(state);
    return { type: "InvalidClause", value: token.value };
  }
}

function parseJob(state) {
  const start = expectKeyword(state, "job", "PARSE_EXPECTED_JOB", "Expected job declaration.");
  const name = parseName(state, "PARSE_EXPECTED_JOB_NAME", "Expected job name.");
  const clauses = [];

  expectSymbol(state, "{", "PARSE_EXPECTED_JOB_BODY", "Expected '{' after job name.");

  while (!atEnd(state) && !check(state, TOKEN_TYPES.SYMBOL, "}")) {
    clauses.push(parseJobClause(state));
  }

  expectSymbol(state, "}", "PARSE_EXPECTED_JOB_END", "Expected '}' after job body.");

  return {
    type: "JobDeclaration",
    name,
    clauses,
    location: start ? { line: start.line, column: start.column, offset: start.offset } : null,
  };
}

function parserHealth(state, body) {
  const errors = state.diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const hasRecoveryClause = body.some((job) => job.clauses.some((clause) => clause.type === "RecoverClause"));
  const hasRetryClause = body.some((job) => job.clauses.some((clause) => clause.type === "RetryClause"));
  const degradedModeAvailable = body.some((job) => job.clauses.some((clause) => clause.type === "DegradedClause"));

  return Object.freeze({
    ok: errors.length === 0,
    degraded: errors.length > 0 && degradedModeAvailable,
    retryable: errors.length > 0 && hasRetryClause,
    restartSafe: errors.length === 0 || hasRecoveryClause,
    errorCount: errors.length,
    warningCount: state.diagnostics.length - errors.length,
    lexerStatus: state.lexHealth?.status ?? "unknown",
    nextAction: errors.length === 0
      ? "compile"
      : hasRecoveryClause
        ? "recover-from-checkpoint"
        : "surface-actionable-diagnostics",
  });
}

function countClauses(body) {
  const counts = new Map();

  for (const job of body) {
    for (const clause of job.clauses) {
      counts.set(clause.type, (counts.get(clause.type) ?? 0) + 1);
    }
  }

  return Object.freeze(Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))));
}

function createHistorySnapshot(state, body) {
  const tokenSummary = summarizeTokenState(state.tokenSnapshot);
  const diagnostics = state.diagnostics.map((diagnostic) => Object.freeze({
    code: diagnostic.code,
    severity: diagnostic.severity,
    line: diagnostic.line,
    column: diagnostic.column,
    offset: diagnostic.offset,
  }));

  return Object.freeze({
    schema: "aios.parser.history.v1",
    cursor: state.current,
    tokenCount: tokenSummary.tokenCount,
    jobCount: body.length,
    clauseCounts: countClauses(body),
    diagnostics: Object.freeze(diagnostics),
    restartSafe: tokenSummary.restartSafe && (state.lexHealth?.restartSafe ?? false),
  });
}

function createTimeline(body, diagnostics) {
  const jobEvents = body.flatMap((job) => [
    {
      phase: "job.discovered",
      job: job.name,
      line: job.location?.line ?? 1,
      column: job.location?.column ?? 1,
      status: "ok",
    },
    ...job.clauses.map((clause, index) => ({
      phase: "clause.parsed",
      job: job.name,
      clause: clause.type,
      order: index,
      status: clause.type === "InvalidClause" || clause.type === "UnknownClause" ? "recovered" : "ok",
    })),
  ]);
  const diagnosticEvents = diagnostics.map((diagnostic) => ({
    phase: "diagnostic.emitted",
    code: diagnostic.code,
    severity: diagnostic.severity,
    line: diagnostic.line,
    column: diagnostic.column,
    status: diagnostic.severity === "warning" ? "warning" : "blocked",
  }));

  return Object.freeze([...jobEvents, ...diagnosticEvents].map((event, index) => Object.freeze({
    index,
    ...event,
  })));
}

function parserAnalytics(state, body, health) {
  const history = createHistorySnapshot(state, body);
  const diagnosticsBySeverity = state.diagnostics.reduce((counts, diagnostic) => {
    const key = diagnostic.severity ?? "error";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return Object.freeze({
    schema: "aios.parser.analytics.v1",
    exportReady: health.ok,
    counters: Object.freeze({
      jobs: body.length,
      clauses: body.reduce((total, job) => total + job.clauses.length, 0),
      diagnostics: state.diagnostics.length,
      diagnosticsBySeverity: Object.freeze({ ...diagnosticsBySeverity }),
      ...history.clauseCounts,
    }),
    history,
    timeline: createTimeline(body, state.diagnostics),
    summary: Object.freeze({
      status: health.ok ? "parsed" : health.degraded ? "parsed-with-degraded-recovery" : "blocked",
      nextAction: health.nextAction,
      restartSafe: health.restartSafe,
      boundaryOk: state.boundary?.ok === true,
    }),
  });
}

export function parse(source, options = {}) {
  const state = parserState(source, options);
  const body = [];

  while (!atEnd(state)) {
    if (check(state, TOKEN_TYPES.KEYWORD, "job")) {
      body.push(parseJob(state));
      continue;
    }

    const token = current(state);
    state.diagnostics.push(createDiagnostic("PARSE_EXPECTED_TOP_LEVEL_JOB", `Expected job declaration. Found ${tokenLabel(token)}.`, token));
    advance(state);
    synchronize(state);
  }

  const health = parserHealth(state, body);
  const analytics = parserAnalytics(state, body, health);

  return Object.freeze({
    type: "Program",
    body: Object.freeze(body),
    diagnostics: Object.freeze(state.diagnostics),
    boundary: state.boundary,
    tokenSnapshot: state.tokenSnapshot,
    lexHealth: state.lexHealth,
    health,
    analytics,
  });
}

export function parseOk(source, options = {}) {
  return parse(source, options).diagnostics.length === 0;
}

export function parseHealth(source, options = {}) {
  const program = parse(source, options);
  return Object.freeze({
    health: program.health,
    lexHealth: program.lexHealth,
    diagnostics: program.diagnostics,
    boundary: program.boundary,
  });
}

export function summarizeParse(source, options = {}) {
  const program = parse(source, options);
  return Object.freeze({
    ok: program.health.ok,
    diagnostics: program.diagnostics,
    analytics: program.analytics,
    boundary: program.boundary,
  });
}
