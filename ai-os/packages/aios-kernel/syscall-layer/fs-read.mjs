export const surfaceId = "aios_syscall-layer_fs-read_022";
export const surfaceGroup = "syscall-layer";
export const surfaceName = "fs-read";

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  lifecycle: "active",
  maxBytes: 1024 * 1024,
  allowHidden: false,
  allowedRoots: Object.freeze(["/workspace", "/tmp"]),
  deniedGlobs: Object.freeze(["**/.ssh/**", "**/.env", "**/node_modules/**"]),
  schedule: Object.freeze({
    mode: "immediate",
    intervalMs: 0,
    nextRunAt: null
  })
});

const DEFAULT_PROVIDER_CONTRACT = Object.freeze({
  providerId: "hosted-kernel.fs-read.local",
  service: "kernel-fs-read",
  version: "1.0.0",
  protocol: "aios.fs.read.v1",
  endpoint: "kernel://syscall-layer/fs-read",
  capabilities: Object.freeze(["absolute-paths", "root-policy", "byte-limit", "audit-proof"]),
  serviceContract: Object.freeze({
    operations: Object.freeze(["fs.read"]),
    maxBytes: DEFAULT_SETTINGS.maxBytes,
    handoffMode: "inline",
    leaseMs: 30000,
    proofModes: Object.freeze(["audit-proof"])
  }),
  sync: Object.freeze({
    cursor: null,
    consistency: "request",
    watermark: null
  })
});

const LIFECYCLE_COMMANDS = new Set([
  "enable",
  "disable",
  "pause",
  "resume",
  "schedule",
  "configure",
  "recover-dispatch",
  "recover-schedule",
  "mark-clean"
]);
const LIFECYCLE_STATES = new Set(["active", "disabled", "paused"]);
const SCHEDULE_MODES = new Set(["immediate", "deferred", "interval"]);
const PROVIDER_PROTOCOLS = new Set(["aios.fs.read.v1"]);
const SYNC_CONSISTENCY_LEVELS = new Set(["request", "session", "provider"]);
const PROVIDER_OPERATIONS = new Set(["fs.read"]);
const PROVIDER_HANDOFF_MODES = new Set(["inline", "external", "queued"]);
const PROVIDER_PROOF_MODES = new Set(["audit-proof", "checksum-proof", "capability-proof"]);
const PROVIDER_ACK_STATES = new Set(["accepted", "rejected", "deferred"]);
const READ_RESULT_ENCODINGS = new Set(["utf8", "base64", "bytes-ref"]);
const READ_RESULT_HASH_ALGORITHMS = new Set(["sha256", "sha512", "blake3"]);
const CLIENT_CHANNELS = new Set(["api", "cli", "web", "agent", "scheduler"]);
const PERSISTED_STATES = new Set(["clean", "blocked", "scheduled", "dispatching", "recovered"]);
const RECOVERY_COMMANDS = new Set(["recover-dispatch", "recover-schedule", "mark-clean"]);
const RETRYABLE_ACTIONS = new Set(["wait-until", "enqueue-interval", "fix-provider-contract"]);
const HEALTH_SIGNAL_STATES = new Set(["healthy", "degraded", "unhealthy", "offline"]);
const CIRCUIT_STATES = new Set(["closed", "half-open", "open"]);
const TENANT_READ_ROLE_GRANTS = Object.freeze({
  owner: Object.freeze(["fs.read", "fs.read.hidden", "fs.read.any-root", "fs.read.audit"]),
  maintainer: Object.freeze(["fs.read", "fs.read.hidden", "fs.read.audit"]),
  reader: Object.freeze(["fs.read"]),
  auditor: Object.freeze(["fs.read.audit"])
});
const ANALYTICS_COUNTERS = Object.freeze([
  "totalRequests",
  "dispatchReady",
  "blockedRequests",
  "scheduledRequests",
  "degradedRequests",
  "recoveryRequired",
  "validationErrors",
  "policyBlocked",
  "encodedPathBlocks",
  "hiddenPathBlocks",
  "deniedGlobBlocks",
  "missingCapabilityEvents",
  "tenantBoundaryBlocks",
  "bytesAccepted",
  "providerAckAwaiting",
  "providerAckAccepted",
  "providerAckRejected",
  "providerResultAwaiting",
  "providerResultFulfilled",
  "providerResultPartial",
  "providerResultRejected",
  "providerResultCommitted",
  "providerResultCommitBlocked",
  "bytesReturned"
]);
const NON_RETRYABLE_ERROR_MATCHERS = Object.freeze([
  { match: "path must be absolute", code: "FS_READ_PATH_NOT_ABSOLUTE", action: "Use an absolute path inside an allowed root." },
  { match: "NUL bytes", code: "FS_READ_PATH_NUL_BYTE", action: "Remove NUL bytes from the path before retrying." },
  { match: "parent traversal", code: "FS_READ_PARENT_TRAVERSAL", action: "Remove '..' path segments before retrying." },
  { match: "encoded path hazard", code: "FS_READ_ENCODED_PATH_HAZARD", action: "Use a normalized literal path without percent-encoded separators, NULs, or traversal segments." },
  { match: "outside allowedRoots", code: "FS_READ_ROOT_POLICY", action: "Choose a path under an allowed root or update allowedRoots." },
  { match: "deniedGlob", code: "FS_READ_DENIED_GLOB", action: "Choose a non-denied path or revise deniedGlobs." },
  { match: "hidden path reads", code: "FS_READ_HIDDEN_PATH", action: "Enable allowHidden only if this read is expected." },
  { match: "range reads require", code: "FS_READ_RANGE_CAPABILITY", action: "Request a zero offset or use a provider with range-read capability." },
  { match: "exceed maxBytes", code: "FS_READ_BYTE_LIMIT", action: "Lower requested bytes or raise maxBytes within policy limits." },
  { match: "provider.serviceContract.maxBytes", code: "FS_READ_PROVIDER_BYTE_LIMIT", action: "Lower requested bytes or select a provider with a larger fs.read byte ceiling." },
  { match: "service contract does not allow fs.read", code: "FS_READ_PROVIDER_OPERATION", action: "Select a provider contract that advertises the fs.read operation." },
  { match: "unavailable capabilities", code: "FS_READ_CAPABILITY_MISSING", action: "Remove the required capability or use a provider that grants it." },
  { match: "tenant boundary", code: "FS_READ_TENANT_BOUNDARY", action: "Choose a path inside the caller tenant workspace or supply a matching tenant boundary." },
  { match: "tenant permission", code: "FS_READ_TENANT_PERMISSION", action: "Grant a role or explicit permission that allows this fs.read request." }
]);
const SUPPORTED_CAPABILITIES = new Set([
  "absolute-paths",
  "root-policy",
  "byte-limit",
  "audit-proof",
  "range-read",
  "checksum-proof",
  "sync-watermark"
]);

const VALIDATION_SEVERITY = Object.freeze({
  blocked: "error",
  attention: "warning",
  ready: "info"
});

function asIso(value, fallback) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function normalizeHostedReadPath(rawPath) {
  const path = typeof rawPath === "string" ? rawPath.trim() : "";
  const hasNul = path.includes("\0");
  const absolute = path.startsWith("/");
  const rawSegments = path.split("/");
  const parentTraversal = rawSegments.includes("..");
  const canonicalSegments = [];

  for (const segment of rawSegments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") continue;
    canonicalSegments.push(segment);
  }

  const canonicalPath = absolute ? `/${canonicalSegments.join("/")}` : canonicalSegments.join("/");
  const hiddenSegments = canonicalSegments.filter((segment) => segment.startsWith("."));
  const basename = canonicalSegments.at(-1) || (absolute ? "/" : "");
  const extensionMatch = basename.match(/\.([^.]+)$/u);

  return {
    contract: "fs-read-path-normalization.v1",
    inputPath: path,
    canonicalPath: canonicalPath === "" && absolute ? "/" : canonicalPath,
    absolute,
    hasNul,
    parentTraversal,
    depth: canonicalSegments.length,
    basename,
    extension: extensionMatch ? extensionMatch[1].toLowerCase() : null,
    hiddenSegments,
    changed: path !== (canonicalPath === "" && absolute ? "/" : canonicalPath)
  };
}

function detectEncodedPathHazards(rawPath) {
  const path = typeof rawPath === "string" ? rawPath.trim() : "";
  const hazards = [];
  const encodedTokens = [...path.matchAll(/%[0-9a-f]{2}/giu)].map((match) => ({
    token: match[0],
    offset: match.index,
    decoded: String.fromCharCode(Number.parseInt(match[0].slice(1), 16))
  }));

  if (encodedTokens.length === 0) {
    return {
      contract: "fs-read-encoded-path-policy.v1",
      encoded: false,
      tokens: [],
      hazards,
      blocked: false
    };
  }

  for (const token of encodedTokens) {
    if (token.decoded === "\0") {
      hazards.push({ type: "encoded-nul", token: token.token, offset: token.offset });
    }
    if (token.decoded === "/" || token.decoded === "\\") {
      hazards.push({ type: "encoded-separator", token: token.token, offset: token.offset });
    }
  }

  const decodedPath = path.replace(/%[0-9a-f]{2}/giu, (token) => (
    String.fromCharCode(Number.parseInt(token.slice(1), 16))
  ));
  const decodedSegments = decodedPath.split(/[\\/]+/u);
  if (decodedSegments.includes("..")) {
    hazards.push({ type: "encoded-parent-traversal", decodedPath });
  }
  if (decodedSegments.some((segment) => segment === ".")) {
    hazards.push({ type: "encoded-current-directory", decodedPath });
  }

  return {
    contract: "fs-read-encoded-path-policy.v1",
    encoded: true,
    tokens: encodedTokens.map((token) => ({
      token: token.token,
      offset: token.offset,
      class: token.decoded === "\0"
        ? "nul"
        : token.decoded === "/" || token.decoded === "\\"
          ? "separator"
          : token.decoded === "."
            ? "dot"
            : "literal"
    })),
    decodedPath,
    hazards,
    blocked: hazards.length > 0
  };
}

function rootContainsPath(root, canonicalPath) {
  const normalizedRoot = root === "/" ? "/" : root.replace(/\/+$/u, "");
  if (normalizedRoot === "/") return canonicalPath.startsWith("/");
  return canonicalPath === normalizedRoot || canonicalPath.startsWith(`${normalizedRoot}/`);
}

function compareRootSpecificity(left, right) {
  const leftDepth = left.split("/").filter(Boolean).length;
  const rightDepth = right.split("/").filter(Boolean).length;
  if (leftDepth !== rightDepth) return rightDepth - leftDepth;
  return right.length - left.length;
}

function buildRootScopeProof(roots) {
  const orderedRoots = [...roots].sort(compareRootSpecificity);
  const overlaps = [];
  const broadRoots = [];

  for (const [index, root] of orderedRoots.entries()) {
    if (root === "/") {
      broadRoots.push({ root, reason: "filesystem root grants every absolute path" });
    }
    if (root === "/tmp") {
      broadRoots.push({ root, reason: "shared temporary root requires tenant boundary or explicit request policy" });
    }

    for (const priorRoot of orderedRoots.slice(0, index)) {
      if (rootContainsPath(root, priorRoot) || rootContainsPath(priorRoot, root)) {
        overlaps.push({
          parent: rootContainsPath(root, priorRoot) ? root : priorRoot,
          child: rootContainsPath(root, priorRoot) ? priorRoot : root
        });
      }
    }
  }

  return {
    orderedRoots,
    broadRoots,
    overlaps
  };
}

function selectMostSpecificRoot(roots, canonicalPath) {
  return [...roots]
    .filter((root) => rootContainsPath(root, canonicalPath))
    .sort(compareRootSpecificity)[0] || null;
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function deniedGlobToRegExp(glob) {
  const normalizedGlob = typeof glob === "string" ? glob.trim() : "";
  if (!normalizedGlob) return null;
  let pattern = "^";

  for (let index = 0; index < normalizedGlob.length; index += 1) {
    const char = normalizedGlob[index];
    const next = normalizedGlob[index + 1];
    const afterNext = normalizedGlob[index + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      pattern += "(?:.*/)?";
      index += 2;
      continue;
    }
    if (char === "*" && next === "*") {
      pattern += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      pattern += "[^/]*";
      continue;
    }
    pattern += escapeRegExp(char);
  }

  return new RegExp(`${pattern}$`, "u");
}

function matchDeniedGlob(canonicalPath, deniedGlobs) {
  if (!canonicalPath || !Array.isArray(deniedGlobs)) return null;

  for (const glob of deniedGlobs) {
    const matcher = deniedGlobToRegExp(glob);
    if (!matcher) continue;
    if (matcher.test(canonicalPath)) {
      return {
        glob,
        matcher: "segment-glob",
        path: canonicalPath
      };
    }
  }

  return null;
}

function normalizeScopeRootEntries(rawRoots, fallbackRoots, label) {
  const requestedRoots = Array.isArray(rawRoots) ? rawRoots : fallbackRoots;
  const roots = [];
  const errors = [];
  const proof = [];
  const canonicalInputs = new Map();

  for (const [index, rawRoot] of requestedRoots.entries()) {
    const original = typeof rawRoot === "string" ? rawRoot.trim() : "";
    const normalized = normalizeHostedReadPath(original);
    const rootLabel = `${label}[${index}]`;
    const blockedReasons = [];

    if (!original) blockedReasons.push(`${rootLabel} must be a non-empty absolute path`);
    if (normalized.hasNul) blockedReasons.push(`${rootLabel} must not contain NUL bytes`);
    if (original && !normalized.absolute) blockedReasons.push(`${rootLabel} must be an absolute path`);
    if (normalized.parentTraversal) blockedReasons.push(`${rootLabel} must not contain parent traversal`);

    if (blockedReasons.length) {
      errors.push(...blockedReasons);
      proof.push({
        input: original || null,
        canonicalRoot: null,
        accepted: false,
        reasons: blockedReasons
      });
      continue;
    }

    const canonicalRoot = normalized.canonicalPath === "" ? "/" : normalized.canonicalPath;
    if (canonicalInputs.has(canonicalRoot)) {
      proof.push({
        input: original,
        canonicalRoot,
        accepted: true,
        duplicateOf: canonicalInputs.get(canonicalRoot),
        changed: normalized.changed
      });
      continue;
    }
    canonicalInputs.set(canonicalRoot, original);
    roots.push(canonicalRoot);
    proof.push({
      input: original,
      canonicalRoot,
      accepted: true,
      changed: normalized.changed
    });
  }

  if (roots.length === 0) errors.push(`${label} must include at least one accepted absolute root`);
  const scopeProof = buildRootScopeProof(roots);
  const rejectedFilesystemRoot = label === "settings.allowedRoots" && scopeProof.broadRoots.some((entry) => entry.root === "/");
  if (rejectedFilesystemRoot) {
    errors.push(`${label} must not include / because fs.read requires an explicit workspace or temporary root`);
  }

  return {
    contract: "fs-read-scope-root-policy.v1",
    label,
    roots,
    errors,
    proof,
    scopeProof
  };
}

function normalizeTenantToken(value, fallback = null) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return stableClientKey(value.trim());
}

function deriveRolePermissions(roles = [], explicitPermissions = []) {
  const roleGrants = roles.flatMap((role) => TENANT_READ_ROLE_GRANTS[role] || []);
  return uniqueStrings([...roleGrants, ...explicitPermissions]);
}

function selectTenantBoundaryInput(input = {}) {
  const candidates = [
    input.tenantBoundary,
    input.permissionBoundary,
    input.tenantPermissions,
    input.workspaceBoundary,
    input.tenant
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") || {};
}

function normalizeTenantBoundary(input, clientContext, readGate, now) {
  const boundaryInput = selectTenantBoundaryInput(input);
  const requestInput = input.readRequest || input.request || {};
  const tenantIdentity = clientContext.tenantIdentity || {};
  const requestedTenantId = normalizeTenantToken(requestInput.tenantId || boundaryInput.requestTenantId, null);
  const tenantId = normalizeTenantToken(boundaryInput.tenantId, tenantIdentity.tenantId || requestedTenantId);
  const workspaceId = normalizeTenantToken(boundaryInput.workspaceId, tenantIdentity.workspaceId || tenantId || "workspace");
  const explicitBoundaryRoots = Array.isArray(boundaryInput.allowedRoots || boundaryInput.roots)
    && (boundaryInput.allowedRoots || boundaryInput.roots).length > 0;
  const workspaceRoot = typeof boundaryInput.workspaceRoot === "string" && boundaryInput.workspaceRoot.trim()
    ? normalizeHostedReadPath(boundaryInput.workspaceRoot).canonicalPath
    : tenantId
      ? `/workspace/tenants/${tenantId}`
      : "/workspace";
  const boundaryRootPolicy = normalizeScopeRootEntries(
    boundaryInput.allowedRoots || boundaryInput.roots,
    [workspaceRoot],
    "tenantBoundary.allowedRoots"
  );
  const allowedRoots = boundaryRootPolicy.roots;
  const roles = uniqueStrings(boundaryInput.roles || tenantIdentity.roles || []);
  const explicitPermissions = uniqueStrings(boundaryInput.permissions || tenantIdentity.permissions || []);
  const permissions = deriveRolePermissions(roles.length ? roles : ["reader"], explicitPermissions);
  const observed = Boolean(tenantId || requestedTenantId || Object.keys(boundaryInput).length);
  const enforced = boundaryInput.enforce === true
    || boundaryInput.enforced === true
    || Boolean(tenantId || requestedTenantId || explicitBoundaryRoots || boundaryInput.workspaceRoot);
  const requiredPermission = readGate.pathNormalization.hiddenSegments.length ? "fs.read.hidden" : "fs.read";
  const matchedTenantRoot = selectMostSpecificRoot(allowedRoots, readGate.path);
  const tenantMismatch = Boolean(tenantId && requestedTenantId && tenantId !== requestedTenantId);
  const hasReadPermission = permissions.includes(requiredPermission) || permissions.includes("fs.read.any-root");
  const anyRoot = permissions.includes("fs.read.any-root");
  const rootAllowed = Boolean(matchedTenantRoot) || anyRoot;
  const errors = [...boundaryRootPolicy.errors];

  if (enforced && tenantMismatch) errors.push("tenant boundary request tenantId does not match caller tenant");
  if (enforced && !rootAllowed) errors.push("tenant boundary blocked path outside caller workspace roots");
  if (enforced && !hasReadPermission) errors.push(`tenant permission ${requiredPermission} is required for fs.read`);

  return {
    contract: "fs-read-tenant-boundary.v1",
    schemaVersion: 1,
    generatedAt: now,
    observed,
    mode: enforced ? "enforced" : "monitor",
    tenantId: tenantId || null,
    requestedTenantId: requestedTenantId || null,
    workspaceId,
    roles: roles.length ? roles : ["reader"],
    permissions,
    requiredPermission,
    allowedRoots,
    rootPolicy: boundaryRootPolicy,
    matchedTenantRoot: matchedTenantRoot || null,
    anyRootOverride: anyRoot,
    decision: errors.length ? "blocked" : "allowed",
    errors,
    proof: {
      tenantMatched: !tenantMismatch,
      rootMatched: rootAllowed,
      permissionGranted: hasReadPermission,
      enforcement: enforced,
      evaluatedAt: now
    }
  };
}

function normalizeSettings(inputSettings = {}) {
  const errors = [];
  const rootPolicy = normalizeScopeRootEntries(inputSettings.allowedRoots, DEFAULT_SETTINGS.allowedRoots, "settings.allowedRoots");
  const allowedRoots = rootPolicy.roots;
  const deniedGlobs = uniqueStrings(inputSettings.deniedGlobs || DEFAULT_SETTINGS.deniedGlobs);
  const maxBytes = Number.isInteger(inputSettings.maxBytes) ? inputSettings.maxBytes : DEFAULT_SETTINGS.maxBytes;
  const lifecycle = typeof inputSettings.lifecycle === "string" ? inputSettings.lifecycle : DEFAULT_SETTINGS.lifecycle;
  const scheduleInput = inputSettings.schedule && typeof inputSettings.schedule === "object" ? inputSettings.schedule : {};
  const scheduleMode = typeof scheduleInput.mode === "string" ? scheduleInput.mode : DEFAULT_SETTINGS.schedule.mode;
  const intervalMs = Number.isInteger(scheduleInput.intervalMs) ? scheduleInput.intervalMs : DEFAULT_SETTINGS.schedule.intervalMs;

  errors.push(...rootPolicy.errors);
  if (maxBytes < 1 || maxBytes > 16 * 1024 * 1024) errors.push("maxBytes must be between 1 byte and 16 MiB");
  if (!LIFECYCLE_STATES.has(lifecycle)) errors.push(`lifecycle must be one of ${[...LIFECYCLE_STATES].join(", ")}`);
  if (!SCHEDULE_MODES.has(scheduleMode)) errors.push(`schedule.mode must be one of ${[...SCHEDULE_MODES].join(", ")}`);
  if (scheduleMode === "interval" && intervalMs < 1000) errors.push("schedule.intervalMs must be at least 1000 for interval mode");

  return {
    settings: {
      enabled: inputSettings.enabled !== false && lifecycle !== "disabled",
      lifecycle,
      maxBytes,
      allowHidden: inputSettings.allowHidden === true,
      allowedRoots,
      rootPolicy,
      deniedGlobs,
      schedule: {
        mode: scheduleMode,
        intervalMs,
        nextRunAt: typeof scheduleInput.nextRunAt === "string" ? scheduleInput.nextRunAt : null
      }
    },
    errors
  };
}

function normalizeLifecycleSettingsPatch(input = {}, currentSettings, now) {
  const patchInput = input.settingsPatch && typeof input.settingsPatch === "object"
    ? input.settingsPatch
    : input.patch && typeof input.patch === "object"
      ? input.patch
      : {};
  const candidate = {
    ...currentSettings,
    schedule: { ...currentSettings.schedule }
  };
  const changedFields = [];

  if (Object.hasOwn(patchInput, "enabled")) {
    candidate.enabled = patchInput.enabled === true;
    candidate.lifecycle = patchInput.enabled === false ? "disabled" : candidate.lifecycle;
    changedFields.push("enabled");
  }
  if (Object.hasOwn(patchInput, "lifecycle")) {
    candidate.lifecycle = patchInput.lifecycle;
    changedFields.push("lifecycle");
  }
  if (Object.hasOwn(patchInput, "maxBytes")) {
    candidate.maxBytes = patchInput.maxBytes;
    changedFields.push("maxBytes");
  }
  if (Object.hasOwn(patchInput, "allowHidden")) {
    candidate.allowHidden = patchInput.allowHidden === true;
    changedFields.push("allowHidden");
  }
  if (Object.hasOwn(patchInput, "allowedRoots")) {
    candidate.allowedRoots = patchInput.allowedRoots;
    changedFields.push("allowedRoots");
  }
  if (Object.hasOwn(patchInput, "deniedGlobs")) {
    candidate.deniedGlobs = patchInput.deniedGlobs;
    changedFields.push("deniedGlobs");
  }
  if (patchInput.schedule && typeof patchInput.schedule === "object") {
    candidate.schedule = {
      ...candidate.schedule,
      ...patchInput.schedule
    };
    changedFields.push("schedule");
  }

  const normalized = normalizeSettings(candidate);
  const scheduleNextRunAt = asIso(normalized.settings.schedule.nextRunAt, null);
  const errors = [...normalized.errors];
  if (changedFields.length === 0) errors.push("configure command requires at least one supported settingsPatch field");
  if (normalized.settings.schedule.mode === "deferred" && !scheduleNextRunAt) {
    errors.push("configure command schedule.nextRunAt is required for deferred mode");
  }
  if (scheduleNextRunAt && Date.parse(scheduleNextRunAt) < Date.parse(now)) {
    errors.push("configure command schedule.nextRunAt must not be in the past");
  }

  return {
    settings: {
      ...normalized.settings,
      schedule: {
        ...normalized.settings.schedule,
        nextRunAt: scheduleNextRunAt
      }
    },
    changedFields: [...new Set(changedFields)],
    errors
  };
}

function normalizeLifecycleScheduleCommand(input = {}, currentSchedule = {}, now) {
  const scheduleInput = input.schedule && typeof input.schedule === "object" ? input.schedule : {};
  const requestedMode = typeof input.mode === "string"
    ? input.mode.trim()
    : typeof scheduleInput.mode === "string"
      ? scheduleInput.mode.trim()
      : null;
  const requestedNextRunAt = asIso(input.nextRunAt || scheduleInput.nextRunAt, null);
  const requestedIntervalMs = Number.isInteger(input.intervalMs)
    ? input.intervalMs
    : Number.isInteger(scheduleInput.intervalMs)
      ? scheduleInput.intervalMs
      : Number.isInteger(currentSchedule.intervalMs)
        ? currentSchedule.intervalMs
        : 0;
  const inferredMode = requestedMode || (requestedIntervalMs > 0 ? "interval" : requestedNextRunAt ? "deferred" : "immediate");
  const errors = [];

  if (!SCHEDULE_MODES.has(inferredMode)) {
    errors.push(`schedule command mode must be one of ${[...SCHEDULE_MODES].join(", ")}`);
  }
  if (inferredMode === "deferred" && !requestedNextRunAt) {
    errors.push("schedule command nextRunAt is required for deferred mode");
  }
  if (inferredMode === "interval" && requestedIntervalMs < 1000) {
    errors.push("schedule command intervalMs must be at least 1000");
  }
  if (inferredMode === "immediate" && (requestedNextRunAt || requestedIntervalMs > 0)) {
    errors.push("schedule command immediate mode cannot include nextRunAt or intervalMs");
  }
  if (requestedNextRunAt && Date.parse(requestedNextRunAt) < Date.parse(now)) {
    errors.push("schedule command nextRunAt must not be in the past");
  }

  const nextRunAt = inferredMode === "immediate"
    ? null
    : inferredMode === "deferred"
      ? requestedNextRunAt
      : requestedNextRunAt || asIso(new Date(Date.parse(now) + requestedIntervalMs), now);

  return {
    contract: "fs-read-lifecycle-schedule-command.v1",
    mode: inferredMode,
    intervalMs: inferredMode === "interval" ? requestedIntervalMs : 0,
    nextRunAt,
    errors,
    proof: {
      explicitMode: Boolean(requestedMode),
      explicitNextRunAt: Boolean(requestedNextRunAt),
      explicitIntervalMs: Number.isInteger(input.intervalMs) || Number.isInteger(scheduleInput.intervalMs),
      evaluatedAt: now
    }
  };
}

function normalizeProviderContract(inputProvider = {}, now) {
  const errors = [];
  const providerId = typeof inputProvider.providerId === "string" && inputProvider.providerId.trim()
    ? inputProvider.providerId.trim()
    : DEFAULT_PROVIDER_CONTRACT.providerId;
  const service = typeof inputProvider.service === "string" && inputProvider.service.trim()
    ? inputProvider.service.trim()
    : DEFAULT_PROVIDER_CONTRACT.service;
  const version = typeof inputProvider.version === "string" && inputProvider.version.trim()
    ? inputProvider.version.trim()
    : DEFAULT_PROVIDER_CONTRACT.version;
  const protocol = typeof inputProvider.protocol === "string" && inputProvider.protocol.trim()
    ? inputProvider.protocol.trim()
    : DEFAULT_PROVIDER_CONTRACT.protocol;
  const endpoint = typeof inputProvider.endpoint === "string" && inputProvider.endpoint.trim()
    ? inputProvider.endpoint.trim()
    : DEFAULT_PROVIDER_CONTRACT.endpoint;
  const requestedCapabilities = uniqueStrings(inputProvider.capabilities || DEFAULT_PROVIDER_CONTRACT.capabilities);
  const serviceContractInput = inputProvider.serviceContract && typeof inputProvider.serviceContract === "object"
    ? inputProvider.serviceContract
    : inputProvider.contract && typeof inputProvider.contract === "object"
      ? inputProvider.contract
      : {};
  const syncInput = inputProvider.sync && typeof inputProvider.sync === "object" ? inputProvider.sync : {};
  const consistency = typeof syncInput.consistency === "string" ? syncInput.consistency : DEFAULT_PROVIDER_CONTRACT.sync.consistency;
  const cursor = typeof syncInput.cursor === "string" && syncInput.cursor.trim() ? syncInput.cursor.trim() : null;
  const watermark = asIso(syncInput.watermark, null);
  const operations = uniqueStrings(serviceContractInput.operations || DEFAULT_PROVIDER_CONTRACT.serviceContract.operations);
  const serviceMaxBytes = Number.isInteger(serviceContractInput.maxBytes)
    ? serviceContractInput.maxBytes
    : DEFAULT_PROVIDER_CONTRACT.serviceContract.maxBytes;
  const handoffMode = typeof serviceContractInput.handoffMode === "string"
    ? serviceContractInput.handoffMode
    : DEFAULT_PROVIDER_CONTRACT.serviceContract.handoffMode;
  const leaseMs = Number.isInteger(serviceContractInput.leaseMs)
    ? serviceContractInput.leaseMs
    : DEFAULT_PROVIDER_CONTRACT.serviceContract.leaseMs;
  const proofModes = uniqueStrings(serviceContractInput.proofModes || DEFAULT_PROVIDER_CONTRACT.serviceContract.proofModes);

  if (!/^[a-z0-9_.:-]+$/i.test(providerId)) errors.push("provider.providerId must be a stable token");
  if (!/^[a-z0-9_.:-]+$/i.test(service)) errors.push("provider.service must be a stable service token");
  if (!PROVIDER_PROTOCOLS.has(protocol)) errors.push(`provider.protocol must be one of ${[...PROVIDER_PROTOCOLS].join(", ")}`);
  if (!endpoint.startsWith("kernel://") && !endpoint.startsWith("handoff://")) {
    errors.push("provider.endpoint must use kernel:// or handoff://");
  }
  if (!SYNC_CONSISTENCY_LEVELS.has(consistency)) {
    errors.push(`provider.sync.consistency must be one of ${[...SYNC_CONSISTENCY_LEVELS].join(", ")}`);
  }
  if (!operations.includes("fs.read")) errors.push("provider.serviceContract.operations must include fs.read");
  const unsupportedOperation = operations.find((operation) => !PROVIDER_OPERATIONS.has(operation));
  if (unsupportedOperation) errors.push(`provider.serviceContract.operations contains unsupported operation: ${unsupportedOperation}`);
  if (serviceMaxBytes < 1 || serviceMaxBytes > 16 * 1024 * 1024) {
    errors.push("provider.serviceContract.maxBytes must be between 1 byte and 16 MiB");
  }
  if (!PROVIDER_HANDOFF_MODES.has(handoffMode)) {
    errors.push(`provider.serviceContract.handoffMode must be one of ${[...PROVIDER_HANDOFF_MODES].join(", ")}`);
  }
  if (leaseMs < 1000 || leaseMs > 5 * 60 * 1000) {
    errors.push("provider.serviceContract.leaseMs must be between 1000 and 300000");
  }
  const unsupportedProofModes = proofModes.filter((mode) => !PROVIDER_PROOF_MODES.has(mode));
  for (const mode of unsupportedProofModes) errors.push(`provider.serviceContract.proofModes contains unsupported proof mode: ${mode}`);

  const unsupportedCapabilities = requestedCapabilities.filter((capability) => !SUPPORTED_CAPABILITIES.has(capability));
  for (const capability of unsupportedCapabilities) errors.push(`provider capability is not supported: ${capability}`);

  return {
    provider: {
      providerId,
      service,
      version,
      protocol,
      endpoint,
      capabilities: requestedCapabilities,
      serviceContract: {
        operations,
        maxBytes: serviceMaxBytes,
        handoffMode,
        leaseMs,
        proofModes
      },
      sync: {
        cursor,
        consistency,
        watermark,
        observedAt: now
      }
    },
    unsupportedCapabilities,
    errors
  };
}

function normalizeCommandLedger(entries = []) {
  const seen = new Set();
  const ledger = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== "object") continue;
    const commandId = typeof entry.commandId === "string" && entry.commandId.trim() ? entry.commandId.trim() : null;
    if (!commandId || seen.has(commandId)) continue;
    seen.add(commandId);
    ledger.push({
      commandId,
      command: typeof entry.command === "string" && entry.command.trim() ? entry.command.trim() : "unknown",
      state: PERSISTED_STATES.has(entry.state) ? entry.state : "clean",
      appliedAt: asIso(entry.appliedAt, null),
      replaySafe: entry.replaySafe !== false
    });
  }

  return ledger.slice(-25);
}

function toNonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function normalizeCountMap(input = {}) {
  const output = {};
  if (!input || typeof input !== "object") return output;
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = stableClientKey(key);
    const normalizedValue = toNonNegativeInteger(value, 0);
    if (normalizedKey && normalizedValue > 0) output[normalizedKey] = normalizedValue;
  }
  return output;
}

function normalizeAnalyticsSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const at = asIso(snapshot.at || snapshot.generatedAt, null);
  if (!at) return null;

  return {
    at,
    requestId: typeof snapshot.requestId === "string" && snapshot.requestId.trim() ? snapshot.requestId.trim() : null,
    workflowId: typeof snapshot.workflowId === "string" && snapshot.workflowId.trim() ? snapshot.workflowId.trim() : null,
    providerId: typeof snapshot.providerId === "string" && snapshot.providerId.trim() ? snapshot.providerId.trim() : null,
    channel: CLIENT_CHANNELS.has(snapshot.channel) ? snapshot.channel : "api",
    state: typeof snapshot.state === "string" && snapshot.state.trim() ? snapshot.state.trim() : "unknown",
    serviceLevel: typeof snapshot.serviceLevel === "string" && snapshot.serviceLevel.trim() ? snapshot.serviceLevel.trim() : "unknown",
    route: typeof snapshot.route === "string" && snapshot.route.trim() ? snapshot.route.trim() : null,
    path: typeof snapshot.path === "string" && snapshot.path.trim() ? snapshot.path.trim() : null,
    root: typeof snapshot.root === "string" && snapshot.root.trim() ? snapshot.root.trim() : null,
    tenantId: typeof snapshot.tenantId === "string" && snapshot.tenantId.trim() ? snapshot.tenantId.trim() : null,
    tenantBoundaryDecision: typeof snapshot.tenantBoundaryDecision === "string" && snapshot.tenantBoundaryDecision.trim()
      ? snapshot.tenantBoundaryDecision.trim()
      : "not-evaluated",
    bytes: toNonNegativeInteger(snapshot.bytes, 0),
    ready: snapshot.ready === true,
    queueable: snapshot.queueable === true,
    degraded: snapshot.degraded === true,
    providerAcknowledgementState: typeof snapshot.providerAcknowledgementState === "string" && snapshot.providerAcknowledgementState.trim()
      ? snapshot.providerAcknowledgementState.trim()
      : "unknown",
    hostedKernelReadResultState: typeof snapshot.hostedKernelReadResultState === "string" && snapshot.hostedKernelReadResultState.trim()
      ? snapshot.hostedKernelReadResultState.trim()
      : "unknown",
    resultReceived: snapshot.resultReceived === true,
    bytesReturned: toNonNegativeInteger(snapshot.bytesReturned, 0),
    providerResultCommitState: typeof snapshot.providerResultCommitState === "string" && snapshot.providerResultCommitState.trim()
      ? snapshot.providerResultCommitState.trim()
      : "unknown",
    providerResultCommitReady: snapshot.providerResultCommitReady === true,
    providerResultCommitAdmissionState: typeof snapshot.providerResultCommitAdmissionState === "string" && snapshot.providerResultCommitAdmissionState.trim()
      ? snapshot.providerResultCommitAdmissionState.trim()
      : "unknown",
    providerResultCommitAdmitted: snapshot.providerResultCommitAdmitted === true,
    policyBlocked: snapshot.policyBlocked === true,
    policyBlockTypes: uniqueStrings(snapshot.policyBlockTypes || []),
    recoveryState: typeof snapshot.recoveryState === "string" && snapshot.recoveryState.trim()
      ? snapshot.recoveryState.trim()
      : "unknown",
    errorCodes: uniqueStrings(snapshot.errorCodes || [])
  };
}

function normalizeAnalyticsState(inputAnalytics = {}) {
  const analyticsInput = inputAnalytics && typeof inputAnalytics === "object" ? inputAnalytics : {};
  const countersInput = analyticsInput.counters && typeof analyticsInput.counters === "object" ? analyticsInput.counters : {};
  const counters = ANALYTICS_COUNTERS.reduce((summary, counter) => {
    summary[counter] = toNonNegativeInteger(countersInput[counter], 0);
    return summary;
  }, {});
  const dimensionsInput = analyticsInput.dimensions && typeof analyticsInput.dimensions === "object" ? analyticsInput.dimensions : {};
  const snapshots = (Array.isArray(analyticsInput.snapshots) ? analyticsInput.snapshots : analyticsInput.history || [])
    .map((snapshot) => normalizeAnalyticsSnapshot(snapshot))
    .filter(Boolean)
    .slice(-30);

  return {
    contract: "fs-read-analytics-state.v1",
    schemaVersion: 1,
    counters,
    dimensions: {
      byChannel: normalizeCountMap(dimensionsInput.byChannel),
      byRoot: normalizeCountMap(dimensionsInput.byRoot),
      byTenant: normalizeCountMap(dimensionsInput.byTenant),
      byProvider: normalizeCountMap(dimensionsInput.byProvider),
      byAction: normalizeCountMap(dimensionsInput.byAction),
      byErrorCode: normalizeCountMap(dimensionsInput.byErrorCode)
    },
    snapshots
  };
}

function normalizePersistedState(inputState = {}, now) {
  const stateInput = inputState && typeof inputState === "object" ? inputState : {};
  const status = PERSISTED_STATES.has(stateInput.status) ? stateInput.status : "clean";
  const snapshot = stateInput.snapshot && typeof stateInput.snapshot === "object" ? stateInput.snapshot : {};
  const pendingRead = stateInput.pendingRead && typeof stateInput.pendingRead === "object" ? stateInput.pendingRead : null;
  const warnings = [];
  const dirty = status === "dispatching" || status === "scheduled";
  const recoveredAt = dirty ? now : asIso(stateInput.recoveredAt, null);
  const lastHeartbeatAt = asIso(stateInput.lastHeartbeatAt, null);

  if (stateInput.status && !PERSISTED_STATES.has(stateInput.status)) warnings.push(`unknown persisted status ${stateInput.status}`);
  if (dirty && !pendingRead) warnings.push("persisted state is restart-sensitive but has no pendingRead payload");

  return {
    contract: "fs-read-persisted-state.v1",
    schemaVersion: 1,
    status,
    epoch: Number.isInteger(stateInput.epoch) && stateInput.epoch >= 0 ? stateInput.epoch : 0,
    lastHeartbeatAt,
    recoveredAt,
    commandLedger: normalizeCommandLedger(stateInput.commandLedger),
    pendingRead: pendingRead
      ? {
          path: typeof pendingRead.path === "string" ? pendingRead.path : null,
          bytes: Number.isInteger(pendingRead.bytes) ? pendingRead.bytes : null,
          syncCursor: typeof pendingRead.syncCursor === "string" ? pendingRead.syncCursor : null,
          handoffKey: typeof pendingRead.handoffKey === "string" ? pendingRead.handoffKey : null,
          startedAt: asIso(pendingRead.startedAt, null)
        }
      : null,
    snapshot: {
      settings: snapshot.settings && typeof snapshot.settings === "object" ? snapshot.settings : null,
      providerRef: snapshot.providerRef && typeof snapshot.providerRef === "object" ? snapshot.providerRef : null,
      readRequest: snapshot.readRequest && typeof snapshot.readRequest === "object" ? snapshot.readRequest : null,
      syncCursor: typeof snapshot.syncCursor === "string" ? snapshot.syncCursor : null
    },
    restart: {
      dirty,
      safeToReplay: !dirty || status === "scheduled",
      requiresRecovery: dirty && status === "dispatching"
    },
    warnings
  };
}

function deriveCommandId(input = {}, clientContext = {}) {
  const lifecycleInput = input.lifecycle && typeof input.lifecycle === "object" ? input.lifecycle : input;
  const candidate = lifecycleInput.commandId || lifecycleInput.idempotencyKey || input.commandId || input.idempotencyKey;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  if (typeof clientContext.requestId === "string" && clientContext.requestId.trim() && lifecycleInput.command) {
    return `${lifecycleInput.command}:${clientContext.requestId.trim()}`;
  }
  return null;
}

function negotiateProviderCapabilities(provider, readRequest = {}) {
  const requested = uniqueStrings(readRequest.capabilities || readRequest.requiredCapabilities || []);
  const available = provider.capabilities.filter((capability) => SUPPORTED_CAPABILITIES.has(capability));
  const granted = requested.length
    ? requested.filter((capability) => available.includes(capability))
    : available;
  const missing = requested.filter((capability) => !granted.includes(capability));
  const proof = granted.map((capability) => ({ capability, providerId: provider.providerId, granted: true }));
  const serviceProof = {
    capability: "provider-service-contract",
    providerId: provider.providerId,
    granted: provider.serviceContract.operations.includes("fs.read"),
    operation: "fs.read",
    handoffMode: provider.serviceContract.handoffMode,
    maxBytes: provider.serviceContract.maxBytes
  };

  return {
    mode: missing.length ? "degraded" : "granted",
    requested,
    available,
    granted,
    missing,
    proof: [...proof, serviceProof]
  };
}

function applyLifecycleCommand(settings, input = {}, now, persistedState = null, commandId = null) {
  const command = typeof input.command === "string" ? input.command : null;
  const events = [];
  const nextSettings = {
    ...settings,
    allowedRoots: [...settings.allowedRoots],
    deniedGlobs: [...settings.deniedGlobs],
    schedule: { ...settings.schedule }
  };
  const errors = [];

  if (!command) return { settings: nextSettings, command: "describe", events, errors };
  const priorCommand = commandId
    ? persistedState?.commandLedger?.find((entry) => entry.commandId === commandId)
    : null;
  if (priorCommand?.replaySafe) {
    return {
      settings: nextSettings,
      command,
      events,
      errors,
      idempotency: {
        commandId,
        replayed: true,
        priorState: priorCommand.state,
        priorAppliedAt: priorCommand.appliedAt
      }
    };
  }
  if (!LIFECYCLE_COMMANDS.has(command)) {
    return {
      settings: nextSettings,
      command,
      events,
      errors: [`unsupported lifecycle command: ${command}`],
      idempotency: { commandId, replayed: false }
    };
  }

  if (command === "enable" || command === "resume") {
    nextSettings.enabled = true;
    nextSettings.lifecycle = "active";
    events.push({ type: "lifecycle", command, state: "active", at: now });
  }

  if (command === "disable") {
    nextSettings.enabled = false;
    nextSettings.lifecycle = "disabled";
    nextSettings.schedule = {
      mode: "immediate",
      intervalMs: 0,
      nextRunAt: null
    };
    events.push({ type: "lifecycle", command, state: "disabled", at: now });
  }

  if (command === "pause") {
    nextSettings.enabled = true;
    nextSettings.lifecycle = "paused";
    nextSettings.schedule = {
      ...nextSettings.schedule,
      nextRunAt: nextSettings.schedule.mode === "immediate" ? null : nextSettings.schedule.nextRunAt
    };
    events.push({ type: "lifecycle", command, state: "paused", schedule: nextSettings.schedule, at: now });
  }

  if (command === "schedule") {
    const scheduleCommand = normalizeLifecycleScheduleCommand(input, nextSettings.schedule, now);
    const scheduleErrors = [];
    if (nextSettings.lifecycle === "disabled") {
      scheduleErrors.push("schedule command requires enabled fs-read lifecycle");
    }
    if (scheduleCommand.errors.length) {
      scheduleErrors.push(...scheduleCommand.errors);
    }
    if (nextSettings.lifecycle === "paused" && scheduleCommand.mode === "immediate") {
      scheduleErrors.push("schedule command immediate mode requires active lifecycle");
    }

    if (scheduleErrors.length) {
      errors.push(...scheduleErrors);
    } else {
      nextSettings.schedule = {
        mode: scheduleCommand.mode,
        intervalMs: scheduleCommand.intervalMs,
        nextRunAt: scheduleCommand.nextRunAt
      };
      events.push({
        type: "schedule",
        command,
        schedule: nextSettings.schedule,
        state: nextSettings.lifecycle,
        proof: scheduleCommand.proof,
        at: now
      });
    }
  }

  if (command === "configure") {
    const patch = normalizeLifecycleSettingsPatch(input, nextSettings, now);
    errors.push(...patch.errors);
    if (patch.errors.length === 0) {
      nextSettings.enabled = patch.settings.enabled;
      nextSettings.lifecycle = patch.settings.lifecycle;
      nextSettings.maxBytes = patch.settings.maxBytes;
      nextSettings.allowHidden = patch.settings.allowHidden;
      nextSettings.allowedRoots = [...patch.settings.allowedRoots];
      nextSettings.rootPolicy = patch.settings.rootPolicy;
      nextSettings.deniedGlobs = [...patch.settings.deniedGlobs];
      nextSettings.schedule = { ...patch.settings.schedule };
      events.push({
        type: "settings",
        command,
        changedFields: patch.changedFields,
        state: nextSettings.lifecycle,
        schedule: nextSettings.schedule,
        at: now
      });
    }
  }

  if (RECOVERY_COMMANDS.has(command)) {
    const expectedPersistedState = command === "recover-dispatch"
      ? "dispatching"
      : command === "recover-schedule"
        ? "scheduled"
        : null;
    if (expectedPersistedState && persistedState?.status !== expectedPersistedState) {
      errors.push(`${command} requires persisted status ${expectedPersistedState}`);
    }
    events.push({
      type: "recovery-command",
      command,
      persistedStatus: persistedState?.status || "clean",
      state: errors.length ? "rejected" : "accepted",
      at: now
    });
  }

  return { settings: nextSettings, command, events, errors, idempotency: { commandId, replayed: false } };
}

function classifyReadRequest(request = {}, settings, capabilityNegotiation = { granted: [], missing: [], proof: [] }, provider = null) {
  const path = typeof request.path === "string" ? request.path.trim() : "";
  const pathNormalization = normalizeHostedReadPath(path);
  const encodedPathPolicy = detectEncodedPathHazards(path);
  const canonicalPath = pathNormalization.canonicalPath;
  const requestedBytes = Number.isInteger(request.bytes) ? request.bytes : settings.maxBytes;
  const requestedOffset = Number.isInteger(request.offset) ? request.offset : 0;
  const proof = [];
  const errors = [];

  if (!path) errors.push("read request requires a non-empty path");
  if (pathNormalization.hasNul) errors.push("read request path must not contain NUL bytes");
  if (path && !pathNormalization.absolute) errors.push("read request path must be absolute");
  if (pathNormalization.parentTraversal) errors.push("read request path must not contain parent traversal");
  if (encodedPathPolicy.blocked) {
    errors.push(`read request path contains encoded path hazard: ${encodedPathPolicy.hazards.map((hazard) => hazard.type).join(", ")}`);
  }
  if (!settings.allowHidden && pathNormalization.hiddenSegments.length) errors.push("hidden path reads require allowHidden=true");
  if (requestedBytes < 1) errors.push("requested bytes must be positive");
  if (requestedOffset < 0) errors.push("requested offset must be zero or positive");
  if (requestedOffset > 0 && !capabilityNegotiation.granted.includes("range-read")) {
    errors.push("range reads require provider capability range-read");
  }
  if (requestedBytes > settings.maxBytes) errors.push(`requested bytes exceed maxBytes ${settings.maxBytes}`);
  if (provider?.serviceContract && !provider.serviceContract.operations.includes("fs.read")) {
    errors.push("provider service contract does not allow fs.read");
  }
  if (provider?.serviceContract && requestedBytes > provider.serviceContract.maxBytes) {
    errors.push(`requested bytes exceed provider.serviceContract.maxBytes ${provider.serviceContract.maxBytes}`);
  }
  if (capabilityNegotiation.missing.length) {
    errors.push(`read request requires unavailable capabilities: ${capabilityNegotiation.missing.join(", ")}`);
  }

  const matchedRoot = selectMostSpecificRoot(settings.allowedRoots, canonicalPath);
  if (path && !matchedRoot) errors.push("read request path is outside allowedRoots");
  if (matchedRoot) {
    proof.push({
      check: "allowed-root",
      root: matchedRoot,
      path: canonicalPath,
      rootSpecificity: matchedRoot.split("/").filter(Boolean).length,
      passed: true
    });
  }
  if (provider?.serviceContract) {
    proof.push({
      check: "provider-service-contract",
      operation: "fs.read",
      handoffMode: provider.serviceContract.handoffMode,
      leaseMs: provider.serviceContract.leaseMs,
      maxBytes: provider.serviceContract.maxBytes,
      passed: provider.serviceContract.operations.includes("fs.read") && requestedBytes <= provider.serviceContract.maxBytes
    });
  }

  const deniedMatch = matchDeniedGlob(canonicalPath, settings.deniedGlobs);
  if (deniedMatch) errors.push(`read request path matches deniedGlob ${deniedMatch.glob}`);

  return {
    status: errors.length ? "blocked" : "ready",
    path: canonicalPath,
    requestedPath: path,
    pathNormalization,
    encodedPathPolicy,
    bytes: requestedBytes,
    requestedOffset,
    matchedRoot: matchedRoot || null,
    deniedGlobMatch: deniedMatch,
    proof: [...proof, ...capabilityNegotiation.proof],
    errors
  };
}

function deriveEffectiveScopeRoot(policyRoot, tenantRoot) {
  if (!policyRoot || !tenantRoot || !policyRoot.startsWith("/") || !tenantRoot.startsWith("/")) return null;
  if (rootContainsPath(policyRoot, tenantRoot)) return tenantRoot;
  if (rootContainsPath(tenantRoot, policyRoot)) return policyRoot;
  return null;
}

function buildTenantWorkspaceScope(settings, readGate, tenantBoundary, now) {
  const tenantRoots = uniqueStrings(tenantBoundary.allowedRoots || []);
  const policyRoots = uniqueStrings(settings.allowedRoots || []);
  const effectiveRoots = tenantBoundary.anyRootOverride
    ? policyRoots
    : uniqueStrings(policyRoots.flatMap((policyRoot) => (
        tenantRoots.map((tenantRoot) => deriveEffectiveScopeRoot(policyRoot, tenantRoot)).filter(Boolean)
      )));
  const matchedEffectiveRoot = selectMostSpecificRoot(effectiveRoots, readGate.path);
  const policyRootMatched = Boolean(readGate.matchedRoot);
  const tenantRootMatched = tenantBoundary.anyRootOverride || Boolean(tenantBoundary.matchedTenantRoot);
  const scopeRootMatched = tenantBoundary.mode === "monitor"
    ? Boolean(matchedEffectiveRoot || readGate.matchedRoot)
    : Boolean(matchedEffectiveRoot);
  const constrained = tenantBoundary.observed && tenantBoundary.mode === "enforced" && !tenantBoundary.anyRootOverride;
  const errors = [];

  if (constrained && tenantRoots.length === 0) {
    errors.push("tenant workspace scope requires at least one tenant root");
  }
  if (constrained && policyRootMatched && tenantRootMatched && !scopeRootMatched) {
    errors.push("tenant workspace scope has no effective overlap with allowedRoots for this path");
  }

  return {
    contract: "fs-read-tenant-workspace-scope.v1",
    schemaVersion: 1,
    generatedAt: now,
    mode: tenantBoundary.mode,
    constrained,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    anyRootOverride: tenantBoundary.anyRootOverride,
    policyRoots,
    tenantRoots,
    effectiveRoots,
    rootOverlapProof: policyRoots.flatMap((policyRoot) => tenantRoots.map((tenantRoot) => {
      const effectiveRoot = deriveEffectiveScopeRoot(policyRoot, tenantRoot);
      return {
        policyRoot,
        tenantRoot,
        effectiveRoot,
        pathMatched: Boolean(effectiveRoot && readGate.path && rootContainsPath(effectiveRoot, readGate.path))
      };
    })),
    matchedPolicyRoot: readGate.matchedRoot || null,
    matchedTenantRoot: tenantBoundary.matchedTenantRoot || null,
    matchedEffectiveRoot: matchedEffectiveRoot || null,
    decision: errors.length ? "blocked" : "allowed",
    errors,
    proof: {
      policyRootMatched,
      tenantRootMatched,
      scopeRootMatched,
      effectiveRootCount: effectiveRoots.length,
      evaluatedAt: now
    }
  };
}

function applyTenantBoundaryToReadGate(readGate, tenantBoundary, workspaceScope) {
  const errors = [...readGate.errors, ...tenantBoundary.errors, ...workspaceScope.errors];
  return {
    ...readGate,
    status: errors.length ? "blocked" : "ready",
    tenantBoundary,
    workspaceScope,
    proof: [
      ...readGate.proof,
      {
        check: "tenant-boundary",
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        mode: tenantBoundary.mode,
        matchedRoot: tenantBoundary.matchedTenantRoot,
        requiredPermission: tenantBoundary.requiredPermission,
        passed: tenantBoundary.decision === "allowed"
      },
      {
        check: "tenant-workspace-scope",
        tenantId: workspaceScope.tenantId,
        workspaceId: workspaceScope.workspaceId,
        matchedPolicyRoot: workspaceScope.matchedPolicyRoot,
        matchedTenantRoot: workspaceScope.matchedTenantRoot,
        matchedEffectiveRoot: workspaceScope.matchedEffectiveRoot,
        effectiveRoots: workspaceScope.effectiveRoots,
        passed: workspaceScope.decision === "allowed"
      }
    ],
    errors
  };
}

function classifyPolicyErrorCode(message) {
  const matcher = NON_RETRYABLE_ERROR_MATCHERS.find((candidate) => message.includes(candidate.match));
  if (matcher) return matcher.code;
  if (message.includes("requires a non-empty path")) return "FS_READ_PATH_REQUIRED";
  if (message.includes("encoded path hazard")) return "FS_READ_ENCODED_PATH_HAZARD";
  if (message.includes("requested bytes must be positive")) return "FS_READ_BYTE_LIMIT";
  if (message.includes("requested offset must be zero or positive")) return "FS_READ_RANGE_OFFSET";
  if (message.includes("tenant workspace scope")) return "FS_READ_TENANT_SCOPE";
  return "FS_READ_POLICY_BLOCKED";
}

function buildScopeCheckList(settings, readGate, scopePolicy, capabilityNegotiation = { missing: [] }, provider = null) {
  const providerMaxBytes = provider?.serviceContract?.maxBytes || null;
  const requestedBytes = readGate.bytes || 0;
  const encodedPathBlocked = scopePolicy.path.encodedPolicy?.blocked === true;
  const deniedGlobMatched = Boolean(scopePolicy.contentPolicy.deniedGlobMatched);
  const hiddenBlocked = scopePolicy.contentPolicy.hiddenBlocked;
  const tenantBlocked = scopePolicy.tenantPolicy.boundaryDecision === "blocked";
  const workspaceBlocked = scopePolicy.tenantPolicy.workspaceScopeDecision === "blocked";
  const settingsByteLimitPassed = requestedBytes <= settings.maxBytes;
  const providerByteLimitPassed = !providerMaxBytes || requestedBytes <= providerMaxBytes;

  return [
    {
      check: "path-normalization",
      state: scopePolicy.path.hasNul || scopePolicy.path.hasParentTraversal || !scopePolicy.path.absolute ? "blocked" : "passed",
      code: scopePolicy.path.hasNul
        ? "FS_READ_PATH_NUL_BYTE"
        : scopePolicy.path.hasParentTraversal
          ? "FS_READ_PARENT_TRAVERSAL"
          : scopePolicy.path.absolute
            ? null
            : "FS_READ_PATH_NOT_ABSOLUTE",
      evidence: {
        requested: scopePolicy.path.requested,
        canonical: scopePolicy.path.canonical,
        normalized: scopePolicy.path.normalized
      }
    },
    {
      check: "allowed-root",
      state: scopePolicy.rootPolicy.rootMatched ? "passed" : "blocked",
      code: scopePolicy.rootPolicy.rootMatched ? null : "FS_READ_ROOT_POLICY",
      evidence: {
        configuredRoots: scopePolicy.rootPolicy.configuredRoots,
        matchedRoot: scopePolicy.rootPolicy.matchedRoot,
        rejectedRoots: scopePolicy.rootPolicy.rejectedRoots
      }
    },
    {
      check: "encoded-path-policy",
      state: encodedPathBlocked ? "blocked" : "passed",
      code: encodedPathBlocked ? "FS_READ_ENCODED_PATH_HAZARD" : null,
      evidence: {
        encoded: scopePolicy.path.encodedPolicy?.encoded === true,
        decodedPath: scopePolicy.path.encodedPolicy?.decodedPath || null,
        hazards: scopePolicy.path.encodedPolicy?.hazards || [],
        tokens: scopePolicy.path.encodedPolicy?.tokens || []
      }
    },
    {
      check: "hidden-path",
      state: hiddenBlocked ? "blocked" : "passed",
      code: hiddenBlocked ? "FS_READ_HIDDEN_PATH" : null,
      evidence: {
        allowHidden: settings.allowHidden,
        hiddenSegments: scopePolicy.path.hiddenSegments
      }
    },
    {
      check: "denied-glob",
      state: deniedGlobMatched ? "blocked" : "passed",
      code: deniedGlobMatched ? "FS_READ_DENIED_GLOB" : null,
      evidence: {
        deniedGlobs: settings.deniedGlobs,
        matched: scopePolicy.contentPolicy.deniedGlobMatched
      }
    },
    {
      check: "byte-limit",
      state: settingsByteLimitPassed ? "passed" : "blocked",
      code: settingsByteLimitPassed ? null : "FS_READ_BYTE_LIMIT",
      evidence: {
        requestedBytes,
        settingsMaxBytes: settings.maxBytes
      }
    },
    {
      check: "provider-byte-limit",
      state: providerByteLimitPassed ? "passed" : "blocked",
      code: providerByteLimitPassed ? null : "FS_READ_PROVIDER_BYTE_LIMIT",
      evidence: {
        requestedBytes,
        providerMaxBytes
      }
    },
    {
      check: "provider-capability",
      state: capabilityNegotiation.missing.length ? "blocked" : "passed",
      code: capabilityNegotiation.missing.length ? "FS_READ_CAPABILITY_MISSING" : null,
      evidence: {
        requested: capabilityNegotiation.requested || [],
        granted: capabilityNegotiation.granted || [],
        missing: capabilityNegotiation.missing || []
      }
    },
    {
      check: "tenant-boundary",
      state: tenantBlocked ? "blocked" : "passed",
      code: tenantBlocked ? "FS_READ_TENANT_BOUNDARY" : null,
      evidence: {
        mode: scopePolicy.tenantPolicy.boundaryMode,
        tenantId: scopePolicy.tenantPolicy.tenantId,
        matchedTenantRoot: scopePolicy.tenantPolicy.matchedTenantRoot,
        requiredPermission: scopePolicy.tenantPolicy.requiredPermission
      }
    },
    {
      check: "tenant-workspace-scope",
      state: workspaceBlocked ? "blocked" : "passed",
      code: workspaceBlocked ? "FS_READ_TENANT_SCOPE" : null,
      evidence: {
        matchedEffectiveRoot: scopePolicy.tenantPolicy.matchedEffectiveRoot,
        effectiveRoots: scopePolicy.tenantPolicy.effectiveRoots
      }
    }
  ];
}

