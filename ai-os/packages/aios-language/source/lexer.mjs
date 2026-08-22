import {
  TOKEN_TYPES,
  classifyIdentifier,
  createAuditScope,
  createBoundaryDiagnostics,
  createDiagnostic,
  createTokenStateSnapshot,
  createToken,
  eofToken,
  isSymbol,
  summarizeTokenState,
} from "./tokens.mjs";

function createCursor(source) {
  return {
    source: String(source ?? ""),
    index: 0,
    line: 1,
    column: 1,
  };
}

function currentPosition(cursor) {
  return {
    line: cursor.line,
    column: cursor.column,
    offset: cursor.index,
  };
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

function isWhitespace(char) {
  return char === " " || char === "\t" || char === "\r" || char === "\n";
}

function isIdentifierStart(char) {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_-]/.test(char);
}

function isDigit(char) {
  return /[0-9]/.test(char);
}

function readIdentifier(cursor) {
  const start = currentPosition(cursor);
  let value = "";

  while (isIdentifierPart(peek(cursor))) {
    value += advance(cursor);
  }

  return createToken(classifyIdentifier(value), value, start);
}

function readNumber(cursor, diagnostics) {
  const start = currentPosition(cursor);
  let value = "";
  let decimalSeen = false;

  while (isDigit(peek(cursor)) || peek(cursor) === ".") {
    if (peek(cursor) === ".") {
      if (decimalSeen || !isDigit(peek(cursor, 1))) {
        break;
      }
      decimalSeen = true;
    }
    value += advance(cursor);
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    diagnostics.push(createDiagnostic("LEX_INVALID_NUMBER", `Invalid numeric literal '${value}'.`, start));
  }

  return createToken(TOKEN_TYPES.NUMBER, value, start, { numericValue });
}

function readString(cursor, diagnostics) {
  const start = currentPosition(cursor);
  const quote = advance(cursor);
  let value = "";
  let terminated = false;

  while (cursor.index < cursor.source.length) {
    const char = advance(cursor);

    if (char === quote) {
      terminated = true;
      break;
    }

    if (char === "\\") {
      const escaped = advance(cursor);
      const escapeMap = { n: "\n", r: "\r", t: "\t", "\"": "\"", "'": "'", "\\": "\\" };
      value += escapeMap[escaped] ?? escaped;
      continue;
    }

    if (char === "\n") {
      diagnostics.push(createDiagnostic("LEX_UNTERMINATED_STRING", "String literal cannot span lines.", start));
      break;
    }

    value += char;
  }

  if (!terminated) {
    diagnostics.push(createDiagnostic("LEX_UNTERMINATED_STRING", "Unterminated string literal.", start));
  }

  return createToken(TOKEN_TYPES.STRING, value, start, { quote });
}

function skipLineComment(cursor) {
  while (cursor.index < cursor.source.length && peek(cursor) !== "\n") {
    advance(cursor);
  }
}

function skipBlockComment(cursor, diagnostics) {
  const start = currentPosition(cursor);
  advance(cursor);
  advance(cursor);

  while (cursor.index < cursor.source.length) {
    if (peek(cursor) === "*" && peek(cursor, 1) === "/") {
      advance(cursor);
      advance(cursor);
      return;
    }
    advance(cursor);
  }

  diagnostics.push(createDiagnostic("LEX_UNTERMINATED_COMMENT", "Unterminated block comment.", start));
}

function normalizeLexOptions(options = {}) {
  const workspace = options.workspace === undefined || options.workspace === null
    ? null
    : String(options.workspace).trim();
  const tenant = options.tenant === undefined || options.tenant === null
    ? null
    : String(options.tenant).trim();
  const role = options.role === undefined || options.role === null
    ? null
    : String(options.role).trim();

  return Object.freeze({
    workspace: workspace || null,
    tenant: tenant || null,
    role: role || null,
    localOnly: options.localOnly !== false,
  });
}

function validateLexBoundary(options, diagnostics) {
  const auditScope = createAuditScope(options);
  const generated = [
    ...createBoundaryDiagnostics({
      workspace: options.workspace,
      tenant: options.tenant,
      role: options.role,
    }),
  ];

  diagnostics.push(...generated);

  return Object.freeze({
    ok: generated.length === 0,
    workspace: options.workspace,
    tenant: options.tenant,
    role: options.role,
    localOnly: options.localOnly,
    audit: Object.freeze({
      scope: auditScope,
      handoff: "lexer.boundary",
      externalWrites: false,
      generatedDiagnostics: Object.freeze(generated.map((diagnostic) => diagnostic.code)),
    }),
  });
}

