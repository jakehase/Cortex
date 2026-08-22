export const TOKEN_TYPES = Object.freeze({
  EOF: "EOF",
  IDENTIFIER: "IDENTIFIER",
  KEYWORD: "KEYWORD",
  STRING: "STRING",
  NUMBER: "NUMBER",
  SYMBOL: "SYMBOL",
});

export const KEYWORDS = Object.freeze(new Set([
  "adapter",
  "as",
  "audit",
  "backoff",
  "capability",
  "degraded",
  "emits",
  "error",
  "from",
  "handoff",
  "idempotency",
  "job",
  "key",
  "max",
  "memory",
  "on",
  "permissions",
  "recover",
  "retry",
  "role",
  "rollback",
  "scope",
  "status",
  "truth",
  "tenant",
  "verify",
  "with",
  "workspace",
]));

export const SYMBOLS = Object.freeze(new Set([
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  ":",
  ";",
  ",",
  ".",
  "=",
]));

export function createToken(type, value, position, extra = {}) {
  const line = Number.isInteger(position?.line) ? position.line : 1;
  const column = Number.isInteger(position?.column) ? position.column : 1;
  const offset = Number.isInteger(position?.offset) ? position.offset : 0;

  return Object.freeze({
    type,
    value,
    line,
    column,
    offset,
    ...extra,
  });
}

export function eofToken(position) {
  return createToken(TOKEN_TYPES.EOF, "", position);
}

export function isKeyword(value) {
  return KEYWORDS.has(value);
}

export function isSymbol(value) {
  return SYMBOLS.has(value);
}

export function classifyIdentifier(value) {
  return isKeyword(value) ? TOKEN_TYPES.KEYWORD : TOKEN_TYPES.IDENTIFIER;
}

export function tokenLabel(token) {
  if (!token) {
    return "<missing token>";
  }

  if (token.type === TOKEN_TYPES.EOF) {
    return "end of file";
  }

  return `${token.type.toLowerCase()} '${token.value}'`;
}

export function tokenLocation(token) {
  if (!token) {
    return Object.freeze({ line: 1, column: 1, offset: 0 });
  }

  return Object.freeze({
    line: token.line,
    column: token.column,
    offset: token.offset,
  });
}

export function createDiagnostic(code, message, tokenOrPosition, severity = "error") {
  const location = tokenOrPosition?.type
    ? tokenLocation(tokenOrPosition)
    : tokenLocation({ line: tokenOrPosition?.line, column: tokenOrPosition?.column, offset: tokenOrPosition?.offset });

  return Object.freeze({
    code,
    message,
    severity,
    line: location.line,
    column: location.column,
    offset: location.offset,
  });
}

export function normalizeBoundaryValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

export function boundaryRisk(value, kind = "scope") {
  const normalized = normalizeBoundaryValue(value);
  const violations = [];

  if (!normalized) {
    violations.push(`${kind.toUpperCase()}_EMPTY`);
  } else {
    if (normalized.startsWith("/") || normalized.includes("..")) {
      violations.push(`${kind.toUpperCase()}_PATH_ESCAPE`);
    }

    if (/^[a-z]+:\/\//i.test(normalized)) {
      violations.push(`${kind.toUpperCase()}_REMOTE_URI`);
    }

    if (!/^[A-Za-z0-9_.:/-]+$/.test(normalized)) {
      violations.push(`${kind.toUpperCase()}_UNSAFE_CHARACTERS`);
    }
  }

  return Object.freeze({
    kind,
    value: normalized,
    ok: violations.length === 0,
    violations: Object.freeze(violations),
  });
}

export function createBoundaryDiagnostics(boundaries, position = { line: 1, column: 1, offset: 0 }) {
  return Object.freeze(Object.entries(boundaries ?? {}).flatMap(([kind, value]) => {
    const normalized = normalizeBoundaryValue(value);
    if (normalized === null) {
      return [];
    }

    const risk = boundaryRisk(normalized, kind);
    return risk.violations.map((violation) => createDiagnostic(
      `BOUNDARY_${violation}`,
      `${kind} boundary '${risk.value ?? "<empty>"}' is not valid for local AI OS execution.`,
      position,
    ));
  }));
}

export function createAuditScope(boundaries = {}, permissions = []) {
  const workspace = normalizeBoundaryValue(boundaries.workspace);
  const tenant = normalizeBoundaryValue(boundaries.tenant);
  const role = normalizeBoundaryValue(boundaries.role);
  const normalizedPermissions = Array.from(permissions ?? [])
    .map((permission) => normalizeBoundaryValue(permission))
    .filter(Boolean)
    .sort();
  const boundaryChecks = Object.freeze({
    workspace: boundaryRisk(workspace, "workspace"),
    tenant: boundaryRisk(tenant, "tenant"),
    role: boundaryRisk(role, "role"),
  });
  const ok = Object.values(boundaryChecks).every((entry) => entry.ok || entry.value === null);

  return Object.freeze({
    schema: "aios.audit.scope.v1",
    workspace,
    tenant,
    role,
    permissions: Object.freeze(normalizedPermissions),
    localOnly: boundaries.localOnly !== false,
    externalWrites: false,
    ok,
    boundaryChecks,
  });
}