function buildReadScopePolicyContract(settings, readGate, now, provider = null) {
  const rootPolicy = settings.rootPolicy || {
    contract: "fs-read-scope-root-policy.v1",
    label: "settings.allowedRoots",
    roots: settings.allowedRoots || [],
    errors: [],
    proof: [],
    scopeProof: buildRootScopeProof(settings.allowedRoots || [])
  };
  const deniedGlob = readGate.errors.find((error) => error.includes("deniedGlob")) || null;
  const hiddenBlocked = readGate.errors.some((error) => error.includes("hidden path reads"));
  const byteLimitBlocked = readGate.errors.some((error) => error.includes("exceed maxBytes"));
  const providerByteLimitBlocked = readGate.errors.some((error) => error.includes("exceed provider.serviceContract.maxBytes"));
  const pathBlocked = readGate.errors.some((error) => error.includes("path must") || error.includes("requires a non-empty path"));
  const encodedPathBlocked = readGate.encodedPathPolicy?.blocked === true;
  const tenantBlocked = readGate.tenantBoundary?.decision === "blocked";
  const workspaceBlocked = readGate.workspaceScope?.decision === "blocked";
  const rootBlocked = Boolean(readGate.requestedPath) && !readGate.matchedRoot;
  const decision = readGate.status === "ready" ? "allowed" : "blocked";
  const errorCodes = uniqueStrings(readGate.errors.map((error) => classifyPolicyErrorCode(error)));
  const blockingChecks = [
    ...(pathBlocked ? ["path-normalization"] : []),
    ...(encodedPathBlocked ? ["encoded-path-policy"] : []),
    ...(rootBlocked ? ["allowed-root"] : []),
    ...(hiddenBlocked ? ["hidden-path"] : []),
    ...(deniedGlob ? ["denied-glob"] : []),
    ...(byteLimitBlocked ? ["byte-limit"] : []),
    ...(providerByteLimitBlocked ? ["provider-byte-limit"] : []),
    ...(tenantBlocked ? ["tenant-boundary"] : []),
    ...(workspaceBlocked ? ["tenant-workspace-scope"] : [])
  ];

  return {
    contract: "fs-read-scope-policy-decision.v1",
    schemaVersion: 1,
    generatedAt: now,
    decision,
    state: decision === "allowed" ? "dispatch-scope-approved" : "dispatch-scope-blocked",
    path: {
      requested: readGate.requestedPath || null,
      canonical: readGate.path || null,
      absolute: readGate.pathNormalization?.absolute === true,
      normalized: readGate.pathNormalization?.changed === true,
      hasParentTraversal: readGate.pathNormalization?.parentTraversal === true,
      hasNul: readGate.pathNormalization?.hasNul === true,
      hiddenSegments: readGate.pathNormalization?.hiddenSegments || [],
      encodedPolicy: readGate.encodedPathPolicy || {
        contract: "fs-read-encoded-path-policy.v1",
        encoded: false,
        tokens: [],
        hazards: [],
        blocked: false
      }
    },
    rootPolicy: {
      contract: rootPolicy.contract,
      configuredRoots: rootPolicy.roots,
      matchedRoot: readGate.matchedRoot || null,
      rootMatched: Boolean(readGate.matchedRoot),
      scopeProof: rootPolicy.scopeProof || buildRootScopeProof(rootPolicy.roots || []),
      rejectedRoots: rootPolicy.proof.filter((entry) => entry.accepted === false).map((entry) => ({
        input: entry.input,
        reasons: entry.reasons
      })),
      canonicalization: rootPolicy.proof.filter((entry) => entry.accepted === true && entry.changed === true).map((entry) => ({
        input: entry.input,
        canonicalRoot: entry.canonicalRoot
      }))
    },
    contentPolicy: {
      allowHidden: settings.allowHidden,
      hiddenBlocked,
      deniedGlobs: settings.deniedGlobs,
      deniedGlobMatched: deniedGlob ? deniedGlob.replace(/^read request path matches deniedGlob /u, "") : null,
      deniedGlobMatch: readGate.deniedGlobMatch || null,
      requestedBytes: readGate.bytes,
      maxBytes: settings.maxBytes,
      providerMaxBytes: provider?.serviceContract?.maxBytes || null,
      byteLimitSatisfied: !byteLimitBlocked && readGate.bytes <= settings.maxBytes,
      providerByteLimitSatisfied: !providerByteLimitBlocked && (!provider?.serviceContract || readGate.bytes <= provider.serviceContract.maxBytes)
    },
    tenantPolicy: {
      boundaryDecision: readGate.tenantBoundary?.decision || "not-evaluated",
      boundaryMode: readGate.tenantBoundary?.mode || "none",
      tenantId: readGate.tenantBoundary?.tenantId || null,
      workspaceId: readGate.tenantBoundary?.workspaceId || null,
      matchedTenantRoot: readGate.tenantBoundary?.matchedTenantRoot || null,
      requiredPermission: readGate.tenantBoundary?.requiredPermission || null,
      workspaceScopeDecision: readGate.workspaceScope?.decision || "not-evaluated",
      matchedEffectiveRoot: readGate.workspaceScope?.matchedEffectiveRoot || null,
      effectiveRoots: readGate.workspaceScope?.effectiveRoots || [],
      rootOverlapProof: readGate.workspaceScope?.rootOverlapProof || []
    },
    blockingChecks,
    errorCodes,
    errors: readGate.errors,
    proof: {
      pathAccepted: !pathBlocked && !encodedPathBlocked,
      encodedPathAccepted: !encodedPathBlocked,
      rootAccepted: Boolean(readGate.matchedRoot),
      hiddenAccepted: !hiddenBlocked,
      deniedGlobAccepted: !deniedGlob,
      byteLimitAccepted: !byteLimitBlocked && readGate.bytes <= settings.maxBytes,
      providerByteLimitAccepted: !providerByteLimitBlocked && (!provider?.serviceContract || readGate.bytes <= provider.serviceContract.maxBytes),
      tenantAccepted: !tenantBlocked,
      workspaceScopeAccepted: !workspaceBlocked,
      evaluatedAt: now
    }
  };
}

function buildReadAuditEnvelope({ settings, provider, readGate, scopePolicy, scopedDispatchClaim, capabilityNegotiation, clientContext, now }) {
  const checks = buildScopeCheckList(settings, readGate, scopePolicy, capabilityNegotiation, provider);
  const blockedChecks = checks.filter((check) => check.state === "blocked");
  const errorCodes = uniqueStrings([
    ...scopePolicy.errorCodes,
    ...blockedChecks.map((check) => check.code).filter(Boolean)
  ]);
  const actorKey = stableClientKey(clientContext.actorId);
  const requestKey = stableClientKey(clientContext.requestId);
  const pathKey = stableClientKey(readGate.path || readGate.requestedPath || "no-path");

  return {
    contract: "fs-read-audit-envelope.v1",
    schemaVersion: 1,
    generatedAt: now,
    auditId: `fs-read-audit:${requestKey}:${pathKey}`,
    surfaceId,
    actorKey,
    requestId: clientContext.requestId,
    workflowId: clientContext.workflowId,
    tenantId: readGate.tenantBoundary?.tenantId || clientContext.tenantIdentity.tenantId || null,
    workspaceId: readGate.tenantBoundary?.workspaceId || clientContext.tenantIdentity.workspaceId || null,
    decision: scopePolicy.decision,
    state: blockedChecks.length ? "blocked" : "approved",
    providerId: provider.providerId,
    path: {
      requested: readGate.requestedPath || null,
      canonical: readGate.path || null,
      matchedRoot: readGate.matchedRoot || null,
      matchedEffectiveRoot: readGate.workspaceScope?.matchedEffectiveRoot || null
    },
    scope: {
      configuredRoots: scopePolicy.rootPolicy.configuredRoots,
      matchedRoot: scopePolicy.rootPolicy.matchedRoot,
      effectiveRoots: scopePolicy.tenantPolicy.effectiveRoots,
      matchedEffectiveRoot: scopePolicy.tenantPolicy.matchedEffectiveRoot,
      rootScopeProof: scopePolicy.rootPolicy.scopeProof,
      rootOverlapProof: scopePolicy.tenantPolicy.rootOverlapProof
    },
    scopedDispatchClaim: {
      contract: scopedDispatchClaim.contract,
      claimId: scopedDispatchClaim.claimId,
      state: scopedDispatchClaim.state,
      accepted: scopedDispatchClaim.accepted,
      matchedEffectiveRoot: scopedDispatchClaim.path.matchedEffectiveRoot,
      requiredPermission: scopedDispatchClaim.permission.required,
      permissionGranted: scopedDispatchClaim.permission.granted,
      errors: scopedDispatchClaim.errors
    },
    checks,
    blockedChecks: blockedChecks.map((check) => check.check),
    errorCodes,
    proof: {
      scopePolicyContract: scopePolicy.contract,
      rootPolicyContract: scopePolicy.rootPolicy.contract,
      normalizedPath: scopePolicy.path.normalized,
      rootMatched: scopePolicy.rootPolicy.rootMatched,
      effectiveRootMatched: Boolean(scopePolicy.tenantPolicy.matchedEffectiveRoot),
      tenantBoundaryDecision: scopePolicy.tenantPolicy.boundaryDecision,
      tenantWorkspaceScopeDecision: scopePolicy.tenantPolicy.workspaceScopeDecision,
      providerOperation: provider.serviceContract.operations.includes("fs.read"),
      providerByteLimit: provider.serviceContract.maxBytes,
      providerByteLimitAccepted: scopePolicy.contentPolicy.providerByteLimitSatisfied,
      scopedDispatchClaimAccepted: scopedDispatchClaim.accepted,
      scopedDispatchClaimId: scopedDispatchClaim.claimId,
      evaluatedAt: now
    }
  };
}

function buildScopedDispatchClaim({ provider, readGate, scopePolicy, clientContext, syncMetadata, now }) {
  const tenantBoundary = readGate.tenantBoundary || null;
  const workspaceScope = readGate.workspaceScope || null;
  const effectiveRoot = workspaceScope?.matchedEffectiveRoot || readGate.matchedRoot || null;
  const pathInsideEffectiveRoot = Boolean(effectiveRoot && readGate.path && rootContainsPath(effectiveRoot, readGate.path));
  const requiredPermission = tenantBoundary?.requiredPermission || (readGate.pathNormalization?.hiddenSegments.length ? "fs.read.hidden" : "fs.read");
  const grantedPermissions = tenantBoundary?.permissions || clientContext.tenantIdentity.permissions || [];
  const permissionGranted = grantedPermissions.includes(requiredPermission) || grantedPermissions.includes("fs.read.any-root");
  const roleGrant = (tenantBoundary?.roles || clientContext.tenantIdentity.roles || []).find((role) => (
    (TENANT_READ_ROLE_GRANTS[role] || []).includes(requiredPermission)
    || (TENANT_READ_ROLE_GRANTS[role] || []).includes("fs.read.any-root")
  )) || null;
  const tenantDecisionAllowed = !tenantBoundary || tenantBoundary.decision === "allowed";
  const workspaceDecisionAllowed = !workspaceScope || workspaceScope.decision === "allowed";
  const providerOperationAllowed = provider.serviceContract.operations.includes("fs.read");
  const errors = [
    ...(!readGate.path ? ["scoped dispatch claim requires a canonical read path"] : []),
    ...(!readGate.matchedRoot ? ["scoped dispatch claim requires a matched settings root"] : []),
    ...(!effectiveRoot ? ["scoped dispatch claim requires an effective workspace root"] : []),
    ...(effectiveRoot && !pathInsideEffectiveRoot ? ["scoped dispatch claim path is outside effective workspace root"] : []),
    ...(!permissionGranted ? [`scoped dispatch claim requires permission ${requiredPermission}`] : []),
    ...(!tenantDecisionAllowed ? ["scoped dispatch claim tenant boundary is blocked"] : []),
    ...(!workspaceDecisionAllowed ? ["scoped dispatch claim workspace scope is blocked"] : []),
    ...(!providerOperationAllowed ? ["scoped dispatch claim provider does not allow fs.read"] : []),
    ...(scopePolicy.decision !== "allowed" ? ["scoped dispatch claim requires an allowed scope policy decision"] : [])
  ];
  const claimKey = [
    clientContext.requestId,
    clientContext.workflowId,
    provider.providerId,
    readGate.path || "no-path",
    effectiveRoot || "no-effective-root",
    syncMetadata.cursor
  ].map((value) => stableClientKey(value)).join(":");

  return {
    contract: "fs-read-scoped-dispatch-claim.v1",
    schemaVersion: 1,
    generatedAt: now,
    claimId: `fs-read-scope-claim:${claimKey}`,
    state: errors.length ? "rejected" : "accepted",
    accepted: errors.length === 0,
    providerId: provider.providerId,
    requestId: clientContext.requestId,
    workflowId: clientContext.workflowId,
    actorId: clientContext.actorId,
    tenantId: tenantBoundary?.tenantId || clientContext.tenantIdentity.tenantId || null,
    workspaceId: tenantBoundary?.workspaceId || clientContext.tenantIdentity.workspaceId || null,
    path: {
      requested: readGate.requestedPath || null,
      canonical: readGate.path || null,
      matchedPolicyRoot: readGate.matchedRoot || null,
      matchedTenantRoot: tenantBoundary?.matchedTenantRoot || null,
      matchedEffectiveRoot: effectiveRoot,
      insideEffectiveRoot: pathInsideEffectiveRoot
    },
    permission: {
      required: requiredPermission,
      granted: permissionGranted,
      viaRole: roleGrant,
      anyRootOverride: tenantBoundary?.anyRootOverride === true,
      roles: tenantBoundary?.roles || clientContext.tenantIdentity.roles || [],
      permissions: grantedPermissions
    },
    decisions: {
      scopePolicy: scopePolicy.decision,
      tenantBoundary: tenantBoundary?.decision || "not-evaluated",
      workspaceScope: workspaceScope?.decision || "not-evaluated",
      providerOperationAllowed
    },
    sync: {
      cursor: syncMetadata.cursor,
      nextCursor: syncMetadata.nextCursor,
      consistency: syncMetadata.consistency
    },
    errors,
    proof: {
      pathInsideEffectiveRoot,
      permissionGranted,
      tenantDecisionAllowed,
      workspaceDecisionAllowed,
      providerOperationAllowed,
      evaluatedAt: now
    }
  };
}

function buildSyncMetadata(provider, readGate, now) {
  const pathKey = readGate.path ? readGate.path.replace(/[^a-z0-9/_:-]/gi, "_") : "no-path";
  const watermark = provider.sync.watermark || now;
  const cursor = provider.sync.cursor || `${provider.providerId}:${provider.sync.consistency}:${pathKey}:${watermark}`;

  return {
    contract: "fs-read-sync-metadata",
    consistency: provider.sync.consistency,
    cursor,
    watermark,
    nextCursor: readGate.status === "ready" ? `${cursor}:ready:${readGate.bytes}` : cursor,
    stale: provider.sync.watermark ? provider.sync.watermark < now && provider.sync.consistency !== "request" : false
  };
}

function buildExternalHandoffWorkflowReceipt({
  provider,
  readGate,
  nextAction,
  syncMetadata,
  handoffState,
  deliveryState,
  leaseExpiresAt,
  clientContext,
  clientRuntime,
  workflowPreferences,
  scopePolicy,
  now
}) {
  if (!clientContext || !clientRuntime || !workflowPreferences) return null;

  const requestKey = stableClientKey(clientContext.requestId);
  const handoffKey = clientRuntime.runtimeKeys.handoffKey;
  const blockedReasons = readGate.status === "ready"
    ? []
    : readGate.errors.map((message) => ({
        code: classifyPolicyErrorCode(message),
        message,
        route: "client://fs-read/request-editor"
      }));
  const scheduled = ["wait-until", "enqueue-interval"].includes(nextAction.type);
  const route = handoffState === "ready"
    ? workflowPreferences.routes.dispatchRoute
    : scheduled
      ? workflowPreferences.routes.scheduleRoute
      : workflowPreferences.routes.blockedRoute;
  const primaryAction = handoffState === "ready"
    ? "dispatch-read"
    : scheduled
      ? "schedule-read"
      : "resolve-read-request";

  return {
    contract: "fs-read-dispatch-workflow-receipt.v1",
    schemaVersion: 1,
    generatedAt: now,
    userVisible: true,
    receiptId: workflowPreferences.receiptId,
    handoffKey,
    state: handoffState === "ready" ? "dispatch-ready" : scheduled ? "scheduled" : "blocked",
    deliveryState,
    request: {
      requestId: clientContext.requestId,
      workflowId: clientContext.workflowId,
      channel: clientContext.channel,
      actorId: clientContext.actorId,
      tenantId: clientContext.tenantIdentity.tenantId,
      workspaceId: clientContext.tenantIdentity.workspaceId
    },
    provider: {
      providerId: provider.providerId,
      service: provider.service,
      endpoint: provider.endpoint,
      handoffMode: provider.serviceContract.handoffMode,
      acknowledgementRequired: handoffState === "ready" && provider.serviceContract.handoffMode === "external"
    },
    path: {
      requested: readGate.requestedPath || null,
      canonical: readGate.path || null,
      matchedRoot: readGate.matchedRoot || null,
      matchedEffectiveRoot: readGate.workspaceScope?.matchedEffectiveRoot || null,
      bytes: readGate.bytes,
      offset: readGate.requestedOffset || 0
    },
    policyDecision: {
      state: scopePolicy?.state || (handoffState === "ready" ? "dispatch-scope-approved" : "dispatch-scope-blocked"),
      decision: scopePolicy?.decision || (handoffState === "ready" ? "allowed" : "blocked"),
      errorCodes: scopePolicy?.errorCodes || blockedReasons.map((reason) => reason.code),
      blockingChecks: scopePolicy?.blockingChecks || []
    },
    lease: {
      leaseMs: provider.serviceContract.leaseMs,
      expiresAt: leaseExpiresAt,
      syncCursor: syncMetadata.cursor,
      nextCursor: syncMetadata.nextCursor
    },
    routes: {
      current: route,
      returnRoute: workflowPreferences.routes.returnRoute,
      dispatchRoute: workflowPreferences.routes.dispatchRoute,
      blockedRoute: workflowPreferences.routes.blockedRoute,
      auditRoute: workflowPreferences.routes.auditRoute,
      successRoute: workflowPreferences.routes.successRoute
    },
    nextAction: {
      action: primaryAction,
      route,
      enabled: handoffState === "ready" || scheduled,
      reason: handoffState === "ready"
        ? "fs-read handoff is ready for provider dispatch"
        : scheduled
          ? "fs-read request is scheduled before provider dispatch"
          : nextAction.reason || blockedReasons[0]?.message || "fs-read handoff is blocked"
    },
    resumeTokens: {
      requestToken: workflowPreferences.resumeTokens.requestToken,
      workflowToken: workflowPreferences.resumeTokens.workflowToken,
      handoffToken: `fs-read:handoff:${requestKey}:${stableClientKey(syncMetadata.cursor)}`,
      proofKey: clientRuntime.runtimeKeys.proofKey
    },
    blockedReasons,
    proof: {
      requestBound: clientRuntime.requestIdentity.requestId === clientContext.requestId,
      workflowBound: clientRuntime.requestIdentity.workflowId === clientContext.workflowId,
      receiptBound: workflowPreferences.requestId === clientContext.requestId,
      scopeAllowed: scopePolicy?.decision === "allowed",
      handoffReady: handoffState === "ready",
      evaluatedAt: now
    }
  };
}

function buildExternalHandoff(provider, capabilityNegotiation, readGate, nextAction, syncMetadata, now, runtimeContext = {}) {
  const scopedDispatchClaim = runtimeContext.scopedDispatchClaim || null;
  const scopeClaimAccepted = scopedDispatchClaim ? scopedDispatchClaim.accepted === true : true;
  const handoffState = readGate.status === "ready" && nextAction.type === "dispatch-read" && scopeClaimAccepted ? "ready" : "blocked";
  const leaseExpiresAt = handoffState === "ready"
    ? asIso(new Date(Date.parse(now) + provider.serviceContract.leaseMs), now)
    : null;
  const deliveryState = handoffState === "ready"
    ? provider.serviceContract.handoffMode === "inline"
      ? "inline-dispatch"
      : provider.serviceContract.handoffMode === "queued"
        ? "queued-for-provider"
        : "awaiting-external-ack"
      : "not-created";
  const workflowReceipt = buildExternalHandoffWorkflowReceipt({
    provider,
    readGate,
    nextAction,
    syncMetadata,
    handoffState,
    deliveryState,
    leaseExpiresAt,
    clientContext: runtimeContext.clientContext,
    clientRuntime: runtimeContext.clientRuntime,
    workflowPreferences: runtimeContext.workflowPreferences,
    scopePolicy: runtimeContext.scopePolicy,
    now
  });

  return {
    contract: "fs-read-external-handoff.v1",
    state: handoffState,
    deliveryState,
    providerId: provider.providerId,
    service: provider.service,
    protocol: provider.protocol,
    endpoint: provider.endpoint,
    operation: "fs.read",
    serviceContract: {
      operations: provider.serviceContract.operations,
      handoffMode: provider.serviceContract.handoffMode,
      leaseMs: provider.serviceContract.leaseMs,
      leaseExpiresAt,
      proofModes: provider.serviceContract.proofModes
    },
    path: readGate.path || null,
    requestedPath: readGate.requestedPath || readGate.path || null,
    tenantBoundary: readGate.tenantBoundary
      ? {
          mode: readGate.tenantBoundary.mode,
          tenantId: readGate.tenantBoundary.tenantId,
          workspaceId: readGate.tenantBoundary.workspaceId,
          matchedTenantRoot: readGate.tenantBoundary.matchedTenantRoot,
          requiredPermission: readGate.tenantBoundary.requiredPermission,
          decision: readGate.tenantBoundary.decision
        }
      : null,
    workspaceScope: readGate.workspaceScope
      ? {
          contract: readGate.workspaceScope.contract,
          decision: readGate.workspaceScope.decision,
          constrained: readGate.workspaceScope.constrained,
          matchedPolicyRoot: readGate.workspaceScope.matchedPolicyRoot,
          matchedTenantRoot: readGate.workspaceScope.matchedTenantRoot,
          matchedEffectiveRoot: readGate.workspaceScope.matchedEffectiveRoot,
          effectiveRoots: readGate.workspaceScope.effectiveRoots,
          errors: readGate.workspaceScope.errors
        }
      : null,
    offset: readGate.requestedOffset || 0,
    byteLimit: readGate.bytes,
    capabilityMode: capabilityNegotiation.mode,
    grantedCapabilities: capabilityNegotiation.granted,
    missingCapabilities: capabilityNegotiation.missing,
    syncCursor: syncMetadata.cursor,
    scopedDispatchClaim: scopedDispatchClaim
      ? {
          contract: scopedDispatchClaim.contract,
          claimId: scopedDispatchClaim.claimId,
          state: scopedDispatchClaim.state,
          accepted: scopedDispatchClaim.accepted,
          matchedEffectiveRoot: scopedDispatchClaim.path.matchedEffectiveRoot,
          requiredPermission: scopedDispatchClaim.permission.required,
          permissionGranted: scopedDispatchClaim.permission.granted,
          errors: scopedDispatchClaim.errors
        }
      : null,
    acknowledgement: {
      required: handoffState === "ready" && provider.serviceContract.handoffMode === "external",
      state: provider.serviceContract.handoffMode === "external" && handoffState === "ready" ? "pending" : "not-required",
      deadlineAt: leaseExpiresAt
    },
    workflowReceipt,
    reason: handoffState === "ready"
      ? "provider contract accepted for fs-read dispatch"
      : scopedDispatchClaim && !scopeClaimAccepted
        ? scopedDispatchClaim.errors[0] || "scoped dispatch claim rejected"
        : nextAction.reason || readGate.errors[0]
  };
}