function classifyLexDiagnostic(diagnostic) {
  if (diagnostic.code === "LEX_UNTERMINATED_STRING" || diagnostic.code === "LEX_UNTERMINATED_COMMENT") {
    return Object.freeze({
      category: "incomplete-source",
      retryable: true,
      degradedMode: false,
      action: "resume-editing-from-reported-location",
    });
  }

  if (diagnostic.code?.startsWith("BOUNDARY_") || diagnostic.code?.includes("BOUNDARY")) {
    return Object.freeze({
      category: "boundary",
      retryable: false,
      degradedMode: false,
      action: "correct-workspace-tenant-role-scope",
    });
  }

  if (diagnostic.code === "LEX_UNEXPECTED_CHARACTER") {
    return Object.freeze({
      category: "invalid-token",
      retryable: false,
      degradedMode: true,
      action: "remove-or-escape-unexpected-character",
    });
  }

  return Object.freeze({
    category: "lexer",
    retryable: false,
    degradedMode: true,
    action: "inspect-lexer-diagnostic",
  });
}

function buildLexHealth(diagnostics, snapshot, boundary) {
  const summary = summarizeTokenState(snapshot);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const classifications = errors.map((diagnostic) => ({
    fingerprint: `${diagnostic.code}@${diagnostic.line}:${diagnostic.column}:${diagnostic.offset}`,
    code: diagnostic.code,
    ...classifyLexDiagnostic(diagnostic),
  }));
  const retryable = classifications.some((entry) => entry.retryable);
  const degradedMode = errors.length > 0 && classifications.every((entry) => entry.degradedMode || entry.retryable);

  return Object.freeze({
    schema: "aios.lexer.health.v1",
    ok: errors.length === 0 && boundary.ok,
    status: errors.length === 0 && boundary.ok
      ? "healthy"
      : degradedMode
        ? "degraded"
        : "blocked",
    retryable,
    degradedMode,
    restartSafe: summary.restartSafe && boundary.ok,
    tokenCount: summary.tokenCount,
    errorCount: errors.length,
    warningCount: diagnostics.length - errors.length,
    nextAction: errors.length === 0 && boundary.ok
      ? "parse"
      : retryable
        ? "retry-after-source-completion"
        : "surface-actionable-diagnostics",
    actions: Object.freeze(classifications.map((entry) => Object.freeze(entry))),
  });
}

export function lex(source, options = {}) {
  const normalizedOptions = normalizeLexOptions(options);
  const cursor = createCursor(source);
  const tokens = [];
  const diagnostics = [];
  const boundary = validateLexBoundary(normalizedOptions, diagnostics);

  while (cursor.index < cursor.source.length) {
    const char = peek(cursor);

    if (isWhitespace(char)) {
      advance(cursor);
      continue;
    }

    if (char === "/" && peek(cursor, 1) === "/") {
      skipLineComment(cursor);
      continue;
    }

    if (char === "/" && peek(cursor, 1) === "*") {
      skipBlockComment(cursor, diagnostics);
      continue;
    }

    if (isIdentifierStart(char)) {
      tokens.push(readIdentifier(cursor));
      continue;
    }

    if (isDigit(char)) {
      tokens.push(readNumber(cursor, diagnostics));
      continue;
    }

    if (char === "\"" || char === "'") {
      tokens.push(readString(cursor, diagnostics));
      continue;
    }

    if (isSymbol(char)) {
      tokens.push(createToken(TOKEN_TYPES.SYMBOL, advance(cursor), currentPosition({
        ...cursor,
        index: cursor.index - 1,
        column: cursor.column - 1,
      })));
      continue;
    }

    diagnostics.push(createDiagnostic("LEX_UNEXPECTED_CHARACTER", `Unexpected character '${char}'.`, currentPosition(cursor)));
    advance(cursor);
  }

  tokens.push(eofToken(currentPosition(cursor)));
  const snapshot = createTokenStateSnapshot(tokens, diagnostics, {
    workspace: normalizedOptions.workspace,
    tenant: normalizedOptions.tenant,
    sourceLength: cursor.source.length,
  });
  const health = buildLexHealth(diagnostics, snapshot, boundary);

  return Object.freeze({
    tokens: Object.freeze(tokens),
    diagnostics: Object.freeze(diagnostics),
    boundary,
    snapshot,
    health,
  });
}

export function lexOk(source, options = {}) {
  const result = lex(source, options);
  return result.diagnostics.length === 0;
}

export function describeLexBoundary(source, options = {}) {
  const result = lex(source, options);
  return Object.freeze({
    ok: result.diagnostics.filter((diagnostic) => diagnostic.severity !== "warning").length === 0,
    boundary: result.boundary,
    snapshot: result.snapshot,
    health: result.health,
  });
}