export function normalizePermissionValue(value) {
  const normalized = normalizeBoundaryValue(value);
  if (!normalized) {
    return null;
  }

  return normalized
    .replace(/\s+/g, "")
    .replace(/^\.+|\.+$/g, "")
    .toLowerCase();
}

export function permissionRisk(permission, context = {}) {
  const normalized = normalizePermissionValue(permission);
  const violations = [];
  const expectedPrefix = normalizePermissionValue(context.expectedPrefix ?? null);

  if (!normalized) {
    violations.push("PERMISSION_EMPTY");
  } else {
    if (!/^[a-z0-9_.:-]+$/.test(normalized)) {
      violations.push("PERMISSION_UNSAFE_CHARACTERS");
    }

    if (normalized.includes("..") || normalized.startsWith(".") || normalized.endsWith(".")) {
      violations.push("PERMISSION_NAMESPACE_ESCAPE");
    }

    if (normalized.includes("*")) {
      violations.push("PERMISSION_WILDCARD");
    }

    if (expectedPrefix && normalized !== expectedPrefix && !normalized.startsWith(`${expectedPrefix}.`)) {
      violations.push("PERMISSION_OUTSIDE_EXPECTED_DOMAIN");
    }
  }

  return Object.freeze({
    permission: normalized,
    expectedPrefix,
    ok: violations.length === 0,
    violations: Object.freeze(violations),
  });
}

function createPermissionDiagnostic(violation, permission, position) {
  const printable = permission || "<empty>";
  const messages = {
    PERMISSION_EMPTY: "Permission entries must be non-empty.",
    PERMISSION_UNSAFE_CHARACTERS: `Permission '${printable}' contains characters outside the local AI OS permission alphabet.`,
    PERMISSION_NAMESPACE_ESCAPE: `Permission '${printable}' attempts to escape its namespace.`,
    PERMISSION_WILDCARD: `Permission '${printable}' cannot use wildcard grants for adapter handoff.`,
    PERMISSION_OUTSIDE_EXPECTED_DOMAIN: `Permission '${printable}' is outside the expected adapter permission domain.`,
  };

  return createDiagnostic(
    `PERMISSION_${violation}`,
    messages[violation] ?? `Permission '${printable}' failed policy validation.`,
    position,
  );
}

export function analyzePermissionBoundary(requiredPermissions = [], declaredPermissions = [], options = {}) {
  const position = options.position ?? { line: 1, column: 1, offset: 0 };
  const expectedPrefix = normalizePermissionValue(options.expectedPrefix ?? null);
  const required = Array.from(requiredPermissions ?? [])
    .map((permission) => normalizePermissionValue(permission))
    .filter(Boolean)
    .sort();
  const declared = Array.from(declaredPermissions ?? [])
    .map((permission) => normalizePermissionValue(permission))
    .filter(Boolean)
    .sort();
  const uniqueRequired = Object.freeze([...new Set(required)]);
  const uniqueDeclared = Object.freeze([...new Set(declared)]);
  const granted = uniqueRequired.filter((permission) => uniqueDeclared.includes(permission));
  const missing = uniqueRequired.filter((permission) => !uniqueDeclared.includes(permission));
  const unused = uniqueDeclared.filter((permission) => !uniqueRequired.includes(permission));
  const risks = uniqueDeclared.map((permission) => permissionRisk(permission, { expectedPrefix }));
  const riskDiagnostics = risks.flatMap((risk) => risk.violations.map((violation) => createPermissionDiagnostic(
    violation,
    risk.permission,
    position,
  )));
  const missingDiagnostics = missing.map((permission) => createDiagnostic(
    "PERMISSION_REQUIRED_CAPABILITY_MISSING",
    `Required capability '${permission}' is not granted by the active role permissions.`,
    position,
  ));
  const overgrantDiagnostics = unused
    .filter((permission) => !expectedPrefix || permission === expectedPrefix || permission.startsWith(`${expectedPrefix}.`))
    .map((permission) => createDiagnostic(
      "PERMISSION_UNUSED_GRANT",
      `Declared permission '${permission}' is not required by this job descriptor.`,
      position,
      "warning",
    ));
  const diagnostics = Object.freeze([...riskDiagnostics, ...missingDiagnostics, ...overgrantDiagnostics]);
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");

  return Object.freeze({
    schema: "aios.permission.boundary.v1",
    ok: blockingDiagnostics.length === 0,
    status: blockingDiagnostics.length === 0
      ? missing.length === 0
        ? "granted"
        : "blocked"
      : "blocked",
    expectedPrefix,
    required: uniqueRequired,
    declared: uniqueDeclared,
    granted: Object.freeze(granted),
    missing: Object.freeze(missing),
    unused: Object.freeze(unused),
    leastPrivilege: unused.length === 0 && missing.length === 0,
    retryable: false,
    degradedModeAllowed: false,
    nextAction: blockingDiagnostics.length === 0
      ? unused.length > 0
        ? "review-unused-role-grants"
        : "continue-to-truth-verification"
      : "align-role-permissions-with-capabilities",
    risks: Object.freeze(risks),
    diagnostics,
  });
}