function selectProviderAcknowledgementInput(input = {}) {
  const candidates = [
    input.providerAcknowledgement,
    input.handoffAcknowledgement,
    input.externalHandoffAcknowledgement,
    input.providerAck
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") || null;
}

function buildProviderAcknowledgementContract(input, externalHandoff, clientRuntime, syncMetadata, now) {
  const acknowledgementInput = selectProviderAcknowledgementInput(input);
  const expectedHandoffKey = clientRuntime.runtimeKeys.handoffKey;
  const expectedProviderId = externalHandoff.providerId;
  const expectedCursor = syncMetadata.cursor;
  const leaseExpiresAt = externalHandoff.serviceContract.leaseExpiresAt;
  const leaseExpired = Boolean(leaseExpiresAt && Date.parse(leaseExpiresAt) < Date.parse(now));
  const ackRequired = externalHandoff.acknowledgement.required;

  if (!acknowledgementInput) {
    return {
      contract: "fs-read-provider-acknowledgement.v1",
      state: ackRequired ? "awaiting" : "not-required",
      received: false,
      required: ackRequired,
      providerId: expectedProviderId,
      handoffKey: expectedHandoffKey,
      syncCursor: expectedCursor,
      receivedAt: null,
      acceptedAt: null,
      leaseExpiresAt,
      leaseExpired,
      decision: ackRequired ? "hold-dispatch-until-provider-ack" : "dispatch-without-provider-ack",
      errors: [],
      receipt: null
    };
  }

  const receivedState = typeof acknowledgementInput.state === "string"
    ? acknowledgementInput.state.trim().toLowerCase()
    : typeof acknowledgementInput.status === "string"
      ? acknowledgementInput.status.trim().toLowerCase()
      : "accepted";
  const providerId = typeof acknowledgementInput.providerId === "string" && acknowledgementInput.providerId.trim()
    ? acknowledgementInput.providerId.trim()
    : expectedProviderId;
  const handoffKey = typeof acknowledgementInput.handoffKey === "string" && acknowledgementInput.handoffKey.trim()
    ? acknowledgementInput.handoffKey.trim()
    : expectedHandoffKey;
  const syncCursor = typeof acknowledgementInput.syncCursor === "string" && acknowledgementInput.syncCursor.trim()
    ? acknowledgementInput.syncCursor.trim()
    : expectedCursor;
  const receiptId = typeof acknowledgementInput.receiptId === "string" && acknowledgementInput.receiptId.trim()
    ? acknowledgementInput.receiptId.trim()
    : `fs-read-ack:${stableClientKey(expectedHandoffKey)}:${stableClientKey(now)}`;
  const receivedAt = asIso(acknowledgementInput.receivedAt || acknowledgementInput.at, now);
  const errors = [];

  if (!PROVIDER_ACK_STATES.has(receivedState)) errors.push(`provider acknowledgement state must be one of ${[...PROVIDER_ACK_STATES].join(", ")}`);
  if (providerId !== expectedProviderId) errors.push("provider acknowledgement providerId does not match handoff provider");
  if (handoffKey !== expectedHandoffKey) errors.push("provider acknowledgement handoffKey does not match runtime handoff");
  if (syncCursor !== expectedCursor) errors.push("provider acknowledgement syncCursor does not match current sync cursor");
  if (leaseExpired) errors.push("provider acknowledgement arrived after handoff lease expiry");
  if (receivedState === "rejected" && typeof acknowledgementInput.reason !== "string") {
    errors.push("provider acknowledgement rejection requires a reason");
  }

  const accepted = errors.length === 0 && receivedState === "accepted";
  const deferred = errors.length === 0 && receivedState === "deferred";
  const rejected = receivedState === "rejected" || errors.length > 0;

  return {
    contract: "fs-read-provider-acknowledgement.v1",
    state: accepted ? "accepted" : deferred ? "deferred" : rejected ? "rejected" : "awaiting",
    received: true,
    required: ackRequired,
    providerId,
    handoffKey,
    syncCursor,
    receivedAt,
    acceptedAt: accepted ? receivedAt : null,
    leaseExpiresAt,
    leaseExpired,
    decision: accepted
      ? "provider-accepted-fs-read-handoff"
      : deferred
        ? "provider-deferred-fs-read-handoff"
        : "provider-acknowledgement-rejected",
    errors,
    receipt: {
      receiptId,
      state: receivedState,
      reason: typeof acknowledgementInput.reason === "string" && acknowledgementInput.reason.trim()
        ? acknowledgementInput.reason.trim()
        : null,
      proof: {
        providerMatched: providerId === expectedProviderId,
        handoffKeyMatched: handoffKey === expectedHandoffKey,
        syncCursorMatched: syncCursor === expectedCursor,
        leaseValid: !leaseExpired
      }
    }
  };
}

function normalizeClientContext(input = {}, readGate, now) {
  const clientInput = input.client && typeof input.client === "object"
    ? input.client
    : input.clientState && typeof input.clientState === "object"
      ? input.clientState
      : {};
  const requestContext = input.requestContext && typeof input.requestContext === "object" ? input.requestContext : {};
  const requestedChannel = typeof clientInput.channel === "string" ? clientInput.channel.trim().toLowerCase() : "api";
  const channel = CLIENT_CHANNELS.has(requestedChannel) ? requestedChannel : "api";
  const warnings = CLIENT_CHANNELS.has(requestedChannel) ? [] : [`unsupported client.channel ${requestedChannel}`];
  const sessionId = typeof clientInput.sessionId === "string" && clientInput.sessionId.trim()
    ? clientInput.sessionId.trim()
    : typeof requestContext.sessionId === "string" && requestContext.sessionId.trim()
      ? requestContext.sessionId.trim()
      : null;
  const requestId = typeof clientInput.requestId === "string" && clientInput.requestId.trim()
    ? clientInput.requestId.trim()
    : typeof requestContext.requestId === "string" && requestContext.requestId.trim()
      ? requestContext.requestId.trim()
      : `${surfaceName}:${readGate.path || "unresolved"}:${now}`;
  const actorId = typeof clientInput.actorId === "string" && clientInput.actorId.trim()
    ? clientInput.actorId.trim()
    : typeof requestContext.actorId === "string" && requestContext.actorId.trim()
      ? requestContext.actorId.trim()
      : "anonymous";
  const tenantId = normalizeTenantToken(clientInput.tenantId || requestContext.tenantId, null);
  const workspaceId = normalizeTenantToken(clientInput.workspaceId || requestContext.workspaceId, tenantId);
  const roles = uniqueStrings(clientInput.roles || requestContext.roles || input.roles || []);
  const explicitPermissions = uniqueStrings(clientInput.permissions || requestContext.permissions || input.permissions || []);
  const effectiveRoles = roles.length ? roles : ["reader"];
  const effectivePermissions = deriveRolePermissions(effectiveRoles, explicitPermissions);
  const workflowId = typeof clientInput.workflowId === "string" && clientInput.workflowId.trim()
    ? clientInput.workflowId.trim()
    : typeof requestContext.workflowId === "string" && requestContext.workflowId.trim()
      ? requestContext.workflowId.trim()
      : `fs-read:${requestId}`;

  return {
    contract: "fs-read-client-context.v1",
    channel,
    actorId,
    sessionId,
    requestId,
    workflowId,
    tenantIdentity: {
      tenantId,
      workspaceId,
      roles: effectiveRoles,
      permissions: effectivePermissions,
      explicitPermissions
    },
    locale: typeof clientInput.locale === "string" && clientInput.locale.trim() ? clientInput.locale.trim() : "en-US",
    timezone: typeof clientInput.timezone === "string" && clientInput.timezone.trim() ? clientInput.timezone.trim() : "UTC",
    source: sessionId ? "session" : "request",
    warnings
  };
}

function stableClientKey(value) {
  return String(value || "none")
    .replace(/[^a-z0-9_.:-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "none";
}

function buildClientRuntimeState(clientContext, provider, readGate, readiness, nextStep, syncMetadata) {
  const rootKey = readGate.matchedRoot ? stableClientKey(readGate.matchedRoot) : "outside-policy";
  const pathKey = stableClientKey(readGate.path || "no-path");
  const requestKey = stableClientKey(clientContext.requestId);
  const cacheScope = clientContext.sessionId ? "session" : "request";
  const clientState = readiness.ready
    ? "ready-to-dispatch"
    : readiness.queueable
      ? "queued"
      : nextStep.route === "client://fs-read/request-editor"
        ? "needs-request-edit"
        : "needs-configuration";

  return {
    contract: "fs-read-client-runtime.v1",
    schemaVersion: 1,
    state: clientState,
    channel: clientContext.channel,
    requestIdentity: {
      actorId: clientContext.actorId,
      sessionId: clientContext.sessionId,
      requestId: clientContext.requestId,
      workflowId: clientContext.workflowId,
      tenantId: clientContext.tenantIdentity.tenantId,
      workspaceId: clientContext.tenantIdentity.workspaceId
    },
    providerRef: {
      providerId: provider.providerId,
      endpoint: provider.endpoint,
      protocol: provider.protocol,
      handoffMode: provider.serviceContract.handoffMode
    },
    runtimeKeys: {
      cacheScope,
      cacheKey: `fs-read:${cacheScope}:${rootKey}:${pathKey}:${readGate.bytes}`,
      draftKey: `fs-read:draft:${requestKey}`,
      proofKey: `fs-read:proof:${requestKey}:${stableClientKey(syncMetadata.cursor)}`,
      handoffKey: `fs-read:handoff:${requestKey}:${nextStep.action}`
    },
    viewModel: {
      route: nextStep.route,
      primaryAction: nextStep.label,
      disabled: !readiness.ready,
      disabledReason: readiness.ready ? null : readiness.reason,
      path: readGate.path || "",
      requestedPath: readGate.requestedPath || readGate.path || "",
      bytes: readGate.bytes,
      offset: readGate.requestedOffset || 0,
      root: readGate.matchedRoot,
      syncCursor: syncMetadata.cursor
    },
    tenantBoundary: readGate.tenantBoundary
      ? {
          mode: readGate.tenantBoundary.mode,
          decision: readGate.tenantBoundary.decision,
          tenantId: readGate.tenantBoundary.tenantId,
          workspaceId: readGate.tenantBoundary.workspaceId,
          root: readGate.tenantBoundary.matchedTenantRoot,
          requiredPermission: readGate.tenantBoundary.requiredPermission
        }
      : null,
    persistence: {
      shouldPersistDraft: !readiness.ready,
      shouldCachePreview: readiness.ready,
      invalidatesOn: ["settings.allowedRoots", "settings.maxBytes", "provider.capabilities", "readRequest.path", "readRequest.bytes"]
    },
    warnings: clientContext.warnings
  };
}

function selectWorkflowHandoffInput(input = {}) {
  const candidates = [
    input.workflowHandoff,
    input.clientWorkflow,
    input.workflow,
    input.client?.workflow,
    input.clientState?.workflow
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") || {};
}

function normalizeClientRoute(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const route = value.trim();
  if (route.startsWith("client://") || route.startsWith("kernel://")) return route;
  return fallback;
}

function normalizeWorkflowHandoffPreferences(input, clientContext, readGate, readiness, nextStep, now) {
  const workflowInput = selectWorkflowHandoffInput(input);
  const requestedResultDelivery = typeof workflowInput.resultDelivery === "string"
    ? workflowInput.resultDelivery.trim().toLowerCase()
    : typeof workflowInput.delivery === "string"
      ? workflowInput.delivery.trim().toLowerCase()
      : "reference";
  const resultDelivery = ["inline", "reference", "download"].includes(requestedResultDelivery)
    ? requestedResultDelivery
    : "reference";
  const returnRoute = normalizeClientRoute(workflowInput.returnRoute, nextStep.route);
  const blockedRoute = normalizeClientRoute(workflowInput.blockedRoute, "client://fs-read/request-editor");
  const successRoute = normalizeClientRoute(workflowInput.successRoute, "client://fs-read/result");
  const auditRoute = normalizeClientRoute(workflowInput.auditRoute, "client://fs-read/audit");
  const requestKey = stableClientKey(clientContext.requestId);
  const workflowKey = stableClientKey(clientContext.workflowId);
  const receiptId = typeof workflowInput.receiptId === "string" && workflowInput.receiptId.trim()
    ? workflowInput.receiptId.trim()
    : `fs-read-client-receipt:${requestKey}:${stableClientKey(now)}`;
  const preferredAction = typeof workflowInput.preferredAction === "string" && workflowInput.preferredAction.trim()
    ? workflowInput.preferredAction.trim()
    : readiness.ready
      ? "dispatch"
      : readiness.queueable
        ? "schedule"
        : "edit-request";
  const optimisticPreview = workflowInput.optimisticPreview === true && readGate.status === "ready";
  const requireAckBeforeResult = workflowInput.requireAcknowledgementBeforeResult !== false;

  return {
    contract: "fs-read-client-workflow-preferences.v1",
    schemaVersion: 1,
    generatedAt: now,
    requestId: clientContext.requestId,
    workflowId: clientContext.workflowId,
    channel: clientContext.channel,
    receiptId,
    preferredAction,
    resultDelivery,
    optimisticPreview,
    requireAcknowledgementBeforeResult: requireAckBeforeResult,
    routes: {
      returnRoute,
      blockedRoute,
      successRoute,
      auditRoute,
      dispatchRoute: "kernel://syscall-layer/fs-read/dispatch",
      scheduleRoute: "kernel://syscall-layer/fs-read/schedule"
    },
    resumeTokens: {
      requestToken: `fs-read:request:${requestKey}`,
      workflowToken: `fs-read:workflow:${workflowKey}`,
      pathToken: stableClientKey(readGate.path || readGate.requestedPath || "no-path")
    },
    proof: {
      explicitInput: Object.keys(workflowInput).length > 0,
      routeAccepted: returnRoute === (workflowInput.returnRoute || nextStep.route) || returnRoute === nextStep.route,
      deliveryAccepted: resultDelivery === requestedResultDelivery,
      evaluatedAt: now
    }
  };
}

function buildClientResultDeliveryContract({
  clientRuntime,
  workflowPreferences,
  providerAcknowledgement,
  hostedKernelReadResult,
  providerResultCommit,
  preview,
  syncMetadata,
  now
}) {
  const ackSatisfied = !providerAcknowledgement.required || providerAcknowledgement.state === "accepted";
  const ackBlocksResult = workflowPreferences.requireAcknowledgementBeforeResult && !ackSatisfied;
  const resultAccepted = ["fulfilled", "partial"].includes(hostedKernelReadResult.state);
  const commitReady = providerResultCommit.commitReady === true;
  const commitAdmitted = providerResultCommit.commitAdmission?.commitAdmitted === true;
  const deliverable = resultAccepted && !ackBlocksResult && (commitReady || (commitAdmitted && workflowPreferences.optimisticPreview));
  const requestedDelivery = workflowPreferences.resultDelivery;
  const content = hostedKernelReadResult.content || {};
  const canInline = content.inline === true && requestedDelivery === "inline";
  const canReference = Boolean(content.contentRef || providerResultCommit.durableWrite.writeKey);
  const deliveryMode = !deliverable
    ? "blocked"
    : canInline
      ? "inline"
      : requestedDelivery === "download"
        ? "download"
        : "reference";
  const resultRoute = deliverable
    ? requestedDelivery === "download"
      ? "client://fs-read/result/download"
      : workflowPreferences.routes.successRoute
    : ackBlocksResult
      ? "client://fs-read/provider-acknowledgement"
      : hostedKernelReadResult.received
        ? workflowPreferences.routes.auditRoute
        : "kernel://syscall-layer/fs-read/dispatch";
  const blockReasons = [
    ...(ackBlocksResult ? [`provider acknowledgement is ${providerAcknowledgement.state}`] : []),
    ...(!resultAccepted ? [`hosted kernel result is ${hostedKernelReadResult.state}`] : []),
    ...(resultAccepted && !commitAdmitted ? providerResultCommit.commitAdmission?.errors || ["provider result commit admission is blocked"] : []),
    ...(resultAccepted && commitAdmitted && !commitReady && !workflowPreferences.optimisticPreview ? ["provider result has not been committed"] : [])
  ];

  return {
    contract: "fs-read-client-result-delivery.v1",
    schemaVersion: 1,
    generatedAt: now,
    state: deliverable ? "deliverable" : "blocked",
    deliveryMode,
    requestedDelivery,
    route: resultRoute,
    receiptId: workflowPreferences.receiptId,
    requestId: clientRuntime.requestIdentity.requestId,
    workflowId: clientRuntime.requestIdentity.workflowId,
    handoffKey: clientRuntime.runtimeKeys.handoffKey,
    resultIdentity: {
      providerId: providerResultCommit.providerId,
      operationId: providerResultCommit.operationId,
      commitId: providerResultCommit.commitId,
      syncCursor: syncMetadata.cursor,
      committedCursor: providerResultCommit.syncCommit.committedCursor,
      proofKey: clientRuntime.runtimeKeys.proofKey,
      cacheKey: clientRuntime.runtimeKeys.cacheKey
    },
    byteRange: {
      ...hostedKernelReadResult.byteRange,
      redactedPath: preview.redactedPath || preview.path || null
    },
    payload: deliverable
      ? {
          inlinePreview: canInline ? hostedKernelReadResult.content.preview : null,
          contentRef: content.contentRef || providerResultCommit.durableWrite.writeKey || null,
          downloadRef: deliveryMode === "download"
            ? content.contentRef || providerResultCommit.durableWrite.writeKey || null
            : null,
          encoding: content.encoding || null,
          partial: hostedKernelReadResult.state === "partial",
          committed: commitReady,
          optimistic: !commitReady && workflowPreferences.optimisticPreview
        }
      : null,
    gates: {
      acknowledgement: {
        required: providerAcknowledgement.required,
        state: providerAcknowledgement.state,
        satisfied: ackSatisfied,
        blocksResult: ackBlocksResult
      },
      result: {
        state: hostedKernelReadResult.state,
        received: hostedKernelReadResult.received,
        accepted: resultAccepted,
        errors: hostedKernelReadResult.errors
      },
      commit: {
        state: providerResultCommit.state,
        ready: commitReady,
        admitted: commitAdmitted,
        admissionState: providerResultCommit.commitAdmission?.state || "unknown",
        durableStatus: providerResultCommit.durableWrite.status
      }
    },
    blockReasons,
    proof: {
      deliveryMatchesPreference: deliveryMode === "blocked" || deliveryMode === requestedDelivery || (requestedDelivery === "inline" && deliveryMode === "reference"),
      acknowledgementSatisfied: ackSatisfied,
      resultAccepted,
      commitAdmitted,
      commitReady,
      evaluatedAt: now
    }
  };
}

function buildWorkflowHandoff(
  clientRuntime,
  preview,
  readiness,
  externalHandoff,
  nextStep,
  providerAcknowledgement,
  hostedKernelReadResult,
  providerResultCommit,
  workflowPreferences,
  resultDelivery
) {
  const ackReady = !providerAcknowledgement.required || providerAcknowledgement.state === "accepted";
  const resultReady = ["fulfilled", "partial"].includes(hostedKernelReadResult.state);
  const commitReady = providerResultCommit.commitReady === true;
  const completionRoute = commitReady
    ? workflowPreferences.routes.successRoute
    : readiness.ready
      ? workflowPreferences.routes.dispatchRoute
      : readiness.queueable
        ? workflowPreferences.routes.scheduleRoute
        : workflowPreferences.routes.blockedRoute;
  const controls = {
    contract: "fs-read-workflow-controls.v1",
    primary: {
      action: commitReady ? "open-result" : readiness.ready ? "dispatch-read" : readiness.queueable ? "schedule-read" : "resolve-block",
      route: completionRoute,
      enabled: readiness.ready || readiness.queueable || commitReady,
      label: commitReady ? "Open result" : readiness.ready ? "Read file" : readiness.queueable ? "Schedule read" : "Resolve block"
    },
    secondary: [
      {
        action: "return",
        route: workflowPreferences.routes.returnRoute,
        enabled: true
      },
      {
        action: "view-audit-proof",
        route: workflowPreferences.routes.auditRoute,
        enabled: true
      }
    ],
    blockedReason: readiness.ready || readiness.queueable || commitReady ? null : nextStep.reason
  };
  const payload = readiness.ready
    ? {
        operation: externalHandoff.operation,
        providerId: externalHandoff.providerId,
        endpoint: externalHandoff.endpoint,
        path: externalHandoff.path,
        offset: externalHandoff.offset,
        bytes: externalHandoff.byteLimit,
        syncCursor: externalHandoff.syncCursor,
        deliveryState: externalHandoff.deliveryState,
        acknowledgement: externalHandoff.acknowledgement,
        providerAcknowledgement: {
          state: providerAcknowledgement.state,
          required: providerAcknowledgement.required,
          received: providerAcknowledgement.received,
          receiptId: providerAcknowledgement.receipt?.receiptId || null
        },
        readResult: {
          state: hostedKernelReadResult.state,
          received: hostedKernelReadResult.received,
          byteRange: hostedKernelReadResult.byteRange,
          content: hostedKernelReadResult.content,
          errors: hostedKernelReadResult.errors
        },
        commit: {
          state: providerResultCommit.state,
          ready: providerResultCommit.commitReady,
          admissionState: providerResultCommit.commitAdmission?.state || "unknown",
          admitted: providerResultCommit.commitAdmission?.commitAdmitted === true,
          commitId: providerResultCommit.commitId,
          committedCursor: providerResultCommit.syncCommit.committedCursor,
          durableStatus: providerResultCommit.durableWrite.status
        },
        resultDelivery
      }
    : {
        editorRoute: nextStep.route,
        path: preview.path,
        bytes: preview.byteLimit,
        missingCapabilities: nextStep.payload.missingCapabilities,
        reason: nextStep.reason
      };

  return {
    contract: "fs-read-workflow-handoff.v1",
    state: commitReady
      ? "result-ready"
      : readiness.ready
        ? "dispatch"
        : readiness.queueable
          ? "scheduled"
          : "client-action-required",
    userVisible: true,
    handoffKey: clientRuntime.runtimeKeys.handoffKey,
    resumeRoute: completionRoute,
    label: controls.primary.label,
    message: commitReady
      ? `${hostedKernelReadResult.byteRange.returnedLength} bytes are ready from ${preview.redactedPath || preview.path}.`
      : readiness.ready
        ? preview.userMessage
        : nextStep.reason,
    preferences: workflowPreferences,
    controls,
    completion: {
      acknowledgementReady: ackReady,
      resultReady,
      commitReady,
      resultDelivery: workflowPreferences.resultDelivery,
      clientReceiptId: workflowPreferences.receiptId,
      nextRoute: completionRoute,
      requiresAcknowledgementBeforeResult: workflowPreferences.requireAcknowledgementBeforeResult
    },
    resultDelivery,
    payload,
    telemetry: {
      workflowId: clientRuntime.requestIdentity.workflowId,
      requestId: clientRuntime.requestIdentity.requestId,
      channel: clientRuntime.channel,
      runtimeState: clientRuntime.state
    }
  };
}

function buildKernelReadExecutionPlan({
  settings,
  provider,
  readGate,
  readiness,
  externalHandoff,
  syncMetadata,
  clientContext,
  now
}) {
  const dispatchable = readiness.ready && externalHandoff.state === "ready";
  const proofModes = provider.serviceContract.proofModes;
  const checksumRequested = proofModes.includes("checksum-proof") || provider.capabilities.includes("checksum-proof");
  const rangeReadSupported = provider.capabilities.includes("range-read");
  const offset = Number.isInteger(readGate.requestedOffset) && readGate.requestedOffset > 0 ? readGate.requestedOffset : 0;
  const readLength = readGate.bytes;
  const kernelOperationId = `fs-read:${stableClientKey(clientContext.requestId)}:${stableClientKey(syncMetadata.nextCursor)}`;

  return {
    contract: "fs-read-hosted-kernel-execution-plan.v1",
    schemaVersion: 1,
    generatedAt: now,
    state: dispatchable ? "dispatchable" : "blocked",
    operationId: kernelOperationId,
    operation: {
      type: "fs.read",
      route: "kernel://syscall-layer/fs-read/dispatch",
      providerId: provider.providerId,
      endpoint: provider.endpoint,
      deliveryState: externalHandoff.deliveryState
    },
    io: {
      requestedPath: readGate.requestedPath || readGate.path || null,
      canonicalPath: readGate.path || null,
      root: readGate.matchedRoot,
      offset,
      length: readLength,
      maxBytes: Math.min(settings.maxBytes, provider.serviceContract.maxBytes),
      rangeRead: rangeReadSupported
        ? { supported: true, start: offset, endExclusive: offset + readLength }
        : { supported: false, start: 0, endExclusive: readLength }
    },
    policy: {
      lifecycle: settings.lifecycle,
      allowHidden: settings.allowHidden,
      rootMatched: Boolean(readGate.matchedRoot),
      scopedDispatchClaim: externalHandoff.scopedDispatchClaim
        ? {
            claimId: externalHandoff.scopedDispatchClaim.claimId,
            state: externalHandoff.scopedDispatchClaim.state,
            accepted: externalHandoff.scopedDispatchClaim.accepted,
            matchedEffectiveRoot: externalHandoff.scopedDispatchClaim.matchedEffectiveRoot,
            requiredPermission: externalHandoff.scopedDispatchClaim.requiredPermission,
            permissionGranted: externalHandoff.scopedDispatchClaim.permissionGranted
          }
        : null,
      tenantBoundary: readGate.tenantBoundary
        ? {
            mode: readGate.tenantBoundary.mode,
            tenantId: readGate.tenantBoundary.tenantId,
            workspaceId: readGate.tenantBoundary.workspaceId,
            requiredPermission: readGate.tenantBoundary.requiredPermission,
            decision: readGate.tenantBoundary.decision,
            matchedTenantRoot: readGate.tenantBoundary.matchedTenantRoot
          }
        : null,
      workspaceScope: readGate.workspaceScope
        ? {
            decision: readGate.workspaceScope.decision,
            constrained: readGate.workspaceScope.constrained,
            matchedEffectiveRoot: readGate.workspaceScope.matchedEffectiveRoot,
            effectiveRoots: readGate.workspaceScope.effectiveRoots
          }
        : null,
      deniedGlobMatched: readGate.errors.some((error) => error.includes("deniedGlob")),
      encodedPathHazards: readGate.encodedPathPolicy?.hazards || [],
      encodedPathAccepted: readGate.encodedPathPolicy?.blocked !== true,
      byteLimitSatisfied: readLength <= settings.maxBytes && readLength <= provider.serviceContract.maxBytes,
      hiddenSegments: readGate.pathNormalization?.hiddenSegments || []
    },
    sync: {
      consistency: syncMetadata.consistency,
      cursor: syncMetadata.cursor,
      nextCursor: syncMetadata.nextCursor,
      stale: syncMetadata.stale
    },
    proofRequirements: {
      modes: proofModes,
      checksum: checksumRequested
        ? { required: true, algorithm: "sha256", scope: "returned-bytes" }
        : { required: false, algorithm: null, scope: null },
      audit: {
        required: true,
        includePathNormalization: true,
        includeProviderContract: true,
        includePolicyDecision: true,
        includeScopedDispatchClaim: true
      }
    },
    dispatchEnvelope: dispatchable
      ? {
          handoffKey: `fs-read:provider-handoff:${stableClientKey(clientContext.requestId)}`,
          leaseExpiresAt: externalHandoff.serviceContract.leaseExpiresAt,
          acknowledgementDeadlineAt: externalHandoff.acknowledgement.deadlineAt,
          acknowledgement: externalHandoff.acknowledgement,
          actorId: clientContext.actorId,
          tenantId: clientContext.tenantIdentity.tenantId,
          workspaceId: clientContext.tenantIdentity.workspaceId,
          requestId: clientContext.requestId,
          workflowId: clientContext.workflowId,
          scopedDispatchClaimId: externalHandoff.scopedDispatchClaim?.claimId || null,
          scopedDispatchEffectiveRoot: externalHandoff.scopedDispatchClaim?.matchedEffectiveRoot || null
        }
      : null,
    blockingReasons: dispatchable
      ? []
      : [
          ...readGate.errors,
          ...(externalHandoff.scopedDispatchClaim?.errors || [])
        ]
  };
}

function selectProviderReadResultInput(input = {}) {
  const candidates = [
    input.providerReadResult,
    input.readResult,
    input.result,
    input.providerOutput
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") || null;
}

function estimateContentBytes(content, encoding) {
  if (typeof content !== "string") return 0;
  if (encoding === "base64") {
    const normalized = content.replace(/\s+/g, "");
    const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
  }
  if (typeof Buffer !== "undefined") return Buffer.byteLength(content, "utf8");
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(content).length;
  return content.length;
}

function normalizeReadResultOffset(resultInput = {}, expectedOffset = 0) {
  const byteRange = resultInput.byteRange && typeof resultInput.byteRange === "object" ? resultInput.byteRange : {};
  const candidates = [resultInput.offset, resultInput.startOffset, byteRange.offset, byteRange.start];
  const explicitOffset = candidates.find((candidate) => Number.isInteger(candidate));
  return {
    offset: Number.isInteger(explicitOffset) ? explicitOffset : expectedOffset,
    explicit: Number.isInteger(explicitOffset)
  };
}

function expectedHashLength(algorithm) {
  if (algorithm === "sha256" || algorithm === "blake3") return 64;
  if (algorithm === "sha512") return 128;
  return null;
}

function buildReadResultIntegrityContract({
  resultInput,
  state,
  encoding,
  content,
  contentRef,
  declaredBytes,
  hashAlgorithm,
  hashValue,
  kernelReadPlan,
  provider,
  providerId,
  operationId,
  path,
  readGate,
  now
}) {
  const resultOffset = normalizeReadResultOffset(resultInput, kernelReadPlan.io.offset);
  const inlineBytes = content === null ? null : estimateContentBytes(content, encoding);
  const expectedEndExclusive = kernelReadPlan.io.offset + kernelReadPlan.io.length;
  const returnedEndExclusive = resultOffset.offset + Math.max(0, declaredBytes);
  const declaredComplete = resultInput.complete === true
    || resultInput.done === true
    || resultInput.byteRange?.complete === true;
  const checksumRequired = kernelReadPlan.proofRequirements.checksum.required;
  const hashLength = expectedHashLength(hashAlgorithm);
  const errors = [];

  if (resultOffset.offset !== kernelReadPlan.io.offset) {
    errors.push("provider read result offset does not match execution plan");
  }
  if (returnedEndExclusive > expectedEndExclusive) {
    errors.push("provider read result byte range exceeds requested window");
  }
  if (inlineBytes !== null && inlineBytes !== declaredBytes) {
    errors.push("provider read result declared bytesRead does not match inline content length");
  }
  if (declaredComplete && declaredBytes !== kernelReadPlan.io.length) {
    errors.push("provider read result complete=true requires returned bytes to equal requested length");
  }
  if (state !== "failed" && encoding === "bytes-ref" && !contentRef) {
    errors.push("provider read result bytes-ref payload must include a contentRef");
  }
  if (checksumRequired && (!hashAlgorithm || !hashValue)) {
    errors.push("provider read result requires checksum proof");
  }
  if (hashAlgorithm && hashLength && !new RegExp(`^[a-f0-9]{${hashLength}}$`, "iu").test(hashValue || "")) {
    errors.push(`provider read result ${hashAlgorithm} checksum must be ${hashLength} hex characters`);
  }

  return {
    contract: "fs-read-result-integrity.v1",
    schemaVersion: 1,
    generatedAt: now,
    state: errors.length ? "rejected" : "accepted",
    providerId,
    operationId,
    path,
    expected: {
      providerId: provider.providerId,
      operationId: kernelReadPlan.operationId,
      path: readGate.path || null,
      offset: kernelReadPlan.io.offset,
      length: kernelReadPlan.io.length,
      endExclusive: expectedEndExclusive,
      checksumRequired
    },
    observed: {
      state,
      offset: resultOffset.offset,
      offsetExplicit: resultOffset.explicit,
      bytesRead: declaredBytes,
      endExclusive: returnedEndExclusive,
      declaredComplete,
      encoding,
      inlineBytes,
      hasContentRef: Boolean(contentRef),
      hashAlgorithm,
      hashValueLength: typeof hashValue === "string" ? hashValue.length : 0
    },
    checks: [
      { check: "provider", passed: providerId === provider.providerId },
      { check: "operation", passed: operationId === kernelReadPlan.operationId },
      { check: "path", passed: path === readGate.path },
      { check: "offset", passed: resultOffset.offset === kernelReadPlan.io.offset },
      { check: "byte-window", passed: declaredBytes >= 0 && returnedEndExclusive <= expectedEndExclusive },
      { check: "inline-length", passed: inlineBytes === null || inlineBytes === declaredBytes },
      { check: "content-reference", passed: encoding !== "bytes-ref" || Boolean(contentRef) || state === "failed" },
      { check: "checksum-proof", passed: !checksumRequired || Boolean(hashAlgorithm && hashValue && (!hashLength || hashValue.length === hashLength)) }
    ],
    errors
  };
}

function buildHostedKernelReadResult(input, kernelReadPlan, provider, readGate, syncMetadata, now) {
  const resultInput = selectProviderReadResultInput(input);
  const resultExpected = kernelReadPlan.state === "dispatchable";

  if (!resultInput) {
    return {
      contract: "fs-read-hosted-kernel-result.v1",
      schemaVersion: 1,
      generatedAt: now,
      state: resultExpected ? "awaiting-provider-result" : "not-expected",
      received: false,
      resultExpected,
      providerId: provider.providerId,
      operationId: kernelReadPlan.operationId,
      path: readGate.path || null,
      byteRange: {
        offset: kernelReadPlan.io.offset,
        requestedLength: kernelReadPlan.io.length,
        returnedLength: 0,
        complete: false
      },
      content: null,
      proofs: [],
      errors: []
    };
  }

  const state = typeof resultInput.state === "string" && resultInput.state.trim()
    ? resultInput.state.trim().toLowerCase()
    : "fulfilled";
  const providerId = typeof resultInput.providerId === "string" && resultInput.providerId.trim()
    ? resultInput.providerId.trim()
    : provider.providerId;
  const operationId = typeof resultInput.operationId === "string" && resultInput.operationId.trim()
    ? resultInput.operationId.trim()
    : kernelReadPlan.operationId;
  const path = typeof resultInput.path === "string" && resultInput.path.trim()
    ? normalizeHostedReadPath(resultInput.path).canonicalPath
    : readGate.path || null;
  const encoding = READ_RESULT_ENCODINGS.has(resultInput.encoding) ? resultInput.encoding : "bytes-ref";
  const content = typeof resultInput.content === "string" ? resultInput.content : null;
  const contentRef = typeof resultInput.contentRef === "string" && resultInput.contentRef.trim()
    ? resultInput.contentRef.trim()
    : typeof resultInput.uri === "string" && resultInput.uri.trim()
      ? resultInput.uri.trim()
      : null;
  const declaredBytes = Number.isInteger(resultInput.bytesRead)
    ? resultInput.bytesRead
    : Number.isInteger(resultInput.byteLength)
      ? resultInput.byteLength
      : estimateContentBytes(content, encoding);
  const hashInput = resultInput.hash && typeof resultInput.hash === "object" ? resultInput.hash : {};
  const hashAlgorithm = typeof hashInput.algorithm === "string" ? hashInput.algorithm.trim().toLowerCase() : null;
  const hashValue = typeof hashInput.value === "string" && hashInput.value.trim() ? hashInput.value.trim() : null;
  const returnedAt = asIso(resultInput.returnedAt || resultInput.at, now);
  const integrity = buildReadResultIntegrityContract({
    resultInput,
    state,
    encoding,
    content,
    contentRef,
    declaredBytes,
    hashAlgorithm,
    hashValue,
    kernelReadPlan,
    provider,
    providerId,
    operationId,
    path,
    readGate,
    now
  });
  const errors = [];

  if (!resultExpected) errors.push("provider read result was supplied for a non-dispatchable fs.read plan");
  if (!["fulfilled", "partial", "failed"].includes(state)) errors.push("provider read result state must be fulfilled, partial, or failed");
  if (providerId !== provider.providerId) errors.push("provider read result providerId does not match execution provider");
  if (operationId !== kernelReadPlan.operationId) errors.push("provider read result operationId does not match execution plan");
  if (path !== readGate.path) errors.push("provider read result path does not match canonical read path");
  if (declaredBytes < 0) errors.push("provider read result bytesRead must be zero or positive");
  if (declaredBytes > kernelReadPlan.io.length) errors.push("provider read result bytesRead exceeds requested length");
  if (encoding !== "bytes-ref" && content === null) errors.push("provider read result inline content is required for utf8/base64 encoding");
  if (encoding === "bytes-ref" && !contentRef) errors.push("provider read result contentRef is required for bytes-ref encoding");
  if (kernelReadPlan.proofRequirements.checksum.required && (!hashAlgorithm || !hashValue)) {
    errors.push("provider read result requires checksum proof");
  }
  if (hashAlgorithm && !READ_RESULT_HASH_ALGORITHMS.has(hashAlgorithm)) {
    errors.push(`provider read result hash algorithm is unsupported: ${hashAlgorithm}`);
  }
  if (state === "failed" && typeof resultInput.reason !== "string") {
    errors.push("provider read result failure requires a reason");
  }
  errors.push(...integrity.errors);

  const accepted = errors.length === 0 && state !== "failed";
  const partial = accepted && (state === "partial" || declaredBytes < kernelReadPlan.io.length);

  return {
    contract: "fs-read-hosted-kernel-result.v1",
    schemaVersion: 1,
    generatedAt: now,
    state: accepted ? (partial ? "partial" : "fulfilled") : "rejected",
    received: true,
    resultExpected,
    providerId,
    operationId,
    path,
    returnedAt,
    byteRange: {
      offset: kernelReadPlan.io.offset,
      requestedLength: kernelReadPlan.io.length,
      returnedLength: declaredBytes,
      complete: accepted && declaredBytes === kernelReadPlan.io.length
    },
    content: {
      encoding,
      inline: content !== null,
      contentRef,
      preview: content && encoding === "utf8" ? content.slice(0, 160) : null,
      redacted: content && content.length > 160
    },
    proofs: [
      {
        check: "execution-plan-match",
        providerMatched: providerId === provider.providerId,
        operationMatched: operationId === kernelReadPlan.operationId,
        pathMatched: path === readGate.path
      },
      {
        check: "byte-range",
        requestedOffset: kernelReadPlan.io.offset,
        requestedLength: kernelReadPlan.io.length,
        returnedOffset: integrity.observed.offset,
        returnedLength: declaredBytes,
        endExclusive: integrity.observed.endExclusive,
        withinLimit: declaredBytes <= kernelReadPlan.io.length && integrity.observed.endExclusive <= integrity.expected.endExclusive
      },
      {
        check: "sync-cursor",
        cursor: syncMetadata.cursor,
        nextCursor: syncMetadata.nextCursor
      },
      {
        check: "checksum",
        required: kernelReadPlan.proofRequirements.checksum.required,
        algorithm: hashAlgorithm,
        value: hashValue,
        present: Boolean(hashAlgorithm && hashValue)
      },
      {
        check: "result-integrity",
        contract: integrity.contract,
        state: integrity.state,
        checks: integrity.checks
      }
    ],
    integrity,
    reason: typeof resultInput.reason === "string" && resultInput.reason.trim() ? resultInput.reason.trim() : null,
    errors
  };
}

function buildProviderResultCommitAdmission({
  resultInput,
  externalHandoff,
  providerAcknowledgement,
  hostedKernelReadResult,
  kernelReadPlan,
  syncMetadata,
  clientRuntime,
  now
}) {
  const received = Boolean(resultInput && typeof resultInput === "object");
  const expectedHandoffKey = clientRuntime.runtimeKeys.handoffKey;
  const expectedProviderId = externalHandoff.providerId;
  const expectedOperationId = kernelReadPlan.operationId;
  const expectedSyncCursor = syncMetadata.cursor;
  const expectedNextCursor = syncMetadata.nextCursor;
  const observedProviderId = typeof resultInput?.providerId === "string" && resultInput.providerId.trim()
    ? resultInput.providerId.trim()
    : hostedKernelReadResult.providerId;
  const observedOperationId = typeof resultInput?.operationId === "string" && resultInput.operationId.trim()
    ? resultInput.operationId.trim()
    : hostedKernelReadResult.operationId;
  const observedHandoffKey = typeof resultInput?.handoffKey === "string" && resultInput.handoffKey.trim()
    ? resultInput.handoffKey.trim()
    : typeof resultInput?.handoff?.key === "string" && resultInput.handoff.key.trim()
      ? resultInput.handoff.key.trim()
      : null;
  const observedSyncCursor = typeof resultInput?.syncCursor === "string" && resultInput.syncCursor.trim()
    ? resultInput.syncCursor.trim()
    : typeof resultInput?.cursor === "string" && resultInput.cursor.trim()
      ? resultInput.cursor.trim()
      : null;
  const observedNextCursor = typeof resultInput?.nextCursor === "string" && resultInput.nextCursor.trim()
    ? resultInput.nextCursor.trim()
    : typeof resultInput?.sync?.nextCursor === "string" && resultInput.sync.nextCursor.trim()
      ? resultInput.sync.nextCursor.trim()
      : null;
  const leaseExpiresAt = externalHandoff.serviceContract.leaseExpiresAt;
  const leaseExpired = Boolean(leaseExpiresAt && Date.parse(leaseExpiresAt) < Date.parse(now));
  const handoffReady = externalHandoff.state === "ready";
  const acknowledgementAccepted = !providerAcknowledgement.required || providerAcknowledgement.state === "accepted";
  const resultAccepted = ["fulfilled", "partial"].includes(hostedKernelReadResult.state);
  const resultRejected = hostedKernelReadResult.state === "rejected";
  const errors = [];

  if (!received) errors.push("provider result commit admission is awaiting provider result");
  if (received && !handoffReady) errors.push("provider result commit admission requires ready external handoff");
  if (received && observedProviderId !== expectedProviderId) errors.push("provider result commit admission providerId does not match handoff provider");
  if (received && observedOperationId !== expectedOperationId) errors.push("provider result commit admission operationId does not match execution plan");
  if (received && observedHandoffKey && observedHandoffKey !== expectedHandoffKey) errors.push("provider result commit admission handoffKey does not match client runtime");
  if (received && observedSyncCursor && observedSyncCursor !== expectedSyncCursor) errors.push("provider result commit admission syncCursor does not match handoff cursor");
  if (received && observedNextCursor && observedNextCursor !== expectedNextCursor) errors.push("provider result commit admission nextCursor does not match planned cursor");
  if (received && leaseExpired) errors.push("provider result commit admission arrived after handoff lease expiry");
  if (received && !acknowledgementAccepted) errors.push(`provider result commit admission requires acknowledgement state accepted, received ${providerAcknowledgement.state}`);
  if (received && !resultAccepted && !resultRejected) errors.push(`provider result commit admission cannot commit result state ${hostedKernelReadResult.state}`);

  return {
    contract: "fs-read-provider-result-commit-admission.v1",
    schemaVersion: 1,
    generatedAt: now,
    state: !received
      ? "awaiting-result"
      : errors.length
        ? "blocked"
        : resultRejected
          ? "rejectable"
          : "admitted",
    received,
    commitAdmitted: received && errors.length === 0 && resultAccepted,
    rejectionAdmitted: received && errors.length === 0 && resultRejected,
    expected: {
      providerId: expectedProviderId,
      operationId: expectedOperationId,
      handoffKey: expectedHandoffKey,
      syncCursor: expectedSyncCursor,
      nextCursor: expectedNextCursor,
      leaseExpiresAt
    },
    observed: {
      providerId: observedProviderId,
      operationId: observedOperationId,
      handoffKey: observedHandoffKey,
      syncCursor: observedSyncCursor,
      nextCursor: observedNextCursor,
      resultState: hostedKernelReadResult.state,
      acknowledgementState: providerAcknowledgement.state,
      returnedLength: hostedKernelReadResult.byteRange.returnedLength
    },
    checks: {
      handoffReady,
      providerMatched: observedProviderId === expectedProviderId,
      operationMatched: observedOperationId === expectedOperationId,
      handoffKeyMatched: !observedHandoffKey || observedHandoffKey === expectedHandoffKey,
      syncCursorMatched: !observedSyncCursor || observedSyncCursor === expectedSyncCursor,
      nextCursorMatched: !observedNextCursor || observedNextCursor === expectedNextCursor,
      leaseValid: !leaseExpired,
      acknowledgementAccepted,
      resultAccepted,
      resultRejected
    },
    errors
  };
}

function buildProviderResultCommitState({
  input,
  externalHandoff,
  providerAcknowledgement,
  hostedKernelReadResult,
  kernelReadPlan,
  syncMetadata,
  clientRuntime,
  now
}) {
  const resultInput = selectProviderReadResultInput(input);
  const commitAdmission = buildProviderResultCommitAdmission({
    resultInput,
    externalHandoff,
    providerAcknowledgement,
    hostedKernelReadResult,
    kernelReadPlan,
    syncMetadata,
    clientRuntime,
    now
  });
  const resultTerminal = ["fulfilled", "partial", "rejected", "not-expected"].includes(hostedKernelReadResult.state);
  const resultAccepted = ["fulfilled", "partial"].includes(hostedKernelReadResult.state);
  const acknowledgementSatisfied = !providerAcknowledgement.required || providerAcknowledgement.state === "accepted";
  const acknowledgementBlocking = providerAcknowledgement.required && providerAcknowledgement.state !== "accepted";
  const commitErrors = [
    ...(commitAdmission.state === "blocked" ? commitAdmission.errors : []),
    ...(acknowledgementBlocking ? [`provider acknowledgement is ${providerAcknowledgement.state}`] : []),
    ...(hostedKernelReadResult.state === "rejected" ? hostedKernelReadResult.errors : []),
    ...(kernelReadPlan.state !== "dispatchable" && hostedKernelReadResult.received
      ? ["provider result cannot be committed for a non-dispatchable execution plan"]
      : [])
  ];
  const commitReady = resultAccepted && acknowledgementSatisfied && commitAdmission.commitAdmitted && commitErrors.length === 0;
  const commitState = commitReady
    ? hostedKernelReadResult.state === "partial" ? "committed-partial" : "committed"
    : hostedKernelReadResult.state === "not-expected"
      ? "not-applicable"
      : !hostedKernelReadResult.received
        ? "awaiting-result"
        : acknowledgementBlocking
          ? "awaiting-acknowledgement"
          : "blocked";
  const commitId = `fs-read:commit:${stableClientKey(clientRuntime.requestIdentity.requestId)}:${stableClientKey(syncMetadata.nextCursor)}`;
  const byteRange = hostedKernelReadResult.byteRange;
  const complete = commitReady && byteRange.complete === true;
  const advancedCursor = commitReady
    ? `${syncMetadata.nextCursor}:committed:${byteRange.returnedLength}`
    : syncMetadata.cursor;

  return {
    contract: "fs-read-provider-result-commit.v1",
    schemaVersion: 1,
    generatedAt: now,
    state: commitState,
    commitReady,
    commitId,
    providerId: externalHandoff.providerId,
    operationId: kernelReadPlan.operationId,
    handoffKey: clientRuntime.runtimeKeys.handoffKey,
    workflowId: clientRuntime.requestIdentity.workflowId,
    requestId: clientRuntime.requestIdentity.requestId,
    externalHandoff: {
      state: externalHandoff.state,
      deliveryState: externalHandoff.deliveryState,
      acknowledgementRequired: externalHandoff.acknowledgement.required,
      acknowledgementState: providerAcknowledgement.state,
      leaseExpiresAt: externalHandoff.serviceContract.leaseExpiresAt,
      completionState: commitReady ? "complete" : resultTerminal ? "blocked" : "open"
    },
    commitAdmission,
    result: {
      state: hostedKernelReadResult.state,
      received: hostedKernelReadResult.received,
      resultExpected: hostedKernelReadResult.resultExpected,
      byteRange,
      contentRef: hostedKernelReadResult.content?.contentRef || null,
      inlineContent: hostedKernelReadResult.content?.inline === true,
      complete
    },
    syncCommit: {
      consistency: syncMetadata.consistency,
      previousCursor: syncMetadata.cursor,
      plannedCursor: syncMetadata.nextCursor,
      committedCursor: advancedCursor,
      watermark: syncMetadata.watermark,
      advanced: commitReady,
      staleAtCommit: syncMetadata.stale
    },
    durableWrite: {
      shouldWrite: commitReady || hostedKernelReadResult.state === "rejected",
      status: commitReady ? "result-committed" : hostedKernelReadResult.state === "rejected" ? "result-rejected" : "pending",
      writeKey: commitReady || hostedKernelReadResult.state === "rejected" ? commitId : null,
      resultBytes: byteRange.returnedLength,
      cacheKey: clientRuntime.runtimeKeys.cacheKey,
      proofKey: clientRuntime.runtimeKeys.proofKey
    },
    proof: {
      acknowledgementSatisfied,
      commitAdmissionState: commitAdmission.state,
      commitAdmitted: commitAdmission.commitAdmitted,
      resultAccepted,
      cursorAdvanced: commitReady,
      complete,
      byteLimitSatisfied: byteRange.returnedLength <= kernelReadPlan.io.length,
      evaluatedAt: now
    },
    errors: commitErrors
  };
}

function buildRecoveryPlan(persistedState, readGate, readiness, nextStep, syncMetadata, externalHandoff, clientRuntime, lifecycle, now) {
  const pending = persistedState.pendingRead;
  const startedAtMs = pending?.startedAt ? Date.parse(pending.startedAt) : null;
  const pendingAgeMs = Number.isFinite(startedAtMs) ? Math.max(0, Date.parse(now) - startedAtMs) : null;
  const leaseExpiresAt = externalHandoff.serviceContract.leaseExpiresAt;
  const leaseExpired = Boolean(leaseExpiresAt && Date.parse(leaseExpiresAt) < Date.parse(now));
  const pendingMatchesRequest = Boolean(
    pending
      && pending.path === (readGate.path || null)
      && (pending.bytes === null || pending.bytes === readGate.bytes)
  );
  const cursorMatches = !pending?.syncCursor || pending.syncCursor === syncMetadata.cursor;
  const handoffMatches = !pending?.handoffKey || pending.handoffKey === clientRuntime.runtimeKeys.handoffKey;
  const canResumeDispatch = persistedState.restart.requiresRecovery
    && pendingMatchesRequest
    && cursorMatches
    && handoffMatches
    && !leaseExpired
    && readiness.ready;
  const canResumeSchedule = persistedState.status === "scheduled" && readiness.queueable;
  const commandMatchesRecovery = lifecycle.command === "recover-dispatch"
    ? canResumeDispatch
    : lifecycle.command === "recover-schedule"
      ? canResumeSchedule
      : lifecycle.command === "mark-clean"
        ? !persistedState.restart.dirty || !pending
        : true;
  const state = canResumeDispatch
    ? "resume-dispatch"
    : canResumeSchedule
      ? "resume-schedule"
      : persistedState.restart.requiresRecovery
        ? "reconcile"
        : "no-recovery-needed";
  const pendingMismatchReasons = [
    ...(pending && !pendingMatchesRequest ? ["pending-read-differs-from-request"] : []),
    ...(pending && !cursorMatches ? ["sync-cursor-differs-from-pending-read"] : []),
    ...(pending && !handoffMatches ? ["handoff-key-differs-from-pending-read"] : []),
    ...(leaseExpired ? ["handoff-lease-expired"] : []),
    ...(persistedState.restart.requiresRecovery && !readiness.ready ? ["current-request-not-dispatch-ready"] : [])
  ];
  const replayToken = `fs-read:replay:${stableClientKey(clientRuntime.requestIdentity.requestId)}:${stableClientKey(syncMetadata.cursor)}:${stableClientKey(persistedState.epoch)}`;
  const replayDecision = {
    contract: "fs-read-replay-decision.v1",
    token: replayToken,
    mode: canResumeDispatch
      ? "resume-dispatch"
      : canResumeSchedule
        ? "resume-schedule"
        : persistedState.restart.dirty
          ? "manual-reconcile"
          : "clean-start",
    replayAllowed: canResumeDispatch || canResumeSchedule || !persistedState.restart.dirty,
    commandRequired: persistedState.restart.dirty
      && !RECOVERY_COMMANDS.has(lifecycle.command)
      && !lifecycle.idempotency?.replayed,
    stalePendingRead: Boolean(pending && pendingMismatchReasons.length > 0),
    mismatchReasons: pendingMismatchReasons,
    idempotency: {
      command: lifecycle.command,
      commandId: lifecycle.idempotency?.commandId || null,
      replayed: lifecycle.idempotency?.replayed === true,
      priorState: lifecycle.idempotency?.priorState || null
    }
  };

  return {
    contract: "fs-read-recovery-plan.v1",
    state,
    restartObserved: persistedState.restart.dirty,
    recoveredAt: persistedState.recoveredAt,
    resumeSafe: (canResumeDispatch || canResumeSchedule || !persistedState.restart.dirty) && commandMatchesRecovery,
    replayDecision,
    route: canResumeDispatch
      ? "kernel://syscall-layer/fs-read/recover-dispatch"
      : canResumeSchedule
        ? "kernel://syscall-layer/fs-read/recover-schedule"
        : nextStep.route,
    reason: canResumeDispatch
      ? "pending read matches current request and cursor"
      : canResumeSchedule
        ? "scheduled read can be re-enqueued"
        : lifecycle.errors.length
          ? lifecycle.errors[0]
          : persistedState.restart.requiresRecovery
          ? "pending dispatch must be reconciled before replay"
          : "persisted state is clean",
    pendingRead: pending,
    restartStatus: {
      previous: persistedState.status,
      dirty: persistedState.restart.dirty,
      safeToReplay: persistedState.restart.safeToReplay,
      requiresRecovery: persistedState.restart.requiresRecovery,
      leaseExpiresAt,
      leaseExpired,
      pendingAgeMs,
      pendingHandoffKey: pending?.handoffKey || null,
      expectedHandoffKey: clientRuntime.runtimeKeys.handoffKey,
      command: lifecycle.command,
      commandAccepted: lifecycle.errors.length === 0 && commandMatchesRecovery
    },
    recommendedCommand: state === "resume-dispatch"
      ? {
          command: "recover-dispatch",
          commandId: `recover-dispatch:${stableClientKey(clientRuntime.requestIdentity.requestId)}:${stableClientKey(syncMetadata.cursor)}`,
          idempotent: true,
          replayToken
        }
      : state === "resume-schedule"
        ? {
            command: "recover-schedule",
            commandId: `recover-schedule:${stableClientKey(clientRuntime.requestIdentity.requestId)}:${stableClientKey(syncMetadata.cursor)}`,
            idempotent: true,
            replayToken
          }
        : persistedState.restart.dirty && !pending
          ? {
              command: "mark-clean",
              commandId: `mark-clean:${stableClientKey(clientRuntime.requestIdentity.requestId)}:${stableClientKey(persistedState.epoch)}`,
              idempotent: true,
              replayToken
            }
          : null,
    checks: {
      pendingMatchesRequest,
      cursorMatches,
      handoffMatches,
      leaseValid: !leaseExpired,
      commandMatchesRecovery,
      readiness: readiness.state
    }
  };
}

function buildOperationCheckpoint({
  nextStatus,
  persistedState,
  lifecycle,
  provider,
  readGate,
  readiness,
  syncMetadata,
  clientRuntime,
  recoveryPlan,
  pendingRead,
  now
}) {
  const requestKey = stableClientKey(clientRuntime.requestIdentity.requestId);
  const cursorKey = stableClientKey(syncMetadata.cursor);
  const pathKey = stableClientKey(readGate.path || readGate.requestedPath || "no-path");
  const checkpointId = `fs-read:checkpoint:${requestKey}:${cursorKey}:${persistedState.epoch + 1}`;
  const checkpointState = nextStatus === "dispatching"
    ? "open-dispatch"
    : nextStatus === "scheduled"
      ? "open-schedule"
      : nextStatus === "blocked"
        ? "blocked"
        : nextStatus === "recovered"
          ? "requires-reconcile"
          : "closed";
  const resumeRoute = checkpointState === "open-dispatch"
    ? "kernel://syscall-layer/fs-read/recover-dispatch"
    : checkpointState === "open-schedule"
      ? "kernel://syscall-layer/fs-read/recover-schedule"
      : recoveryPlan.route;
  const terminal = ["clean", "blocked"].includes(nextStatus);
  const replayable = recoveryPlan.replayDecision.replayAllowed && !terminal;

  return {
    contract: "fs-read-operation-checkpoint.v1",
    schemaVersion: 1,
    checkpointId,
    operationKey: `fs-read:${requestKey}:${pathKey}:${readGate.bytes}`,
    state: checkpointState,
    persistedStatus: nextStatus,
    createdAt: now,
    previousEpoch: persistedState.epoch,
    nextEpoch: persistedState.epoch + 1,
    provider: {
      providerId: provider.providerId,
      handoffMode: provider.serviceContract.handoffMode,
      endpoint: provider.endpoint
    },
    request: {
      requestId: clientRuntime.requestIdentity.requestId,
      workflowId: clientRuntime.requestIdentity.workflowId,
      path: readGate.path || null,
      bytes: readGate.bytes,
      offset: readGate.requestedOffset || 0,
      root: readGate.matchedRoot,
      tenantId: clientRuntime.requestIdentity.tenantId,
      workspaceId: clientRuntime.requestIdentity.workspaceId
    },
    cursor: {
      current: syncMetadata.cursor,
      next: syncMetadata.nextCursor,
      consistency: syncMetadata.consistency
    },
    replay: {
      replayable,
      token: recoveryPlan.replayDecision.token,
      resumeRoute,
      requiredCommand: recoveryPlan.recommendedCommand?.command || null,
      commandId: recoveryPlan.recommendedCommand?.commandId || lifecycle.idempotency?.commandId || null,
      commandReplayed: lifecycle.idempotency?.replayed === true,
      stalePendingRead: recoveryPlan.replayDecision.stalePendingRead,
      mismatchReasons: recoveryPlan.replayDecision.mismatchReasons
    },
    pendingRead,
    restartSemantics: {
      terminal,
      dirtyOnRestart: !terminal && Boolean(pendingRead),
      safeStatusAfterRestart: replayable ? "recoverable" : terminal ? "stable" : "reconcile-required",
      statusMessage: replayable
        ? "checkpoint can be replayed with the recommended recovery command"
        : terminal
          ? "checkpoint does not require recovery after restart"
          : "checkpoint requires operator reconciliation before replay"
    },
    proof: {
      readinessState: readiness.state,
      pendingRetained: Boolean(pendingRead),
      commandAccepted: lifecycle.errors.length === 0,
      replayDecision: recoveryPlan.replayDecision.mode,
      evaluatedAt: now
    }
  };
}

function buildStatePersistenceContract(persistedState, lifecycle, settings, provider, readGate, readiness, syncMetadata, clientRuntime, recoveryPlan, now) {
  const cleanRecoveryCommand = lifecycle.command === "mark-clean" && recoveryPlan.restartStatus.commandAccepted;
  const resumeRecoveryCommand = ["recover-dispatch", "recover-schedule"].includes(lifecycle.command) && recoveryPlan.restartStatus.commandAccepted;
  const nextStatus = cleanRecoveryCommand
    ? "clean"
    : recoveryPlan.state === "reconcile"
    ? "recovered"
    : readiness.ready
      ? "dispatching"
      : readiness.queueable
        ? "scheduled"
        : readiness.state === "blocked"
          ? "blocked"
          : "clean";
  const commandId = lifecycle.idempotency?.commandId || null;
  const commandAlreadyRecorded = commandId
    ? persistedState.commandLedger.some((entry) => entry.commandId === commandId)
    : false;
  const commandLedger = commandId && !commandAlreadyRecorded
    ? [
        ...persistedState.commandLedger,
        {
          commandId,
          command: lifecycle.command,
          state: nextStatus,
          appliedAt: now,
          replaySafe: lifecycle.errors.length === 0
        }
      ].slice(-25)
    : persistedState.commandLedger;
  const pendingRead = nextStatus === "dispatching" || nextStatus === "scheduled"
    ? {
        path: readGate.path || null,
        bytes: readGate.bytes,
        syncCursor: syncMetadata.cursor,
        handoffKey: clientRuntime.runtimeKeys.handoffKey,
        startedAt: resumeRecoveryCommand && persistedState.pendingRead?.startedAt
          ? persistedState.pendingRead.startedAt
          : now
      }
    : null;
  const operationCheckpoint = buildOperationCheckpoint({
    nextStatus,
    persistedState,
    lifecycle,
    provider,
    readGate,
    readiness,
    syncMetadata,
    clientRuntime,
    recoveryPlan,
    pendingRead,
    now
  });
  const transition = {
    contract: "fs-read-persisted-status-transition.v1",
    from: persistedState.status,
    to: nextStatus,
    reason: cleanRecoveryCommand
      ? "operator marked recovered persisted state clean"
      : resumeRecoveryCommand
        ? `operator accepted ${lifecycle.command} replay`
        : recoveryPlan.reason,
    restartSafe: recoveryPlan.resumeSafe && nextStatus !== "recovered",
    command: lifecycle.command,
    commandId,
    pendingRetained: Boolean(pendingRead),
    epochFrom: persistedState.epoch,
    epochTo: persistedState.epoch + 1
  };

  return {
    contract: "fs-read-state-persistence.v1",
    schemaVersion: 1,
    status: nextStatus,
    restartSafe: recoveryPlan.resumeSafe && nextStatus !== "recovered",
    transition,
    operationCheckpoint,
    idempotency: {
      commandId,
      replayed: lifecycle.idempotency?.replayed === true,
      commandAlreadyRecorded,
      ledgerDepth: commandLedger.length,
      recommendedRecoveryCommandId: recoveryPlan.recommendedCommand?.commandId || null,
      replayToken: recoveryPlan.replayDecision.token,
      replayMode: recoveryPlan.replayDecision.mode
    },
    writeModel: {
      shouldPersist: nextStatus !== "clean"
        || commandLedger.length !== persistedState.commandLedger.length
        || transition.from !== transition.to,
      epoch: persistedState.epoch + 1,
      status: nextStatus,
      lastHeartbeatAt: now,
      commandLedger,
      pendingRead,
      operationCheckpoint,
      restartSemantics: operationCheckpoint.restartSemantics,
      snapshot: {
        settings,
        providerRef: {
          providerId: provider.providerId,
          endpoint: provider.endpoint,
          protocol: provider.protocol,
          handoffMode: provider.serviceContract.handoffMode,
          serviceMaxBytes: provider.serviceContract.maxBytes
        },
        readRequest: {
          path: readGate.path || null,
          bytes: readGate.bytes,
          offset: readGate.requestedOffset || 0,
          root: readGate.matchedRoot,
          tenantBoundary: readGate.tenantBoundary
            ? {
                mode: readGate.tenantBoundary.mode,
                tenantId: readGate.tenantBoundary.tenantId,
                workspaceId: readGate.tenantBoundary.workspaceId,
                matchedTenantRoot: readGate.tenantBoundary.matchedTenantRoot,
                requiredPermission: readGate.tenantBoundary.requiredPermission,
                decision: readGate.tenantBoundary.decision
              }
            : null,
          workspaceScope: readGate.workspaceScope
            ? {
                decision: readGate.workspaceScope.decision,
                matchedEffectiveRoot: readGate.workspaceScope.matchedEffectiveRoot,
                constrained: readGate.workspaceScope.constrained
              }
            : null
        },
        syncCursor: syncMetadata.cursor
      }
    },
    recovery: {
      route: recoveryPlan.route,
      state: recoveryPlan.state,
      reason: recoveryPlan.reason,
      recommendedCommand: recoveryPlan.recommendedCommand,
      replayDecision: recoveryPlan.replayDecision,
      restartStatus: recoveryPlan.restartStatus
    },
    proof: {
      statusTransition: `${transition.from}->${transition.to}`,
      commandReplay: lifecycle.idempotency?.replayed === true,
      commandRecorded: Boolean(commandId && !commandAlreadyRecorded),
      pendingReadMatchesRecovery: recoveryPlan.checks.pendingMatchesRequest,
      cursorMatchesRecovery: recoveryPlan.checks.cursorMatches,
      handoffMatchesRecovery: recoveryPlan.checks.handoffMatches,
      leaseValidForReplay: recoveryPlan.checks.leaseValid,
      replayToken: recoveryPlan.replayDecision.token,
      checkpointId: operationCheckpoint.checkpointId,
      evaluatedAt: now
    }
  };
}

function classifyActionableError(item, nextStep) {
  const message = item?.message || nextStep.reason || "fs-read request is not dispatchable";
  const matcher = NON_RETRYABLE_ERROR_MATCHERS.find((candidate) => message.includes(candidate.match));
  if (matcher) {
    return {
      code: matcher.code,
      source: item?.source || "runtime",
      message,
      retryable: false,
      action: matcher.action,
      route: nextStep.route
    };
  }

  if (item?.source === "provider") {
    return {
      code: "FS_READ_PROVIDER_CONTRACT",
      source: "provider",
      message,
      retryable: true,
      action: "Refresh or replace the fs-read provider contract, then retry.",
      route: "client://fs-read/configuration"
    };
  }

  if (item?.source === "lifecycle") {
    return {
      code: "FS_READ_LIFECYCLE_COMMAND",
      source: "lifecycle",
      message,
      retryable: false,
      action: "Submit a supported lifecycle command before dispatch.",
      route: "client://fs-read/configuration"
    };
  }

  return {
    code: "FS_READ_VALIDATION_BLOCKED",
    source: item?.source || "runtime",
    message,
    retryable: RETRYABLE_ACTIONS.has(nextStep.action),
    action: nextStep.route === "client://fs-read/request-editor"
      ? "Edit the read request and submit it again."
      : "Resolve the blocking configuration before retrying.",
    route: nextStep.route
  };
}

function selectOperationalHealthInput(input = {}) {
  const candidates = [
    input.operationalHealth,
    input.health,
    input.providerHealth,
    input.runtimeHealth,
    input.healthProbe
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") || {};
}

function normalizeOperationalHealthInput(input, provider, now) {
  const healthInput = selectOperationalHealthInput(input);
  const providerInput = healthInput.provider && typeof healthInput.provider === "object" ? healthInput.provider : healthInput;
  const circuitInput = healthInput.circuitBreaker && typeof healthInput.circuitBreaker === "object"
    ? healthInput.circuitBreaker
    : healthInput.circuit && typeof healthInput.circuit === "object"
      ? healthInput.circuit
      : {};
  const state = HEALTH_SIGNAL_STATES.has(providerInput.state)
    ? providerInput.state
    : HEALTH_SIGNAL_STATES.has(providerInput.status)
      ? providerInput.status
      : "healthy";
  const circuitState = CIRCUIT_STATES.has(circuitInput.state)
    ? circuitInput.state
    : CIRCUIT_STATES.has(circuitInput.status)
      ? circuitInput.status
      : "closed";
  const retryAfterMs = Number.isInteger(providerInput.retryAfterMs)
    ? Math.max(0, providerInput.retryAfterMs)
    : Number.isInteger(healthInput.retryAfterMs)
      ? Math.max(0, healthInput.retryAfterMs)
      : 0;
  const consecutiveFailures = Number.isInteger(providerInput.consecutiveFailures)
    ? Math.max(0, providerInput.consecutiveFailures)
    : Number.isInteger(healthInput.consecutiveFailures)
      ? Math.max(0, healthInput.consecutiveFailures)
      : 0;
  const circuitOpenedUntil = asIso(circuitInput.openUntil || circuitInput.openedUntil || healthInput.circuitOpenUntil, null);
  const circuitOpenActive = circuitState === "open"
    && (!circuitOpenedUntil || Date.parse(circuitOpenedUntil) > Date.parse(now));
  const lastErrorInput = providerInput.lastError && typeof providerInput.lastError === "object"
    ? providerInput.lastError
    : healthInput.lastError && typeof healthInput.lastError === "object"
      ? healthInput.lastError
      : null;
  const lastError = lastErrorInput
    ? {
        code: typeof lastErrorInput.code === "string" && lastErrorInput.code.trim()
          ? stableClientKey(lastErrorInput.code.trim()).toUpperCase()
          : "FS_READ_PROVIDER_HEALTH",
        message: typeof lastErrorInput.message === "string" && lastErrorInput.message.trim()
          ? lastErrorInput.message.trim()
          : "fs-read provider health probe reported an error",
        at: asIso(lastErrorInput.at || lastErrorInput.observedAt, null),
        retryable: lastErrorInput.retryable !== false
      }
    : null;

  return {
    contract: "fs-read-operational-health-input.v1",
    schemaVersion: 1,
    generatedAt: now,
    observed: Object.keys(healthInput).length > 0,
    providerId: typeof providerInput.providerId === "string" && providerInput.providerId.trim()
      ? providerInput.providerId.trim()
      : provider.providerId,
    state,
    serviceLevelHint: state === "healthy" ? "nominal" : state === "degraded" ? "degraded" : "unavailable",
    degradedModeAllowed: healthInput.degradedMode === true || providerInput.degradedMode === true,
    retryAfterMs,
    nextRetryAt: retryAfterMs > 0 ? asIso(new Date(Date.parse(now) + retryAfterMs), now) : null,
    consecutiveFailures,
    lastSuccessAt: asIso(providerInput.lastSuccessAt || healthInput.lastSuccessAt, null),
    lastFailureAt: asIso(providerInput.lastFailureAt || healthInput.lastFailureAt, null),
    lastError,
    circuitBreaker: {
      state: circuitState,
      openActive: circuitOpenActive,
      openedUntil: circuitOpenedUntil,
      halfOpenProbeAllowed: circuitState === "half-open" && healthInput.allowHalfOpenProbe !== false,
      reason: typeof circuitInput.reason === "string" && circuitInput.reason.trim() ? circuitInput.reason.trim() : null
    },
    proof: {
      providerMatched: !providerInput.providerId || providerInput.providerId === provider.providerId,
      retryAfterBounded: retryAfterMs <= 5 * 60 * 1000,
      circuitStateAccepted: CIRCUIT_STATES.has(circuitState),
      healthStateAccepted: HEALTH_SIGNAL_STATES.has(state),
      evaluatedAt: now
    }
  };
}

function buildRetryBackoff(nextStep, readiness, recoveryPlan, validationSummary, healthProbe, now) {
  const retryableValidation = validationSummary.items.map((item) => classifyActionableError(item, nextStep)).some((item) => item.retryable);
  const healthRetryable = healthProbe.circuitBreaker.openActive
    || healthProbe.state === "degraded"
    || healthProbe.state === "unhealthy"
    || (healthProbe.lastError?.retryable === true);
  const retryable = readiness.queueable
    || recoveryPlan.state === "resume-dispatch"
    || recoveryPlan.state === "resume-schedule"
    || retryableValidation
    || healthRetryable
    || RETRYABLE_ACTIONS.has(nextStep.action);
  const baseDelayMs = nextStep.action === "fix-provider-contract"
    ? 2000
    : readiness.queueable
      ? 1000
      : recoveryPlan.state.startsWith("resume-")
        ? 500
        : healthProbe.retryAfterMs > 0
          ? healthProbe.retryAfterMs
          : healthProbe.consecutiveFailures > 0
            ? Math.min(30000, 1000 * 2 ** Math.min(5, healthProbe.consecutiveFailures - 1))
            : 0;
  const maxAttempts = nextStep.action === "fix-provider-contract"
    ? 3
    : readiness.queueable || recoveryPlan.state.startsWith("resume-")
      ? 5
      : healthRetryable
        ? 4
        : 0;
  const nextRetryAt = healthProbe.circuitBreaker.openActive && healthProbe.circuitBreaker.openedUntil
    ? healthProbe.circuitBreaker.openedUntil
    : healthProbe.nextRetryAt || (retryable && baseDelayMs > 0 ? asIso(new Date(Date.parse(now) + baseDelayMs), now) : null);

  return {
    contract: "fs-read-retry-backoff.v1",
    retryable,
    strategy: retryable ? "bounded-exponential" : "none",
    attempt: Math.min(healthProbe.consecutiveFailures, maxAttempts),
    maxAttempts,
    baseDelayMs,
    maxDelayMs: retryable ? Math.max(baseDelayMs, 1000) * 8 : 0,
    jitter: retryable ? "request-key" : "none",
    nextRetryAt,
    stopConditions: [
      "validation-summary-ready",
      "readiness-dispatch-ready",
      "provider-health-restored",
      "circuit-breaker-closed",
      "non-retryable-actionable-error",
      "retry-budget-exhausted"
    ]
  };
}

function buildOperationalHealth({
  validationSummary,
  providerContract,
  capabilityNegotiation,
  readGate,
  readiness,
  nextStep,
  recoveryPlan,
  statePersistence,
  syncMetadata,
  clientRuntime,
  providerAcknowledgement,
  hostedKernelReadResult,
  providerResultCommit,
  healthProbe,
  now
}) {
  const actionableErrors = validationSummary.items.length
    ? validationSummary.items.map((item) => classifyActionableError(item, nextStep))
    : [];
  const degradedReasons = [
    ...(capabilityNegotiation.missing.length ? [`missing capabilities: ${capabilityNegotiation.missing.join(", ")}`] : []),
    ...(syncMetadata.stale ? ["provider sync watermark is stale"] : []),
    ...(recoveryPlan.state === "reconcile" ? ["persisted dispatch requires reconciliation"] : []),
    ...(statePersistence.restartSafe ? [] : ["next persisted state is not restart-safe"]),
    ...(readGate.tenantBoundary?.observed && readGate.tenantBoundary.mode === "monitor" ? ["tenant boundary is observing without enforcement"] : []),
    ...(providerAcknowledgement.state === "deferred" ? ["provider acknowledgement deferred fs-read handoff"] : []),
    ...(hostedKernelReadResult.state === "partial" ? ["provider returned a partial fs-read result"] : []),
    ...(providerResultCommit.commitAdmission?.state === "blocked" ? ["provider result commit admission is blocked"] : []),
    ...(providerResultCommit.state === "awaiting-acknowledgement" ? ["provider result commit is waiting for acknowledgement"] : []),
    ...(providerResultCommit.state === "awaiting-result" && readiness.ready ? ["provider result commit is waiting for hosted-kernel result"] : []),
    ...(healthProbe.state === "degraded" ? ["provider health probe reports degraded fs-read service"] : []),
    ...(healthProbe.degradedModeAllowed && healthProbe.state !== "healthy" ? ["degraded mode is explicitly allowed by runtime health input"] : [])
  ];
  const failureState = actionableErrors.length
    ? "validation-failed"
    : healthProbe.circuitBreaker.openActive
      ? "provider-circuit-open"
      : healthProbe.state === "offline"
        ? "provider-offline"
        : healthProbe.state === "unhealthy" && !healthProbe.degradedModeAllowed
          ? "provider-unhealthy"
    : providerAcknowledgement.state === "rejected"
      ? "provider-acknowledgement-rejected"
      : hostedKernelReadResult.state === "rejected"
        ? "provider-result-rejected"
        : providerResultCommit.commitAdmission?.state === "blocked"
          ? "provider-result-commit-admission-blocked"
        : providerResultCommit.state === "blocked"
          ? "provider-result-commit-blocked"
    : recoveryPlan.state === "reconcile"
      ? "recovery-required"
      : degradedReasons.length
        ? "degraded"
        : readiness.ready
          ? "healthy"
          : readiness.queueable
            ? "scheduled"
            : "blocked";
  const retry = buildRetryBackoff(nextStep, readiness, recoveryPlan, validationSummary, healthProbe, now);
  const serviceLevel = failureState === "healthy"
    ? "nominal"
    : failureState === "scheduled" || failureState === "degraded"
      ? "degraded"
      : "unavailable";

  return {
    contract: "fs-read-operational-health.v1",
    schemaVersion: 1,
    generatedAt: now,
    serviceLevel,
    state: failureState,
    degraded: serviceLevel === "degraded",
    dispatchable: readiness.ready,
    queueable: readiness.queueable,
    retry,
    providerHealth: {
      observed: healthProbe.observed,
      providerId: healthProbe.providerId,
      state: healthProbe.state,
      serviceLevelHint: healthProbe.serviceLevelHint,
      degradedModeAllowed: healthProbe.degradedModeAllowed,
      consecutiveFailures: healthProbe.consecutiveFailures,
      lastSuccessAt: healthProbe.lastSuccessAt,
      lastFailureAt: healthProbe.lastFailureAt,
      lastError: healthProbe.lastError,
      circuitBreaker: healthProbe.circuitBreaker,
      proof: healthProbe.proof
    },
    degradedMode: {
      active: healthProbe.degradedModeAllowed && ["degraded", "unhealthy"].includes(healthProbe.state) && !healthProbe.circuitBreaker.openActive,
      dispatchAllowed: readiness.ready && (healthProbe.state === "healthy" || healthProbe.state === "degraded" || healthProbe.degradedModeAllowed),
      reason: healthProbe.state === "healthy"
        ? null
        : healthProbe.circuitBreaker.openActive
          ? "provider circuit breaker is open"
          : healthProbe.degradedModeAllowed
            ? "runtime allowed degraded fs-read dispatch"
            : healthProbe.lastError?.message || `provider health is ${healthProbe.state}`
    },
    failure: failureState === "healthy" || failureState === "scheduled"
      ? null
      : {
          state: failureState,
          route: healthProbe.circuitBreaker.openActive || healthProbe.state !== "healthy" ? "client://fs-read/operational-health" : nextStep.route,
          reason: actionableErrors[0]?.message || healthProbe.lastError?.message || providerAcknowledgement.errors[0] || hostedKernelReadResult.errors[0] || degradedReasons[0] || readiness.reason,
          actionable: actionableErrors[0] || (healthProbe.state !== "healthy"
            ? {
                code: healthProbe.lastError?.code || "FS_READ_PROVIDER_HEALTH",
                source: "provider-health",
                message: healthProbe.lastError?.message || `provider health is ${healthProbe.state}`,
                retryable: healthProbe.state !== "offline" || healthProbe.retryAfterMs > 0 || healthProbe.circuitBreaker.openActive,
                action: healthProbe.circuitBreaker.openActive
                  ? "Wait for the provider circuit breaker to half-open or close before retrying."
                  : "Refresh provider health or route fs-read to a healthy provider.",
                route: "client://fs-read/operational-health"
              }
            : null)
        },
    actionableErrors,
    degradedReasons,
    probes: {
      settingsValidation: validationSummary.checks.settings,
      providerContract: validationSummary.checks.provider,
      readRequest: readGate.status,
      tenantBoundaryDecision: readGate.tenantBoundary?.decision || "not-evaluated",
      tenantBoundaryMode: readGate.tenantBoundary?.mode || "none",
      capabilityMode: capabilityNegotiation.mode,
      providerHandoffMode: providerContract.serviceContract.handoffMode,
      providerServiceMaxBytes: providerContract.serviceContract.maxBytes,
      recoveryState: recoveryPlan.state,
      persistenceStatus: statePersistence.status,
      clientRuntimeState: clientRuntime.state,
      providerObservedAt: providerContract.sync.observedAt,
      providerAcknowledgementState: providerAcknowledgement.state,
      providerAcknowledgementRequired: providerAcknowledgement.required,
      providerAcknowledgementReceived: providerAcknowledgement.received,
      hostedKernelReadResultState: hostedKernelReadResult.state,
      hostedKernelReadResultReceived: hostedKernelReadResult.received,
      hostedKernelReadResultBytes: hostedKernelReadResult.byteRange.returnedLength,
      providerResultCommitState: providerResultCommit.state,
      providerResultCommitReady: providerResultCommit.commitReady,
      providerResultCommitAdmissionState: providerResultCommit.commitAdmission?.state || "unknown",
      providerResultCommitAdmitted: providerResultCommit.commitAdmission?.commitAdmitted === true,
      providerResultCommitCursorAdvanced: providerResultCommit.syncCommit.advanced,
      providerHealthState: healthProbe.state,
      providerCircuitState: healthProbe.circuitBreaker.state,
      providerCircuitOpenActive: healthProbe.circuitBreaker.openActive,
      degradedModeActive: healthProbe.degradedModeAllowed && healthProbe.state !== "healthy"
    },
    proof: [
      { check: "validation", status: validationSummary.status, errors: validationSummary.errorCount },
      { check: "readiness", status: readiness.state, route: nextStep.route },
      { check: "recovery", status: recoveryPlan.state, resumeSafe: recoveryPlan.resumeSafe },
      { check: "retry-policy", status: retry.retryable ? "retryable" : "terminal", maxAttempts: retry.maxAttempts },
      {
        check: "provider-acknowledgement",
        status: providerAcknowledgement.state,
        required: providerAcknowledgement.required,
        errors: providerAcknowledgement.errors.length
      },
      {
        check: "hosted-kernel-read-result",
        status: hostedKernelReadResult.state,
        received: hostedKernelReadResult.received,
        bytes: hostedKernelReadResult.byteRange.returnedLength,
        errors: hostedKernelReadResult.errors.length
      },
      {
        check: "provider-result-commit",
        status: providerResultCommit.state,
        ready: providerResultCommit.commitReady,
        admission: providerResultCommit.commitAdmission?.state || "unknown",
        errors: providerResultCommit.errors.length,
        committedCursor: providerResultCommit.syncCommit.committedCursor
      },
      {
        check: "tenant-boundary",
        status: readGate.tenantBoundary?.decision || "not-evaluated",
        mode: readGate.tenantBoundary?.mode || "none",
        errors: readGate.tenantBoundary?.errors.length || 0
      },
      {
        check: "provider-health",
        status: healthProbe.state,
        circuit: healthProbe.circuitBreaker.state,
        retryAfterMs: healthProbe.retryAfterMs,
        consecutiveFailures: healthProbe.consecutiveFailures,
        degradedModeAllowed: healthProbe.degradedModeAllowed
      },
      { check: "degraded-mode", status: serviceLevel, reasons: degradedReasons }
    ]
  };
}

function incrementCountMap(map, key, amount = 1) {
  const normalizedKey = stableClientKey(key);
  return {
    ...map,
    [normalizedKey]: toNonNegativeInteger(map[normalizedKey], 0) + amount
  };
}

function buildAnalyticsExportState({
  analyticsState,
  clientContext,
  providerContract,
  readGate,
  validationSummary,
  readiness,
  nextStep,
  recoveryPlan,
  operationalHealth,
  providerAcknowledgement,
  hostedKernelReadResult,
  providerResultCommit,
  now
}) {
  const validationErrorCodes = validationSummary.items.map((item) => classifyPolicyErrorCode(item.message));
  const readGateErrorCodes = readGate.errors.map((message) => classifyPolicyErrorCode(message));
  const actionableErrorCodes = operationalHealth.actionableErrors.map((error) => error.code);
  const errorCodes = uniqueStrings([...actionableErrorCodes, ...validationErrorCodes, ...readGateErrorCodes]);
  const resultState = hostedKernelReadResult.state;
  const resultReturnedBytes = hostedKernelReadResult.byteRange.returnedLength;
  const resultAwaiting = resultState === "awaiting-provider-result";
  const commitReady = providerResultCommit.commitReady === true;
  const commitBlocked = providerResultCommit.state === "blocked"
    || providerResultCommit.state === "awaiting-acknowledgement"
    || providerResultCommit.commitAdmission?.state === "blocked";
  const encodedPathBlocked = readGate.encodedPathPolicy?.blocked === true;
  const hiddenPathBlocked = readGate.errors.some((error) => error.includes("hidden path reads"));
  const deniedGlobBlocked = Boolean(readGate.deniedGlobMatch)
    || readGate.errors.some((error) => error.includes("deniedGlob"));
  const policyBlocked = validationSummary.items.some((item) => item.source === "read-request")
    || encodedPathBlocked
    || hiddenPathBlocked
    || deniedGlobBlocked
    || readGate.tenantBoundary?.decision === "blocked"
    || readGate.workspaceScope?.decision === "blocked";
  const state = readiness.ready
    ? "dispatch-ready"
    : readiness.queueable
      ? "scheduled"
      : "blocked";
  const snapshot = {
    at: now,
    requestId: clientContext.requestId,
    workflowId: clientContext.workflowId,
    providerId: providerContract.providerId,
    channel: clientContext.channel,
    state,
    serviceLevel: operationalHealth.serviceLevel,
    route: nextStep.route,
    path: readGate.path || null,
    root: readGate.matchedRoot || null,
    tenantId: readGate.tenantBoundary?.tenantId || clientContext.tenantIdentity.tenantId || null,
    tenantBoundaryDecision: readGate.tenantBoundary?.decision || "not-evaluated",
    bytes: readGate.bytes,
    ready: readiness.ready,
    queueable: readiness.queueable,
    degraded: operationalHealth.degraded,
    providerAcknowledgementState: providerAcknowledgement.state,
    hostedKernelReadResultState: resultState,
    resultReceived: hostedKernelReadResult.received,
    bytesReturned: resultReturnedBytes,
    providerResultCommitState: providerResultCommit.state,
    providerResultCommitReady: commitReady,
    providerResultCommitAdmissionState: providerResultCommit.commitAdmission?.state || "unknown",
    providerResultCommitAdmitted: providerResultCommit.commitAdmission?.commitAdmitted === true,
    policyBlocked,
    policyBlockTypes: uniqueStrings([
      ...(encodedPathBlocked ? ["encoded-path"] : []),
      ...(hiddenPathBlocked ? ["hidden-path"] : []),
      ...(deniedGlobBlocked ? ["denied-glob"] : []),
      ...(readGate.tenantBoundary?.decision === "blocked" ? ["tenant-boundary"] : []),
      ...(readGate.workspaceScope?.decision === "blocked" ? ["tenant-workspace-scope"] : []),
      ...readGateErrorCodes
    ]),
    recoveryState: recoveryPlan.state,
    errorCodes
  };
  const counters = {
    ...analyticsState.counters,
    totalRequests: analyticsState.counters.totalRequests + 1,
    dispatchReady: analyticsState.counters.dispatchReady + (readiness.ready ? 1 : 0),
    blockedRequests: analyticsState.counters.blockedRequests + (!readiness.ready && !readiness.queueable ? 1 : 0),
    scheduledRequests: analyticsState.counters.scheduledRequests + (readiness.queueable ? 1 : 0),
    degradedRequests: analyticsState.counters.degradedRequests + (operationalHealth.degraded ? 1 : 0),
    recoveryRequired: analyticsState.counters.recoveryRequired + (recoveryPlan.state === "reconcile" ? 1 : 0),
    validationErrors: analyticsState.counters.validationErrors + validationSummary.errorCount,
    policyBlocked: analyticsState.counters.policyBlocked + (policyBlocked ? 1 : 0),
    encodedPathBlocks: analyticsState.counters.encodedPathBlocks + (encodedPathBlocked ? 1 : 0),
    hiddenPathBlocks: analyticsState.counters.hiddenPathBlocks + (hiddenPathBlocked ? 1 : 0),
    deniedGlobBlocks: analyticsState.counters.deniedGlobBlocks + (deniedGlobBlocked ? 1 : 0),
    missingCapabilityEvents: analyticsState.counters.missingCapabilityEvents + (readGate.errors.some((error) => error.includes("unavailable capabilities")) ? 1 : 0),
    tenantBoundaryBlocks: analyticsState.counters.tenantBoundaryBlocks + (readGate.tenantBoundary?.decision === "blocked" ? 1 : 0),
    bytesAccepted: analyticsState.counters.bytesAccepted + (readiness.ready ? readGate.bytes : 0),
    providerAckAwaiting: analyticsState.counters.providerAckAwaiting + (providerAcknowledgement.state === "awaiting" ? 1 : 0),
    providerAckAccepted: analyticsState.counters.providerAckAccepted + (providerAcknowledgement.state === "accepted" ? 1 : 0),
    providerAckRejected: analyticsState.counters.providerAckRejected + (providerAcknowledgement.state === "rejected" ? 1 : 0),
    providerResultAwaiting: analyticsState.counters.providerResultAwaiting + (resultAwaiting ? 1 : 0),
    providerResultFulfilled: analyticsState.counters.providerResultFulfilled + (resultState === "fulfilled" ? 1 : 0),
    providerResultPartial: analyticsState.counters.providerResultPartial + (resultState === "partial" ? 1 : 0),
    providerResultRejected: analyticsState.counters.providerResultRejected + (resultState === "rejected" ? 1 : 0),
    providerResultCommitted: analyticsState.counters.providerResultCommitted + (commitReady ? 1 : 0),
    providerResultCommitBlocked: analyticsState.counters.providerResultCommitBlocked + (commitBlocked ? 1 : 0),
    bytesReturned: analyticsState.counters.bytesReturned + resultReturnedBytes
  };
  const dimensions = {
    byChannel: incrementCountMap(analyticsState.dimensions.byChannel, clientContext.channel),
    byRoot: incrementCountMap(analyticsState.dimensions.byRoot, readGate.matchedRoot || "outside-policy"),
    byTenant: incrementCountMap(analyticsState.dimensions.byTenant, readGate.tenantBoundary?.tenantId || "unscoped"),
    byProvider: incrementCountMap(analyticsState.dimensions.byProvider, providerContract.providerId),
    byAction: incrementCountMap(analyticsState.dimensions.byAction, nextStep.action),
    byErrorCode: errorCodes.reduce(
      (summary, code) => incrementCountMap(summary, code),
      { ...analyticsState.dimensions.byErrorCode }
    )
  };
  const snapshots = [...analyticsState.snapshots, snapshot].slice(-30);
  const previousSnapshot = snapshots.length > 1 ? snapshots.at(-2) : null;
  const timeline = snapshots.map((entry, index) => ({
    index,
    at: entry.at,
    state: entry.state,
    serviceLevel: entry.serviceLevel,
    route: entry.route,
    requestId: entry.requestId,
    providerId: entry.providerId,
    root: entry.root,
    tenantId: entry.tenantId,
    tenantBoundaryDecision: entry.tenantBoundaryDecision,
    bytes: entry.bytes,
    hostedKernelReadResultState: entry.hostedKernelReadResultState,
    resultReceived: entry.resultReceived,
    bytesReturned: entry.bytesReturned,
    recoveryState: entry.recoveryState,
    providerAcknowledgementState: entry.providerAcknowledgementState,
    providerResultCommitState: entry.providerResultCommitState,
    providerResultCommitReady: entry.providerResultCommitReady,
    providerResultCommitAdmissionState: entry.providerResultCommitAdmissionState,
    providerResultCommitAdmitted: entry.providerResultCommitAdmitted,
    policyBlocked: entry.policyBlocked,
    policyBlockTypes: entry.policyBlockTypes,
    errors: entry.errorCodes.length
  }));
  const dispatchRate = counters.totalRequests > 0 ? counters.dispatchReady / counters.totalRequests : 0;
  const blockedRate = counters.totalRequests > 0 ? counters.blockedRequests / counters.totalRequests : 0;
  const policyBlockRate = counters.totalRequests > 0 ? counters.policyBlocked / counters.totalRequests : 0;
  const resultCompletionAttempts = counters.providerResultFulfilled + counters.providerResultPartial + counters.providerResultRejected;
  const resultCompletionRate = resultCompletionAttempts > 0
    ? counters.providerResultFulfilled / resultCompletionAttempts
    : 0;
  const commitSuccessRate = resultCompletionAttempts > 0
    ? counters.providerResultCommitted / resultCompletionAttempts
    : 0;
  const byteYieldRate = counters.bytesAccepted > 0 ? counters.bytesReturned / counters.bytesAccepted : 0;
  const latestTransition = previousSnapshot
    ? {
        from: previousSnapshot.state,
        to: snapshot.state,
        serviceLevelChanged: previousSnapshot.serviceLevel !== snapshot.serviceLevel,
        acknowledgementChanged: previousSnapshot.providerAcknowledgementState !== snapshot.providerAcknowledgementState,
        resultChanged: previousSnapshot.hostedKernelReadResultState !== snapshot.hostedKernelReadResultState,
        commitChanged: previousSnapshot.providerResultCommitState !== snapshot.providerResultCommitState,
        commitAdmissionChanged: previousSnapshot.providerResultCommitAdmissionState !== snapshot.providerResultCommitAdmissionState,
        policyBlockChanged: previousSnapshot.policyBlocked !== snapshot.policyBlocked,
        bytesReturnedDelta: snapshot.bytesReturned - previousSnapshot.bytesReturned,
        at: now
      }
    : null;
  const exportRecords = snapshots.map((entry) => ({
    recordType: "fs-read-decision",
    at: entry.at,
    requestId: entry.requestId,
    workflowId: entry.workflowId,
    providerId: entry.providerId,
    channel: entry.channel,
    state: entry.state,
    serviceLevel: entry.serviceLevel,
    route: entry.route,
    root: entry.root,
    tenantId: entry.tenantId,
    ready: entry.ready,
    queueable: entry.queueable,
    degraded: entry.degraded,
    policyBlocked: entry.policyBlocked,
    policyBlockTypes: entry.policyBlockTypes,
    providerAcknowledgementState: entry.providerAcknowledgementState,
    hostedKernelReadResultState: entry.hostedKernelReadResultState,
    providerResultCommitState: entry.providerResultCommitState,
    providerResultCommitAdmissionState: entry.providerResultCommitAdmissionState,
    bytes: entry.bytes,
    bytesReturned: entry.bytesReturned,
    recoveryState: entry.recoveryState,
    errorCodes: entry.errorCodes
  }));
  const reportWindow = {
    contract: "fs-read-analytics-report-window.v1",
    firstSnapshotAt: snapshots[0]?.at || now,
    lastSnapshotAt: snapshots.at(-1)?.at || now,
    retainedSnapshots: snapshots.length,
    latestTransition,
    latestOutcome: {
      requestId: snapshot.requestId,
      state: snapshot.state,
      serviceLevel: snapshot.serviceLevel,
      providerAcknowledgementState: snapshot.providerAcknowledgementState,
      hostedKernelReadResultState: snapshot.hostedKernelReadResultState,
      providerResultCommitState: snapshot.providerResultCommitState,
      providerResultCommitReady: snapshot.providerResultCommitReady,
      providerResultCommitAdmissionState: snapshot.providerResultCommitAdmissionState,
      providerResultCommitAdmitted: snapshot.providerResultCommitAdmitted,
      policyBlocked: snapshot.policyBlocked,
      policyBlockTypes: snapshot.policyBlockTypes,
      resultReceived: snapshot.resultReceived,
      bytesReturned: snapshot.bytesReturned,
      recoveryState: snapshot.recoveryState
    }
  };

  return {
    contract: "fs-read-analytics-export.v1",
    schemaVersion: 1,
    generatedAt: now,
    counters,
    dimensions,
    latestSnapshot: snapshot,
    history: {
      contract: "fs-read-history-snapshots.v1",
      retention: "last-30-decisions",
      count: snapshots.length,
      snapshots
    },
    timeline: {
      contract: "fs-read-reporting-timeline.v1",
      count: timeline.length,
      entries: timeline,
      transition: latestTransition
    },
    reportWindow,
    exportSummary: {
      contract: "fs-read-export-summary.v1",
      exportReady: true,
      formats: ["jsonl", "summary-json"],
      redaction: "path retained for kernel audit; hidden file leaf redacted in preview contract",
      records: exportRecords,
      recordCount: exportRecords.length,
      totals: {
        requests: counters.totalRequests,
        dispatchReady: counters.dispatchReady,
        blocked: counters.blockedRequests,
        scheduled: counters.scheduledRequests,
        validationErrors: counters.validationErrors,
        policyBlocked: counters.policyBlocked,
        encodedPathBlocks: counters.encodedPathBlocks,
        hiddenPathBlocks: counters.hiddenPathBlocks,
        deniedGlobBlocks: counters.deniedGlobBlocks,
        tenantBoundaryBlocks: counters.tenantBoundaryBlocks,
        bytesAccepted: counters.bytesAccepted,
        providerAckAwaiting: counters.providerAckAwaiting,
        providerAckAccepted: counters.providerAckAccepted,
        providerAckRejected: counters.providerAckRejected,
        providerResultAwaiting: counters.providerResultAwaiting,
        providerResultFulfilled: counters.providerResultFulfilled,
        providerResultPartial: counters.providerResultPartial,
        providerResultRejected: counters.providerResultRejected,
        providerResultCommitted: counters.providerResultCommitted,
        providerResultCommitBlocked: counters.providerResultCommitBlocked,
        bytesReturned: counters.bytesReturned
      },
      rates: {
        dispatchReady: Number(dispatchRate.toFixed(4)),
        blocked: Number(blockedRate.toFixed(4)),
        policyBlocked: Number(policyBlockRate.toFixed(4)),
        providerResultCompletion: Number(resultCompletionRate.toFixed(4)),
        providerResultCommit: Number(commitSuccessRate.toFixed(4)),
        byteYield: Number(byteYieldRate.toFixed(4))
      },
      topDimensions: {
        channel: Object.entries(dimensions.byChannel).sort((a, b) => b[1] - a[1]).slice(0, 5),
        root: Object.entries(dimensions.byRoot).sort((a, b) => b[1] - a[1]).slice(0, 5),
        tenant: Object.entries(dimensions.byTenant).sort((a, b) => b[1] - a[1]).slice(0, 5),
        provider: Object.entries(dimensions.byProvider).sort((a, b) => b[1] - a[1]).slice(0, 5),
        errorCode: Object.entries(dimensions.byErrorCode).sort((a, b) => b[1] - a[1]).slice(0, 5)
      }
    },
    reportingState: {
      contract: "fs-read-reporting-state.v1",
      state: operationalHealth.serviceLevel === "unavailable" || resultState === "rejected" ? "attention" : "ready",
      route: "kernel://syscall-layer/fs-read/analytics/export",
      nextReportAt: now,
      labels: [surfaceGroup, surfaceName, providerContract.providerId, clientContext.channel],
      window: {
        firstSnapshotAt: reportWindow.firstSnapshotAt,
        lastSnapshotAt: reportWindow.lastSnapshotAt,
        retainedSnapshots: reportWindow.retainedSnapshots
      },
      proof: {
        requestId: clientContext.requestId,
        latestState: snapshot.state,
        serviceLevel: operationalHealth.serviceLevel,
        providerAcknowledgementState: providerAcknowledgement.state,
        hostedKernelReadResultState: resultState,
        providerResultCommitState: providerResultCommit.state,
        providerResultCommitAdmissionState: providerResultCommit.commitAdmission?.state || "unknown",
        policyBlocked,
        bytesReturned: resultReturnedBytes,
        sourceSnapshotCount: snapshots.length,
        counterVersion: counters.totalRequests
      }
    }
  };
}

function buildPreview(settings, provider, capabilityNegotiation, readGate, syncMetadata) {
  const previewState = readGate.status === "ready" ? "renderable" : "blocked";
  const redactedPath = readGate.path
    ? readGate.path.replace(/\/([^/.][^/]*)$/u, "/$1").replace(/\/\.[^/]+$/u, "/[hidden]")
    : null;
  const rootPolicy = readGate.matchedRoot
    ? `within allowed root ${readGate.matchedRoot}`
    : "no allowed root matched";

  return {
    contract: "fs-read-preview.v1",
    state: previewState,
    title: readGate.path ? `Read ${readGate.path.split("/").filter(Boolean).pop() || "/"}` : "Read file",
    path: readGate.path || null,
    requestedPath: readGate.requestedPath || readGate.path || null,
    redactedPath,
    offset: readGate.requestedOffset || 0,
    byteLimit: readGate.bytes,
    maxBytes: settings.maxBytes,
    rootPolicy,
    encodedPathPolicy: {
      encoded: readGate.encodedPathPolicy?.encoded === true,
      blocked: readGate.encodedPathPolicy?.blocked === true,
      hazards: readGate.encodedPathPolicy?.hazards || []
    },
    tenantBoundary: readGate.tenantBoundary
      ? {
          mode: readGate.tenantBoundary.mode,
          decision: readGate.tenantBoundary.decision,
          tenantId: readGate.tenantBoundary.tenantId,
          workspaceId: readGate.tenantBoundary.workspaceId,
          matchedTenantRoot: readGate.tenantBoundary.matchedTenantRoot,
          requiredPermission: readGate.tenantBoundary.requiredPermission
        }
      : null,
    workspaceScope: readGate.workspaceScope
      ? {
          decision: readGate.workspaceScope.decision,
          constrained: readGate.workspaceScope.constrained,
          matchedEffectiveRoot: readGate.workspaceScope.matchedEffectiveRoot,
          effectiveRootCount: readGate.workspaceScope.effectiveRoots.length
        }
      : null,
    hiddenAllowed: settings.allowHidden,
    provider: {
      providerId: provider.providerId,
      service: provider.service,
      protocol: provider.protocol,
      handoffMode: provider.serviceContract.handoffMode,
      providerMaxBytes: provider.serviceContract.maxBytes
    },
    capabilitySummary: {
      mode: capabilityNegotiation.mode,
      granted: capabilityNegotiation.granted,
      missing: capabilityNegotiation.missing
    },
    sync: {
      consistency: syncMetadata.consistency,
      cursor: syncMetadata.cursor,
      stale: syncMetadata.stale
    },
    userMessage: previewState === "renderable"
      ? `Ready to preview up to ${readGate.bytes} bytes from ${readGate.path}.`
      : readGate.errors[0] || "Read preview is blocked by policy."
  };
}

function buildValidationSummary(normalizedErrors, commandErrors, providerErrors, readGate) {
  const items = [
    ...normalizedErrors.map((message) => ({ source: "settings", message })),
    ...commandErrors.map((message) => ({ source: "lifecycle", message })),
    ...providerErrors.map((message) => ({ source: "provider", message })),
    ...readGate.errors.map((message) => ({ source: "read-request", message }))
  ];
  const bySource = items.reduce((summary, item) => {
    summary[item.source] = (summary[item.source] || 0) + 1;
    return summary;
  }, {});
  const status = items.length ? "blocked" : "ready";

  return {
    contract: "fs-read-validation-summary.v1",
    status,
    severity: VALIDATION_SEVERITY[status],
    errorCount: items.length,
    bySource,
    items,
    firstError: items[0]?.message || null,
    checks: {
      settings: normalizedErrors.length ? "failed" : "passed",
      lifecycle: commandErrors.length ? "failed" : "passed",
      provider: providerErrors.length ? "failed" : "passed",
      readRequest: readGate.errors.length ? "failed" : "passed",
      tenantBoundary: readGate.tenantBoundary?.errors.length ? "failed" : "passed",
      tenantWorkspaceScope: readGate.workspaceScope?.errors.length ? "failed" : "passed"
    }
  };
}

function buildAcceptanceContract(settings, provider, capabilityNegotiation, readGate, validationSummary) {
  const requiredProofs = ["allowed-root", "encoded-path-policy", "tenant-boundary", "tenant-workspace-scope", "provider-capability", "byte-limit", "provider-service-contract"].map((proof) => ({
    proof,
    satisfied: proof === "allowed-root"
      ? Boolean(readGate.matchedRoot)
      : proof === "encoded-path-policy"
        ? readGate.encodedPathPolicy?.blocked !== true
        : proof === "tenant-boundary"
        ? !readGate.tenantBoundary || readGate.tenantBoundary.decision === "allowed"
        : proof === "tenant-workspace-scope"
          ? !readGate.workspaceScope || readGate.workspaceScope.decision === "allowed"
          : proof === "provider-capability"
            ? capabilityNegotiation.missing.length === 0
            : proof === "provider-service-contract"
              ? provider.serviceContract.operations.includes("fs.read") && readGate.bytes <= provider.serviceContract.maxBytes
              : readGate.bytes <= settings.maxBytes
  }));
  const accepted = validationSummary.status === "ready"
    && settings.lifecycle === "active"
    && requiredProofs.every((proof) => proof.satisfied);

  return {
    contract: "fs-read-acceptance.v1",
    accepted,
    acceptanceState: accepted ? "accepted" : "needs-action",
    acceptedAt: accepted ? provider.sync.observedAt : null,
    providerId: provider.providerId,
    protocol: provider.protocol,
    serviceContract: {
      operation: "fs.read",
      handoffMode: provider.serviceContract.handoffMode,
      maxBytes: provider.serviceContract.maxBytes,
      proofModes: provider.serviceContract.proofModes
    },
    request: {
      path: readGate.path || null,
      bytes: readGate.bytes,
      offset: readGate.requestedOffset || 0,
      root: readGate.matchedRoot,
      tenantBoundary: readGate.tenantBoundary
        ? {
            mode: readGate.tenantBoundary.mode,
            tenantId: readGate.tenantBoundary.tenantId,
            workspaceId: readGate.tenantBoundary.workspaceId,
            decision: readGate.tenantBoundary.decision,
            matchedTenantRoot: readGate.tenantBoundary.matchedTenantRoot
          }
        : null,
      workspaceScope: readGate.workspaceScope
        ? {
            decision: readGate.workspaceScope.decision,
            matchedEffectiveRoot: readGate.workspaceScope.matchedEffectiveRoot,
            effectiveRootCount: readGate.workspaceScope.effectiveRoots.length
          }
        : null
    },
    requiredProofs,
    blockingReasons: accepted ? [] : [
      ...validationSummary.items.map((item) => item.message),
      ...(settings.lifecycle === "active" ? [] : [`lifecycle is ${settings.lifecycle}`])
    ]
  };
}

function buildReadinessContract(settings, readGate, nextAction, acceptance) {
  const ready = acceptance.accepted && nextAction.type === "dispatch-read";
  const queueable = acceptance.accepted && ["wait-until", "enqueue-interval"].includes(nextAction.type);

  return {
    contract: "fs-read-readiness.v1",
    state: ready ? "ready" : queueable ? "scheduled" : "blocked",
    ready,
    queueable,
    lifecycle: settings.lifecycle,
    schedule: settings.schedule,
    dispatch: {
      allowed: ready,
      operation: "fs.read",
      path: readGate.path || null,
      bytes: readGate.bytes,
      offset: readGate.requestedOffset || 0,
      tenantBoundaryDecision: readGate.tenantBoundary?.decision || "not-evaluated",
      workspaceScopeDecision: readGate.workspaceScope?.decision || "not-evaluated",
      effectiveRoot: readGate.workspaceScope?.matchedEffectiveRoot || readGate.matchedRoot || null
    },
    reason: ready
      ? "accepted read request can be dispatched now"
      : nextAction.reason || acceptance.blockingReasons[0] || "read request is not dispatchable"
  };
}

function buildScheduleControlsState(settings, nextAction, readiness, lifecycleErrors, now) {
  const scheduleNextRunAt = asIso(settings.schedule.nextRunAt, null);
  const nowMs = Date.parse(now);
  const nextRunMs = scheduleNextRunAt ? Date.parse(scheduleNextRunAt) : null;
  const due = settings.schedule.mode === "immediate"
    || (Number.isFinite(nextRunMs) && nextRunMs <= nowMs);
  const active = settings.lifecycle === "active";
  const queued = ["wait-until", "enqueue-interval"].includes(nextAction.type);
  const invalidReasons = [
    ...(lifecycleErrors || []),
    ...(settings.schedule.mode === "deferred" && !scheduleNextRunAt ? ["deferred schedule requires nextRunAt"] : []),
    ...(settings.schedule.mode === "interval" && settings.schedule.intervalMs < 1000 ? ["interval schedule requires intervalMs >= 1000"] : []),
    ...(settings.schedule.mode === "immediate" && scheduleNextRunAt ? ["immediate schedule must not retain nextRunAt"] : []),
    ...(settings.lifecycle === "disabled" && settings.schedule.mode !== "immediate" ? ["disabled lifecycle cannot hold queued schedules"] : [])
  ];
  const state = invalidReasons.length
    ? "invalid"
    : readiness.ready
      ? "dispatchable"
      : queued
        ? "queued"
        : settings.lifecycle === "paused"
          ? "paused"
          : "blocked";
  const nextRunDelayMs = Number.isFinite(nextRunMs) ? Math.max(0, nextRunMs - nowMs) : null;

  return {
    contract: "fs-read-schedule-controls-state.v1",
    mode: settings.schedule.mode,
    intervalMs: settings.schedule.intervalMs,
    nextRunAt: scheduleNextRunAt,
    nextRunDelayMs,
    due,
    active,
    queued,
    state,
    canDispatchNow: active && readiness.ready && due,
    canEnqueue: active && queued && invalidReasons.length === 0,
    canEditSchedule: settings.lifecycle !== "disabled",
    canClearSchedule: settings.schedule.mode !== "immediate" || Boolean(scheduleNextRunAt),
    nextAction: nextAction.type,
    validation: invalidReasons.length ? "blocked" : "accepted",
    errors: invalidReasons,
    proof: {
      lifecycle: settings.lifecycle,
      readiness: readiness.state,
      nextAction: nextAction.type,
      evaluatedAt: now
    }
  };
}

function buildLifecycleControlsContract(settings, lifecycle, nextAction, validationSummary, readiness, now) {
  const disabled = settings.lifecycle === "disabled";
  const paused = settings.lifecycle === "paused";
  const active = settings.lifecycle === "active";
  const lifecycleErrors = validationSummary.items.filter((item) => item.source === "lifecycle").map((item) => item.message);
  const settingsErrors = validationSummary.items.filter((item) => item.source === "settings").map((item) => item.message);
  const scheduleControls = buildScheduleControlsState(settings, nextAction, readiness, lifecycleErrors, now);
  const commandState = {
    enable: {
      enabled: disabled,
      reason: disabled ? "surface is disabled" : "surface is already enabled"
    },
    disable: {
      enabled: !disabled,
      reason: disabled ? "surface is already disabled" : "disable fs-read dispatch and scheduling"
    },
    pause: {
      enabled: active,
      reason: active ? "pause fs-read dispatch without disabling settings" : "surface must be active before it can be paused"
    },
    resume: {
      enabled: paused,
      reason: paused ? "resume paused fs-read dispatch" : "surface is not paused"
    },
    schedule: {
      enabled: !disabled && settingsErrors.length === 0 && lifecycleErrors.length === 0,
      reason: disabled
        ? "enable fs-read before scheduling"
        : settingsErrors[0] || lifecycleErrors[0] || "schedule the accepted read request"
    },
    configure: {
      enabled: true,
      reason: "update maxBytes, hidden-file policy, roots, denied globs, lifecycle, or schedule"
    }
  };

  return {
    contract: "fs-read-lifecycle-controls.v1",
    schemaVersion: 1,
    generatedAt: now,
    current: {
      lifecycle: settings.lifecycle,
      enabled: settings.enabled,
      command: lifecycle.command,
      commandAccepted: lifecycle.errors.length === 0,
      idempotency: lifecycle.idempotency || null
    },
    commands: commandState,
    settingsValidation: {
      state: settingsErrors.length ? "invalid" : "valid",
      errors: settingsErrors,
      constraints: {
        maxBytes: { min: 1, max: 16 * 1024 * 1024, value: settings.maxBytes },
        allowedRoots: { minItems: 1, absoluteOnly: true, value: settings.allowedRoots },
        deniedGlobs: { value: settings.deniedGlobs },
        allowHidden: { value: settings.allowHidden }
      }
    },
    scheduleControls,
    nextActionState: {
      action: nextAction.type,
      routeHint: nextAction.type === "revise-read-request"
        ? "client://fs-read/request-editor"
        : nextAction.type.startsWith("fix-") || ["enable", "resume"].includes(nextAction.type)
          ? "client://fs-read/configuration"
          : "kernel://syscall-layer/fs-read",
      blocked: !readiness.ready && !readiness.queueable,
      reason: readiness.reason,
      scheduleState: scheduleControls.state,
      dispatchEligible: scheduleControls.canDispatchNow,
      enqueueEligible: scheduleControls.canEnqueue
    },
    auditProof: {
      lifecycleEvents: lifecycle.events.length,
      validationStatus: validationSummary.status,
      readinessState: readiness.state,
      scheduleDue: scheduleControls.due,
      commandReplay: lifecycle.idempotency?.replayed === true
    }
  };
}

function deriveNextAction(settings, readGate, commandErrors, providerErrors = [], now = new Date().toISOString()) {
  if (providerErrors.length) return { type: "fix-provider-contract", reason: providerErrors[0] };
  if (commandErrors.length) return { type: "fix-command", reason: commandErrors[0] };
  if (settings.lifecycle === "disabled") return { type: "enable", reason: "fs-read surface is disabled" };
  if (settings.lifecycle === "paused") return { type: "resume", reason: "fs-read surface is paused" };
  if (readGate.status === "blocked") return { type: "revise-read-request", reason: readGate.errors[0] };
  const scheduleNextRunAt = asIso(settings.schedule.nextRunAt, null);
  const scheduleDue = settings.schedule.mode === "immediate"
    || (scheduleNextRunAt ? Date.parse(scheduleNextRunAt) <= Date.parse(now) : false);
  if (settings.schedule.mode === "deferred" && !scheduleDue) return { type: "wait-until", at: scheduleNextRunAt };
  if (settings.schedule.mode === "interval" && !scheduleDue) {
    return { type: "enqueue-interval", everyMs: settings.schedule.intervalMs, nextRunAt: scheduleNextRunAt };
  }
  return { type: "dispatch-read", reason: "settings and read request are valid" };
}

function buildNextStepContract(nextAction, preview, readiness, validationSummary) {
  const route = readiness.ready
    ? "kernel://syscall-layer/fs-read/dispatch"
    : nextAction.type === "revise-read-request"
      ? "client://fs-read/request-editor"
      : nextAction.type.startsWith("fix-")
        ? "client://fs-read/configuration"
        : "kernel://syscall-layer/fs-read/schedule";

  return {
    contract: "fs-read-next-step.v1",
    action: nextAction.type,
    route,
    label: readiness.ready ? "Dispatch read" : "Resolve fs-read block",
    reason: readiness.reason,
    userVisible: true,
    previewState: preview.state,
    validationStatus: validationSummary.status,
    payload: {
      path: preview.path,
      bytes: preview.byteLimit,
      schedule: readiness.schedule,
      missingCapabilities: preview.capabilitySummary.missing
    }
  };
}

function buildClientRouteDecisionContract({
  preview,
  validationSummary,
  acceptance,
  readiness,
  nextStep,
  lifecycleControls,
  clientContext,
  provider,
  readGate,
  syncMetadata,
  now
}) {
  const validationItems = validationSummary.items.map((item, index) => ({
    id: `fs-read-validation-${index + 1}`,
    source: item.source,
    severity: VALIDATION_SEVERITY[validationSummary.status],
    message: item.message,
    route: item.source === "read-request" ? "client://fs-read/request-editor" : "client://fs-read/configuration"
  }));
  const primaryActionEnabled = readiness.ready || readiness.queueable;
  const acceptanceProof = acceptance.requiredProofs.map((proof) => ({
    id: `fs-read-proof-${stableClientKey(proof.proof)}`,
    label: proof.proof,
    state: proof.satisfied ? "satisfied" : "missing"
  }));
  const checklist = [
    {
      id: "path",
      label: "Path policy",
      state: readGate.matchedRoot && readGate.encodedPathPolicy?.blocked !== true ? "passed" : "blocked",
      detail: readGate.encodedPathPolicy?.blocked
        ? `encoded path hazard: ${readGate.encodedPathPolicy.hazards.map((hazard) => hazard.type).join(", ")}`
        : preview.rootPolicy
    },
    {
      id: "tenant",
      label: "Tenant boundary",
      state: readGate.tenantBoundary?.decision === "blocked" || readGate.workspaceScope?.decision === "blocked" ? "blocked" : "passed",
      detail: readGate.tenantBoundary
        ? `${readGate.tenantBoundary.mode}:${readGate.tenantBoundary.decision}:${readGate.workspaceScope?.matchedEffectiveRoot || "no-effective-root"}`
        : "not-evaluated"
    },
    {
      id: "provider",
      label: "Provider contract",
      state: acceptanceProof.find((proof) => proof.label === "provider-service-contract")?.state === "satisfied" ? "passed" : "blocked",
      detail: `${provider.providerId}:${provider.serviceContract.handoffMode}`
    },
    {
      id: "schedule",
      label: "Schedule",
      state: readiness.ready || readiness.queueable ? "passed" : "blocked",
      detail: readiness.schedule.mode
    }
  ];
  const routeMode = nextStep.route.startsWith("client://")
    ? "client-resolution"
    : readiness.ready
      ? "kernel-dispatch"
      : "kernel-schedule";

  return {
    contract: "fs-read-client-route-decision.v1",
    schemaVersion: 1,
    generatedAt: now,
    userVisible: true,
    route: nextStep.route,
    routeMode,
    channel: clientContext.channel,
    requestId: clientContext.requestId,
    workflowId: clientContext.workflowId,
    status: readiness.state,
    previewCard: {
      contract: "fs-read-preview-card.v1",
      title: preview.title,
      state: preview.state,
      path: preview.redactedPath || preview.path,
      requestedPath: preview.requestedPath,
      byteRange: {
        offset: preview.offset,
        limit: preview.byteLimit,
        maximum: preview.maxBytes
      },
      providerLabel: provider.service,
      syncCursor: syncMetadata.cursor,
      message: preview.userMessage
    },
    acceptanceBanner: {
      contract: "fs-read-acceptance-banner.v1",
      state: acceptance.acceptanceState,
      accepted: acceptance.accepted,
      acceptedAt: acceptance.acceptedAt,
      providerId: acceptance.providerId,
      proof: acceptanceProof,
      blockingReasons: acceptance.blockingReasons
    },
    readinessChecklist: {
      contract: "fs-read-readiness-checklist.v1",
      state: readiness.state,
      ready: readiness.ready,
      queueable: readiness.queueable,
      items: checklist,
      reason: readiness.reason
    },
    validationPanel: {
      contract: "fs-read-validation-panel.v1",
      status: validationSummary.status,
      severity: validationSummary.severity,
      errorCount: validationSummary.errorCount,
      bySource: validationSummary.bySource,
      firstError: validationSummary.firstError,
      items: validationItems
    },
    nextStepAction: {
      contract: "fs-read-next-step-action.v1",
      action: nextStep.action,
      route: nextStep.route,
      label: nextStep.label,
      enabled: primaryActionEnabled,
      disabledReason: primaryActionEnabled ? null : readiness.reason,
      payload: nextStep.payload
    },
    secondaryActions: [
      {
        action: "configure",
        route: "client://fs-read/configuration",
        enabled: lifecycleControls.commands.configure.enabled,
        reason: lifecycleControls.commands.configure.reason
      },
      {
        action: "edit-request",
        route: "client://fs-read/request-editor",
        enabled: !readiness.ready || preview.state === "renderable",
        reason: readiness.ready ? "adjust path, offset, or byte limit before dispatch" : validationSummary.firstError
      },
      {
        action: "view-audit-proof",
        route: "client://fs-read/audit",
        enabled: acceptance.requiredProofs.length > 0,
        reason: "inspect fs-read policy and provider proof"
      }
    ],
    telemetryHints: {
      surfaceId,
      surfaceName,
      tenantId: clientContext.tenantIdentity.tenantId,
      workspaceId: clientContext.tenantIdentity.workspaceId,
      effectiveRoot: readGate.workspaceScope?.matchedEffectiveRoot || readGate.matchedRoot || null,
      workspaceScopeDecision: readGate.workspaceScope?.decision || "not-evaluated",
      providerId: provider.providerId,
      pathKey: stableClientKey(readGate.path || preview.requestedPath || "no-path"),
      validationStatus: validationSummary.status,
      readinessState: readiness.state
    }
  };
}

function buildClientResolutionDataContract({
  settings,
  provider,
  readGate,
  scopePolicy,
  validationSummary,
  acceptance,
  readiness,
  nextStep,
  clientRouteDecision,
  clientContext,
  now
}) {
  const validationItems = validationSummary.items.map((item, index) => {
    const code = classifyPolicyErrorCode(item.message);
    const route = item.source === "read-request"
      ? "client://fs-read/request-editor"
      : item.source === "provider"
        ? "client://fs-read/provider-contract"
        : "client://fs-read/configuration";
    const field = item.message.includes("path")
      ? "readRequest.path"
      : item.message.includes("bytes")
        ? "readRequest.bytes"
        : item.message.includes("offset") || item.message.includes("range reads")
          ? "readRequest.offset"
          : item.message.includes("allowHidden")
            ? "settings.allowHidden"
            : item.message.includes("allowedRoots") || item.message.includes("outside allowedRoots")
              ? "settings.allowedRoots"
              : item.message.includes("deniedGlob")
                ? "settings.deniedGlobs"
                : item.source === "provider"
                  ? "provider.serviceContract"
                  : item.source === "lifecycle"
                    ? "lifecycle.command"
                    : "readRequest";

    return {
      id: `fs-read-resolution-${index + 1}`,
      source: item.source,
      code,
      field,
      route,
      message: item.message,
      blocking: true,
      retryable: classifyActionableError(item, nextStep).retryable
    };
  });
  const fields = {
    "readRequest.path": {
      value: readGate.requestedPath || "",
      canonicalValue: readGate.path || null,
      required: true,
      editable: !readiness.ready,
      state: scopePolicy.path.hasNul || scopePolicy.path.hasParentTraversal || !scopePolicy.path.absolute || scopePolicy.path.encodedPolicy?.blocked
        ? "invalid"
        : readGate.matchedRoot
          ? "accepted"
          : "blocked",
      constraints: {
        absolute: true,
        parentTraversal: false,
        encodedSeparators: false,
        allowedRoots: settings.allowedRoots,
        matchedRoot: readGate.matchedRoot
      }
    },
    "readRequest.bytes": {
      value: readGate.bytes,
      required: true,
      editable: true,
      state: readGate.bytes > settings.maxBytes || readGate.bytes > provider.serviceContract.maxBytes ? "blocked" : "accepted",
      constraints: {
        min: 1,
        settingsMaxBytes: settings.maxBytes,
        providerMaxBytes: provider.serviceContract.maxBytes,
        effectiveMaxBytes: Math.min(settings.maxBytes, provider.serviceContract.maxBytes)
      }
    },
    "readRequest.offset": {
      value: readGate.requestedOffset || 0,
      required: false,
      editable: true,
      state: readGate.requestedOffset > 0 && !provider.capabilities.includes("range-read") ? "blocked" : "accepted",
      constraints: {
        min: 0,
        requiresCapability: readGate.requestedOffset > 0 ? "range-read" : null,
        rangeReadGranted: provider.capabilities.includes("range-read")
      }
    },
    "settings.allowHidden": {
      value: settings.allowHidden,
      required: readGate.pathNormalization?.hiddenSegments.length > 0,
      editable: true,
      state: readGate.pathNormalization?.hiddenSegments.length && !settings.allowHidden ? "blocked" : "accepted",
      constraints: {
        hiddenSegments: readGate.pathNormalization?.hiddenSegments || [],
        permissionRequired: readGate.pathNormalization?.hiddenSegments.length ? "fs.read.hidden" : "fs.read"
      }
    },
    "provider.serviceContract": {
      value: {
        operations: provider.serviceContract.operations,
        maxBytes: provider.serviceContract.maxBytes,
        handoffMode: provider.serviceContract.handoffMode,
        proofModes: provider.serviceContract.proofModes
      },
      required: true,
      editable: validationItems.some((item) => item.source === "provider"),
      state: provider.serviceContract.operations.includes("fs.read") && readGate.bytes <= provider.serviceContract.maxBytes
        ? "accepted"
        : "blocked",
      constraints: {
        requiredOperation: "fs.read",
        requiredProof: "audit-proof",
        requiredProtocol: "aios.fs.read.v1"
      }
    }
  };
  const suggestedPatch = {};
  if (fields["readRequest.bytes"].state === "blocked") {
    suggestedPatch.readRequest = {
      ...(suggestedPatch.readRequest || {}),
      bytes: fields["readRequest.bytes"].constraints.effectiveMaxBytes
    };
  }
  if (fields["readRequest.offset"].state === "blocked") {
    suggestedPatch.readRequest = {
      ...(suggestedPatch.readRequest || {}),
      offset: 0
    };
  }
  if (fields["settings.allowHidden"].state === "blocked") {
    suggestedPatch.settingsPatch = {
      ...(suggestedPatch.settingsPatch || {}),
      allowHidden: true
    };
  }

  const blockingFields = Object.entries(fields)
    .filter(([, field]) => field.state === "blocked" || field.state === "invalid")
    .map(([field, detail]) => ({
      field,
      state: detail.state,
      route: validationItems.find((item) => item.field === field)?.route || "client://fs-read/request-editor"
    }));
  const primaryRoute = blockingFields[0]?.route || clientRouteDecision.route;

  return {
    contract: "fs-read-client-resolution-data.v1",
    schemaVersion: 1,
    generatedAt: now,
    userVisible: true,
    state: readiness.ready ? "dispatch-ready" : blockingFields.length ? "requires-user-resolution" : "awaiting-schedule",
    requestId: clientContext.requestId,
    workflowId: clientContext.workflowId,
    route: primaryRoute,
    nextAction: {
      action: nextStep.action,
      label: nextStep.label,
      route: primaryRoute,
      enabled: readiness.ready || readiness.queueable,
      reason: readiness.reason
    },
    fields,
    blockingFields,
    validationItems,
    suggestedPatch,
    proofLinks: acceptance.requiredProofs.map((proof) => ({
      proof: proof.proof,
      state: proof.satisfied ? "satisfied" : "missing",
      auditRoute: "client://fs-read/audit",
      evidencePath: `acceptance.requiredProofs.${proof.proof}`
    })),
    routes: {
      editor: "client://fs-read/request-editor",
      configuration: "client://fs-read/configuration",
      providerContract: "client://fs-read/provider-contract",
      audit: "client://fs-read/audit",
      dispatch: "kernel://syscall-layer/fs-read/dispatch",
      schedule: "kernel://syscall-layer/fs-read/schedule"
    },
    resumeData: {
      path: readGate.path || readGate.requestedPath || null,
      bytes: readGate.bytes,
      offset: readGate.requestedOffset || 0,
      matchedRoot: readGate.matchedRoot,
      effectiveRoot: readGate.workspaceScope?.matchedEffectiveRoot || readGate.matchedRoot || null,
      acceptanceState: acceptance.acceptanceState,
      readinessState: readiness.state,
      validationStatus: validationSummary.status
    }
  };
}

export function describeFsReadSurface(input = {}) {
  const now = asIso(input.now, new Date().toISOString());
  const persistedState = normalizePersistedState(input.persistedState || input.state || {}, now);
  const effectiveSettingsInput = input.settings || persistedState.snapshot.settings || {};
  const effectiveReadRequest = input.readRequest || input.request || persistedState.snapshot.readRequest || persistedState.pendingRead || {};
  const normalized = normalizeSettings(effectiveSettingsInput);
  const earlyClientContext = normalizeClientContext(input, { path: effectiveReadRequest.path || null }, now);
  const commandId = deriveCommandId(input, earlyClientContext);
  const lifecycle = applyLifecycleCommand(normalized.settings, input.lifecycle || input, now, persistedState, commandId);
  const providerContract = normalizeProviderContract(input.provider || input.providerContract || {}, now);
  const capabilityNegotiation = negotiateProviderCapabilities(providerContract.provider, effectiveReadRequest);
  const baseReadGate = classifyReadRequest(effectiveReadRequest, lifecycle.settings, capabilityNegotiation, providerContract.provider);
  const tenantBoundary = normalizeTenantBoundary(input, earlyClientContext, baseReadGate, now);
  const workspaceScope = buildTenantWorkspaceScope(lifecycle.settings, baseReadGate, tenantBoundary, now);
  const readGate = applyTenantBoundaryToReadGate(baseReadGate, tenantBoundary, workspaceScope);
  const scopePolicy = buildReadScopePolicyContract(lifecycle.settings, readGate, now, providerContract.provider);
  const validationErrors = [...normalized.errors, ...lifecycle.errors, ...providerContract.errors, ...readGate.errors];
  const nextAction = deriveNextAction(lifecycle.settings, readGate, lifecycle.errors, providerContract.errors, now);
  const syncMetadata = buildSyncMetadata(providerContract.provider, readGate, now);
  const preview = buildPreview(lifecycle.settings, providerContract.provider, capabilityNegotiation, readGate, syncMetadata);
  const validationSummary = buildValidationSummary(normalized.errors, lifecycle.errors, providerContract.errors, readGate);
  const acceptance = buildAcceptanceContract(lifecycle.settings, providerContract.provider, capabilityNegotiation, readGate, validationSummary);
  const readiness = buildReadinessContract(lifecycle.settings, readGate, nextAction, acceptance);
  const lifecycleControls = buildLifecycleControlsContract(lifecycle.settings, lifecycle, nextAction, validationSummary, readiness, now);
  const nextStep = buildNextStepContract(nextAction, preview, readiness, validationSummary);
  const clientContext = normalizeClientContext(input, readGate, now);
  const clientRuntime = buildClientRuntimeState(clientContext, providerContract.provider, readGate, readiness, nextStep, syncMetadata);
  const workflowPreferences = normalizeWorkflowHandoffPreferences(input, clientContext, readGate, readiness, nextStep, now);
  const scopedDispatchClaim = buildScopedDispatchClaim({
    provider: providerContract.provider,
    readGate,
    scopePolicy,
    clientContext,
    syncMetadata,
    now
  });
  const externalHandoff = buildExternalHandoff(
    providerContract.provider,
    capabilityNegotiation,
    readGate,
    nextAction,
    syncMetadata,
    now,
    {
      clientContext,
      clientRuntime,
      workflowPreferences,
      scopePolicy,
      scopedDispatchClaim
    }
  );
  const readAudit = buildReadAuditEnvelope({
    settings: lifecycle.settings,
    provider: providerContract.provider,
    readGate,
    scopePolicy,
    scopedDispatchClaim,
    capabilityNegotiation,
    clientContext,
    now
  });
  const clientRouteDecision = buildClientRouteDecisionContract({
    preview,
    validationSummary,
    acceptance,
    readiness,
    nextStep,
    lifecycleControls,
    clientContext,
    provider: providerContract.provider,
    readGate,
    syncMetadata,
    now
  });
  const clientResolutionData = buildClientResolutionDataContract({
    settings: lifecycle.settings,
    provider: providerContract.provider,
    readGate,
    scopePolicy,
    validationSummary,
    acceptance,
    readiness,
    nextStep,
    clientRouteDecision,
    clientContext,
    now
  });
  const kernelReadPlan = buildKernelReadExecutionPlan({
    settings: lifecycle.settings,
    provider: providerContract.provider,
    readGate,
    readiness,
    externalHandoff,
    syncMetadata,
    clientContext,
    now
  });
  const providerAcknowledgement = buildProviderAcknowledgementContract(input, externalHandoff, clientRuntime, syncMetadata, now);
  const hostedKernelReadResult = buildHostedKernelReadResult(input, kernelReadPlan, providerContract.provider, readGate, syncMetadata, now);
  const providerResultCommit = buildProviderResultCommitState({
    input,
    externalHandoff,
    providerAcknowledgement,
    hostedKernelReadResult,
    kernelReadPlan,
    syncMetadata,
    clientRuntime,
    now
  });
  const resultDelivery = buildClientResultDeliveryContract({
    clientRuntime,
    workflowPreferences,
    providerAcknowledgement,
    hostedKernelReadResult,
    providerResultCommit,
    preview,
    syncMetadata,
    now
  });
  const workflowHandoff = buildWorkflowHandoff(
    clientRuntime,
    preview,
    readiness,
    externalHandoff,
    nextStep,
    providerAcknowledgement,
    hostedKernelReadResult,
    providerResultCommit,
    workflowPreferences,
    resultDelivery
  );
  const recoveryPlan = buildRecoveryPlan(
    persistedState,
    readGate,
    readiness,
    nextStep,
    syncMetadata,
    externalHandoff,
    clientRuntime,
    lifecycle,
    now
  );
  const statePersistence = buildStatePersistenceContract(
    persistedState,
    lifecycle,
    lifecycle.settings,
    providerContract.provider,
    readGate,
    readiness,
    syncMetadata,
    clientRuntime,
    recoveryPlan,
    now
  );
  const healthProbe = normalizeOperationalHealthInput(input, providerContract.provider, now);
  const operationalHealth = buildOperationalHealth({
    validationSummary,
    providerContract: providerContract.provider,
    capabilityNegotiation,
    readGate,
    readiness,
    nextStep,
    recoveryPlan,
    statePersistence,
    syncMetadata,
    clientRuntime,
    providerAcknowledgement,
    hostedKernelReadResult,
    providerResultCommit,
    healthProbe,
    now
  });
  const analyticsState = normalizeAnalyticsState(input.analytics || input.analyticsState || {});
  const analyticsExport = buildAnalyticsExportState({
    analyticsState,
    clientContext,
    providerContract: providerContract.provider,
    readGate,
    validationSummary,
    readiness,
    nextStep,
    recoveryPlan,
    operationalHealth,
    providerAcknowledgement,
    hostedKernelReadResult,
    providerResultCommit,
    now
  });

  return {
    ok: validationErrors.length === 0
      && lifecycle.settings.lifecycle === "active"
      && recoveryPlan.state !== "reconcile"
      && operationalHealth.serviceLevel !== "unavailable",
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel fs-read lifecycle and policy gate",
    command: lifecycle.command,
    settings: lifecycle.settings,
    persistedState,
    providerContract: providerContract.provider,
    capabilityNegotiation,
    readGate,
    scopePolicy,
    scopedDispatchClaim,
    readAudit,
    syncMetadata,
    externalHandoff,
    dispatchWorkflowReceipt: externalHandoff.workflowReceipt,
    providerAcknowledgement,
    hostedKernelReadResult,
    providerResultCommit,
    preview,
    validationSummary,
    lifecycleControls,
    acceptance,
    readiness,
    nextAction,
    nextStep,
    clientRouteDecision,
    clientResolutionData,
    clientContext,
    kernelReadPlan,
    clientRuntime,
    workflowPreferences,
    resultDelivery,
    workflowHandoff,
    recoveryPlan,
    statePersistence,
    operationalHealth,
    analytics: analyticsExport,
    audit: {
      proofKind: "fs-read-policy-decision",
      surfaceId,
      generatedAt: now,
      events: lifecycle.events,
      validationErrors,
      providerErrors: providerContract.errors,
      capabilityProof: capabilityNegotiation.proof,
      syncCursor: syncMetadata.cursor,
      readAuditContract: readAudit.contract,
      readAuditId: readAudit.auditId,
      readAuditDecision: readAudit.decision,
      readAuditState: readAudit.state,
      readAuditBlockedChecks: readAudit.blockedChecks,
      readAuditErrorCodes: readAudit.errorCodes,
      readAuditChecks: readAudit.checks.map((check) => ({
        check: check.check,
        state: check.state,
        code: check.code
      })),
      scopedDispatchClaimContract: scopedDispatchClaim.contract,
      scopedDispatchClaimId: scopedDispatchClaim.claimId,
      scopedDispatchClaimState: scopedDispatchClaim.state,
      scopedDispatchClaimAccepted: scopedDispatchClaim.accepted,
      scopedDispatchClaimEffectiveRoot: scopedDispatchClaim.path.matchedEffectiveRoot,
      scopedDispatchClaimPermission: scopedDispatchClaim.permission.required,
      scopedDispatchClaimPermissionGranted: scopedDispatchClaim.permission.granted,
      scopedDispatchClaimViaRole: scopedDispatchClaim.permission.viaRole,
      scopedDispatchClaimErrors: scopedDispatchClaim.errors,
      canonicalPath: readGate.path || null,
      requestedPath: readGate.requestedPath || null,
      requestedOffset: readGate.requestedOffset || 0,
      pathNormalizationChanged: readGate.pathNormalization?.changed === true,
      encodedPathPolicyContract: readGate.encodedPathPolicy?.contract || null,
      encodedPathObserved: readGate.encodedPathPolicy?.encoded === true,
      encodedPathBlocked: readGate.encodedPathPolicy?.blocked === true,
      encodedPathHazards: readGate.encodedPathPolicy?.hazards || [],
      encodedPathTokens: readGate.encodedPathPolicy?.tokens || [],
      scopePolicyContract: scopePolicy.contract,
      scopePolicyDecision: scopePolicy.decision,
      scopePolicyState: scopePolicy.state,
      scopePolicyBlockingChecks: scopePolicy.blockingChecks,
      scopePolicyConfiguredRoots: scopePolicy.rootPolicy.configuredRoots,
      scopePolicyMatchedRoot: scopePolicy.rootPolicy.matchedRoot,
      scopePolicyRootScopeProof: scopePolicy.rootPolicy.scopeProof,
      scopePolicyRejectedRoots: scopePolicy.rootPolicy.rejectedRoots,
      scopePolicyCanonicalizedRoots: scopePolicy.rootPolicy.canonicalization,
      scopePolicyHiddenBlocked: scopePolicy.contentPolicy.hiddenBlocked,
      scopePolicyDeniedGlobMatched: scopePolicy.contentPolicy.deniedGlobMatched,
      scopePolicyByteLimitSatisfied: scopePolicy.contentPolicy.byteLimitSatisfied,
      scopePolicyProviderByteLimitSatisfied: scopePolicy.contentPolicy.providerByteLimitSatisfied,
      scopePolicyProviderMaxBytes: scopePolicy.contentPolicy.providerMaxBytes,
      scopePolicyEffectiveRoots: scopePolicy.tenantPolicy.effectiveRoots,
      scopePolicyRootOverlapProof: scopePolicy.tenantPolicy.rootOverlapProof,
      tenantBoundaryContract: readGate.tenantBoundary?.contract || null,
      tenantBoundaryMode: readGate.tenantBoundary?.mode || "none",
      tenantBoundaryDecision: readGate.tenantBoundary?.decision || "not-evaluated",
      tenantId: readGate.tenantBoundary?.tenantId || clientContext.tenantIdentity.tenantId || null,
      tenantWorkspaceId: readGate.tenantBoundary?.workspaceId || clientContext.tenantIdentity.workspaceId || null,
      tenantMatchedRoot: readGate.tenantBoundary?.matchedTenantRoot || null,
      tenantRequiredPermission: readGate.tenantBoundary?.requiredPermission || null,
      tenantBoundaryErrors: readGate.tenantBoundary?.errors || [],
      workspaceScopeContract: readGate.workspaceScope?.contract || null,
      workspaceScopeDecision: readGate.workspaceScope?.decision || "not-evaluated",
      workspaceScopeConstrained: readGate.workspaceScope?.constrained === true,
      workspaceScopeMatchedPolicyRoot: readGate.workspaceScope?.matchedPolicyRoot || null,
      workspaceScopeMatchedTenantRoot: readGate.workspaceScope?.matchedTenantRoot || null,
      workspaceScopeMatchedEffectiveRoot: readGate.workspaceScope?.matchedEffectiveRoot || null,
      workspaceScopeEffectiveRoots: readGate.workspaceScope?.effectiveRoots || [],
      workspaceScopeErrors: readGate.workspaceScope?.errors || [],
      handoffState: externalHandoff.state,
      handoffDeliveryState: externalHandoff.deliveryState,
      handoffAcknowledgementState: externalHandoff.acknowledgement.state,
      handoffWorkflowReceiptContract: externalHandoff.workflowReceipt?.contract || null,
      handoffWorkflowReceiptId: externalHandoff.workflowReceipt?.receiptId || null,
      handoffWorkflowReceiptState: externalHandoff.workflowReceipt?.state || null,
      handoffWorkflowReceiptRoute: externalHandoff.workflowReceipt?.nextAction.route || null,
      handoffWorkflowReceiptAction: externalHandoff.workflowReceipt?.nextAction.action || null,
      handoffWorkflowResumeToken: externalHandoff.workflowReceipt?.resumeTokens.handoffToken || null,
      providerAcknowledgementState: providerAcknowledgement.state,
      providerAcknowledgementReceived: providerAcknowledgement.received,
      providerAcknowledgementDecision: providerAcknowledgement.decision,
      providerAcknowledgementErrors: providerAcknowledgement.errors,
      hostedKernelReadResultState: hostedKernelReadResult.state,
      hostedKernelReadResultReceived: hostedKernelReadResult.received,
      hostedKernelReadResultBytes: hostedKernelReadResult.byteRange.returnedLength,
      hostedKernelReadResultErrors: hostedKernelReadResult.errors,
      providerResultCommitState: providerResultCommit.state,
      providerResultCommitReady: providerResultCommit.commitReady,
      providerResultCommitId: providerResultCommit.commitId,
      providerResultCommitAdmissionContract: providerResultCommit.commitAdmission.contract,
      providerResultCommitAdmissionState: providerResultCommit.commitAdmission.state,
      providerResultCommitAdmitted: providerResultCommit.commitAdmission.commitAdmitted,
      providerResultCommitAdmissionErrors: providerResultCommit.commitAdmission.errors,
      providerResultCommitAdmissionChecks: providerResultCommit.commitAdmission.checks,
      providerResultCommitErrors: providerResultCommit.errors,
      providerResultCommitCursor: providerResultCommit.syncCommit.committedCursor,
      providerResultCommitDurableStatus: providerResultCommit.durableWrite.status,
      providerHandoffMode: providerContract.provider.serviceContract.handoffMode,
      providerServiceMaxBytes: providerContract.provider.serviceContract.maxBytes,
      previewState: preview.state,
      acceptanceState: acceptance.acceptanceState,
      readinessState: readiness.state,
      lifecycleControlsContract: lifecycleControls.contract,
      lifecycleCommandAccepted: lifecycleControls.current.commandAccepted,
      lifecycleScheduleDue: lifecycleControls.scheduleControls.due,
      lifecycleNextAction: lifecycleControls.nextActionState.action,
      persistedState: persistedState.status,
      persistedWarnings: persistedState.warnings,
      recoveryState: recoveryPlan.state,
      recoveryRecommendedCommand: recoveryPlan.recommendedCommand?.command || null,
      recoveryCommandAccepted: recoveryPlan.restartStatus.commandAccepted,
      recoveryLeaseExpired: recoveryPlan.restartStatus.leaseExpired,
      recoveryPendingAgeMs: recoveryPlan.restartStatus.pendingAgeMs,
      recoveryHandoffMatches: recoveryPlan.checks.handoffMatches,
      persistenceStatus: statePersistence.status,
      persistenceTransition: statePersistence.proof.statusTransition,
      persistenceRestartSafe: statePersistence.restartSafe,
      persistenceRecommendedCommandId: statePersistence.idempotency.recommendedRecoveryCommandId,
      operationalHealthState: operationalHealth.state,
      serviceLevel: operationalHealth.serviceLevel,
      providerHealthObserved: operationalHealth.providerHealth.observed,
      providerHealthState: operationalHealth.providerHealth.state,
      providerHealthFailures: operationalHealth.providerHealth.consecutiveFailures,
      providerCircuitState: operationalHealth.providerHealth.circuitBreaker.state,
      providerCircuitOpenActive: operationalHealth.providerHealth.circuitBreaker.openActive,
      degradedModeActive: operationalHealth.degradedMode.active,
      degradedModeDispatchAllowed: operationalHealth.degradedMode.dispatchAllowed,
      kernelReadPlanState: kernelReadPlan.state,
      kernelOperationId: kernelReadPlan.operationId,
      kernelProofModes: kernelReadPlan.proofRequirements.modes,
      degradedReasons: operationalHealth.degradedReasons,
      retryable: operationalHealth.retry.retryable,
      retryStrategy: operationalHealth.retry.strategy,
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
      clientRouteDecisionContract: clientRouteDecision.contract,
      clientRouteDecisionRoute: clientRouteDecision.route,
      clientRouteDecisionMode: clientRouteDecision.routeMode,
      clientRouteDecisionStatus: clientRouteDecision.status,
      clientRouteDecisionPrimaryEnabled: clientRouteDecision.nextStepAction.enabled,
      clientRouteValidationItems: clientRouteDecision.validationPanel.errorCount,
      clientResolutionDataContract: clientResolutionData.contract,
      clientResolutionState: clientResolutionData.state,
      clientResolutionRoute: clientResolutionData.route,
      clientResolutionBlockingFields: clientResolutionData.blockingFields.map((field) => field.field),
      clientResolutionSuggestedPatch: Object.keys(clientResolutionData.suggestedPatch),
      analyticsContract: analyticsExport.contract,
      analyticsRequests: analyticsExport.counters.totalRequests,
      analyticsDispatchReady: analyticsExport.counters.dispatchReady,
      analyticsBlocked: analyticsExport.counters.blockedRequests,
      analyticsPolicyBlocked: analyticsExport.counters.policyBlocked,
      analyticsEncodedPathBlocks: analyticsExport.counters.encodedPathBlocks,
      analyticsHiddenPathBlocks: analyticsExport.counters.hiddenPathBlocks,
      analyticsDeniedGlobBlocks: analyticsExport.counters.deniedGlobBlocks,
      analyticsProviderAckAwaiting: analyticsExport.counters.providerAckAwaiting,
      analyticsProviderResultFulfilled: analyticsExport.counters.providerResultFulfilled,
      analyticsProviderResultRejected: analyticsExport.counters.providerResultRejected,
      analyticsProviderResultCommitted: analyticsExport.counters.providerResultCommitted,
      analyticsProviderResultCommitBlocked: analyticsExport.counters.providerResultCommitBlocked,
      analyticsBytesReturned: analyticsExport.counters.bytesReturned,
      analyticsHistoryCount: analyticsExport.history.count,
      analyticsExportReady: analyticsExport.exportSummary.exportReady,
      analyticsExportRecordCount: analyticsExport.exportSummary.recordCount,
      analyticsReportWindow: analyticsExport.reportWindow.retainedSnapshots,
      analyticsLatestResultState: analyticsExport.reportWindow.latestOutcome.hostedKernelReadResultState,
      analyticsLatestCommitState: analyticsExport.reportWindow.latestOutcome.providerResultCommitState,
      analyticsLatestPolicyBlocked: analyticsExport.reportWindow.latestOutcome.policyBlocked,
      analyticsLatestPolicyBlockTypes: analyticsExport.reportWindow.latestOutcome.policyBlockTypes,
      reportingState: analyticsExport.reportingState.state,
      idempotencyReplayed: statePersistence.idempotency.replayed,
      nextStepRoute: nextStep.route,
      clientRuntimeState: clientRuntime.state,
      workflowPreferenceContract: workflowPreferences.contract,
      workflowPreferredAction: workflowPreferences.preferredAction,
      workflowResultDelivery: workflowPreferences.resultDelivery,
      workflowReturnRoute: workflowPreferences.routes.returnRoute,
      workflowSuccessRoute: workflowPreferences.routes.successRoute,
      workflowReceiptId: workflowPreferences.receiptId,
      resultDeliveryContract: resultDelivery.contract,
      resultDeliveryState: resultDelivery.state,
      resultDeliveryMode: resultDelivery.deliveryMode,
      resultDeliveryRoute: resultDelivery.route,
      resultDeliveryBlockedBy: resultDelivery.blockReasons,
      workflowHandoffState: workflowHandoff.state,
      workflowHandoffPrimaryAction: workflowHandoff.controls.primary.action,
      workflowHandoffCompletionRoute: workflowHandoff.completion.nextRoute,
      workflowHandoffCommitReady: workflowHandoff.completion.commitReady,
      clientHandoffKey: workflowHandoff.handoffKey,
      clientWarnings: clientContext.warnings,
      evidenceCount: Array.isArray(input.evidence) ? input.evidence.length : 0
    },
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

export default describeFsReadSurface;