export function diagnosticFingerprint(diagnostic) {
  const code = diagnostic?.code ?? "UNKNOWN";
  const line = Number.isInteger(diagnostic?.line) ? diagnostic.line : 1;
  const column = Number.isInteger(diagnostic?.column) ? diagnostic.column : 1;
  const offset = Number.isInteger(diagnostic?.offset) ? diagnostic.offset : 0;
  return `${code}@${line}:${column}:${offset}`;
}

export function createTokenStateSnapshot(tokens, diagnostics = [], metadata = {}) {
  const stableTokens = Array.from(tokens ?? []).map((token, index) => Object.freeze({
    index,
    type: token?.type ?? TOKEN_TYPES.EOF,
    value: String(token?.value ?? ""),
    line: Number.isInteger(token?.line) ? token.line : 1,
    column: Number.isInteger(token?.column) ? token.column : 1,
    offset: Number.isInteger(token?.offset) ? token.offset : 0,
    numericValue: typeof token?.numericValue === "number" ? token.numericValue : null,
    quote: token?.quote ?? null,
  }));
  const stableDiagnostics = Array.from(diagnostics ?? []).map((diagnostic) => Object.freeze({
    code: diagnostic?.code ?? "UNKNOWN",
    message: String(diagnostic?.message ?? ""),
    severity: diagnostic?.severity ?? "error",
    line: Number.isInteger(diagnostic?.line) ? diagnostic.line : 1,
    column: Number.isInteger(diagnostic?.column) ? diagnostic.column : 1,
    offset: Number.isInteger(diagnostic?.offset) ? diagnostic.offset : 0,
    fingerprint: diagnosticFingerprint(diagnostic),
  }));

  return Object.freeze({
    schema: "aios.tokens.snapshot.v1",
    tokenCount: stableTokens.length,
    diagnosticCount: stableDiagnostics.length,
    restartSafe: stableDiagnostics.every((diagnostic) => diagnostic.severity === "warning"),
    metadata: Object.freeze({
      workspace: metadata.workspace ?? null,
      tenant: metadata.tenant ?? null,
      sourceLength: Number.isInteger(metadata.sourceLength) ? metadata.sourceLength : null,
    }),
    tokens: Object.freeze(stableTokens),
    diagnostics: Object.freeze(stableDiagnostics),
  });
}

export function hydrateTokenStateSnapshot(snapshot) {
  const tokens = Array.from(snapshot?.tokens ?? []).map((token) => createToken(
    token?.type ?? TOKEN_TYPES.EOF,
    token?.value ?? "",
    {
      line: token?.line,
      column: token?.column,
      offset: token?.offset,
    },
    {
      numericValue: token?.numericValue ?? undefined,
      quote: token?.quote ?? undefined,
    },
  ));
  const diagnostics = Array.from(snapshot?.diagnostics ?? []).map((diagnostic) => createDiagnostic(
    diagnostic?.code ?? "UNKNOWN",
    diagnostic?.message ?? "",
    diagnostic,
    diagnostic?.severity ?? "error",
  ));

  return Object.freeze({
    tokens: Object.freeze(tokens),
    diagnostics: Object.freeze(diagnostics),
    restartSafe: snapshot?.restartSafe === true,
    metadata: Object.freeze({
      workspace: snapshot?.metadata?.workspace ?? null,
      tenant: snapshot?.metadata?.tenant ?? null,
      sourceLength: Number.isInteger(snapshot?.metadata?.sourceLength) ? snapshot.metadata.sourceLength : null,
    }),
  });
}

export function summarizeTokenState(snapshot) {
  const diagnostics = Array.from(snapshot?.diagnostics ?? []);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");

  return Object.freeze({
    ok: errors.length === 0,
    restartSafe: snapshot?.restartSafe === true && errors.length === 0,
    tokenCount: Number.isInteger(snapshot?.tokenCount) ? snapshot.tokenCount : Array.from(snapshot?.tokens ?? []).length,
    errors: Object.freeze(errors.map((diagnostic) => diagnostic.fingerprint ?? diagnosticFingerprint(diagnostic))),
    warnings: Object.freeze(warnings.map((diagnostic) => diagnostic.fingerprint ?? diagnosticFingerprint(diagnostic))),
  });
}
