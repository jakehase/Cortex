import path from 'node:path';

export const surfaceId = "aios_syscall-layer_shell-exec_024";
export const surfaceGroup = "syscall-layer";
export const surfaceName = "shell-exec";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const BASE_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_ATTEMPTS = 4;
const DEFAULT_ENV_ALLOWLIST = ['CI', 'HOME', 'LANG', 'PATH', 'PWD', 'SHELL', 'TERM', 'TMPDIR', 'USER'];
const MAX_STDIN_BYTES = 64_000;
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const DESTRUCTIVE_COMMAND_PATTERN = /\b(rm\s+-rf|mkfs|dd\s+if=|shutdown|reboot|:(){:|curl\b.*\|\s*sh|wget\b.*\|\s*sh)\b/;
const NETWORK_COMMAND_PATTERN = /\b(curl|wget|npm|pnpm|yarn|pip|git\s+(clone|pull|fetch))\b/;
const FILE_WRITE_COMMAND_PATTERN = /\b(>|>>|tee|touch|mkdir|mv|cp|rm|sed\s+-i|apply_patch)\b/;
const SHELL_CONTROL_OPERATOR_PATTERN = /(?:^|\s)(?:&&|\|\||;|\||`|\$\(|<\(|>\(|\{|\})/;
const DEFAULT_CLIENT_CHANNEL = 'codex-cli';
const TERMINAL_EXECUTION_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const ACTIVE_EXECUTION_STATUSES = new Set(['queued', 'running']);
const RECOVERABLE_EXECUTION_STATUSES = new Set(['accepted', 'queued', 'running']);
const RETRYABLE_FAILURE_STATUSES = new Set(['failed', 'timed_out', 'blocked']);
const PATH_FLAG_PREFIXES = new Set(['--cwd=', '--workdir=', '--output=', '--file=', '--config=']);
const PATH_OPERAND_COMMANDS = new Set(['cat', 'cp', 'mv', 'rm', 'touch', 'mkdir', 'sed', 'tee', 'node', 'python', 'python3', 'npm', 'pnpm']);
const LIFECYCLE_COMMANDS = new Set(['preview', 'accept', 'dispatch', 'recover', 'retry', 'cancel', 'result']);
const DEFAULT_SCHEDULE_INTERVAL_MS = 5_000;
const MIN_SCHEDULE_INTERVAL_MS = 1_000;
const MAX_SCHEDULE_INTERVAL_MS = 86_400_000;
const ACTIVE_LEASE_GRACE_MS = 15_000;
const QUEUED_LEASE_TTL_MS = 120_000;
const PROVIDER_HEALTH_FRESH_MS = 120_000;
const PROVIDER_HEALTH_STALE_MS = 600_000;
const ANALYTICS_DURATION_BUCKETS = [
  { id: 'sub_1s', maxMs: 1_000 },
  { id: '1s_to_10s', maxMs: 10_000 },
  { id: '10s_to_60s', maxMs: 60_000 },
  { id: '1m_to_5m', maxMs: 300_000 },
  { id: 'over_5m', maxMs: Infinity }
];
const ANALYTICS_RISK_TIERS = new Set(['low', 'moderate', 'elevated', 'blocked', 'unknown']);
const ROLE_PERMISSION_DEFAULTS = {
  viewer: ['shell_exec.preview'],
  operator: ['shell_exec.preview', 'shell_exec.accept', 'shell_exec.dispatch'],
  maintainer: ['shell_exec.preview', 'shell_exec.accept', 'shell_exec.dispatch', 'shell_exec.env_overlay'],
  admin: ['shell_exec.preview', 'shell_exec.accept', 'shell_exec.dispatch', 'shell_exec.env_overlay', 'shell_exec.cross_workspace']
};
const BASE_PROVIDER_CAPABILITIES = [
  'shell_exec.audit_proof',
  'shell_exec.cwd',
  'shell_exec.env_allowlist',
  'shell_exec.exit_code',
  'shell_exec.sync_state',
  'shell_exec.timeout'
];
const HOSTED_PROVIDER_CAPABILITIES = [
  ...BASE_PROVIDER_CAPABILITIES,
  'shell_exec.accepted_dispatch',
  'shell_exec.argv',
  'shell_exec.cancellable_run',
  'shell_exec.preview_only'
];
const PROVIDER_HANDOFF_READY_STATES = new Set(['accepted', 'acknowledged', 'claimed', 'prepared', 'ready', 'running']);
const PROVIDER_HANDOFF_BLOCKED_STATES = new Set(['blocked', 'cancelled', 'expired', 'failed', 'rejected']);
const HISTORY_EVENT_STATUSES = new Set([
  'draft',
  'accepted',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'blocked',
  'stale'
]);

function coerceStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function readRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function coerceTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stableShellExecId(parts = []) {
  return Buffer.from(parts.map((part) => part || '').join('\n')).toString('base64url').slice(0, 28);
}

function coerceStatus(value, fallback = 'draft') {
  const status = coerceTrimmedString(value);
  if (!status) return fallback;
  return [
    'draft',
    'accepted',
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled',
    'timed_out',
    'blocked',
    'stale'
  ].includes(status) ? status : fallback;
}

function coerceIsoTimestamp(value, fallback = null) {
  const timestamp = coerceTrimmedString(value);
  if (!timestamp) return fallback;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function coerceNonNegativeInteger(value, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

function normalizePathScope(value) {
  const rawPath = coerceTrimmedString(value);
  if (!rawPath) return null;
  return path.resolve(rawPath);
}

function isPathInsideScope(candidate, root) {
  const candidatePath = normalizePathScope(candidate);
  const rootPath = normalizePathScope(root);
  if (!candidatePath || !rootPath) return false;
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function firstScopedRoot(candidate, roots = []) {
  return roots.find((root) => isPathInsideScope(candidate, root)) || null;
}

function tokenizeCommandLine(command = '') {
  const tokens = [];
  const tokenPattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match;
  while ((match = tokenPattern.exec(command))) {
    const token = match[1] ?? match[2] ?? match[3];
    if (token) tokens.push(token.replaceAll('\\"', '"').replaceAll("\\'", "'"));
  }
  return tokens;
}

function buildCommandIntentContract(command, argv = []) {
  const commandProvided = Boolean(command);
  const argvProvided = argv.length > 0;
  const commandTokens = commandProvided ? tokenizeCommandLine(command) : [];
  const canonicalArgvLine = argv.join(' ');
  const executable = coerceTrimmedString(argv[0] || commandTokens[0]);
  const shellControlDetected = commandProvided && SHELL_CONTROL_OPERATOR_PATTERN.test(command);
  const argvMatchesCommand = !commandProvided
    || !argvProvided
    || commandTokens.length === argv.length && commandTokens.every((token, index) => token === argv[index]);
  const issues = [];

  if (!commandProvided && !argvProvided) {
    issues.push({
      code: 'command_intent_empty',
      severity: 'error',
      message: 'Shell exec intent is empty; provide a command string or argv array.'
    });
  }
  if (commandProvided && !commandTokens.length) {
    issues.push({
      code: 'command_intent_unparseable',
      severity: 'error',
      message: 'Command text did not produce an executable token.'
    });
  }
  if (argvProvided && !executable) {
    issues.push({
      code: 'argv_executable_required',
      severity: 'error',
      message: 'Argv shell exec requests must include an executable at argv[0].'
    });
  }
  if (commandProvided && argvProvided && !argvMatchesCommand) {
    issues.push({
      code: 'command_argv_mismatch',
      severity: 'error',
      message: 'Command text and argv describe different shell exec intents; dispatch requires one authoritative representation.'
    });
  }
  if (shellControlDetected && argvProvided) {
    issues.push({
      code: 'argv_shell_control_operators',
      severity: 'warning',
      message: 'Command text contains shell control operators while argv is also supplied; hosted execution will require an explicit command representation.'
    });
  }

  return {
    kind: 'shell-exec.command-intent.v1',
    source: argvProvided && commandProvided
      ? 'command+argv'
      : argvProvided
        ? 'argv'
        : commandProvided
          ? 'command'
          : 'empty',
    commandProvided,
    argvProvided,
    commandLine: command || canonicalArgvLine,
    canonicalArgvLine,
    executable,
    tokenCount: argvProvided ? argv.length : commandTokens.length,
    commandTokens,
    argv,
    representation: {
      authoritative: argvProvided && !commandProvided
        ? 'argv'
        : commandProvided && !argvProvided
          ? 'command'
          : argvMatchesCommand
            ? 'equivalent'
            : 'conflicting',
      argvMatchesCommand,
      shellControlDetected,
      requiresShellInterpreter: shellControlDetected && !argvProvided,
      parseConfidence: commandProvided && commandTokens.length || argvProvided ? 'bounded' : 'none'
    },
    validation: {
      ok: !issues.some((issue) => issue.severity === 'error'),
      issues
    },
    digest: `intent_${stableShellExecId([
      command || '',
      canonicalArgvLine,
      executable || '',
      shellControlDetected ? 'shell-control' : 'direct'
    ]).slice(0, 18)}`,
    proofTags: [
      `intent-source:${argvProvided ? 'argv' : 'command'}`,
      `intent-representation:${argvMatchesCommand ? 'coherent' : 'conflicting'}`,
      `intent-shell-control:${shellControlDetected ? 'detected' : 'none'}`
    ]
  };
}

function looksLikePathOperand(value) {
  const token = coerceTrimmedString(value);
  if (!token || token === '-' || token.startsWith('$') || token.includes('://')) return false;
  if (token.startsWith('./') || token.startsWith('../') || token.startsWith('/')) return true;
  if (token.includes('/') && !token.startsWith('-')) return true;
  return /\.[A-Za-z0-9]{1,12}$/.test(token);
}

function normalizeCommandPathOperand(rawToken, cwd) {
  const token = coerceTrimmedString(rawToken);
  if (!token || !looksLikePathOperand(token)) return null;
  const flagPrefix = [...PATH_FLAG_PREFIXES].find((prefix) => token.startsWith(prefix));
  const value = flagPrefix ? token.slice(flagPrefix.length) : token;
  if (!looksLikePathOperand(value)) return null;
  return {
    token,
    flag: flagPrefix ? flagPrefix.slice(0, -1) : null,
    resolvedPath: path.resolve(cwd || process.cwd(), value)
  };
}

function buildWorkspaceAccessPlan(request, boundary) {
  const cwd = boundary.workspace.effectiveCwd || request.cwd || boundary.workspace.root || process.cwd();
  const tokens = request.argv.length ? request.argv : request.commandIntent.commandTokens;
  const executable = coerceTrimmedString(tokens[0]) || null;
  const operands = [];

  tokens.forEach((token, index) => {
    if (index === 0 && executable && !looksLikePathOperand(token) && !PATH_OPERAND_COMMANDS.has(path.basename(executable))) return;
    const operand = normalizeCommandPathOperand(token, cwd);
    if (!operand) return;
    const scopedRoot = firstScopedRoot(operand.resolvedPath, boundary.workspace.allowedRoots);
    const withinScope = Boolean(!boundary.workspace.allowedRoots.length || scopedRoot || boundary.actor.permissions.includes('shell_exec.cross_workspace'));
    operands.push({
      index,
      token: operand.token,
      flag: operand.flag,
      resolvedPath: operand.resolvedPath,
      scopedRoot,
      withinScope,
      access: /\b(rm|mv|cp|touch|mkdir|tee|sed)\b/.test(request.command) ? 'write_candidate' : 'read_candidate'
    });
  });

  const outsideScope = operands.filter((operand) => !operand.withinScope);
  const writeCandidates = operands.filter((operand) => operand.access === 'write_candidate');

  return {
    kind: 'shell-exec.workspace-access-plan.v1',
    cwd,
    executable,
    tokenCount: tokens.length,
    operandCount: operands.length,
    operands,
    outsideScope,
    writeCandidates,
    status: outsideScope.length
      ? 'blocked_outside_workspace'
      : operands.length
        ? 'scoped_operands'
        : 'no_path_operands',
    proofTags: [
      `workspace-access:${outsideScope.length ? 'blocked' : 'scoped'}`,
      `path-operands:${operands.length}`,
      `write-candidates:${writeCandidates.length}`
    ]
  };
}

function buildShellExecSandboxPolicy(request, boundary, workspaceAccessPlan, workspaceBoundaryReview = null) {
  const writesFilesystem = FILE_WRITE_COMMAND_PATTERN.test(request.command);
  const usesNetwork = NETWORK_COMMAND_PATTERN.test(request.command);
  const destructiveIntent = DESTRUCTIVE_COMMAND_PATTERN.test(request.command);
  const outsideScopeCount = workspaceAccessPlan?.outsideScope?.length || 0;
  const deniedPermissions = boundary.actor?.deniedPermissions || [];
  const boundaryBlockingReasons = workspaceBoundaryReview?.blockingReasons || [];
  const boundaryWarningReasons = workspaceBoundaryReview?.warningReasons || [];
  const riskLabels = [
    request.previewOnly ? 'preview-only' : 'dispatch-requested',
    request.accepted ? 'accepted' : 'acceptance-not-recorded',
    writesFilesystem ? 'filesystem-write' : 'read-only-intent',
    usesNetwork ? 'network-access' : 'no-network-detected',
    destructiveIntent ? 'destructive-pattern' : null,
    request.timeoutMs > DEFAULT_TIMEOUT_MS ? 'extended-timeout' : 'default-timeout',
    request.stdin.provided ? 'stdin-provided' : 'stdin-none',
    request.envOverlay.entries.length ? 'env-overlay' : 'default-env',
    request.envOverlay.rejected.length ? 'env-overlay-rejected' : null,
    outsideScopeCount ? 'workspace-scope-violation' : 'workspace-scoped',
    deniedPermissions.length ? 'permission-gap' : 'permissions-bound',
    workspaceBoundaryReview?.status === 'blocked' ? 'workspace-boundary-blocked' : null,
    workspaceBoundaryReview?.status === 'review' ? 'workspace-boundary-review' : null,
    workspaceBoundaryReview?.persistedCwd ? 'persisted-workspace-binding' : null
  ].filter(Boolean);
  const blockingReasons = [
    ...(destructiveIntent ? ['destructive_command_requires_review'] : []),
    ...(outsideScopeCount ? ['path_operand_outside_workspace_scope'] : []),
    ...(boundary.workspace.withinAllowedRoots ? [] : ['cwd_outside_workspace_scope']),
    ...boundaryBlockingReasons,
    ...(deniedPermissions.length ? deniedPermissions.map((permission) => `permission_denied:${permission}`) : []),
    ...(request.stdin.byteLength > request.stdin.maxBytes ? ['stdin_too_large'] : []),
    ...(request.envOverlay.rejected.some((entry) => entry.reason === 'not_in_env_allowlist') ? ['env_overlay_not_in_env_allowlist'] : [])
  ];
  const evidenceRefs = [
    `request:${request.id}`,
    `idempotency:${request.idempotencyKey}`,
    `cwd:${boundary.workspace.effectiveCwd || request.cwd || 'workspace-unbound'}`,
    `timeout:${request.timeoutMs}`,
    `env-overlay:${request.envOverlay.entries.length}`,
    `stdin:${request.stdin.digest || 'none'}`,
    `workspace-access:${workspaceAccessPlan?.status || 'not_evaluated'}`,
    `workspace-boundary:${workspaceBoundaryReview?.status || 'not_evaluated'}`
  ];

  return {
    kind: 'shell-exec.sandbox-policy.v1',
    mode: request.previewOnly ? 'preview' : 'hosted-kernel-dispatch',
    enforcement: {
      status: blockingReasons.length ? 'blocked' : 'enforce',
      blockingReasons: [...new Set(blockingReasons)].sort(),
      requiresAcceptance: request.requiresAcceptance,
      accepted: request.accepted,
      crossWorkspaceAllowed: boundary.actor.permissions.includes('shell_exec.cross_workspace'),
      envOverlayAllowed: boundary.actor.permissions.includes('shell_exec.env_overlay'),
      workspaceBoundaryStatus: workspaceBoundaryReview?.status || 'not_evaluated',
      workspaceBoundaryWarnings: boundaryWarningReasons
    },
    filesystem: {
      cwd: boundary.workspace.effectiveCwd || request.cwd || null,
      allowedRoots: boundary.workspace.allowedRoots,
      scopedRoot: boundary.workspace.scopedRoot,
      outsideScopePathCount: outsideScopeCount,
      writeCandidateCount: workspaceAccessPlan?.writeCandidates?.length || 0,
      writesFilesystem,
      boundaryReview: workspaceBoundaryReview ? {
        kind: workspaceBoundaryReview.kind,
        status: workspaceBoundaryReview.status,
        matchingRootCount: workspaceBoundaryReview.matchingRootCount,
        requestScopedRoot: workspaceBoundaryReview.requestScopedRoot,
        persistedScopedRoot: workspaceBoundaryReview.persistedScopedRoot,
        blockingReasons: workspaceBoundaryReview.blockingReasons,
        warningReasons: workspaceBoundaryReview.warningReasons
      } : null
    },
    network: {
      intentDetected: usesNetwork,
      policy: usesNetwork ? 'requires-hosted-kernel-network-policy' : 'not_requested'
    },
    process: {
      timeoutMs: request.timeoutMs,
      maxTimeoutMs: MAX_TIMEOUT_MS,
      timeoutRisk: request.timeoutMs > DEFAULT_TIMEOUT_MS ? 'extended' : 'default',
      stdinMaxBytes: request.stdin.maxBytes,
      stdinByteLength: request.stdin.byteLength
    },
    evidence: {
      capture: ['command', 'cwd', 'timeout_ms', 'env_overlay_keys', 'stdin_digest', 'workspace_access_plan', 'risk_labels'],
      refs: evidenceRefs,
      riskLabels: [...new Set(riskLabels)].sort()
    }
  };
}

function normalizeEnvKey(value) {
  const key = coerceTrimmedString(value);
  return key ? key.toUpperCase() : null;
}

function normalizeEnvAllowlist(value) {
  const keys = coerceStringList(value)
    .map(normalizeEnvKey)
    .filter((key) => key && ENV_KEY_PATTERN.test(key));
  return [...new Set(keys.length ? keys : DEFAULT_ENV_ALLOWLIST)].sort();
}

function normalizeEnvOverrides(value = {}, envAllowlist = DEFAULT_ENV_ALLOWLIST) {
  const source = readRecord(value);
  const allowed = new Set(envAllowlist);
  const entries = [];
  const rejected = [];

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = normalizeEnvKey(rawKey);
    if (!key || !ENV_KEY_PATTERN.test(key)) {
      rejected.push({ key: String(rawKey), reason: 'invalid_env_key' });
    } else if (!allowed.has(key)) {
      rejected.push({ key, reason: 'not_in_env_allowlist' });
    } else if (rawValue === null || rawValue === undefined) {
      rejected.push({ key, reason: 'empty_env_value' });
    } else {
      entries.push({ key, value: String(rawValue) });
    }
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));
  rejected.sort((left, right) => left.key.localeCompare(right.key));
  return { entries, rejected };
}

function normalizeStdinContract(value) {
  const source = readRecord(value);
  const inline = typeof source.text === 'string'
    ? source.text
    : typeof source.inline === 'string'
      ? source.inline
      : null;
  const mode = inline === null
    ? 'none'
    : source.encoding === 'base64'
      ? 'base64'
      : 'text';
  const byteLength = inline === null ? 0 : Buffer.byteLength(inline, mode === 'base64' ? 'base64' : 'utf8');

  return {
    mode,
    provided: inline !== null,
    byteLength,
    maxBytes: MAX_STDIN_BYTES,
    digest: inline === null ? null : `stdin_${stableShellExecId([mode, inline]).slice(0, 18)}`,
    inline: inline === null ? null : inline
  };
}

function incrementCounter(counters, key, amount = 1) {
  if (!key) return;
  counters[key] = (counters[key] || 0) + amount;
}

function classifyAnalyticsDurationBucket(durationMs) {
  if (!Number.isFinite(durationMs)) return 'unknown';
  return ANALYTICS_DURATION_BUCKETS.find((bucket) => durationMs <= bucket.maxMs)?.id || 'over_5m';
}

function normalizeAnalyticsRiskTier(value, fallback = 'unknown') {
  const tier = coerceTrimmedString(value);
  return tier && ANALYTICS_RISK_TIERS.has(tier) ? tier : fallback;
}

function deriveAnalyticsRiskTier(riskLabels = [], status = null, fallback = 'unknown') {
  if (status === 'blocked' || riskLabels.some((label) => label.includes('blocked') || label.includes('violation'))) {
    return 'blocked';
  }
  if (riskLabels.some((label) => [
    'destructive-pattern',
    'network-access',
    'permission-gap',
    'workspace-boundary-review'
  ].includes(label))) {
    return 'elevated';
  }
  if (riskLabels.some((label) => ['filesystem-write', 'extended-timeout', 'stdin-provided', 'env-overlay'].includes(label))) {
    return 'moderate';
  }
  return normalizeAnalyticsRiskTier(fallback, riskLabels.length ? 'low' : 'unknown');
}

function normalizeClientState(input = {}, request = {}) {
  const state = readRecord(input.clientState || input.client || input.runtimeState);
  const workspace = readRecord(state.workspace || input.workspace);
  const session = readRecord(state.session || input.session);
  const actor = readRecord(state.actor || input.actor);
  const channel = coerceTrimmedString(state.channel || input.channel) || DEFAULT_CLIENT_CHANNEL;
  const workspaceRoot = coerceTrimmedString(workspace.root || input.workspaceRoot || request.cwd);
  const conversationId = coerceTrimmedString(session.conversationId || session.threadId || input.conversationId);
  const turnId = coerceTrimmedString(session.turnId || input.turnId);
  const actorId = coerceTrimmedString(actor.id || input.actorId);
  const handoffTarget = coerceTrimmedString(state.handoffTarget || input.handoffTarget);
  const capabilities = new Set(coerceStringList(state.capabilities || input.capabilities));

  if (request.accepted) capabilities.add('shell_exec.accepted');
  if (workspaceRoot) capabilities.add('workspace.bound');

  return {
    kind: 'shell-exec.client-state.v1',
    channel,
    workspace: {
      root: workspaceRoot,
      label: coerceTrimmedString(workspace.label) || (workspaceRoot ? workspaceRoot.split('/').filter(Boolean).at(-1) : null)
    },
    session: {
      conversationId,
      turnId
    },
    actor: {
      id: actorId,
      role: coerceTrimmedString(actor.role || input.actorRole) || 'operator'
    },
    capabilities: [...capabilities].sort(),
    handoffTarget: handoffTarget || 'hosted-kernel.shell-exec'
  };
}

function normalizeTenantPermissionBoundary(input = {}, request = {}, clientState = {}, persistedState = {}) {
  const tenantSource = readRecord(input.tenant || input.account || input.organization);
  const workspaceSource = readRecord(input.workspace || input.workspaceScope || readRecord(input.clientState).workspace);
  const permissionSource = readRecord(input.permissions || input.authorization || input.policy);
  const actorRole = coerceTrimmedString(clientState.actor?.role) || 'operator';
  const tenantId = coerceTrimmedString(
    tenantSource.id
      || tenantSource.tenantId
      || workspaceSource.tenantId
      || permissionSource.tenantId
      || input.tenantId
  );
  const requestTenantId = coerceTrimmedString(request.tenantId || input.requestTenantId);
  const persistedTenantId = coerceTrimmedString(
    persistedState.persistedBinding?.tenantId
      || readRecord(input.persistedState).tenantId
      || readRecord(input.state).tenantId
  );
  const workspaceRoot = normalizePathScope(clientState.workspace?.root || workspaceSource.root || request.cwd);
  const declaredRoots = [
    workspaceRoot,
    ...coerceStringList(workspaceSource.allowedRoots || permissionSource.allowedWorkspaceRoots || input.allowedWorkspaceRoots)
      .map(normalizePathScope)
  ].filter(Boolean);
  const allowedRoots = [...new Set(declaredRoots)];
  const effectiveCwd = normalizePathScope(request.cwd || workspaceRoot);
  const scopedRoot = firstScopedRoot(effectiveCwd, allowedRoots);
  const permissionSet = new Set([
    ...coerceStringList(ROLE_PERMISSION_DEFAULTS[actorRole] || ROLE_PERMISSION_DEFAULTS.operator),
    ...coerceStringList(permissionSource.grants || permissionSource.capabilities || input.permissionGrants)
  ]);
  const deniedPermissions = [];

  if (request.previewOnly === false && !permissionSet.has('shell_exec.dispatch')) {
    deniedPermissions.push('shell_exec.dispatch');
  }
  if (request.accepted && !permissionSet.has('shell_exec.accept')) {
    deniedPermissions.push('shell_exec.accept');
  }
  if (request.envOverlay.entries.length && !permissionSet.has('shell_exec.env_overlay')) {
    deniedPermissions.push('shell_exec.env_overlay');
  }
  const hasCrossWorkspaceGrant = permissionSet.has('shell_exec.cross_workspace');
  if (effectiveCwd && allowedRoots.length && !scopedRoot && !hasCrossWorkspaceGrant) {
    deniedPermissions.push('shell_exec.workspace_scope');
  }

  const tenantMatched = !requestTenantId || !tenantId || requestTenantId === tenantId;
  const persistedTenantMatched = !persistedTenantId || !tenantId || persistedTenantId === tenantId;
  const boundaryStatus = deniedPermissions.length || !tenantMatched || !persistedTenantMatched
    ? 'blocked'
    : scopedRoot || !effectiveCwd
      ? 'scoped'
      : 'unscoped';

  return {
    kind: 'shell-exec.tenant-permission-boundary.v1',
    tenant: {
      id: tenantId,
      requestTenantId,
      persistedTenantId,
      matched: tenantMatched,
      persistedMatched: persistedTenantMatched
    },
    actor: {
      id: clientState.actor?.id || null,
      role: actorRole,
      permissions: [...permissionSet].sort(),
      deniedPermissions: [...new Set(deniedPermissions)].sort()
    },
    workspace: {
      root: workspaceRoot,
      requestedCwd: request.cwd,
      effectiveCwd,
      allowedRoots,
      scopedRoot,
      withinAllowedRoots: Boolean(!effectiveCwd || !allowedRoots.length || scopedRoot || hasCrossWorkspaceGrant)
    },
    status: boundaryStatus,
    auditTags: [
      tenantId ? `tenant:${tenantId}` : 'tenant:unbound',
      `role:${actorRole}`,
      scopedRoot ? 'workspace:scoped' : 'workspace:unscoped'
    ]
  };
}

function buildWorkspaceBoundaryReview(request, boundary, persistedState = {}) {
  const effectiveCwd = boundary.workspace.effectiveCwd || request.cwd || boundary.workspace.root || null;
  const allowedRoots = boundary.workspace.allowedRoots || [];
  const persistedCwd = normalizePathScope(persistedState.persistedBinding?.cwd);
  const requestScopedRoot = effectiveCwd ? firstScopedRoot(effectiveCwd, allowedRoots) : null;
  const persistedScopedRoot = persistedCwd ? firstScopedRoot(persistedCwd, allowedRoots) : null;
  const matchingRoots = effectiveCwd
    ? allowedRoots.filter((root) => isPathInsideScope(effectiveCwd, root))
    : [];
  const rootRelations = allowedRoots.map((root) => {
    const containsCwd = effectiveCwd ? isPathInsideScope(effectiveCwd, root) : false;
    const containsWorkspaceRoot = boundary.workspace.root ? isPathInsideScope(boundary.workspace.root, root) : false;
    const containedByWorkspaceRoot = boundary.workspace.root ? isPathInsideScope(root, boundary.workspace.root) : false;
    const containsPersistedCwd = persistedCwd ? isPathInsideScope(persistedCwd, root) : false;

    return {
      root,
      containsCwd,
      containsWorkspaceRoot,
      containedByWorkspaceRoot,
      containsPersistedCwd,
      role: root === boundary.workspace.root
        ? 'workspace_root'
        : containsWorkspaceRoot
          ? 'workspace_parent'
          : containedByWorkspaceRoot
            ? 'workspace_child'
            : 'declared_root'
    };
  });
  const crossWorkspaceAllowed = boundary.actor.permissions.includes('shell_exec.cross_workspace');
  const persistedCwdOutsideScope = Boolean(persistedCwd && allowedRoots.length && !persistedScopedRoot && !crossWorkspaceAllowed);
  const persistedCwdRootChanged = Boolean(
    persistedCwd
      && effectiveCwd
      && requestScopedRoot
      && persistedScopedRoot
      && requestScopedRoot !== persistedScopedRoot
      && !crossWorkspaceAllowed
  );
  const ambiguousRootSelection = matchingRoots.length > 1 && !crossWorkspaceAllowed;
  const workspaceRootShadowed = rootRelations.some((relation) => relation.role === 'workspace_parent') && !crossWorkspaceAllowed;
  const requestCwdAlias = Boolean(
    request.cwd
      && effectiveCwd
      && request.cwd !== effectiveCwd
      && normalizePathScope(request.cwd) === effectiveCwd
  );
  const blockingReasons = [
    ...(persistedCwdOutsideScope ? ['persisted_cwd_outside_allowed_workspace_roots'] : []),
    ...(persistedCwdRootChanged ? ['persisted_cwd_scoped_to_different_workspace_root'] : []),
    ...(ambiguousRootSelection ? ['ambiguous_allowed_workspace_root_selection'] : []),
    ...(workspaceRootShadowed ? ['workspace_root_shadowed_by_parent_allowed_root'] : [])
  ];
  const warningReasons = [
    ...(requestCwdAlias ? ['request_cwd_normalized_alias'] : []),
    ...(matchingRoots.length === 0 && effectiveCwd && !allowedRoots.length ? ['workspace_roots_unbound'] : []),
    ...(persistedCwd && !persistedState.usable ? ['persisted_workspace_binding_stale'] : [])
  ];
  const status = blockingReasons.length
    ? 'blocked'
    : warningReasons.length
      ? 'review'
      : 'scoped';

  return {
    kind: 'shell-exec.workspace-boundary-review.v1',
    status,
    effectiveCwd,
    requestScopedRoot,
    persistedCwd,
    persistedScopedRoot,
    matchingRootCount: matchingRoots.length,
    matchingRoots,
    rootRelations,
    crossWorkspaceAllowed,
    blockingReasons,
    warningReasons,
    auditHandoff: {
      required: blockingReasons.length > 0 || warningReasons.length > 0,
      route: blockingReasons.length ? 'shellExec.audit.boundary.blocked' : 'shellExec.audit.boundary.review',
      refs: [
        `request:${request.id}`,
        `cwd:${effectiveCwd || 'workspace-unbound'}`,
        `scoped-root:${requestScopedRoot || 'none'}`,
        `persisted-cwd:${persistedCwd || 'none'}`,
        `matching-roots:${matchingRoots.length}`
      ]
    },
    proofTags: [
      `workspace-boundary:${status}`,
      `matching-roots:${matchingRoots.length}`,
      `persisted-workspace:${persistedCwd ? persistedScopedRoot ? 'scoped' : 'unscoped' : 'none'}`
    ]
  };
}

function normalizeShellExecRequest(input = {}) {
  const request = input.request && typeof input.request === 'object' ? input.request : input;
  const argv = coerceStringList(request.argv);
  const command = typeof request.command === 'string' ? request.command.trim() : argv.join(' ').trim();
  const cwd = typeof request.cwd === 'string' && request.cwd.trim() ? request.cwd.trim() : null;
  const timeoutMs = Number.isFinite(request.timeoutMs)
    ? Math.max(1_000, Math.min(Math.trunc(request.timeoutMs), MAX_TIMEOUT_MS))
    : DEFAULT_TIMEOUT_MS;
  const envAllowlist = normalizeEnvAllowlist(request.envAllowlist);
  const envOverlay = normalizeEnvOverrides(request.env || request.envOverlay || request.envOverrides, envAllowlist);
  const stdin = normalizeStdinContract(request.stdin);
  const commandIntent = buildCommandIntentContract(command, argv);
  const requiresAcceptance = request.requiresAcceptance !== false;
  const idempotencyKey = coerceTrimmedString(request.idempotencyKey || request.commandKey)
    || `shell_exec_idem_${stableShellExecId([command, cwd || 'workspace', argv.join('\0')])}`;

  return {
    id: typeof request.id === 'string' && request.id.trim()
      ? request.id.trim()
      : `shell_exec_${stableShellExecId([command || 'empty', cwd || 'workspace']).slice(0, 18)}`,
    idempotencyKey,
    tenantId: coerceTrimmedString(request.tenantId || request.tenant || request.accountId),
    command,
    argv,
    commandIntent,
    cwd,
    timeoutMs,
    envAllowlist,
    envOverlay,
    stdin,
    executionMode: request.previewOnly === false ? 'hosted-kernel-dispatch' : 'preview',
    previewOnly: request.previewOnly !== false,
    requiresAcceptance,
    accepted: request.accepted === true,
    reason: typeof request.reason === 'string' ? request.reason.trim() : ''
  };
}

function normalizePersistedShellExecState(input = {}, request = {}, clientState = {}) {
  const persisted = readRecord(input.persistedState || input.state || input.executionState);
  const storedRequest = readRecord(persisted.request);
  const storedCheckpoint = readRecord(persisted.persistenceCheckpoint || persisted.checkpoint);
  const storedLease = readRecord(persisted.recoveryLease || storedCheckpoint.recoveryLease || persisted.lease);
  const storedProviderSync = readRecord(persisted.providerSync || persisted.provider || persisted.sync);
  const storedStatus = coerceStatus(persisted.status || persisted.phase);
  const storedIdempotencyKey = coerceTrimmedString(persisted.idempotencyKey || storedRequest.idempotencyKey);
  const currentBinding = {
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    command: request.command,
    cwd: request.cwd || clientState.workspace?.root || null,
    conversationId: clientState.session?.conversationId || null
  };
  const persistedBinding = {
    requestId: coerceTrimmedString(persisted.requestId || storedRequest.id),
    idempotencyKey: storedIdempotencyKey,
    command: coerceTrimmedString(storedRequest.command || persisted.command),
    cwd: coerceTrimmedString(storedRequest.cwd || persisted.cwd),
    conversationId: coerceTrimmedString(readRecord(persisted.clientCorrelation).conversationId || readRecord(persisted.session).conversationId),
    tenantId: coerceTrimmedString(persisted.tenantId || readRecord(persisted.boundary).tenantId || readRecord(persisted.workspace).tenantId)
  };
  const sameIntent = Boolean(
    persistedBinding.idempotencyKey
      && persistedBinding.idempotencyKey === currentBinding.idempotencyKey
      && (!persistedBinding.command || persistedBinding.command === currentBinding.command)
  );
  const sameWorkspace = !persistedBinding.cwd || !currentBinding.cwd || persistedBinding.cwd === currentBinding.cwd;
  const sameConversation = !persistedBinding.conversationId
    || !currentBinding.conversationId
    || persistedBinding.conversationId === currentBinding.conversationId;
  const usable = sameIntent && sameWorkspace && sameConversation;

  return {
    kind: 'shell-exec.persisted-state.v1',
    present: Object.keys(persisted).length > 0,
    usable,
    status: usable ? storedStatus : 'stale',
    persistedBinding,
    currentBinding,
    attempts: Number.isFinite(persisted.attempts) ? Math.max(0, Math.trunc(persisted.attempts)) : 0,
    lastRunId: coerceTrimmedString(persisted.lastRunId || persisted.runId),
    lastStartedAt: coerceTrimmedString(persisted.lastStartedAt || persisted.startedAt),
    lastFinishedAt: coerceTrimmedString(persisted.lastFinishedAt || persisted.finishedAt),
    checkpointUpdatedAt: coerceIsoTimestamp(persisted.updatedAt || persisted.checkpointUpdatedAt || storedCheckpoint.generatedAt),
    lease: {
      key: coerceTrimmedString(storedLease.leaseKey || persisted.leaseKey),
      runEpoch: coerceTrimmedString(storedCheckpoint.runEpoch || persisted.runEpoch),
      expiresAt: coerceIsoTimestamp(storedLease.expiresAt || persisted.leaseExpiresAt),
      owner: coerceTrimmedString(storedLease.owner || storedLease.providerId || storedProviderSync.providerId),
      providerCursor: coerceTrimmedString(storedLease.providerCursor || storedProviderSync.cursor),
      previousRunId: coerceTrimmedString(storedLease.previousRunId || persisted.lastRunId || persisted.runId)
    },
    providerBinding: {
      providerId: coerceTrimmedString(storedProviderSync.providerId || storedProviderSync.id),
      cursor: coerceTrimmedString(storedProviderSync.cursor || storedProviderSync.version || storedProviderSync.etag),
      contractKey: coerceTrimmedString(storedProviderSync.contractKey)
    },
    resultDigest: readRecord(persisted.resultDigest),
    recoveryReason: usable
      ? null
      : Object.keys(persisted).length > 0
        ? 'persisted_state_does_not_match_current_shell_exec_intent'
        : null
  };
}

function buildPersistedLeaseRecoveryContract(request, persistedState, providerContract, now, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const nowMs = Date.parse(now);
  const active = persistedState.usable && ACTIVE_EXECUTION_STATUSES.has(persistedState.status);
  const queued = persistedState.usable && persistedState.status === 'queued';
  const running = persistedState.usable && persistedState.status === 'running';
  const terminal = persistedState.usable && TERMINAL_EXECUTION_STATUSES.has(persistedState.status);
  const observedAt = coerceIsoTimestamp(
    persistedState.checkpointUpdatedAt
      || persistedState.lastStartedAt
      || persistedState.lastFinishedAt
  );
  const observedMs = observedAt ? Date.parse(observedAt) : null;
  const leaseExpiresAt = persistedState.lease.expiresAt;
  const leaseExpiresMs = leaseExpiresAt ? Date.parse(leaseExpiresAt) : null;
  const inferredExpiresMs = Number.isFinite(observedMs)
    ? observedMs + (queued ? QUEUED_LEASE_TTL_MS : timeoutMs + ACTIVE_LEASE_GRACE_MS)
    : null;
  const effectiveExpiresMs = Number.isFinite(leaseExpiresMs) ? leaseExpiresMs : inferredExpiresMs;
  const expired = Boolean(active && Number.isFinite(nowMs) && Number.isFinite(effectiveExpiresMs) && nowMs > effectiveExpiresMs);
  const missingRunIdentity = running && !persistedState.lastRunId && !persistedState.lease.previousRunId;
  const providerChanged = Boolean(
    active
      && persistedState.providerBinding.providerId
      && providerContract.provider.id
      && persistedState.providerBinding.providerId !== providerContract.provider.id
  );
  const reclaimRequired = expired || missingRunIdentity || providerChanged;
  const reclaimToken = reclaimRequired
    ? `reclaim_${stableShellExecId([
      request.idempotencyKey,
      persistedState.lastRunId || persistedState.lease.previousRunId || persistedState.lease.runEpoch || 'run-unbound',
      providerContract.provider.id,
      effectiveExpiresMs ? new Date(effectiveExpiresMs).toISOString() : 'lease-unbounded'
    ]).slice(0, 20)}`
    : null;

  return {
    kind: 'shell-exec.persisted-lease-recovery.v1',
    generatedAt: now,
    active,
    queued,
    running,
    terminal,
    observedAt,
    ageMs: Number.isFinite(nowMs) && Number.isFinite(observedMs) ? Math.max(0, nowMs - observedMs) : null,
    effectiveExpiresAt: Number.isFinite(effectiveExpiresMs) ? new Date(effectiveExpiresMs).toISOString() : null,
    expired,
    missingRunIdentity,
    providerChanged,
    reclaimRequired,
    reclaimToken,
    restartAction: terminal
      ? 'return_terminal'
      : reclaimRequired
        ? 'reclaim_expired_or_unbound_active_run'
        : active
          ? 'recover_active_run'
          : 'claim_new_run',
    conflictReasons: [
      ...(expired ? ['active_lease_expired'] : []),
      ...(missingRunIdentity ? ['running_state_missing_run_identity'] : []),
      ...(providerChanged ? ['persisted_provider_binding_changed'] : [])
    ],
    compareAndSet: {
      expectedLeaseKey: persistedState.lease.key,
      expectedRunId: persistedState.lastRunId || persistedState.lease.previousRunId,
      expectedProviderCursor: persistedState.lease.providerCursor || persistedState.providerBinding.cursor,
      reclaimToken
    }
  };
}

function normalizeProviderState(input = {}, clientState = {}) {
  const provider = readRecord(input.provider || input.serviceProvider || input.integrationProvider);
  const service = readRecord(provider.shellExec || provider.shell_exec || provider.service);
  const providerId = coerceTrimmedString(provider.id || provider.providerId || service.providerId)
    || clientState.handoffTarget
    || 'hosted-kernel.shell-exec';
  const protocolVersion = coerceTrimmedString(provider.protocolVersion || service.protocolVersion) || 'shell-exec-provider.v1';
  const advertisedCapabilities = new Set([
    ...HOSTED_PROVIDER_CAPABILITIES,
    ...coerceStringList(provider.capabilities),
    ...coerceStringList(service.capabilities)
  ]);
  const sync = readRecord(provider.sync || service.sync || input.sync);
  const external = readRecord(provider.externalHandoff || service.externalHandoff || input.externalHandoff);

  return {
    kind: 'shell-exec.provider-state.v1',
    providerId,
    protocolVersion,
    endpoint: coerceTrimmedString(provider.endpoint || service.endpoint),
    channel: coerceTrimmedString(provider.channel || service.channel) || clientState.channel,
    advertisedCapabilities: [...advertisedCapabilities].sort(),
    sync: {
      cursor: coerceTrimmedString(sync.cursor || sync.version || sync.etag),
      leaseId: coerceTrimmedString(sync.leaseId || sync.claimId),
      lastSyncedAt: coerceIsoTimestamp(sync.lastSyncedAt || sync.syncedAt || sync.updatedAt)
    },
    externalHandoff: {
      state: coerceTrimmedString(external.state || external.phase) || 'not_started',
      token: coerceTrimmedString(external.token || external.handoffToken),
      url: coerceTrimmedString(external.url || external.href),
      expiresAt: coerceIsoTimestamp(external.expiresAt)
    }
  };
}

function normalizeProviderHealthState(input = {}) {
  const provider = readRecord(input.provider || input.serviceProvider || input.integrationProvider);
  const service = readRecord(provider.shellExec || provider.shell_exec || provider.service);
  const health = readRecord(provider.health || service.health || input.providerHealth || input.health);
  const circuit = readRecord(health.circuitBreaker || health.circuit || provider.circuitBreaker);
  const status = coerceTrimmedString(health.status || health.state || provider.status) || 'healthy';
  const lastError = readRecord(health.lastError || provider.lastError || input.lastError);
  const failureCount = coerceNonNegativeInteger(health.failureCount ?? health.consecutiveFailures ?? provider.failureCount);
  const retryAfterMs = coerceNonNegativeInteger(health.retryAfterMs ?? health.backoffMs, null);
  const lastCheckedAt = coerceIsoTimestamp(health.lastCheckedAt || health.checkedAt || provider.lastHealthCheckAt);
  const observedAt = coerceIsoTimestamp(
    health.observedAt
      || health.updatedAt
      || service.lastSyncedAt
      || provider.updatedAt
      || lastCheckedAt
  );
  const healthCheckRequired = health.required !== false && provider.healthRequired !== false;
  const healthCheckMissing = healthCheckRequired && !lastCheckedAt;

  return {
    kind: 'shell-exec.provider-health-state.v1',
    status,
    degradedReason: coerceTrimmedString(health.degradedReason || health.reason || provider.degradedReason),
    lastCheckedAt,
    observedAt,
    freshness: {
      required: healthCheckRequired,
      missing: healthCheckMissing,
      freshForMs: coerceNonNegativeInteger(health.freshForMs ?? provider.healthFreshForMs, PROVIDER_HEALTH_FRESH_MS),
      staleAfterMs: coerceNonNegativeInteger(health.staleAfterMs ?? provider.healthStaleAfterMs, PROVIDER_HEALTH_STALE_MS),
      maxDispatchAgeMs: coerceNonNegativeInteger(health.maxDispatchAgeMs ?? provider.maxDispatchHealthAgeMs, PROVIDER_HEALTH_FRESH_MS)
    },
    failureCount,
    retryAfterMs,
    lastError: {
      code: coerceTrimmedString(lastError.code || health.errorCode),
      message: coerceTrimmedString(lastError.message || health.errorMessage),
      retryable: lastError.retryable === true || health.retryable === true
    },
    circuitBreaker: {
      state: coerceTrimmedString(circuit.state || circuit.status) || 'closed',
      openedAt: coerceIsoTimestamp(circuit.openedAt),
      halfOpenAt: coerceIsoTimestamp(circuit.halfOpenAt),
      failureThreshold: coerceNonNegativeInteger(circuit.failureThreshold, MAX_RETRY_ATTEMPTS)
    }
  };
}

function buildProviderHealthFreshness(providerHealth, now) {
  const nowMs = Date.parse(now);
  const checkedMs = providerHealth.lastCheckedAt ? Date.parse(providerHealth.lastCheckedAt) : null;
  const ageMs = Number.isFinite(nowMs) && Number.isFinite(checkedMs) ? Math.max(0, nowMs - checkedMs) : null;
  const freshForMs = Math.max(1_000, providerHealth.freshness.freshForMs || PROVIDER_HEALTH_FRESH_MS);
  const staleAfterMs = Math.max(freshForMs, providerHealth.freshness.staleAfterMs || PROVIDER_HEALTH_STALE_MS);
  const maxDispatchAgeMs = Math.max(1_000, providerHealth.freshness.maxDispatchAgeMs || freshForMs);
  const missing = providerHealth.freshness.required && providerHealth.freshness.missing;
  const stale = Number.isFinite(ageMs) && ageMs > staleAfterMs;
  const dispatchExpired = missing || Number.isFinite(ageMs) && ageMs > maxDispatchAgeMs;
  const nextRefreshDueMs = Number.isFinite(checkedMs) ? checkedMs + freshForMs : null;
  const refreshDue = missing || Number.isFinite(nextRefreshDueMs) && Number.isFinite(nowMs) && nowMs >= nextRefreshDueMs;

  return {
    kind: 'shell-exec.provider-health-freshness.v1',
    checkedAt: providerHealth.lastCheckedAt,
    observedAt: providerHealth.observedAt,
    ageMs,
    freshForMs,
    staleAfterMs,
    maxDispatchAgeMs,
    required: providerHealth.freshness.required,
    missing,
    stale,
    refreshDue,
    dispatchExpired,
    nextRefreshDueAt: Number.isFinite(nextRefreshDueMs) ? new Date(nextRefreshDueMs).toISOString() : null,
    status: missing
      ? 'missing'
      : stale
        ? 'stale'
        : dispatchExpired
          ? 'dispatch_expired'
          : refreshDue
            ? 'refresh_due'
            : 'fresh',
    blockingReasons: [
      ...(missing ? ['provider_health_check_missing'] : []),
      ...(stale ? ['provider_health_check_stale'] : []),
      ...(dispatchExpired && !missing && !stale ? ['provider_health_check_dispatch_expired'] : [])
    ]
  };
}

function buildProviderAcknowledgementContract(providerState, request, runtimeEnvelope, persistedState, now) {
  const dispatchRequested = request.previewOnly === false;
  const handoffState = providerState.externalHandoff.state || 'not_started';
  const handoffExpiresMs = providerState.externalHandoff.expiresAt ? Date.parse(providerState.externalHandoff.expiresAt) : null;
  const nowMs = Date.parse(now);
  const handoffExpired = Number.isFinite(handoffExpiresMs) && Number.isFinite(nowMs) && handoffExpiresMs <= nowMs;
  const providerLeaseBound = Boolean(providerState.sync.leaseId && (
    providerState.sync.leaseId === request.idempotencyKey
      || providerState.sync.leaseId === persistedState.lease.key
      || providerState.sync.leaseId === persistedState.providerBinding.contractKey
  ));
  const externalHandoffReady = Boolean(
    providerState.externalHandoff.token
      && PROVIDER_HANDOFF_READY_STATES.has(handoffState)
      && !handoffExpired
  );
  const externalHandoffBlocked = PROVIDER_HANDOFF_BLOCKED_STATES.has(handoffState) || handoffExpired;
  const acknowledgementRequired = dispatchRequested;
  const acknowledged = !acknowledgementRequired || providerLeaseBound || externalHandoffReady;
  const issues = [
    ...(acknowledgementRequired && !providerLeaseBound && !externalHandoffReady ? [{
      code: 'provider_dispatch_ack_missing',
      severity: 'error',
      message: 'Hosted shell-exec dispatch requires a provider lease or a live external handoff token before the run can be queued.'
    }] : []),
    ...(handoffExpired ? [{
      code: 'provider_external_handoff_expired',
      severity: acknowledgementRequired ? 'error' : 'warning',
      message: 'Provider external handoff token is expired and must be refreshed before shell exec dispatch.'
    }] : []),
    ...(externalHandoffBlocked && !handoffExpired ? [{
      code: `provider_external_handoff_${handoffState}`,
      severity: acknowledgementRequired ? 'error' : 'warning',
      message: `Provider external handoff is ${handoffState} and cannot accept shell exec dispatch.`
    }] : []),
    ...(acknowledgementRequired && providerState.sync.leaseId && !providerLeaseBound ? [{
      code: 'provider_lease_id_mismatch',
      severity: 'warning',
      message: 'Provider lease id does not match the current shell exec idempotency key or persisted lease.'
    }] : [])
  ];

  return {
    kind: 'shell-exec.provider-acknowledgement.v1',
    required: acknowledgementRequired,
    acknowledged,
    status: acknowledged
      ? 'acknowledged'
      : externalHandoffBlocked
        ? 'handoff_blocked'
        : 'awaiting_provider_ack',
    dispatchRequested,
    dispatchableAtInput: runtimeEnvelope.dispatchable,
    providerLease: {
      leaseId: providerState.sync.leaseId,
      bound: providerLeaseBound,
      expectedIds: [
        request.idempotencyKey,
        persistedState.lease.key,
        persistedState.providerBinding.contractKey
      ].filter(Boolean)
    },
    externalHandoff: {
      state: handoffState,
      tokenPresent: Boolean(providerState.externalHandoff.token),
      urlPresent: Boolean(providerState.externalHandoff.url),
      expiresAt: providerState.externalHandoff.expiresAt,
      expired: handoffExpired,
      ready: externalHandoffReady
    },
    issues,
    proofTags: [
      `provider-ack:${acknowledged ? 'acknowledged' : 'missing'}`,
      `provider-lease:${providerLeaseBound ? 'bound' : 'unbound'}`,
      `external-handoff:${handoffState}`
    ]
  };
}

function coerceExitCode(value) {
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function normalizeFailureText(value) {
  const text = coerceTrimmedString(value);
  return text ? text.slice(0, 500) : null;
}

function classifyShellFailureSignal({ status, exitCode, signal, stderr, message, providerErrorCode }) {
  const text = [stderr, message, providerErrorCode].filter(Boolean).join('\n').toLowerCase();
  if (status === 'timed_out' || signal === 'SIGTERM' && text.includes('timeout')) {
    return {
      code: 'execution_timeout',
      severity: 'warning',
      retryable: true,
      action: 'increase_timeout_or_retry',
      message: 'Command exceeded the hosted-kernel timeout budget.'
    };
  }
  if (text.includes('enoent') || text.includes('not found') || text.includes('command not found') || exitCode === 127) {
    return {
      code: 'executable_not_found',
      severity: 'error',
      retryable: false,
      action: 'fix_command_or_path',
      message: 'Executable could not be found in the scoped hosted-kernel environment.'
    };
  }
  if (text.includes('permission denied') || text.includes('eacces') || exitCode === 126) {
    return {
      code: 'permission_denied',
      severity: 'error',
      retryable: false,
      action: 'adjust_permissions_or_workspace_scope',
      message: 'Command failed because the executable or target path was not permitted.'
    };
  }
  if (signal) {
    return {
      code: 'terminated_by_signal',
      severity: signal === 'SIGKILL' ? 'error' : 'warning',
      retryable: signal !== 'SIGKILL',
      action: signal === 'SIGKILL' ? 'inspect_resource_limits' : 'retry_or_inspect_signal',
      message: `Command was terminated by ${signal}.`
    };
  }
  if (exitCode !== null && exitCode !== 0) {
    return {
      code: 'non_zero_exit',
      severity: 'warning',
      retryable: exitCode >= 128 || exitCode === 1,
      action: 'inspect_command_output',
      message: `Command exited with code ${exitCode}.`
    };
  }
  if (providerErrorCode || message) {
    return {
      code: providerErrorCode || 'provider_execution_error',
      severity: 'warning',
      retryable: true,
      action: 'retry_or_check_provider',
      message: message || 'Hosted shell-exec provider reported an execution error.'
    };
  }
  return {
    code: 'unknown_execution_failure',
    severity: 'warning',
    retryable: true,
    action: 'inspect_failure_context',
    message: 'Shell exec failed without a structured exit code or provider error.'
  };
}

function buildFailureDiagnostic(input = {}, request = {}, persistedState = {}, providerHealth = null, history = []) {
  const result = readRecord(input.result || input.executionResult || input.lastResult || persistedState.resultDigest);
  const latestFailureEvent = [...history].reverse().find((event) => RETRYABLE_FAILURE_STATUSES.has(event.status)) || null;
  const status = coerceStatus(
    result.status
      || result.phase
      || result.outcome
      || latestFailureEvent?.status
      || persistedState.status,
    persistedState.status
  );
  const exitCode = coerceExitCode(result.exitCode ?? result.code ?? latestFailureEvent?.exitCode);
  const signal = coerceTrimmedString(result.signal || result.termSignal);
  const stderr = normalizeFailureText(result.stderr || result.errorOutput || result.stderrTail || result.outputTail);
  const providerError = readRecord(result.error || result.providerError || providerHealth?.lastError);
  const providerErrorCode = coerceTrimmedString(providerError.code || providerHealth?.lastError?.code);
  const providerErrorMessage = normalizeFailureText(providerError.message || providerHealth?.lastError?.message);
  const active = RETRYABLE_FAILURE_STATUSES.has(status)
    || exitCode !== null && exitCode !== 0
    || Boolean(signal || stderr || providerErrorCode || providerErrorMessage);
  const classification = active
    ? classifyShellFailureSignal({
      status,
      exitCode,
      signal,
      stderr,
      message: providerErrorMessage,
      providerErrorCode
    })
    : null;

  return {
    kind: 'shell-exec.failure-diagnostic.v1',
    active,
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    latestRunId: coerceTrimmedString(result.runId || result.executionId) || latestFailureEvent?.runId || persistedState.lastRunId,
    status,
    exitCode,
    signal,
    stderrTail: stderr,
    providerError: {
      code: providerErrorCode,
      message: providerErrorMessage
    },
    classification,
    retryRecommendation: classification ? {
      retryable: classification.retryable,
      action: classification.action,
      routeHint: classification.retryable ? 'shellExec.retry' : 'shellExec.preview',
      requiresCommandChange: !classification.retryable,
      reasonCode: classification.code
    } : null
  };
}

function normalizeLifecycleSettings(input = {}, request = {}, persistedState = {}, providerHealth = null, now = new Date().toISOString()) {
  const settingsRoot = readRecord(input.settings || input.lifecycleSettings || input.controls);
  const shellSettings = readRecord(settingsRoot.shellExec || settingsRoot.shell_exec || settingsRoot.lifecycle || settingsRoot);
  const schedule = readRecord(shellSettings.schedule || input.schedule || input.scheduling);
  const commandOverrides = readRecord(shellSettings.commands || shellSettings.commandControls || input.commandControls);
  const rawEnabledCommands = coerceStringList(commandOverrides.enabled || shellSettings.enabledCommands)
    .filter((command) => LIFECYCLE_COMMANDS.has(command));
  const rawDisabledCommands = coerceStringList(commandOverrides.disabled || shellSettings.disabledCommands)
    .filter((command) => LIFECYCLE_COMMANDS.has(command));
  const enabledSet = new Set(rawEnabledCommands.length ? rawEnabledCommands : [...LIFECYCLE_COMMANDS]);
  for (const command of rawDisabledCommands) enabledSet.delete(command);

  if (shellSettings.previewEnabled === false) enabledSet.delete('preview');
  if (shellSettings.acceptanceEnabled === false || shellSettings.acceptEnabled === false) enabledSet.delete('accept');
  if (shellSettings.dispatchEnabled === false || shellSettings.enabled === false || shellSettings.paused === true) enabledSet.delete('dispatch');
  if (shellSettings.retryEnabled === false) enabledSet.delete('retry');
  if (shellSettings.recoveryEnabled === false || shellSettings.recoverEnabled === false) enabledSet.delete('recover');
  if (shellSettings.cancelEnabled === false) enabledSet.delete('cancel');

  const maxConcurrentRuns = Number.isFinite(shellSettings.maxConcurrentRuns)
    ? Math.max(0, Math.trunc(shellSettings.maxConcurrentRuns))
    : Number.isFinite(schedule.maxConcurrentRuns)
      ? Math.max(0, Math.trunc(schedule.maxConcurrentRuns))
      : 1;
  const activeRunCount = Number.isFinite(shellSettings.activeRunCount)
    ? Math.max(0, Math.trunc(shellSettings.activeRunCount))
    : Number.isFinite(schedule.activeRunCount)
      ? Math.max(0, Math.trunc(schedule.activeRunCount))
      : ACTIVE_EXECUTION_STATUSES.has(persistedState.status)
        ? 1
        : 0;
  const intervalMs = Number.isFinite(schedule.intervalMs)
    ? Math.max(MIN_SCHEDULE_INTERVAL_MS, Math.min(Math.trunc(schedule.intervalMs), MAX_SCHEDULE_INTERVAL_MS))
    : DEFAULT_SCHEDULE_INTERVAL_MS;
  const earliestDispatchAt = coerceIsoTimestamp(
    schedule.earliestDispatchAt
      || schedule.notBefore
      || shellSettings.earliestDispatchAt
  );
  const latestDispatchAt = coerceIsoTimestamp(
    schedule.latestDispatchAt
      || schedule.notAfter
      || shellSettings.latestDispatchAt
  );
  const nowMs = Date.parse(now);
  const earliestMs = earliestDispatchAt ? Date.parse(earliestDispatchAt) : null;
  const latestMs = latestDispatchAt ? Date.parse(latestDispatchAt) : null;
  const beforeWindow = Number.isFinite(nowMs) && Number.isFinite(earliestMs) && nowMs < earliestMs;
  const afterWindow = Number.isFinite(nowMs) && Number.isFinite(latestMs) && nowMs > latestMs;
  const capacityAvailable = maxConcurrentRuns === 0 ? false : activeRunCount < maxConcurrentRuns;
  const maintenanceMode = shellSettings.maintenanceMode === true || shellSettings.paused === true;
  const pauseReason = coerceTrimmedString(shellSettings.pauseReason || schedule.pauseReason);
  const requireAcceptanceOverride = shellSettings.requireAcceptance === true
    ? 'always'
    : shellSettings.requireAcceptance === false
      ? 'request'
      : 'request';
  const dispatchAllowed = enabledSet.has('dispatch')
    && !maintenanceMode
    && capacityAvailable
    && !beforeWindow
    && !afterWindow;
  const retryAllowed = enabledSet.has('retry') && dispatchAllowed;

  return {
    kind: 'shell-exec.lifecycle-settings.v1',
    generatedAt: now,
    requestId: request.id,
    enabled: shellSettings.enabled !== false && !maintenanceMode,
    maintenanceMode,
    pauseReason,
    commands: {
      enabled: [...enabledSet].sort(),
      disabled: [...LIFECYCLE_COMMANDS].filter((command) => !enabledSet.has(command)).sort(),
      dispatchAllowed,
      retryAllowed,
      acceptanceAllowed: enabledSet.has('accept'),
      previewAllowed: enabledSet.has('preview'),
      recoveryAllowed: enabledSet.has('recover'),
      cancelAllowed: enabledSet.has('cancel')
    },
    scheduling: {
      mode: coerceTrimmedString(schedule.mode) || 'immediate',
      intervalMs,
      earliestDispatchAt,
      latestDispatchAt,
      beforeWindow,
      afterWindow,
      nextDispatchAt: beforeWindow ? earliestDispatchAt : dispatchAllowed ? now : null,
      capacity: {
        activeRunCount,
        maxConcurrentRuns,
        available: capacityAvailable
      }
    },
    policy: {
      requireAcceptance: requireAcceptanceOverride,
      autoDisableOnProviderDown: shellSettings.autoDisableOnProviderDown !== false,
      providerStatusObserved: providerHealth?.status || null,
      circuitStateObserved: providerHealth?.circuitBreaker?.state || null
    },
    disabledReasons: [
      ...(maintenanceMode ? ['maintenance_mode'] : []),
      ...(enabledSet.has('dispatch') ? [] : ['dispatch_disabled']),
      ...(capacityAvailable ? [] : ['concurrency_capacity_exhausted']),
      ...(beforeWindow ? ['before_dispatch_window'] : []),
      ...(afterWindow ? ['after_dispatch_window'] : [])
    ]
  };
}

function buildOperationalHealthContract(request, validation, readiness, persistedState, providerContract, history, input, now, providerHealth = normalizeProviderHealthState(input), lifecycleSettings = null, failureDiagnostic = null, providerHealthFreshness = buildProviderHealthFreshness(providerHealth, now)) {
  const latestEvent = history.at(-1) || null;
  const terminalFailures = history.filter((event) => RETRYABLE_FAILURE_STATUSES.has(event.status));
  let consecutiveFailures = 0;
  for (const event of [...history].reverse()) {
    if (!RETRYABLE_FAILURE_STATUSES.has(event.status)) break;
    consecutiveFailures += 1;
  }
  const attempts = Math.max(persistedState.attempts, terminalFailures.length, providerHealth.failureCount);
  const retryableLastFailure = Boolean(
    latestEvent
      && RETRYABLE_FAILURE_STATUSES.has(latestEvent.status)
      && latestEvent.status !== 'blocked'
  );
  const providerCapabilityGap = providerContract.negotiation.accepted === false;
  const providerContractIssue = providerContract.negotiation.contractIssues?.find((issue) => issue.severity === 'error')
    || providerContract.negotiation.contractIssues?.[0]
    || null;
  const lifecycleDispatchBlocked = lifecycleSettings?.commands?.dispatchAllowed === false;
  const lifecycleRetryBlocked = lifecycleSettings?.commands?.retryAllowed === false;
  const circuitOpen = providerHealth.circuitBreaker.state === 'open';
  const externallyDegraded = ['degraded', 'unhealthy', 'down'].includes(providerHealth.status) || circuitOpen;
  const healthFreshnessBlocked = !request.previewOnly && providerHealthFreshness.dispatchExpired;
  const healthRefreshDue = providerHealthFreshness.refreshDue && !providerHealthFreshness.dispatchExpired;
  const nonRetryableFailure = failureDiagnostic?.active && failureDiagnostic.classification?.retryable === false;
  const validationBlocked = validation.errorCount > 0;
  const backoffMs = providerHealth.retryAfterMs ?? Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** Math.min(attempts, 5)));
  const retryAfterMs = Math.max(backoffMs, healthFreshnessBlocked ? Math.min(MAX_RETRY_DELAY_MS, PROVIDER_HEALTH_FRESH_MS) : 0);
  const nextAttemptAtMs = Date.parse(now) + retryAfterMs;
  const retryAllowed = retryableLastFailure
    && attempts < MAX_RETRY_ATTEMPTS
    && !nonRetryableFailure
    && !providerCapabilityGap
    && !circuitOpen
    && !healthFreshnessBlocked
    && !validationBlocked
    && !lifecycleRetryBlocked
    && readiness.ready;
  const status = validationBlocked
    ? 'blocked'
    : lifecycleDispatchBlocked
      ? 'paused'
      : providerCapabilityGap || externallyDegraded || healthFreshnessBlocked || nonRetryableFailure || attempts >= MAX_RETRY_ATTEMPTS
      ? 'degraded'
      : retryableLastFailure
        ? 'retry_wait'
        : healthRefreshDue
          ? 'refresh_due'
          : 'healthy';
  const actionableErrors = [];

  if (validationBlocked) {
    actionableErrors.push(...validation.findings
      .filter((finding) => finding.severity === 'error')
      .map((finding) => ({
        code: finding.code,
        severity: 'error',
        message: finding.message,
        action: 'resolve_request_validation',
        routeHint: 'shellExec.preview'
      })));
  }
  if (providerCapabilityGap) {
    actionableErrors.push({
      code: providerContract.negotiation.missingCapabilities.length ? 'provider_capability_gap' : providerContractIssue?.code || 'provider_contract_gap',
      severity: 'error',
      message: providerContract.negotiation.missingCapabilities.length
        ? `Provider is missing required shell-exec capabilities: ${providerContract.negotiation.missingCapabilities.join(', ')}.`
        : providerContractIssue?.message || 'Provider shell-exec contract must be acknowledged before dispatch.',
      action: providerContract.negotiation.missingCapabilities.length ? 'negotiate_provider_capabilities' : 'prepare_provider_acknowledgement',
      routeHint: providerContract.externalHandoffState.nextRoute
    });
  }
  if (externallyDegraded) {
    actionableErrors.push({
      code: circuitOpen ? 'provider_circuit_open' : 'provider_degraded',
      severity: 'warning',
      message: providerHealth.degradedReason || providerHealth.lastError.message || 'Hosted shell-exec provider reported degraded health.',
      action: circuitOpen ? 'wait_for_circuit_half_open' : 'route_to_degraded_mode',
      routeHint: 'shellExec.provider.health'
    });
  }
  if (providerHealthFreshness.dispatchExpired) {
    actionableErrors.push({
      code: providerHealthFreshness.missing ? 'provider_health_check_missing' : 'provider_health_check_stale',
      severity: request.previewOnly ? 'warning' : 'error',
      message: providerHealthFreshness.missing
        ? 'Hosted shell-exec provider has not published a health check for this dispatch contract.'
        : `Hosted shell-exec provider health check is ${providerHealthFreshness.ageMs}ms old, above the ${providerHealthFreshness.maxDispatchAgeMs}ms dispatch freshness budget.`,
      action: 'refresh_provider_health_before_dispatch',
      routeHint: 'shellExec.provider.health',
      retryable: true,
      retryAfterMs,
      checkedAt: providerHealthFreshness.checkedAt,
      maxDispatchAgeMs: providerHealthFreshness.maxDispatchAgeMs
    });
  } else if (healthRefreshDue) {
    actionableErrors.push({
      code: 'provider_health_refresh_due',
      severity: 'info',
      message: `Hosted shell-exec provider health check should be refreshed before the next dispatch window; current age is ${providerHealthFreshness.ageMs}ms.`,
      action: 'refresh_provider_health',
      routeHint: 'shellExec.provider.health',
      retryable: true,
      checkedAt: providerHealthFreshness.checkedAt,
      nextRefreshDueAt: providerHealthFreshness.nextRefreshDueAt
    });
  }
  if (failureDiagnostic?.active && failureDiagnostic.classification) {
    actionableErrors.push({
      code: failureDiagnostic.classification.code,
      severity: failureDiagnostic.classification.severity,
      message: failureDiagnostic.classification.message,
      action: failureDiagnostic.classification.action,
      routeHint: failureDiagnostic.retryRecommendation.routeHint,
      retryable: failureDiagnostic.retryRecommendation.retryable,
      runId: failureDiagnostic.latestRunId,
      exitCode: failureDiagnostic.exitCode,
      signal: failureDiagnostic.signal
    });
  }
  if (lifecycleDispatchBlocked) {
    actionableErrors.push({
      code: 'lifecycle_dispatch_disabled',
      severity: 'warning',
      message: lifecycleSettings.disabledReasons.length
        ? `Shell exec dispatch is held by lifecycle settings: ${lifecycleSettings.disabledReasons.join(', ')}.`
        : 'Shell exec dispatch is held by lifecycle settings.',
      action: 'review_lifecycle_settings',
      routeHint: 'shellExec.settings'
    });
  }
  if (attempts >= MAX_RETRY_ATTEMPTS && retryableLastFailure) {
    actionableErrors.push({
      code: 'retry_budget_exhausted',
      severity: 'error',
      message: `Shell exec retry budget exhausted after ${attempts} attempts.`,
      action: 'require_operator_review',
      routeHint: 'shellExec.recover'
    });
  }

  return {
    kind: 'shell-exec.operational-health.v1',
    generatedAt: now,
    requestId: request.id,
    health: {
      status,
      providerStatus: providerHealth.status,
      circuitState: providerHealth.circuitBreaker.state,
      healthFreshnessStatus: providerHealthFreshness.status,
      degradedReason: actionableErrors[0]?.message || null,
      readinessReady: readiness.ready,
      validationOk: validation.ok
    },
    providerFreshness: providerHealthFreshness,
    failureState: {
      attempts,
      maxAttempts: MAX_RETRY_ATTEMPTS,
      consecutiveFailures,
      latestStatus: latestEvent?.status || persistedState.status,
      latestRunId: latestEvent?.runId || persistedState.lastRunId,
      lastError: providerHealth.lastError,
      diagnostic: failureDiagnostic ? {
        kind: failureDiagnostic.kind,
        active: failureDiagnostic.active,
        status: failureDiagnostic.status,
        exitCode: failureDiagnostic.exitCode,
        signal: failureDiagnostic.signal,
        classification: failureDiagnostic.classification,
        retryRecommendation: failureDiagnostic.retryRecommendation
      } : null
    },
    retryPolicy: {
      retryAllowed,
      retryableLastFailure,
      backoffMs: retryAfterMs,
      providerHealthRefreshRequired: providerHealthFreshness.dispatchExpired,
      nextAttemptAfterMs: retryAllowed ? retryAfterMs : null,
      nextAttemptAt: retryAllowed && Number.isFinite(nextAttemptAtMs) ? new Date(nextAttemptAtMs).toISOString() : null,
      nextAttemptKey: retryAllowed ? `retry_${stableShellExecId([request.idempotencyKey, String(attempts + 1), String(retryAfterMs)]).slice(0, 18)}` : null
    },
    degradedMode: {
      active: status === 'degraded' || status === 'paused',
      dispatchAllowed: status !== 'degraded' && status !== 'paused',
      route: status === 'paused'
        ? 'shellExec.settings'
        : status === 'degraded' && healthFreshnessBlocked
          ? 'shellExec.provider.health'
        : status === 'degraded' && nonRetryableFailure
          ? 'shellExec.preview'
          : status === 'degraded'
            ? 'shellExec.provider.health'
            : null,
      userVisibleMode: status === 'paused'
        ? 'Lifecycle settings review required before dispatch'
        : status === 'degraded' && healthFreshnessBlocked
          ? 'Provider health refresh required before dispatch'
        : status === 'degraded' && nonRetryableFailure
          ? 'Command must be corrected before retry'
          : status === 'degraded'
            ? 'Provider health review required before dispatch'
            : 'Normal hosted-kernel dispatch'
    },
    actionableErrors
  };
}

function buildProviderServiceContract(input, request, validation, readiness, runtimeEnvelope, persistedState, clientState, now) {
  const providerState = normalizeProviderState(input, clientState);
  const requiredCapabilities = new Set(BASE_PROVIDER_CAPABILITIES);
  if (request.accepted) requiredCapabilities.add('shell_exec.accepted_dispatch');
  if (runtimeEnvelope.dispatchable) requiredCapabilities.add('shell_exec.cancellable_run');
  if (request.argv.length) requiredCapabilities.add('shell_exec.argv');
  if (request.previewOnly) requiredCapabilities.add('shell_exec.preview_only');

  const provided = new Set(providerState.advertisedCapabilities);
  const missingCapabilities = [...requiredCapabilities].filter((capability) => !provided.has(capability)).sort();
  const providerAcknowledgement = buildProviderAcknowledgementContract(providerState, request, runtimeEnvelope, persistedState, now);
  const providerContractIssues = providerAcknowledgement.issues;
  const accepted = missingCapabilities.length === 0 && !providerContractIssues.some((issue) => issue.severity === 'error');
  const syncCursor = providerState.sync.cursor
    || persistedState.lastRunId
    || `sync_${stableShellExecId([request.idempotencyKey, runtimeEnvelope.executor.cwd || 'workspace']).slice(0, 18)}`;
  const negotiationStatus = missingCapabilities.length
    ? 'capability_gap'
    : providerContractIssues.some((issue) => issue.severity === 'error')
      ? 'provider_ack_required'
      : providerContractIssues.length
        ? 'provider_ack_review'
        : 'compatible';

  return {
    kind: 'shell-exec.provider-service-contract.v1',
    generatedAt: now,
    provider: {
      id: providerState.providerId,
      protocolVersion: providerState.protocolVersion,
      endpoint: providerState.endpoint,
      channel: providerState.channel
    },
    negotiation: {
      accepted,
      requiredCapabilities: [...requiredCapabilities].sort(),
      advertisedCapabilities: providerState.advertisedCapabilities,
      missingCapabilities,
      contractIssues: providerContractIssues,
      status: negotiationStatus,
      dispatchEligible: accepted && validation.errorCount === 0 && readiness.ready && providerAcknowledgement.acknowledged
    },
    syncMetadata: {
      contractKey: `shell-exec-provider/${providerState.providerId}/${request.idempotencyKey}`,
      cursor: syncCursor,
      leaseId: providerState.sync.leaseId || request.idempotencyKey,
      lastSyncedAt: providerState.sync.lastSyncedAt,
      expectedPersistedStatus: persistedState.status,
      stateStoreKey: `shell-exec/${request.idempotencyKey}`,
      providerAcknowledgementStatus: providerAcknowledgement.status,
      providerLeaseBound: providerAcknowledgement.providerLease.bound
    },
    providerAcknowledgement,
    externalHandoffState: {
      target: providerState.providerId,
      state: providerState.externalHandoff.state,
      token: providerState.externalHandoff.token,
      url: providerState.externalHandoff.url,
      expiresAt: providerState.externalHandoff.expiresAt,
      expired: providerAcknowledgement.externalHandoff.expired,
      ready: providerAcknowledgement.externalHandoff.ready,
      nextRoute: accepted && runtimeEnvelope.dispatchable && providerAcknowledgement.acknowledged
        ? 'shellExec.provider.dispatch'
        : providerAcknowledgement.status === 'handoff_blocked'
          ? 'shellExec.provider.refresh'
          : 'shellExec.provider.prepare'
    }
  };
}

function buildValidationSummary(request, boundary, lifecycleSettings = null, workspaceAccessPlan = null, sandboxPolicy = null, persistedLeaseRecovery = null, workspaceBoundaryReview = null, providerHealthFreshness = null) {
  const findings = [];
  if (!request.command) {
    findings.push({
      code: 'command_required',
      severity: 'error',
      message: 'Shell exec requests must include a non-empty command or argv array.'
    });
  }
  for (const issue of request.commandIntent.validation.issues) {
    if (findings.some((finding) => finding.code === issue.code)) continue;
    findings.push({
      code: issue.code,
      severity: issue.severity,
      message: issue.message
    });
  }
  if (request.command && DESTRUCTIVE_COMMAND_PATTERN.test(request.command)) {
    findings.push({
      code: 'dangerous_command_requires_review',
      severity: 'error',
      message: 'The command matches a destructive or pipe-to-shell pattern and cannot be auto-accepted.'
    });
  }
  if (!request.cwd) {
    findings.push({
      code: 'cwd_defaulted',
      severity: 'warning',
      message: 'No working directory was supplied; the hosted kernel must bind execution to its workspace root.'
    });
  }
  if (boundary?.tenant && boundary.tenant.requestTenantId && !boundary.tenant.matched) {
    findings.push({
      code: 'tenant_mismatch',
      severity: 'error',
      message: 'The shell exec request tenant does not match the active hosted-kernel tenant boundary.'
    });
  }
  if (boundary?.tenant && boundary.tenant.persistedTenantId && !boundary.tenant.persistedMatched) {
    findings.push({
      code: 'persisted_tenant_mismatch',
      severity: 'error',
      message: 'Persisted shell exec state belongs to a different tenant and cannot be reused.'
    });
  }
  if (boundary?.workspace && !boundary.workspace.withinAllowedRoots) {
    findings.push({
      code: 'cwd_outside_workspace_scope',
      severity: 'error',
      message: 'The requested working directory is outside the allowed workspace roots for this tenant.'
    });
  }
  for (const operand of workspaceAccessPlan?.outsideScope || []) {
    findings.push({
      code: 'path_operand_outside_workspace_scope',
      severity: 'error',
      message: `Path operand ${operand.token} resolves outside the allowed workspace roots for this tenant.`
    });
  }
  for (const reason of workspaceBoundaryReview?.blockingReasons || []) {
    findings.push({
      code: `workspace_boundary_${reason}`,
      severity: 'error',
      message: `Workspace boundary review blocked shell exec dispatch: ${reason}.`
    });
  }
  for (const reason of workspaceBoundaryReview?.warningReasons || []) {
    findings.push({
      code: `workspace_boundary_${reason}`,
      severity: 'warning',
      message: `Workspace boundary review requires audit attention: ${reason}.`
    });
  }
  for (const deniedPermission of boundary?.actor?.deniedPermissions || []) {
    findings.push({
      code: `permission_denied_${deniedPermission.replaceAll('.', '_')}`,
      severity: 'error',
      message: `Actor role ${boundary.actor.role} is missing required permission ${deniedPermission}.`
    });
  }
  for (const reason of sandboxPolicy?.enforcement?.blockingReasons || []) {
    if (workspaceBoundaryReview?.blockingReasons?.includes(reason)) continue;
    const code = reason.replaceAll(':', '_').replaceAll('.', '_');
    if (findings.some((finding) => finding.code === reason || finding.code === code)) continue;
    findings.push({
      code,
      severity: 'error',
      message: `Sandbox policy blocked shell exec dispatch: ${reason}.`
    });
  }
  if (request.timeoutMs > DEFAULT_TIMEOUT_MS) {
    findings.push({
      code: 'extended_timeout',
      severity: 'info',
      message: `Timeout is ${request.timeoutMs}ms, above the default ${DEFAULT_TIMEOUT_MS}ms preview budget.`
    });
  }
  for (const rejected of request.envOverlay.rejected) {
    findings.push({
      code: `env_overlay_${rejected.reason}`,
      severity: rejected.reason === 'not_in_env_allowlist' ? 'error' : 'warning',
      message: `Environment override ${rejected.key} was rejected: ${rejected.reason}.`
    });
  }
  if (request.stdin.byteLength > request.stdin.maxBytes) {
    findings.push({
      code: 'stdin_too_large',
      severity: 'error',
      message: `Inline stdin is ${request.stdin.byteLength} bytes, above the ${request.stdin.maxBytes} byte hosted-kernel limit.`
    });
  }
  if (request.requiresAcceptance && !request.accepted) {
    findings.push({
      code: 'acceptance_pending',
      severity: 'warning',
      message: 'User acceptance is required before the hosted kernel may run this command.'
    });
  }
  if (lifecycleSettings && !lifecycleSettings.commands.previewAllowed) {
    findings.push({
      code: 'lifecycle_preview_disabled',
      severity: 'error',
      message: 'Shell exec preview is disabled by hosted-kernel lifecycle settings.'
    });
  }
  if (lifecycleSettings && request.requiresAcceptance && !request.accepted && !lifecycleSettings.commands.acceptanceAllowed) {
    findings.push({
      code: 'lifecycle_acceptance_disabled',
      severity: 'error',
      message: 'Shell exec acceptance is disabled by hosted-kernel lifecycle settings.'
    });
  }
  if (lifecycleSettings && request.previewOnly === false && !lifecycleSettings.commands.dispatchAllowed) {
    findings.push({
      code: 'lifecycle_dispatch_blocked',
      severity: lifecycleSettings.scheduling.beforeWindow ? 'warning' : 'error',
      message: lifecycleSettings.disabledReasons.length
        ? `Shell exec dispatch is blocked by lifecycle settings: ${lifecycleSettings.disabledReasons.join(', ')}.`
        : 'Shell exec dispatch is blocked by lifecycle settings.'
    });
  }
  if (providerHealthFreshness?.missing) {
    findings.push({
      code: 'provider_health_check_missing',
      severity: 'warning',
      message: 'Hosted shell-exec provider health must be observed before dispatch can proceed.'
    });
  } else if (providerHealthFreshness?.stale) {
    findings.push({
      code: 'provider_health_check_stale',
      severity: 'warning',
      message: `Hosted shell-exec provider health is stale; refresh before dispatch.`
    });
  } else if (providerHealthFreshness?.dispatchExpired) {
    findings.push({
      code: 'provider_health_dispatch_freshness_expired',
      severity: 'warning',
      message: 'Hosted shell-exec provider health exceeded the dispatch freshness budget.'
    });
  } else if (providerHealthFreshness?.refreshDue) {
    findings.push({
      code: 'provider_health_refresh_due',
      severity: 'info',
      message: 'Hosted shell-exec provider health is due for refresh before the next dispatch window.'
    });
  }
  for (const reason of persistedLeaseRecovery?.conflictReasons || []) {
    findings.push({
      code: `persisted_lease_${reason}`,
      severity: 'warning',
      message: `Persisted shell exec active state requires lease recovery before replay: ${reason}.`
    });
  }

  return {
    ok: !findings.some((finding) => finding.severity === 'error'),
    errorCount: findings.filter((finding) => finding.severity === 'error').length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    infoCount: findings.filter((finding) => finding.severity === 'info').length,
    findings
  };
}

function buildPreviewContract(request, validation, clientState, boundary, workspaceAccessPlan = null, sandboxPolicy = null, workspaceBoundaryReview = null) {
  return {
    kind: 'shell-exec.preview.v1',
    requestId: request.id,
    title: request.command ? `Preview: ${request.command}` : 'Preview: shell command required',
    command: request.command,
    argv: request.argv,
    commandIntent: {
      kind: request.commandIntent.kind,
      source: request.commandIntent.source,
      executable: request.commandIntent.executable,
      authoritative: request.commandIntent.representation.authoritative,
      argvMatchesCommand: request.commandIntent.representation.argvMatchesCommand,
      shellControlDetected: request.commandIntent.representation.shellControlDetected,
      digest: request.commandIntent.digest,
      issueCodes: request.commandIntent.validation.issues.map((issue) => issue.code)
    },
    cwd: request.cwd,
    timeoutMs: request.timeoutMs,
    envPolicy: {
      mode: 'allowlist',
      keys: request.envAllowlist,
      overlayKeys: request.envOverlay.entries.map((entry) => entry.key),
      rejectedOverlayKeys: request.envOverlay.rejected.map((entry) => entry.key)
    },
    stdin: {
      mode: request.stdin.mode,
      provided: request.stdin.provided,
      byteLength: request.stdin.byteLength,
      digest: request.stdin.digest
    },
    impact: {
      writesFilesystem: sandboxPolicy?.filesystem?.writesFilesystem ?? FILE_WRITE_COMMAND_PATTERN.test(request.command),
      usesNetwork: sandboxPolicy?.network?.intentDetected ?? NETWORK_COMMAND_PATTERN.test(request.command),
      requiresAcceptance: request.requiresAcceptance,
      accepted: request.accepted
    },
    sandboxPolicy: sandboxPolicy ? {
      kind: sandboxPolicy.kind,
      mode: sandboxPolicy.mode,
      enforcementStatus: sandboxPolicy.enforcement.status,
      blockingReasons: sandboxPolicy.enforcement.blockingReasons,
      riskLabels: sandboxPolicy.evidence.riskLabels,
      evidenceRefs: sandboxPolicy.evidence.refs
    } : null,
    workspaceBoundaryReview: workspaceBoundaryReview ? {
      kind: workspaceBoundaryReview.kind,
      status: workspaceBoundaryReview.status,
      effectiveCwd: workspaceBoundaryReview.effectiveCwd,
      requestScopedRoot: workspaceBoundaryReview.requestScopedRoot,
      persistedCwd: workspaceBoundaryReview.persistedCwd,
      persistedScopedRoot: workspaceBoundaryReview.persistedScopedRoot,
      matchingRootCount: workspaceBoundaryReview.matchingRootCount,
      blockingReasons: workspaceBoundaryReview.blockingReasons,
      warningReasons: workspaceBoundaryReview.warningReasons,
      auditHandoff: workspaceBoundaryReview.auditHandoff
    } : null,
    status: validation.ok ? 'preview_ready' : 'blocked',
    clientBinding: {
      channel: clientState.channel,
      workspaceRoot: clientState.workspace.root,
      tenantId: boundary.tenant.id,
      actorRole: boundary.actor.role,
      conversationId: clientState.session.conversationId,
      turnId: clientState.session.turnId
    },
    boundary: {
      status: boundary.status,
      effectiveCwd: boundary.workspace.effectiveCwd,
      scopedRoot: boundary.workspace.scopedRoot,
      deniedPermissions: boundary.actor.deniedPermissions,
      auditTags: boundary.auditTags,
      workspaceAccessStatus: workspaceAccessPlan?.status || null,
      workspaceBoundaryStatus: workspaceBoundaryReview?.status || null,
      pathOperandCount: workspaceAccessPlan?.operandCount || 0,
      outsideScopePathCount: workspaceAccessPlan?.outsideScope?.length || 0
    },
    display: {
      primaryAction: request.accepted ? 'Run in hosted kernel' : 'Accept command',
      secondaryAction: 'Edit command',
      blockedReason: validation.ok ? null : validation.findings.find((finding) => finding.severity === 'error')?.message
    }
  };
}

function buildReadinessContract(request, validation, clientState, boundary, lifecycleSettings = null, workspaceAccessPlan = null, sandboxPolicy = null, workspaceBoundaryReview = null, providerHealthFreshness = null) {
  const gates = [
    { id: 'command_valid', label: 'Command is valid', passed: validation.errorCount === 0 && request.commandIntent.validation.ok },
    { id: 'command_intent_bound', label: 'Command intent has one authoritative representation', passed: request.commandIntent.validation.ok && request.commandIntent.representation.authoritative !== 'conflicting' },
    { id: 'workspace_bound', label: 'Execution is bound to a working directory', passed: Boolean(request.cwd || clientState.workspace.root) },
    { id: 'acceptance_recorded', label: 'User acceptance recorded', passed: !request.requiresAcceptance || request.accepted },
    { id: 'env_scoped', label: 'Environment is scoped by allowlist', passed: request.envAllowlist.length > 0 },
    { id: 'env_overlay_valid', label: 'Environment overlay matches allowlist', passed: request.envOverlay.rejected.length === 0 },
    { id: 'stdin_bounded', label: 'Inline stdin is bounded', passed: request.stdin.byteLength <= request.stdin.maxBytes },
    { id: 'timeout_bounded', label: 'Timeout is bounded', passed: request.timeoutMs >= 1_000 && request.timeoutMs <= MAX_TIMEOUT_MS },
    { id: 'client_route_bound', label: 'Client route can receive shell-exec handoff', passed: Boolean(clientState.channel && clientState.handoffTarget) },
    { id: 'tenant_boundary_bound', label: 'Tenant boundary matches request and persisted state', passed: boundary.tenant.matched && boundary.tenant.persistedMatched },
    { id: 'workspace_scope_bound', label: 'Working directory stays inside allowed workspace roots', passed: boundary.workspace.withinAllowedRoots },
    { id: 'path_operands_scoped', label: 'Command path operands stay inside allowed workspace roots', passed: !workspaceAccessPlan || workspaceAccessPlan.outsideScope.length === 0 },
    { id: 'workspace_boundary_reviewed', label: 'Workspace boundary review is scoped for dispatch', passed: !workspaceBoundaryReview || workspaceBoundaryReview.status !== 'blocked' },
    { id: 'sandbox_policy_enforced', label: 'Sandbox policy allows hosted execution', passed: !sandboxPolicy || sandboxPolicy.enforcement.status === 'enforce' },
    { id: 'evidence_capture_bound', label: 'Execution evidence capture is configured', passed: !sandboxPolicy || sandboxPolicy.evidence.capture.length > 0 && sandboxPolicy.evidence.riskLabels.length > 0 },
    { id: 'role_permissions_bound', label: 'Actor role has required shell-exec permissions', passed: boundary.actor.deniedPermissions.length === 0 },
    { id: 'lifecycle_preview_enabled', label: 'Shell exec preview is enabled', passed: lifecycleSettings ? lifecycleSettings.commands.previewAllowed : true },
    { id: 'lifecycle_acceptance_enabled', label: 'Shell exec acceptance is enabled when required', passed: lifecycleSettings ? !request.requiresAcceptance || request.accepted || lifecycleSettings.commands.acceptanceAllowed : true },
    { id: 'lifecycle_dispatch_enabled', label: 'Shell exec dispatch controls allow execution', passed: lifecycleSettings ? request.previewOnly || lifecycleSettings.commands.dispatchAllowed : true },
    { id: 'provider_health_fresh', label: 'Provider health is fresh enough for dispatch', passed: request.previewOnly || !providerHealthFreshness || !providerHealthFreshness.dispatchExpired }
  ];

  return {
    kind: 'shell-exec.readiness.v1',
    ready: gates.every((gate) => gate.passed),
    gates,
    runMode: request.previewOnly ? 'preview' : 'execute',
    nextRequiredGate: gates.find((gate) => !gate.passed)?.id || null
  };
}

function buildShellExecutionPlan(request, readiness, boundary, lifecycleSettings = null, workspaceAccessPlan = null, sandboxPolicy = null) {
  const riskLabels = sandboxPolicy?.evidence?.riskLabels || [];
  const blockingReasons = sandboxPolicy?.enforcement?.blockingReasons || [];
  const requiresShellInterpreter = request.commandIntent.representation.requiresShellInterpreter;
  const authoritativeMode = request.argv.length && !requiresShellInterpreter ? 'argv' : 'command';
  const directArgv = authoritativeMode === 'argv'
    ? request.argv
    : request.commandIntent.commandTokens.length && !request.commandIntent.representation.shellControlDetected
      ? request.commandIntent.commandTokens
      : null;
  const evidenceFields = [
    'command_digest',
    'command_intent',
    'cwd',
    'timeout_ms',
    'sandbox_decision',
    'workspace_operands',
    'env_overlay_keys',
    'stdin_digest',
    'risk_labels'
  ];
  const highRisk = riskLabels.some((label) => [
    'destructive-pattern',
    'workspace-scope-violation',
    'permission-gap',
    'network-access',
    'workspace-boundary-blocked',
    'workspace-boundary-review'
  ].includes(label));
  const riskTier = blockingReasons.length
    ? 'blocked'
    : highRisk
      ? 'elevated'
      : riskLabels.includes('filesystem-write') || riskLabels.includes('extended-timeout')
        ? 'moderate'
        : 'low';

  return {
    kind: 'shell-exec.execution-plan.v1',
    planId: `plan_${stableShellExecId([
      request.idempotencyKey,
      request.commandIntent.digest,
      boundary.workspace.effectiveCwd || request.cwd || 'workspace',
      String(request.timeoutMs)
    ]).slice(0, 20)}`,
    dispatchable: readiness.ready && !request.previewOnly && sandboxPolicy?.enforcement?.status !== 'blocked',
    invocation: {
      mode: authoritativeMode,
      commandLine: request.command,
      argv: directArgv,
      executable: request.commandIntent.executable,
      requiresShellInterpreter,
      shellControlDetected: request.commandIntent.representation.shellControlDetected,
      commandDigest: request.commandIntent.digest
    },
    process: {
      cwd: boundary.workspace.effectiveCwd || request.cwd || boundary.workspace.root || null,
      timeoutMs: request.timeoutMs,
      maxTimeoutMs: MAX_TIMEOUT_MS,
      terminationSignal: 'SIGTERM',
      timeoutEnforcement: request.timeoutMs >= MAX_TIMEOUT_MS ? 'capped_at_max' : 'bounded',
      stdinDelivery: request.stdin.provided
        ? request.stdin.byteLength <= request.stdin.maxBytes ? 'inline' : 'blocked_too_large'
        : 'none'
    },
    environment: {
      inheritedKeys: request.envAllowlist,
      overlayKeys: request.envOverlay.entries.map((entry) => entry.key),
      rejectedOverlay: request.envOverlay.rejected,
      valuePolicy: 'values_available_to_executor_not_evidence',
      allowlistMode: 'explicit'
    },
    sandbox: {
      enforcementStatus: sandboxPolicy?.enforcement?.status || 'not_evaluated',
      blockingReasons,
      allowedRoots: boundary.workspace.allowedRoots,
      scopedRoot: boundary.workspace.scopedRoot,
      workspaceAccessStatus: workspaceAccessPlan?.status || 'not_evaluated',
      outsideScopePathCount: workspaceAccessPlan?.outsideScope?.length || 0,
      writeCandidateCount: workspaceAccessPlan?.writeCandidates?.length || 0,
      networkPolicy: sandboxPolicy?.network?.policy || 'not_evaluated'
    },
    evidenceManifest: {
      manifestId: `evidence_${stableShellExecId([
        request.idempotencyKey,
        request.commandIntent.digest,
        riskLabels.join(','),
        blockingReasons.join(',')
      ]).slice(0, 20)}`,
      capture: evidenceFields,
      refs: sandboxPolicy?.evidence?.refs || [],
      redactions: {
        envValues: true,
        stdinInline: true,
        commandLine: false,
        pathOperands: false
      },
      riskLabels,
      riskTier,
      proofTags: [
        ...request.commandIntent.proofTags,
        ...(workspaceAccessPlan?.proofTags || []),
        `sandbox:${sandboxPolicy?.enforcement?.status || 'not_evaluated'}`,
        `risk-tier:${riskTier}`
      ]
    },
    lifecycle: lifecycleSettings ? {
      dispatchAllowed: lifecycleSettings.commands.dispatchAllowed,
      nextDispatchAt: lifecycleSettings.scheduling.nextDispatchAt,
      disabledReasons: lifecycleSettings.disabledReasons
    } : null
  };
}

function buildRuntimeEnvelope(request, clientState, readiness, boundary, lifecycleSettings = null, workspaceAccessPlan = null, sandboxPolicy = null, workspaceBoundaryReview = null) {
  const cwd = boundary.workspace.effectiveCwd || request.cwd || clientState.workspace.root;
  const executionPlan = buildShellExecutionPlan(request, readiness, boundary, lifecycleSettings, workspaceAccessPlan, sandboxPolicy);

  return {
    kind: 'shell-exec.runtime-envelope.v1',
    requestId: request.id,
    dispatchable: readiness.ready && !request.previewOnly,
    executor: {
      target: clientState.handoffTarget,
      channel: clientState.channel,
      cwd,
      timeoutMs: request.timeoutMs,
      executionMode: request.executionMode,
      schedule: lifecycleSettings ? {
        mode: lifecycleSettings.scheduling.mode,
        intervalMs: lifecycleSettings.scheduling.intervalMs,
        nextDispatchAt: lifecycleSettings.scheduling.nextDispatchAt,
        capacityAvailable: lifecycleSettings.scheduling.capacity.available
      } : null
    },
    boundary: {
      tenantId: boundary.tenant.id,
      actorRole: boundary.actor.role,
      scopedRoot: boundary.workspace.scopedRoot,
      allowedRoots: boundary.workspace.allowedRoots,
      status: boundary.status,
      workspaceAccess: workspaceAccessPlan ? {
        kind: workspaceAccessPlan.kind,
        status: workspaceAccessPlan.status,
        operandCount: workspaceAccessPlan.operandCount,
        outsideScopePathCount: workspaceAccessPlan.outsideScope.length,
        writeCandidateCount: workspaceAccessPlan.writeCandidates.length,
        proofTags: workspaceAccessPlan.proofTags
      } : null,
      workspaceBoundaryReview: workspaceBoundaryReview ? {
        kind: workspaceBoundaryReview.kind,
        status: workspaceBoundaryReview.status,
        requestScopedRoot: workspaceBoundaryReview.requestScopedRoot,
        persistedScopedRoot: workspaceBoundaryReview.persistedScopedRoot,
        matchingRootCount: workspaceBoundaryReview.matchingRootCount,
        blockingReasons: workspaceBoundaryReview.blockingReasons,
        warningReasons: workspaceBoundaryReview.warningReasons,
        auditHandoff: workspaceBoundaryReview.auditHandoff,
        proofTags: workspaceBoundaryReview.proofTags
      } : null
    },
    sandbox: sandboxPolicy ? {
      kind: sandboxPolicy.kind,
      mode: sandboxPolicy.mode,
      enforcement: sandboxPolicy.enforcement,
      filesystem: sandboxPolicy.filesystem,
      network: sandboxPolicy.network,
      process: sandboxPolicy.process,
      evidence: sandboxPolicy.evidence
    } : null,
    command: {
      line: request.command,
      argv: request.argv.length ? request.argv : null,
      intent: {
        kind: request.commandIntent.kind,
        source: request.commandIntent.source,
        executable: request.commandIntent.executable,
        authoritative: request.commandIntent.representation.authoritative,
        shellControlDetected: request.commandIntent.representation.shellControlDetected,
        requiresShellInterpreter: request.commandIntent.representation.requiresShellInterpreter,
        digest: request.commandIntent.digest
      },
      envAllowlist: request.envAllowlist,
      envOverlay: request.envOverlay.entries,
      stdin: {
        mode: request.stdin.mode,
        provided: request.stdin.provided,
        byteLength: request.stdin.byteLength,
        digest: request.stdin.digest,
        inline: request.stdin.inline
      },
      idempotencyKey: request.idempotencyKey
    },
    executionPlan,
    clientCorrelation: {
      conversationId: clientState.session.conversationId,
      turnId: clientState.session.turnId,
      actorId: clientState.actor.id
    }
  };
}

function buildRestartPersistenceCheckpoint(request, runtimeEnvelope, persistedState, restartSafeStatus, commandAction, operationalHealth, providerContract, now, lifecycleSettings = null, persistedLeaseRecovery = null) {
  const reclaimingPersistedRun = persistedLeaseRecovery?.reclaimRequired === true;
  const activePersistedRun = persistedState.usable && ACTIVE_EXECUTION_STATUSES.has(persistedState.status) && !reclaimingPersistedRun;
  const terminalPersistedRun = persistedState.usable && TERMINAL_EXECUTION_STATUSES.has(persistedState.status);
  const retryablePersistedRun = persistedState.usable && RETRYABLE_FAILURE_STATUSES.has(persistedState.status);
  const checkpointStatus = commandAction === 'dispatch_new_run' || commandAction === 'retry_after_backoff'
    ? 'queued'
    : commandAction === 'recover_active_run'
      ? 'running'
      : commandAction === 'reclaim_expired_lease'
        ? 'queued'
      : commandAction === 'return_persisted_result'
        ? persistedState.status
        : restartSafeStatus;
  const nextAttempt = operationalHealth?.retryPolicy?.nextAttemptKey || null;
  const runEpoch = terminalPersistedRun || activePersistedRun
    ? persistedState.lastRunId || providerContract.syncMetadata.cursor
    : `epoch_${stableShellExecId([
      request.idempotencyKey,
      checkpointStatus,
      runtimeEnvelope.executor.cwd || 'workspace',
      String(persistedState.attempts + (commandAction === 'retry_after_backoff' ? 1 : 0)),
      nextAttempt || 'first-attempt'
    ]).slice(0, 20)}`;
  const commandTokens = {
    accept: `cmd_accept_${stableShellExecId([request.idempotencyKey, request.id, 'accept']).slice(0, 18)}`,
    dispatch: `cmd_dispatch_${stableShellExecId([request.idempotencyKey, runEpoch, runtimeEnvelope.executor.cwd || 'workspace']).slice(0, 18)}`,
    recover: `cmd_recover_${stableShellExecId([request.idempotencyKey, persistedState.lastRunId || runEpoch, providerContract.syncMetadata.cursor]).slice(0, 18)}`,
    retry: nextAttempt || `cmd_retry_${stableShellExecId([request.idempotencyKey, String(persistedState.attempts + 1), runEpoch]).slice(0, 18)}`,
    cancel: `cmd_cancel_${stableShellExecId([request.idempotencyKey, persistedState.lastRunId || runEpoch, 'cancel']).slice(0, 18)}`,
    result: `cmd_result_${stableShellExecId([request.idempotencyKey, persistedState.lastRunId || runEpoch, checkpointStatus]).slice(0, 18)}`
  };
  const leaseExpiresMs = Date.parse(now) + request.timeoutMs + ACTIVE_LEASE_GRACE_MS;
  const nextLeaseExpiresAt = Number.isFinite(leaseExpiresMs) ? new Date(leaseExpiresMs).toISOString() : null;

  return {
    kind: 'shell-exec.restart-persistence-checkpoint.v1',
    generatedAt: now,
    storeKey: `shell-exec/${request.idempotencyKey}`,
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    checkpointStatus,
    restartSafeStatus,
    commandAction,
    runEpoch,
    activePersistedRun,
    terminalPersistedRun,
    retryablePersistedRun,
    reclaimingPersistedRun,
    writePolicy: {
      mode: 'compare-and-set',
      conflictStrategy: terminalPersistedRun
        ? 'return_existing_terminal_result'
        : reclaimingPersistedRun
          ? 'reclaim_expired_active_lease'
          : activePersistedRun
            ? 'recover_existing_active_run'
            : 'claim_or_update_checkpoint',
      expectedStatuses: terminalPersistedRun
        ? [persistedState.status]
        : reclaimingPersistedRun
          ? [...ACTIVE_EXECUTION_STATUSES].sort()
        : activePersistedRun
          ? [...ACTIVE_EXECUTION_STATUSES].sort()
          : ['draft', 'accepted', 'queued', 'failed', 'timed_out', 'blocked', 'stale'],
      forbiddenReplayStatuses: [...TERMINAL_EXECUTION_STATUSES].sort()
    },
    recoveryLease: {
      required: activePersistedRun || reclaimingPersistedRun || commandAction === 'recover_active_run',
      leaseKey: `shell-exec-lease/${request.idempotencyKey}/${runEpoch}`,
      recoverRoute: activePersistedRun || reclaimingPersistedRun ? 'shellExec.recover' : null,
      previousRunId: persistedState.lastRunId,
      providerCursor: providerContract.syncMetadata.cursor,
      expiresAt: commandAction === 'dispatch_new_run' || commandAction === 'retry_after_backoff' || commandAction === 'reclaim_expired_lease'
        ? nextLeaseExpiresAt
        : null,
      reclaim: persistedLeaseRecovery?.reclaimRequired ? {
        token: persistedLeaseRecovery.reclaimToken,
        reasons: persistedLeaseRecovery.conflictReasons,
        expectedLeaseKey: persistedLeaseRecovery.compareAndSet.expectedLeaseKey,
        expectedRunId: persistedLeaseRecovery.compareAndSet.expectedRunId,
        expectedProviderCursor: persistedLeaseRecovery.compareAndSet.expectedProviderCursor
      } : null
    },
    commandTokens,
    statusSemantics: {
      userVisible: restartSafeStatus,
      persisted: checkpointStatus,
      replaySafe: terminalPersistedRun || activePersistedRun || commandAction !== 'dispatch_new_run',
      dispatchCreatesRun: commandAction === 'dispatch_new_run',
      retryCreatesRun: commandAction === 'retry_after_backoff',
      reclaimCreatesRun: commandAction === 'reclaim_expired_lease',
      resultIsAuthoritative: terminalPersistedRun && commandAction === 'return_persisted_result'
    },
    nextWakeup: {
      at: lifecycleSettings?.scheduling?.nextDispatchAt || null,
      retryAfterMs: operationalHealth?.retryPolicy?.nextAttemptAfterMs || null,
      reason: commandAction === 'retry_after_backoff'
        ? 'retry_backoff'
        : lifecycleSettings?.scheduling?.nextDispatchAt
          ? 'scheduled_dispatch'
          : null
    }
  };
}

function buildRecoveryContract(request, validation, readiness, runtimeEnvelope, persistedState, providerContract, operationalHealth, now, lifecycleSettings = null, persistedLeaseRecovery = null) {
  const retryWait = operationalHealth?.retryPolicy?.retryAllowed === true;
  const commandFailureRequiresChange = operationalHealth?.failureState?.diagnostic?.retryRecommendation?.requiresCommandChange === true;
  const terminal = persistedState.usable && TERMINAL_EXECUTION_STATUSES.has(persistedState.status) && !retryWait;
  const reclaimActiveLease = persistedLeaseRecovery?.reclaimRequired === true;
  const active = persistedState.usable && ACTIVE_EXECUTION_STATUSES.has(persistedState.status) && !reclaimActiveLease;
  const recoverable = persistedState.usable && RECOVERABLE_EXECUTION_STATUSES.has(persistedState.status);
  const providerCompatible = providerContract?.negotiation?.accepted !== false;
  const healthDispatchAllowed = operationalHealth?.degradedMode?.dispatchAllowed !== false;
  const lifecycleDispatchAllowed = lifecycleSettings?.commands?.dispatchAllowed !== false;
  const lifecycleRecoverAllowed = lifecycleSettings?.commands?.recoveryAllowed !== false;
  const canDispatch = runtimeEnvelope.dispatchable && providerCompatible && healthDispatchAllowed && lifecycleDispatchAllowed && !terminal && !active;
  const restartSafeStatus = terminal
    ? persistedState.status
    : reclaimActiveLease
      ? lifecycleRecoverAllowed ? 'reclaim_pending' : 'blocked'
    : active
      ? lifecycleRecoverAllowed ? 'resume_pending' : 'blocked'
      : retryWait
        ? 'retry_wait'
      : validation.errorCount > 0
        ? 'blocked'
      : !providerCompatible
        ? 'blocked'
      : !healthDispatchAllowed
        ? 'degraded'
      : !lifecycleDispatchAllowed
        ? 'paused'
      : request.requiresAcceptance && !request.accepted
        ? 'awaiting_acceptance'
      : readiness.ready && request.previewOnly
        ? 'preview_ready'
            : canDispatch
              ? 'dispatch_ready'
              : 'waiting';
  const commandAction = terminal
    ? 'return_persisted_result'
    : reclaimActiveLease
      ? lifecycleRecoverAllowed ? 'reclaim_expired_lease' : 'hold_lifecycle_settings'
    : active
      ? lifecycleRecoverAllowed ? 'recover_active_run' : 'hold_lifecycle_settings'
      : retryWait
        ? 'retry_after_backoff'
      : canDispatch
        ? 'dispatch_new_run'
        : !healthDispatchAllowed
          ? 'hold_degraded_mode'
        : !lifecycleDispatchAllowed
          ? 'hold_lifecycle_settings'
        : !providerCompatible
          ? 'hold_provider_capability_gap'
        : recoverable
          ? 'resume_before_dispatch'
          : 'hold';
  const persistenceCheckpoint = buildRestartPersistenceCheckpoint(
    request,
    runtimeEnvelope,
    persistedState,
    restartSafeStatus,
    commandAction,
    operationalHealth,
    providerContract,
    now,
    lifecycleSettings,
    persistedLeaseRecovery
  );

  return {
    kind: 'shell-exec.recovery.v1',
    generatedAt: now,
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    restartSafeStatus,
    commandAction,
    dispatchAllowed: commandAction === 'dispatch_new_run',
    idempotentReplay: terminal || active,
    persistedLeaseRecovery,
    recoveredFromPersistedState: persistedState.present && persistedState.usable,
    persistedStateStatus: persistedState.status,
    runClaim: {
      key: request.idempotencyKey,
      expectedStatus: terminal ? persistedState.status : retryWait ? 'retry_wait' : 'queued',
      previousRunId: persistedState.lastRunId,
      reclaimToken: persistedLeaseRecovery?.reclaimToken || null,
      reclaimReasons: persistedLeaseRecovery?.conflictReasons || [],
      retryAfterMs: operationalHealth?.retryPolicy?.nextAttemptAfterMs || null,
      nextAttemptKey: operationalHealth?.retryPolicy?.nextAttemptKey || null,
      scheduledFor: lifecycleSettings?.scheduling?.nextDispatchAt || null
    },
    persistenceCheckpoint,
    statusReason: persistedState.recoveryReason
      || (terminal ? 'terminal_result_already_recorded'
        : reclaimActiveLease ? 'persisted_active_run_requires_lease_reclaim_before_replay'
        : active ? 'active_run_must_be_recovered_before_replay'
          : retryWait ? 'retryable_failure_waiting_for_backoff_window'
          : commandFailureRequiresChange ? 'command_failure_requires_preview_correction_before_retry'
          : !providerCompatible ? 'provider_missing_required_shell_exec_capabilities'
          : !healthDispatchAllowed ? 'provider_or_retry_health_requires_degraded_mode'
          : !lifecycleDispatchAllowed ? 'lifecycle_settings_hold_dispatch_or_capacity'
          : canDispatch ? 'ready_for_first_dispatch'
            : 'waiting_for_validation_acceptance_or_preview')
  };
}

function buildStateWriteContract(request, clientState, recovery, runtimeEnvelope, providerContract, boundary, operationalHealth, clientRuntimeState = null, lifecycleSettings = null, clientWorkflowReceipt = null, workspaceAccessPlan = null, analyticsExport = null, reportingTimeline = null, sandboxPolicy = null, workspaceBoundaryReview = null, clientHandoffContinuity = null) {
  const nowStatus = recovery.commandAction === 'dispatch_new_run'
    ? 'queued'
    : recovery.commandAction === 'return_persisted_result'
      ? recovery.restartSafeStatus
      : recovery.commandAction === 'retry_after_backoff'
        ? 'queued'
      : recovery.commandAction === 'reclaim_expired_lease'
        ? 'queued'
      : recovery.commandAction === 'hold_degraded_mode'
        ? 'blocked'
      : recovery.restartSafeStatus === 'blocked'
        ? 'blocked'
        : request.accepted
          ? 'accepted'
          : 'draft';

  return {
    kind: 'shell-exec.state-write.v1',
    storeKey: `shell-exec/${request.idempotencyKey}`,
    upsertMode: 'compare-and-set',
    compare: {
      idempotencyKey: request.idempotencyKey,
      terminalStatuses: [...TERMINAL_EXECUTION_STATUSES].sort(),
      expectedStatuses: recovery.persistenceCheckpoint.writePolicy.expectedStatuses,
      forbiddenReplayStatuses: recovery.persistenceCheckpoint.writePolicy.forbiddenReplayStatuses,
      conflictStrategy: recovery.persistenceCheckpoint.writePolicy.conflictStrategy
    },
    patch: {
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      status: nowStatus,
      restartSafeStatus: recovery.restartSafeStatus,
      commandAction: recovery.commandAction,
      persistenceCheckpoint: {
        kind: recovery.persistenceCheckpoint.kind,
        checkpointStatus: recovery.persistenceCheckpoint.checkpointStatus,
        runEpoch: recovery.persistenceCheckpoint.runEpoch,
        writePolicy: recovery.persistenceCheckpoint.writePolicy,
        recoveryLease: recovery.persistenceCheckpoint.recoveryLease,
        persistedLeaseRecovery: recovery.persistedLeaseRecovery ? {
          kind: recovery.persistedLeaseRecovery.kind,
          active: recovery.persistedLeaseRecovery.active,
          effectiveExpiresAt: recovery.persistedLeaseRecovery.effectiveExpiresAt,
          reclaimRequired: recovery.persistedLeaseRecovery.reclaimRequired,
          reclaimToken: recovery.persistedLeaseRecovery.reclaimToken,
          conflictReasons: recovery.persistedLeaseRecovery.conflictReasons,
          compareAndSet: recovery.persistedLeaseRecovery.compareAndSet
        } : null,
        commandTokens: recovery.persistenceCheckpoint.commandTokens,
        statusSemantics: recovery.persistenceCheckpoint.statusSemantics,
        nextWakeup: recovery.persistenceCheckpoint.nextWakeup
      },
      request: {
        command: request.command,
        argv: request.argv,
        commandIntent: {
          kind: request.commandIntent.kind,
          source: request.commandIntent.source,
          executable: request.commandIntent.executable,
          authoritative: request.commandIntent.representation.authoritative,
          digest: request.commandIntent.digest,
          issueCodes: request.commandIntent.validation.issues.map((issue) => issue.code)
        },
        cwd: runtimeEnvelope.executor.cwd,
        timeoutMs: request.timeoutMs,
        schedule: runtimeEnvelope.executor.schedule,
        envAllowlist: request.envAllowlist,
        envOverlayKeys: request.envOverlay.entries.map((entry) => entry.key),
        stdinDigest: request.stdin.digest
      },
      clientCorrelation: runtimeEnvelope.clientCorrelation,
      channel: clientState.channel,
      tenantId: boundary.tenant.id,
      boundary: {
        kind: boundary.kind,
        status: boundary.status,
        tenantId: boundary.tenant.id,
        actorRole: boundary.actor.role,
        scopedRoot: boundary.workspace.scopedRoot,
        effectiveCwd: boundary.workspace.effectiveCwd,
        auditTags: boundary.auditTags,
        workspaceAccessStatus: workspaceAccessPlan?.status || null,
        outsideScopePathCount: workspaceAccessPlan?.outsideScope?.length || 0,
        workspaceBoundaryReview: workspaceBoundaryReview ? {
          kind: workspaceBoundaryReview.kind,
          status: workspaceBoundaryReview.status,
          effectiveCwd: workspaceBoundaryReview.effectiveCwd,
          requestScopedRoot: workspaceBoundaryReview.requestScopedRoot,
          persistedCwd: workspaceBoundaryReview.persistedCwd,
          persistedScopedRoot: workspaceBoundaryReview.persistedScopedRoot,
          matchingRootCount: workspaceBoundaryReview.matchingRootCount,
          blockingReasons: workspaceBoundaryReview.blockingReasons,
          warningReasons: workspaceBoundaryReview.warningReasons,
          auditRoute: workspaceBoundaryReview.auditHandoff.route
        } : null
      },
      sandboxPolicy: sandboxPolicy ? {
        kind: sandboxPolicy.kind,
        mode: sandboxPolicy.mode,
        enforcementStatus: sandboxPolicy.enforcement.status,
        blockingReasons: sandboxPolicy.enforcement.blockingReasons,
        riskLabels: sandboxPolicy.evidence.riskLabels,
        evidenceRefs: sandboxPolicy.evidence.refs,
        timeoutRisk: sandboxPolicy.process.timeoutRisk,
        networkPolicy: sandboxPolicy.network.policy
      } : null,
      executionPlan: runtimeEnvelope.executionPlan ? {
        kind: runtimeEnvelope.executionPlan.kind,
        planId: runtimeEnvelope.executionPlan.planId,
        dispatchable: runtimeEnvelope.executionPlan.dispatchable,
        invocationMode: runtimeEnvelope.executionPlan.invocation.mode,
        executable: runtimeEnvelope.executionPlan.invocation.executable,
        requiresShellInterpreter: runtimeEnvelope.executionPlan.invocation.requiresShellInterpreter,
        timeoutMs: runtimeEnvelope.executionPlan.process.timeoutMs,
        timeoutEnforcement: runtimeEnvelope.executionPlan.process.timeoutEnforcement,
        stdinDelivery: runtimeEnvelope.executionPlan.process.stdinDelivery,
        sandboxEnforcementStatus: runtimeEnvelope.executionPlan.sandbox.enforcementStatus,
        sandboxBlockingReasons: runtimeEnvelope.executionPlan.sandbox.blockingReasons,
        riskTier: runtimeEnvelope.executionPlan.evidenceManifest.riskTier,
        riskLabels: runtimeEnvelope.executionPlan.evidenceManifest.riskLabels,
        evidenceManifestId: runtimeEnvelope.executionPlan.evidenceManifest.manifestId,
        evidenceCapture: runtimeEnvelope.executionPlan.evidenceManifest.capture,
        evidenceRedactions: runtimeEnvelope.executionPlan.evidenceManifest.redactions
      } : null,
      providerSync: {
        providerId: providerContract.provider.id,
        contractKey: providerContract.syncMetadata.contractKey,
        cursor: providerContract.syncMetadata.cursor,
        leaseId: providerContract.syncMetadata.leaseId,
        providerAcknowledgementStatus: providerContract.syncMetadata.providerAcknowledgementStatus,
        providerLeaseBound: providerContract.syncMetadata.providerLeaseBound,
        externalHandoffState: providerContract.externalHandoffState.state,
        externalHandoffExpired: providerContract.externalHandoffState.expired,
        externalHandoffReady: providerContract.externalHandoffState.ready
      },
      operationalHealth: {
        status: operationalHealth.health.status,
        providerStatus: operationalHealth.health.providerStatus,
        circuitState: operationalHealth.health.circuitState,
        healthFreshnessStatus: operationalHealth.health.healthFreshnessStatus,
        providerHealthCheckedAt: operationalHealth.providerFreshness.checkedAt,
        providerHealthAgeMs: operationalHealth.providerFreshness.ageMs,
        attempts: operationalHealth.failureState.attempts,
        failureDiagnosticCode: operationalHealth.failureState.diagnostic?.classification?.code || null,
        failureRetryable: operationalHealth.failureState.diagnostic?.retryRecommendation?.retryable ?? null,
        failureRequiresCommandChange: operationalHealth.failureState.diagnostic?.retryRecommendation?.requiresCommandChange ?? null,
        retryAllowed: operationalHealth.retryPolicy.retryAllowed,
        nextAttemptAfterMs: operationalHealth.retryPolicy.nextAttemptAfterMs,
        nextAttemptAt: operationalHealth.retryPolicy.nextAttemptAt,
        providerHealthRefreshRequired: operationalHealth.retryPolicy.providerHealthRefreshRequired,
        degradedModeActive: operationalHealth.degradedMode.active,
        actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code)
      },
      lifecycleSettings: lifecycleSettings ? {
        kind: lifecycleSettings.kind,
        enabled: lifecycleSettings.enabled,
        maintenanceMode: lifecycleSettings.maintenanceMode,
        disabledReasons: lifecycleSettings.disabledReasons,
        enabledCommands: lifecycleSettings.commands.enabled,
        nextDispatchAt: lifecycleSettings.scheduling.nextDispatchAt,
        scheduleMode: lifecycleSettings.scheduling.mode,
        capacityAvailable: lifecycleSettings.scheduling.capacity.available
      } : null,
      clientRuntimeState: clientRuntimeState ? {
        kind: clientRuntimeState.kind,
        stateKey: clientRuntimeState.stateKey,
        status: clientRuntimeState.status,
        activeRoute: clientRuntimeState.activeRoute,
        nextRoute: clientRuntimeState.nextRoute,
        workflowStage: clientRuntimeState.workflowStage,
        primaryAction: clientRuntimeState.commandBar.primary.action,
        primaryActionEnabled: clientRuntimeState.commandBar.primary.enabled,
        notificationLevel: clientRuntimeState.notification.level,
        visibleProofRefs: clientRuntimeState.visibleProofRefs
      } : null,
      clientWorkflowReceipt: clientWorkflowReceipt ? {
        kind: clientWorkflowReceipt.kind,
        receiptId: clientWorkflowReceipt.receiptId,
        status: clientWorkflowReceipt.status,
        handoffQueue: clientWorkflowReceipt.handoffQueue.map((item) => ({
          id: item.id,
          route: item.route,
          action: item.action,
          enabled: item.enabled,
          stateTransition: item.stateTransition
        })),
        clientStatePatch: clientWorkflowReceipt.clientStatePatch,
        clientWorkflowMemory: clientWorkflowReceipt.clientWorkflowMemory,
        proofSummary: clientWorkflowReceipt.proofSummary
      } : null,
      clientHandoffContinuity: clientHandoffContinuity ? {
        kind: clientHandoffContinuity.kind,
        generatedAt: clientHandoffContinuity.generatedAt,
        status: clientHandoffContinuity.status,
        resume: clientHandoffContinuity.resume,
        dispatchReadiness: clientHandoffContinuity.dispatchReadiness,
        clientMemory: clientHandoffContinuity.clientMemory,
        userVisible: clientHandoffContinuity.userVisible,
        persistencePatch: clientHandoffContinuity.persistencePatch,
        evidenceRefs: clientHandoffContinuity.evidenceRefs,
        proofTags: clientHandoffContinuity.proofTags
      } : null,
      analyticsState: analyticsExport ? {
        kind: 'shell-exec.analytics-state-write.v1',
        snapshotId: analyticsExport.snapshots.current.snapshotId,
        previousSnapshotId: analyticsExport.snapshots.previous?.snapshotId || null,
        exportBatchId: analyticsExport.exportManifest.batchId,
        exportSchema: analyticsExport.exportManifest.schema,
        exportRowCount: analyticsExport.exportManifest.rowCount,
        partitionKey: analyticsExport.exportManifest.partitionKey,
        counters: {
          totalHistoryEvents: analyticsExport.counters.totalHistoryEvents,
          terminalEvents: analyticsExport.counters.terminalEvents,
          activeEvents: analyticsExport.counters.activeEvents,
          successCount: analyticsExport.counters.successCount,
          failureCount: analyticsExport.counters.failureCount,
          validationErrorCount: analyticsExport.counters.validationErrorCount,
          validationWarningCount: analyticsExport.counters.validationWarningCount,
          healthActionableErrorCount: analyticsExport.counters.healthActionableErrorCount,
          retryAttemptCount: analyticsExport.counters.retryAttemptCount,
          blockedRiskCount: analyticsExport.counters.blockedRiskCount,
          elevatedRiskCount: analyticsExport.counters.elevatedRiskCount,
          exportableEvidenceCount: analyticsExport.counters.exportableEvidenceCount,
          pathOperandCount: analyticsExport.counters.pathOperandCount,
          outsideScopePathCount: analyticsExport.counters.outsideScopePathCount
        },
        breakdowns: {
          byRiskTier: analyticsExport.breakdowns.byRiskTier,
          byRiskLabel: analyticsExport.breakdowns.byRiskLabel,
          byDurationBucket: analyticsExport.breakdowns.byDurationBucket
        },
        deltaFromPrevious: analyticsExport.snapshots.deltaFromPrevious,
        reporting: reportingTimeline ? {
          kind: reportingTimeline.kind,
          itemCount: reportingTimeline.items.length,
          currentStatus: reportingTimeline.current.status,
          firstAt: reportingTimeline.range.firstAt,
          lastAt: reportingTimeline.range.lastAt,
          reportCards: reportingTimeline.reportCards
        } : null
      } : null
    }
  };
}

function buildClientRuntimeStatePatch(clientState, request, runtimeEnvelope, recovery, workflowHandoff, routeContracts, auditProof, providerContract, operationalHealth, reportingTimeline, now, lifecycleSettings = null) {
  const routeBindingEntries = Object.entries(routeContracts.routeBindings);
  const enabledRoutes = routeBindingEntries
    .filter(([, binding]) => binding.enabled)
    .map(([name, binding]) => ({ name, route: binding.route, payloadRef: binding.payloadRef }));
  const blockedRoutes = routeBindingEntries
    .filter(([, binding]) => binding.enabled === false && Array.isArray(binding.disabledReasons) && binding.disabledReasons.length)
    .map(([name, binding]) => ({ name, route: binding.route, disabledReasons: binding.disabledReasons }));
  const primaryBinding = routeContracts.routeBindings.run.enabled
    ? routeContracts.routeBindings.run
    : routeContracts.routeBindings.accept.enabled
      ? routeContracts.routeBindings.accept
      : routeContracts.routeBindings.recover.enabled
        ? routeContracts.routeBindings.recover
        : routeContracts.routeBindings.result.enabled
          ? routeContracts.routeBindings.result
          : routeContracts.routeBindings.preview;
  const primaryAction = recovery.commandAction === 'return_persisted_result'
    ? 'open_result'
    : recovery.commandAction === 'reclaim_expired_lease'
      ? 'reclaim_lease'
    : recovery.commandAction === 'recover_active_run'
      ? 'recover_run'
      : workflowHandoff.handoffPayload.dispatchable
        ? 'dispatch_run'
        : request.requiresAcceptance && !request.accepted
          ? 'accept_preview'
          : 'open_preview';
  const notificationLevel = routeContracts.validationSummary.counts.errors
    ? 'error'
    : operationalHealth.degradedMode.active || routeContracts.validationSummary.counts.warnings
      ? 'warning'
      : recovery.commandAction === 'retry_after_backoff'
        ? 'info'
        : 'success';
  const stateKey = `shell-exec-client/${clientState.channel}/${request.idempotencyKey}`;
  const commandDigest = `cmd_${stableShellExecId([
    request.command,
    runtimeEnvelope.executor.cwd || 'workspace',
    request.envOverlay.entries.map((entry) => entry.key).join(','),
    request.stdin.digest || 'stdin:none'
  ]).slice(0, 20)}`;

  return {
    kind: 'shell-exec.client-runtime-state.v1',
    generatedAt: now,
    stateKey,
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    status: routeContracts.route.stage === 'ready_to_dispatch' ? 'armed' : routeContracts.route.stage,
    workflowStage: workflowHandoff.stage,
    activeRoute: routeContracts.route.current,
    nextRoute: routeContracts.route.next,
    commandDigest,
    clientSession: {
      channel: clientState.channel,
      handoffTarget: clientState.handoffTarget,
      conversationId: clientState.session.conversationId,
      turnId: clientState.session.turnId,
      actorId: clientState.actor.id,
      workspaceRoot: clientState.workspace.root
    },
    commandBar: {
      primary: {
        action: primaryAction,
        label: routeContracts.nextStepPlan.primary.label,
        route: primaryBinding.route,
        enabled: primaryBinding.enabled !== false,
        payloadRef: primaryBinding.payloadRef || routeContracts.nextStepPlan.primary.routeHint
      },
      secondary: [
        { action: 'edit_command', label: 'Edit command', route: 'shellExec.preview', enabled: !workflowHandoff.handoffPayload.dispatchable },
        { action: 'view_audit_proof', label: 'View audit proof', route: 'shellExec.audit', enabled: true },
        { action: 'open_timeline', label: 'Open timeline', route: 'shellExec.timeline', enabled: reportingTimeline.items.length > 0 },
        { action: 'open_lifecycle_settings', label: 'Settings', route: 'shellExec.settings', enabled: Boolean(lifecycleSettings) }
      ]
    },
    routeSubscriptions: {
      enabledRoutes,
      blockedRoutes,
      refreshOnProviderCursor: providerContract.syncMetadata.cursor,
      resumeStoreKey: `shell-exec/${request.idempotencyKey}`
    },
    notification: {
      level: notificationLevel,
      message: routeContracts.validationSummary.userMessage || workflowHandoff.userVisibleStatus,
      retryAfterMs: operationalHealth.retryPolicy.nextAttemptAfterMs,
      retryAt: operationalHealth.retryPolicy.nextAttemptAt,
      nextDispatchAt: lifecycleSettings?.scheduling?.nextDispatchAt || null,
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code)
    },
    visibleProofRefs: {
      auditProofKind: auditProof.kind,
      validationCodes: auditProof.validationDigest.findingCodes,
      commandIntentDigest: request.commandIntent.digest,
      workflowRoute: auditProof.workflow.route,
      runtimeEnvelopeKind: runtimeEnvelope.kind,
      providerStatus: auditProof.provider.negotiationStatus,
      providerAcknowledgementStatus: providerContract.providerAcknowledgement.status,
      providerHealthFreshness: operationalHealth.health.healthFreshnessStatus,
      stateWriteKey: `shell-exec/${request.idempotencyKey}`
    },
    optimisticUiPatch: {
      drawerOpen: !workflowHandoff.handoffPayload.dispatchable,
      showAcceptButton: routeContracts.routeBindings.accept.enabled,
      showRunButton: routeContracts.routeBindings.run.enabled,
      showResultLink: routeContracts.routeBindings.result.enabled,
      showRecoverLink: routeContracts.routeBindings.recover.enabled,
      timelineBadgeCount: reportingTimeline.items.length,
      disabledReasonCount: blockedRoutes.reduce((count, route) => count + route.disabledReasons.length, 0)
    },
    lifecycleControls: lifecycleSettings ? {
      enabled: lifecycleSettings.enabled,
      maintenanceMode: lifecycleSettings.maintenanceMode,
      pauseReason: lifecycleSettings.pauseReason,
      dispatchAllowed: lifecycleSettings.commands.dispatchAllowed,
      retryAllowed: lifecycleSettings.commands.retryAllowed,
      enabledCommands: lifecycleSettings.commands.enabled,
      disabledReasons: lifecycleSettings.disabledReasons,
      nextDispatchAt: lifecycleSettings.scheduling.nextDispatchAt,
      capacity: lifecycleSettings.scheduling.capacity
    } : null,
    handoffEnvelope: {
      target: clientState.handoffTarget,
      route: primaryBinding.route,
      payloadRef: primaryBinding.payloadRef || 'routeContracts.nextStepPlan',
      requiresFreshAcceptance: request.requiresAcceptance && !request.accepted,
      dispatchable: workflowHandoff.handoffPayload.dispatchable,
      restartSafeStatus: recovery.restartSafeStatus
    }
  };
}

function normalizeClientWorkflowMemory(input = {}, clientState = {}, request = {}, routeContracts = null, recovery = null) {
  const workflow = readRecord(input.clientWorkflow || input.workflow || input.handoffWorkflow);
  const runtimeState = readRecord(input.clientRuntimeState || input.runtimeState || readRecord(input.clientState).runtimeState);
  const pending = Array.isArray(workflow.pendingHandoffs)
    ? workflow.pendingHandoffs
    : Array.isArray(runtimeState.pendingHandoffs)
      ? runtimeState.pendingHandoffs
      : [];
  const acknowledgements = Array.isArray(workflow.acknowledgements)
    ? workflow.acknowledgements
    : Array.isArray(runtimeState.acknowledgements)
      ? runtimeState.acknowledgements
      : [];
  const lastReceiptId = coerceTrimmedString(workflow.lastReceiptId || runtimeState.lastReceiptId);
  const lastStateKey = coerceTrimmedString(workflow.stateKey || runtimeState.stateKey);
  const lastRoute = coerceTrimmedString(workflow.activeRoute || runtimeState.activeRoute || workflow.route);
  const lastStage = coerceTrimmedString(workflow.workflowStage || runtimeState.workflowStage || workflow.stage);
  const lastCommandDigest = coerceTrimmedString(workflow.commandDigest || runtimeState.commandDigest);
  const lastIdempotencyKey = coerceTrimmedString(workflow.idempotencyKey || runtimeState.idempotencyKey);
  const routeStillValid = !lastRoute
    || !routeContracts
    || Object.values(routeContracts.routeBindings).some((binding) => binding.route === lastRoute && binding.enabled !== false);
  const idempotencyMatched = !lastIdempotencyKey || lastIdempotencyKey === request.idempotencyKey;
  const acknowledgedActions = new Set(acknowledgements
    .map((entry) => coerceTrimmedString(readRecord(entry).action || entry))
    .filter(Boolean));
  const normalizedPending = pending
    .map((entry, index) => {
      const record = readRecord(entry);
      const route = coerceTrimmedString(record.route || record.nextRoute);
      const action = coerceTrimmedString(record.action || record.commandAction);
      if (!route && !action) return null;
      return {
        id: coerceTrimmedString(record.id) || `pending_${stableShellExecId([request.idempotencyKey, route || action, String(index)]).slice(0, 18)}`,
        route,
        action,
        createdAt: coerceIsoTimestamp(record.createdAt || record.generatedAt),
        acknowledged: record.acknowledged === true || acknowledgedActions.has(action),
        stale: Boolean(lastIdempotencyKey && lastIdempotencyKey !== request.idempotencyKey)
      };
    })
    .filter(Boolean);
  const pendingClientAck = normalizedPending.find((item) => !item.acknowledged && !item.stale) || null;
  const resumeRoute = routeStillValid
    ? lastRoute || routeContracts?.route?.current || null
    : routeContracts?.route?.current || null;
  const resumeAction = recovery?.commandAction === 'return_persisted_result'
    ? 'open_result'
    : recovery?.commandAction === 'reclaim_expired_lease'
      ? 'reclaim_lease'
    : recovery?.commandAction === 'recover_active_run'
      ? 'recover_run'
      : pendingClientAck?.action || routeContracts?.nextStepPlan?.primary?.action || null;

  return {
    kind: 'shell-exec.client-workflow-memory.v1',
    present: Boolean(lastReceiptId || lastStateKey || lastRoute || normalizedPending.length),
    lastReceiptId,
    lastStateKey,
    lastRoute,
    lastStage,
    lastCommandDigest,
    lastIdempotencyKey,
    idempotencyMatched,
    routeStillValid,
    pendingHandoffs: normalizedPending,
    pendingAcknowledgement: pendingClientAck,
    resume: {
      route: resumeRoute,
      action: resumeAction,
      reason: !idempotencyMatched
        ? 'client_workflow_idempotency_changed'
        : !routeStillValid
          ? 'client_route_no_longer_enabled'
          : pendingClientAck
            ? 'pending_client_handoff_acknowledgement'
            : 'client_workflow_can_resume'
    },
    conflicts: [
      ...(idempotencyMatched ? [] : ['idempotency_mismatch']),
      ...(routeStillValid ? [] : ['route_disabled']),
      ...(pendingClientAck ? ['pending_acknowledgement'] : [])
    ]
  };
}

function buildClientHandoffContinuityContract(clientState, request, runtimeEnvelope, recovery, routeContracts, clientRuntimeState, clientWorkflowMemory, providerContract, operationalHealth, now) {
  const pendingAcknowledgement = clientWorkflowMemory?.pendingAcknowledgement || null;
  const conflicts = clientWorkflowMemory?.conflicts || [];
  const primaryAction = clientRuntimeState.commandBar.primary.action;
  const primaryRoute = clientRuntimeState.commandBar.primary.route;
  const providerReady = providerContract.negotiation.dispatchEligible
    && providerContract.providerAcknowledgement.acknowledged
    && !operationalHealth.retryPolicy.providerHealthRefreshRequired;
  const dispatchReady = runtimeEnvelope.dispatchable
    && recovery.dispatchAllowed
    && providerReady
    && routeContracts.routeBindings.run.enabled;
  const stalePendingHandoff = Boolean(pendingAcknowledgement?.stale);
  const routeChanged = Boolean(
    clientWorkflowMemory?.lastRoute
      && clientWorkflowMemory.lastRoute !== routeContracts.route.current
      && clientWorkflowMemory.routeStillValid === false
  );
  const requiresOperatorAttention = conflicts.length > 0
    || stalePendingHandoff
    || operationalHealth.actionableErrors.length > 0
    || routeContracts.validationSummary.counts.errors > 0
    || providerContract.negotiation.accepted === false;
  const continuityStatus = dispatchReady
    ? 'handoff_dispatch_ready'
    : pendingAcknowledgement && !stalePendingHandoff
      ? 'handoff_ack_pending'
      : routeChanged
        ? 'handoff_route_rebound'
      : requiresOperatorAttention
        ? 'handoff_attention_required'
      : clientWorkflowMemory?.present
        ? 'handoff_resumable'
        : 'handoff_initialized';
  const resumeRoute = pendingAcknowledgement && !stalePendingHandoff
    ? pendingAcknowledgement.route || clientWorkflowMemory.resume.route || primaryRoute
    : clientWorkflowMemory?.resume?.route || primaryRoute;
  const resumeAction = pendingAcknowledgement && !stalePendingHandoff
    ? pendingAcknowledgement.action || clientWorkflowMemory.resume.action || primaryAction
    : clientWorkflowMemory?.resume?.action || primaryAction;
  const interruptReasons = [
    ...(stalePendingHandoff ? ['pending_handoff_stale'] : []),
    ...(routeChanged ? ['client_route_rebound'] : []),
    ...conflicts.map((conflict) => `workflow_${conflict}`),
    ...(providerContract.negotiation.accepted ? [] : ['provider_contract_not_ready']),
    ...(operationalHealth.retryPolicy.providerHealthRefreshRequired ? ['provider_health_refresh_required'] : []),
    ...routeContracts.validationSummary.blockingCodes.map((code) => `validation_${code}`)
  ];

  return {
    kind: 'shell-exec.client-handoff-continuity.v1',
    generatedAt: now,
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    status: continuityStatus,
    resume: {
      route: resumeRoute,
      action: resumeAction,
      label: routeContracts.nextStepPlan.primary.label,
      payloadRef: clientRuntimeState.commandBar.primary.payloadRef,
      reason: clientWorkflowMemory?.resume?.reason || 'new_client_handoff'
    },
    dispatchReadiness: {
      dispatchReady,
      runtimeDispatchable: runtimeEnvelope.dispatchable,
      recoveryDispatchAllowed: recovery.dispatchAllowed,
      providerReady,
      runRouteEnabled: routeContracts.routeBindings.run.enabled
    },
    clientMemory: {
      present: clientWorkflowMemory?.present === true,
      pendingAcknowledgementId: pendingAcknowledgement?.id || null,
      pendingAcknowledgementRoute: pendingAcknowledgement?.route || null,
      lastReceiptId: clientWorkflowMemory?.lastReceiptId || null,
      lastRoute: clientWorkflowMemory?.lastRoute || null,
      lastStage: clientWorkflowMemory?.lastStage || null,
      conflicts,
      routeStillValid: clientWorkflowMemory?.routeStillValid ?? true,
      idempotencyMatched: clientWorkflowMemory?.idempotencyMatched ?? true
    },
    userVisible: {
      shouldInterrupt: requiresOperatorAttention,
      primaryRoute,
      primaryAction,
      message: interruptReasons.length
        ? `Shell exec handoff needs attention: ${interruptReasons[0]}.`
        : dispatchReady
          ? 'Shell exec handoff is ready to dispatch.'
          : pendingAcknowledgement
            ? 'Shell exec handoff is waiting for client acknowledgement.'
            : 'Shell exec handoff is ready to continue.',
      interruptReasons: [...new Set(interruptReasons)].sort()
    },
    persistencePatch: {
      clientStateKey: clientRuntimeState.stateKey,
      pendingHandoffCount: clientWorkflowMemory?.pendingHandoffs?.length || 0,
      continuityStatus,
      resumeRoute,
      resumeAction,
      providerCursor: providerContract.syncMetadata.cursor,
      executorTarget: clientState.handoffTarget
    },
    evidenceRefs: [
      `request:${request.id}`,
      `state:${clientRuntimeState.stateKey}`,
      `route:${routeContracts.route.current}`,
      `provider-cursor:${providerContract.syncMetadata.cursor}`,
      `runtime:${runtimeEnvelope.kind}`
    ],
    proofTags: [
      `handoff-continuity:${continuityStatus}`,
      `client-memory:${clientWorkflowMemory?.present ? 'present' : 'new'}`,
      `dispatch-ready:${dispatchReady ? 'yes' : 'no'}`
    ]
  };
}

function buildClientWorkflowReceipt(clientState, request, runtimeEnvelope, recovery, workflowHandoff, routeContracts, auditProof, providerContract, operationalHealth, clientRuntimeState, now, clientWorkflowMemory = null, clientHandoffContinuity = null) {
  const routeEntries = Object.entries(routeContracts.routeBindings);
  const activeBindings = routeEntries
    .filter(([, binding]) => binding.enabled)
    .map(([name, binding]) => ({ name, binding }));
  const blockedBindings = routeEntries
    .filter(([, binding]) => binding.enabled === false && binding.disabledReasons?.length)
    .map(([name, binding]) => ({
      name,
      route: binding.route,
      disabledReasons: binding.disabledReasons
    }));
  const transitionByAction = {
    accept_preview: 'accepted',
    dispatch_run: 'queued',
    reclaim_lease: 'queued',
    recover_run: 'running',
    open_result: 'terminal',
    open_preview: 'draft'
  };
  const commandBarActions = [
    clientRuntimeState.commandBar.primary,
    ...clientRuntimeState.commandBar.secondary
  ];
  const handoffQueue = activeBindings.map(({ name, binding }) => {
    const commandAction = commandBarActions.find((action) => action.route === binding.route);
    const action = commandAction?.action || name;
    return {
      id: `handoff_${stableShellExecId([request.idempotencyKey, name, binding.route]).slice(0, 18)}`,
      route: binding.route,
      action,
      label: commandAction?.label || binding.route,
      enabled: binding.enabled !== false,
      payloadRef: binding.payloadRef || commandAction?.payloadRef || null,
      stateTransition: transitionByAction[action] || workflowHandoff.stage,
      idempotencyKey: request.idempotencyKey
    };
  });
  const primaryHandoff = handoffQueue.find((item) => item.route === clientRuntimeState.commandBar.primary.route)
    || handoffQueue[0]
    || null;
  const clientAcknowledgementRequired = ['blocked', 'provider_blocked', 'degraded', 'settings_hold'].includes(workflowHandoff.stage)
    || operationalHealth.actionableErrors.length > 0
    || blockedBindings.length > 0
    || Boolean(clientWorkflowMemory?.pendingAcknowledgement)
    || Boolean(clientWorkflowMemory?.conflicts?.includes('idempotency_mismatch'));
  const status = workflowHandoff.handoffPayload.dispatchable
    ? 'ready_for_client_dispatch'
    : clientAcknowledgementRequired
      ? 'client_attention_required'
      : request.requiresAcceptance && !request.accepted
        ? 'awaiting_client_acceptance'
        : recovery.commandAction === 'return_persisted_result'
          ? 'terminal_result_available'
          : 'preview_bound';

  return {
    kind: 'shell-exec.client-workflow-receipt.v1',
    generatedAt: now,
    receiptId: `receipt_${stableShellExecId([
      request.idempotencyKey,
      clientRuntimeState.stateKey,
      workflowHandoff.stage,
      providerContract.syncMetadata.cursor
    ]).slice(0, 22)}`,
    requestId: request.id,
    stateKey: clientRuntimeState.stateKey,
    status,
    primaryHandoff,
    handoffQueue,
    blockedRoutes: blockedBindings,
    clientStatePatch: {
      stateKey: clientRuntimeState.stateKey,
      activeRoute: clientRuntimeState.activeRoute,
      nextRoute: clientRuntimeState.nextRoute,
      workflowStage: clientRuntimeState.workflowStage,
      optimisticUiPatch: clientRuntimeState.optimisticUiPatch,
      notification: clientRuntimeState.notification,
      routeSubscriptions: clientRuntimeState.routeSubscriptions,
      resume: clientWorkflowMemory?.resume || null,
      pendingAcknowledgementId: clientWorkflowMemory?.pendingAcknowledgement?.id || null,
      handoffContinuity: clientHandoffContinuity ? {
        kind: clientHandoffContinuity.kind,
        status: clientHandoffContinuity.status,
        resume: clientHandoffContinuity.resume,
        dispatchReadiness: clientHandoffContinuity.dispatchReadiness,
        interruptReasons: clientHandoffContinuity.userVisible.interruptReasons
      } : null
    },
    clientWorkflowMemory: clientWorkflowMemory ? {
      kind: clientWorkflowMemory.kind,
      present: clientWorkflowMemory.present,
      lastReceiptId: clientWorkflowMemory.lastReceiptId,
      lastStateKey: clientWorkflowMemory.lastStateKey,
      lastRoute: clientWorkflowMemory.lastRoute,
      lastStage: clientWorkflowMemory.lastStage,
      idempotencyMatched: clientWorkflowMemory.idempotencyMatched,
      routeStillValid: clientWorkflowMemory.routeStillValid,
      pendingHandoffCount: clientWorkflowMemory.pendingHandoffs.length,
      pendingAcknowledgement: clientWorkflowMemory.pendingAcknowledgement,
      resume: clientWorkflowMemory.resume,
      conflicts: clientWorkflowMemory.conflicts
    } : null,
    runtimeContractRefs: {
      runtimeEnvelopeKind: runtimeEnvelope.kind,
      providerContractKind: providerContract.kind,
      auditProofKind: auditProof.kind,
      stateStoreKey: `shell-exec/${request.idempotencyKey}`,
      providerCursor: providerContract.syncMetadata.cursor,
      providerAcknowledgementStatus: providerContract.providerAcknowledgement.status,
      externalHandoffToken: providerContract.externalHandoffState.token
    },
    proofSummary: {
      validationOk: auditProof.validationDigest.ok,
      validationCodes: auditProof.validationDigest.findingCodes,
      commandIntentDigest: auditProof.commandIntent.digest,
      commandIntentIssues: auditProof.commandIntent.issueCodes,
      boundaryStatus: auditProof.boundary.status,
      workflowRoute: auditProof.workflow.route,
      providerStatus: auditProof.provider.negotiationStatus,
      operationalHealthStatus: auditProof.operationalHealth.status,
      retryAllowed: auditProof.operationalHealth.retryAllowed
    },
    failureDiagnostic: operationalHealth.failureState.diagnostic ? {
      active: operationalHealth.failureState.diagnostic.active,
      code: operationalHealth.failureState.diagnostic.classification?.code || null,
      severity: operationalHealth.failureState.diagnostic.classification?.severity || null,
      retryable: operationalHealth.failureState.diagnostic.retryRecommendation?.retryable ?? null,
      requiresCommandChange: operationalHealth.failureState.diagnostic.retryRecommendation?.requiresCommandChange ?? null
    } : null,
    userVisibleHandoff: {
      title: routeContracts.previewPanel.title,
      message: clientRuntimeState.notification.message,
      primaryLabel: clientRuntimeState.commandBar.primary.label,
      primaryEnabled: clientRuntimeState.commandBar.primary.enabled,
      primaryRoute: clientRuntimeState.commandBar.primary.route,
      requiresAcknowledgement: clientAcknowledgementRequired,
      acknowledgementReason: clientWorkflowMemory?.pendingAcknowledgement
        ? 'pending_client_handoff_acknowledgement'
        : clientWorkflowMemory?.conflicts?.includes('idempotency_mismatch')
          ? 'client_workflow_idempotency_changed'
          : clientHandoffContinuity?.userVisible?.interruptReasons?.[0]
            || (clientAcknowledgementRequired ? 'workflow_attention_required' : null),
      continuityStatus: clientHandoffContinuity?.status || null,
      resumeRoute: clientHandoffContinuity?.resume?.route || null,
      resumeAction: clientHandoffContinuity?.resume?.action || null,
      nextDispatchAt: clientRuntimeState.notification.nextDispatchAt,
      retryAfterMs: clientRuntimeState.notification.retryAfterMs,
      retryAt: clientRuntimeState.notification.retryAt
    },
    executorIntent: {
      target: runtimeEnvelope.executor.target,
      channel: runtimeEnvelope.executor.channel,
      cwd: runtimeEnvelope.executor.cwd,
      dispatchable: workflowHandoff.handoffPayload.dispatchable,
      commandDigest: clientRuntimeState.commandDigest,
      restartSafeStatus: recovery.restartSafeStatus
    },
    clientSession: {
      channel: clientState.channel,
      handoffTarget: clientState.handoffTarget,
      conversationId: clientState.session.conversationId,
      turnId: clientState.session.turnId,
      actorId: clientState.actor.id,
      workspaceRoot: clientState.workspace.root
    }
  };
}

function buildWorkflowHandoff(request, validation, readiness, preview, runtimeEnvelope, recovery, providerContract, operationalHealth, lifecycleSettings = null) {
  const blockedFinding = validation.findings.find((finding) => finding.severity === 'error');
  const providerBlocked = recovery.commandAction === 'hold_provider_capability_gap';
  const degradedMode = recovery.commandAction === 'hold_degraded_mode';
  const lifecycleHold = recovery.commandAction === 'hold_lifecycle_settings';
  const retryBackoff = recovery.commandAction === 'retry_after_backoff';
  const reclaimLease = recovery.commandAction === 'reclaim_expired_lease';
  const stage = blockedFinding
    ? 'blocked'
    : providerBlocked
      ? 'provider_blocked'
    : degradedMode
      ? 'degraded'
    : lifecycleHold
      ? 'settings_hold'
    : retryBackoff
      ? 'retry_wait'
    : reclaimLease
      ? 'reclaiming'
    : recovery.commandAction === 'return_persisted_result'
      ? 'complete'
    : recovery.commandAction === 'recover_active_run'
      ? 'recovering'
    : request.requiresAcceptance && !request.accepted
      ? 'awaiting_acceptance'
      : recovery.dispatchAllowed
        ? 'ready_to_dispatch'
        : 'preview';

  const routeByStage = {
    blocked: 'shellExec.preview.blocked',
    provider_blocked: 'shellExec.provider.prepare',
    degraded: 'shellExec.provider.health',
    settings_hold: 'shellExec.settings',
    retry_wait: 'shellExec.retry',
    reclaiming: 'shellExec.recover',
    complete: 'shellExec.result',
    recovering: 'shellExec.recover',
    awaiting_acceptance: 'shellExec.accept',
    ready_to_dispatch: 'shellExec.run',
    preview: 'shellExec.preview'
  };

  return {
    kind: 'shell-exec.workflow-handoff.v1',
    requestId: request.id,
    stage,
    route: routeByStage[stage],
    userVisibleStatus: blockedFinding?.message
      || operationalHealth.actionableErrors[0]?.message
      || (lifecycleHold ? `Lifecycle settings require attention: ${(lifecycleSettings?.disabledReasons || ['settings_hold']).join(', ')}` : null)
      || (retryBackoff ? `Retry available after ${operationalHealth.retryPolicy.nextAttemptAfterMs}ms backoff` : null)
      || (reclaimLease ? `Recover persisted shell exec lease: ${recovery.runClaim.reclaimReasons.join(', ') || 'lease_reclaim_required'}` : null)
      || preview.display.primaryAction,
    handoffPayload: {
      previewKind: preview.kind,
      runtimeEnvelopeKind: runtimeEnvelope.kind,
      restartSafeStatus: recovery.restartSafeStatus,
      commandAction: recovery.commandAction,
      providerContractKind: providerContract.kind,
      providerNegotiationStatus: providerContract.negotiation.status,
      providerAcknowledgementStatus: providerContract.providerAcknowledgement.status,
      externalHandoffState: providerContract.externalHandoffState.state,
      externalHandoffExpired: providerContract.externalHandoffState.expired,
      operationalHealthStatus: operationalHealth.health.status,
      degradedModeActive: operationalHealth.degradedMode.active,
      retryAfterMs: operationalHealth.retryPolicy.nextAttemptAfterMs,
      retryAt: operationalHealth.retryPolicy.nextAttemptAt,
      nextDispatchAt: lifecycleSettings?.scheduling?.nextDispatchAt || null,
      nextRequiredGate: readiness.nextRequiredGate,
      dispatchable: runtimeEnvelope.dispatchable && recovery.dispatchAllowed
    }
  };
}

function buildAuditProof(request, validation, now, clientState, workflowHandoff, providerContract, boundary, operationalHealth, lifecycleSettings = null, workspaceAccessPlan = null, sandboxPolicy = null, workspaceBoundaryReview = null) {
  return {
    kind: 'shell-exec.audit-proof.v1',
    generatedAt: now,
    requestId: request.id,
    subject: {
      surfaceId,
      surfaceGroup,
      surfaceName
    },
    acceptance: {
      required: request.requiresAcceptance,
      accepted: request.accepted,
      reason: request.reason || null
    },
    commandIntent: {
      kind: request.commandIntent.kind,
      source: request.commandIntent.source,
      executable: request.commandIntent.executable,
      commandProvided: request.commandIntent.commandProvided,
      argvProvided: request.commandIntent.argvProvided,
      tokenCount: request.commandIntent.tokenCount,
      authoritative: request.commandIntent.representation.authoritative,
      argvMatchesCommand: request.commandIntent.representation.argvMatchesCommand,
      shellControlDetected: request.commandIntent.representation.shellControlDetected,
      requiresShellInterpreter: request.commandIntent.representation.requiresShellInterpreter,
      digest: request.commandIntent.digest,
      proofTags: request.commandIntent.proofTags,
      issueCodes: request.commandIntent.validation.issues.map((issue) => issue.code)
    },
    client: {
      channel: clientState.channel,
      workspaceRoot: clientState.workspace.root,
      conversationId: clientState.session.conversationId,
      turnId: clientState.session.turnId,
      handoffTarget: clientState.handoffTarget
    },
    boundary: {
      kind: boundary.kind,
      status: boundary.status,
      tenantId: boundary.tenant.id,
      requestTenantId: boundary.tenant.requestTenantId,
      persistedTenantId: boundary.tenant.persistedTenantId,
      actorRole: boundary.actor.role,
      deniedPermissions: boundary.actor.deniedPermissions,
      effectiveCwd: boundary.workspace.effectiveCwd,
      scopedRoot: boundary.workspace.scopedRoot,
      allowedRoots: boundary.workspace.allowedRoots,
      auditTags: [
        ...boundary.auditTags,
        ...request.commandIntent.proofTags,
        ...(workspaceAccessPlan?.proofTags || []),
        ...(workspaceBoundaryReview?.proofTags || [])
      ]
    },
    workspaceBoundaryReview: workspaceBoundaryReview ? {
      kind: workspaceBoundaryReview.kind,
      status: workspaceBoundaryReview.status,
      effectiveCwd: workspaceBoundaryReview.effectiveCwd,
      requestScopedRoot: workspaceBoundaryReview.requestScopedRoot,
      persistedCwd: workspaceBoundaryReview.persistedCwd,
      persistedScopedRoot: workspaceBoundaryReview.persistedScopedRoot,
      matchingRoots: workspaceBoundaryReview.matchingRoots,
      rootRelations: workspaceBoundaryReview.rootRelations,
      blockingReasons: workspaceBoundaryReview.blockingReasons,
      warningReasons: workspaceBoundaryReview.warningReasons,
      auditHandoff: workspaceBoundaryReview.auditHandoff,
      proofTags: workspaceBoundaryReview.proofTags
    } : null,
    workspaceAccess: workspaceAccessPlan ? {
      kind: workspaceAccessPlan.kind,
      status: workspaceAccessPlan.status,
      cwd: workspaceAccessPlan.cwd,
      executable: workspaceAccessPlan.executable,
      operandCount: workspaceAccessPlan.operandCount,
      outsideScopePathCount: workspaceAccessPlan.outsideScope.length,
      writeCandidateCount: workspaceAccessPlan.writeCandidates.length,
      operands: workspaceAccessPlan.operands.map((operand) => ({
        index: operand.index,
        token: operand.token,
        flag: operand.flag,
        resolvedPath: operand.resolvedPath,
        scopedRoot: operand.scopedRoot,
        withinScope: operand.withinScope,
        access: operand.access
      }))
    } : {
      kind: 'shell-exec.workspace-access-plan.v1',
      status: 'not_evaluated',
      operandCount: 0,
      outsideScopePathCount: 0,
      writeCandidateCount: 0,
      operands: []
    },
    sandboxPolicy: sandboxPolicy ? {
      kind: sandboxPolicy.kind,
      mode: sandboxPolicy.mode,
      enforcement: sandboxPolicy.enforcement,
      filesystem: sandboxPolicy.filesystem,
      network: sandboxPolicy.network,
      process: sandboxPolicy.process,
      evidence: sandboxPolicy.evidence
    } : null,
    workflow: {
      stage: workflowHandoff.stage,
      route: workflowHandoff.route,
      dispatchable: workflowHandoff.handoffPayload.dispatchable
    },
    provider: {
      id: providerContract.provider.id,
      protocolVersion: providerContract.provider.protocolVersion,
      negotiationStatus: providerContract.negotiation.status,
      missingCapabilities: providerContract.negotiation.missingCapabilities,
      contractIssueCodes: (providerContract.negotiation.contractIssues || []).map((issue) => issue.code),
      syncContractKey: providerContract.syncMetadata.contractKey,
      providerAcknowledgementStatus: providerContract.providerAcknowledgement.status,
      providerAcknowledged: providerContract.providerAcknowledgement.acknowledged,
      providerLeaseBound: providerContract.providerAcknowledgement.providerLease.bound,
      externalHandoffState: providerContract.externalHandoffState.state,
      externalHandoffExpired: providerContract.externalHandoffState.expired,
      proofTags: providerContract.providerAcknowledgement.proofTags
    },
    operationalHealth: {
      kind: operationalHealth.kind,
      status: operationalHealth.health.status,
      providerStatus: operationalHealth.health.providerStatus,
      circuitState: operationalHealth.health.circuitState,
      healthFreshnessStatus: operationalHealth.health.healthFreshnessStatus,
      providerHealthCheckedAt: operationalHealth.providerFreshness.checkedAt,
      providerHealthAgeMs: operationalHealth.providerFreshness.ageMs,
      providerHealthMaxDispatchAgeMs: operationalHealth.providerFreshness.maxDispatchAgeMs,
      attempts: operationalHealth.failureState.attempts,
      maxAttempts: operationalHealth.failureState.maxAttempts,
      failureDiagnosticCode: operationalHealth.failureState.diagnostic?.classification?.code || null,
      failureRetryable: operationalHealth.failureState.diagnostic?.retryRecommendation?.retryable ?? null,
      failureRequiresCommandChange: operationalHealth.failureState.diagnostic?.retryRecommendation?.requiresCommandChange ?? null,
      retryAllowed: operationalHealth.retryPolicy.retryAllowed,
      retryAfterMs: operationalHealth.retryPolicy.nextAttemptAfterMs,
      retryAt: operationalHealth.retryPolicy.nextAttemptAt,
      providerHealthRefreshRequired: operationalHealth.retryPolicy.providerHealthRefreshRequired,
      degradedModeActive: operationalHealth.degradedMode.active,
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code)
    },
    lifecycleSettings: lifecycleSettings ? {
      kind: lifecycleSettings.kind,
      enabled: lifecycleSettings.enabled,
      maintenanceMode: lifecycleSettings.maintenanceMode,
      disabledReasons: lifecycleSettings.disabledReasons,
      enabledCommands: lifecycleSettings.commands.enabled,
      dispatchAllowed: lifecycleSettings.commands.dispatchAllowed,
      retryAllowed: lifecycleSettings.commands.retryAllowed,
      scheduleMode: lifecycleSettings.scheduling.mode,
      nextDispatchAt: lifecycleSettings.scheduling.nextDispatchAt,
      capacity: lifecycleSettings.scheduling.capacity
    } : null,
    idempotency: {
      key: request.idempotencyKey,
      restartSafeStatus: workflowHandoff.handoffPayload.restartSafeStatus,
      commandAction: workflowHandoff.handoffPayload.commandAction
    },
    executionContract: {
      mode: request.executionMode,
      commandIntent: {
        kind: request.commandIntent.kind,
        source: request.commandIntent.source,
        executable: request.commandIntent.executable,
        authoritative: request.commandIntent.representation.authoritative,
        argvMatchesCommand: request.commandIntent.representation.argvMatchesCommand,
        shellControlDetected: request.commandIntent.representation.shellControlDetected,
        requiresShellInterpreter: request.commandIntent.representation.requiresShellInterpreter,
        digest: request.commandIntent.digest,
        issueCodes: request.commandIntent.validation.issues.map((issue) => issue.code)
      },
      timeoutMs: request.timeoutMs,
      envAllowlist: request.envAllowlist,
      envOverlayKeys: request.envOverlay.entries.map((entry) => entry.key),
      stdinDigest: request.stdin.digest,
      stdinBytes: request.stdin.byteLength,
      riskLabels: sandboxPolicy?.evidence?.riskLabels || [],
      evidenceRefs: sandboxPolicy?.evidence?.refs || []
    },
    validationDigest: {
      ok: validation.ok,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
      findingCodes: validation.findings.map((finding) => finding.code)
    }
  };
}

function normalizeExecutionHistory(input = {}, request = {}, persistedState = {}) {
  const rawHistory = Array.isArray(input.history)
    ? input.history
    : Array.isArray(input.executionHistory)
      ? input.executionHistory
      : Array.isArray(input.analytics?.history)
        ? input.analytics.history
        : [];
  const events = rawHistory
    .map((entry, index) => {
      const record = readRecord(entry);
      const status = coerceStatus(record.status || record.phase || record.outcome, null);
      const occurredAt = coerceIsoTimestamp(record.occurredAt || record.timestamp || record.finishedAt || record.startedAt);
      const command = coerceTrimmedString(record.command || readRecord(record.request).command) || request.command || null;
      const cwd = coerceTrimmedString(record.cwd || readRecord(record.request).cwd) || request.cwd || null;
      const idempotencyKey = coerceTrimmedString(record.idempotencyKey || readRecord(record.request).idempotencyKey) || request.idempotencyKey;
      const runId = coerceTrimmedString(record.runId || record.id || record.executionId)
        || `history_${stableShellExecId([idempotencyKey, status || 'unknown', occurredAt || String(index)]).slice(0, 18)}`;
      const durationMs = Number.isFinite(record.durationMs)
        ? Math.max(0, Math.trunc(record.durationMs))
        : Number.isFinite(record.elapsedMs)
          ? Math.max(0, Math.trunc(record.elapsedMs))
          : null;
      const exitCode = Number.isFinite(record.exitCode) ? Math.trunc(record.exitCode) : null;
      const evidence = readRecord(record.evidence || record.evidenceManifest);
      const sandboxPolicy = readRecord(record.sandboxPolicy || record.sandbox);
      const riskLabels = [...new Set([
        ...coerceStringList(record.riskLabels),
        ...coerceStringList(evidence.riskLabels),
        ...coerceStringList(sandboxPolicy.riskLabels),
        ...coerceStringList(readRecord(sandboxPolicy.evidence).riskLabels)
      ])].sort();
      const riskTier = normalizeAnalyticsRiskTier(
        record.riskTier || evidence.riskTier || readRecord(record.executionPlan).riskTier,
        deriveAnalyticsRiskTier(riskLabels, status)
      );
      const evidenceManifestId = coerceTrimmedString(
        record.evidenceManifestId
          || evidence.manifestId
          || readRecord(record.executionPlan).evidenceManifestId
          || readRecord(readRecord(record.executionPlan).evidenceManifest).manifestId
      );
      const exportTags = [...new Set([
        `status:${HISTORY_EVENT_STATUSES.has(status) ? status : 'stale'}`,
        `risk:${riskTier}`,
        `duration:${classifyAnalyticsDurationBucket(durationMs)}`,
        ...(exitCode === null ? [] : [`exit:${exitCode}`]),
        ...coerceStringList(record.exportTags || record.tags)
      ])].sort();

      if (!HISTORY_EVENT_STATUSES.has(status) && !occurredAt && !command) return null;

      return {
        kind: 'shell-exec.history-event.v1',
        ordinal: index + 1,
        runId,
        requestId: coerceTrimmedString(record.requestId) || request.id,
        idempotencyKey,
        status: HISTORY_EVENT_STATUSES.has(status) ? status : 'stale',
        occurredAt,
        command,
        cwd,
        exitCode,
        durationMs,
        actorId: coerceTrimmedString(record.actorId || readRecord(record.actor).id),
        route: coerceTrimmedString(record.route || record.workflowRoute),
        previewOnly: record.previewOnly === true,
        accepted: record.accepted === true,
        riskTier,
        riskLabels,
        durationBucket: classifyAnalyticsDurationBucket(durationMs),
        evidenceManifestId,
        exportTags
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (!left.occurredAt && !right.occurredAt) return left.ordinal - right.ordinal;
      if (!left.occurredAt) return 1;
      if (!right.occurredAt) return -1;
      return left.occurredAt.localeCompare(right.occurredAt) || left.ordinal - right.ordinal;
    });

  if (!events.length && persistedState.present) {
    const inferredAt = coerceIsoTimestamp(persistedState.lastFinishedAt || persistedState.lastStartedAt);
    events.push({
      kind: 'shell-exec.history-event.v1',
      ordinal: 1,
      runId: persistedState.lastRunId || `history_${stableShellExecId([request.idempotencyKey, persistedState.status]).slice(0, 18)}`,
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      status: persistedState.status,
      occurredAt: inferredAt,
      command: request.command || persistedState.persistedBinding.command || null,
      cwd: request.cwd || persistedState.persistedBinding.cwd || null,
      exitCode: null,
      durationMs: null,
      actorId: null,
      route: 'shellExec.recover',
      previewOnly: false,
      accepted: request.accepted,
      riskTier: 'unknown',
      riskLabels: [],
      durationBucket: 'unknown',
      evidenceManifestId: null,
      exportTags: [`status:${persistedState.status}`, 'risk:unknown', 'duration:unknown']
    });
  }

  return events.map((event, index) => ({ ...event, ordinal: index + 1 }));
}

function normalizeAnalyticsSnapshotHistory(input = {}, request = {}) {
  const analytics = readRecord(input.analytics);
  const reporting = readRecord(input.reporting);
  const snapshotSources = [
    analytics.snapshotHistory,
    analytics.snapshots,
    analytics.historySnapshots,
    reporting.snapshots,
    input.analyticsSnapshots
  ].find(Array.isArray) || [];

  return snapshotSources
    .map((entry, index) => {
      const record = readRecord(entry);
      const counters = readRecord(record.counters);
      const snapshot = readRecord(record.snapshot || record.current);
      const generatedAt = coerceIsoTimestamp(record.generatedAt || record.recordedAt || record.timestamp);
      const idempotencyKey = coerceTrimmedString(record.idempotencyKey || snapshot.idempotencyKey) || request.idempotencyKey;
      const requestId = coerceTrimmedString(record.requestId || snapshot.requestId) || request.id;
      const latestStatus = coerceStatus(snapshot.latestStatus || record.latestStatus || record.status, null);

      if (!generatedAt && !latestStatus && !Object.keys(counters).length) return null;

      return {
        kind: 'shell-exec.analytics-snapshot.v1',
        ordinal: index + 1,
        snapshotId: coerceTrimmedString(record.snapshotId || record.id)
          || `analytics_snapshot_${stableShellExecId([idempotencyKey, generatedAt || String(index), latestStatus || 'unknown']).slice(0, 18)}`,
        generatedAt,
        requestId,
        idempotencyKey,
        latestStatus: latestStatus || 'stale',
        currentStage: coerceTrimmedString(snapshot.currentStage || record.currentStage),
        currentRoute: coerceTrimmedString(snapshot.currentRoute || record.currentRoute),
        commandAction: coerceTrimmedString(snapshot.commandAction || record.commandAction),
        currentRiskTier: normalizeAnalyticsRiskTier(snapshot.currentRiskTier || record.currentRiskTier || counters.currentRiskTier),
        totalHistoryEvents: coerceNonNegativeInteger(counters.totalHistoryEvents ?? record.totalHistoryEvents),
        terminalEvents: coerceNonNegativeInteger(counters.terminalEvents ?? record.terminalEvents),
        successCount: coerceNonNegativeInteger(counters.successCount ?? record.successCount),
        failureCount: coerceNonNegativeInteger(counters.failureCount ?? record.failureCount),
        validationErrorCount: coerceNonNegativeInteger(counters.validationErrorCount ?? record.validationErrorCount),
        healthActionableErrorCount: coerceNonNegativeInteger(counters.healthActionableErrorCount ?? record.healthActionableErrorCount),
        retryAttemptCount: coerceNonNegativeInteger(counters.retryAttemptCount ?? record.retryAttemptCount),
        blockedRiskCount: coerceNonNegativeInteger(counters.blockedRiskCount ?? record.blockedRiskCount),
        elevatedRiskCount: coerceNonNegativeInteger(counters.elevatedRiskCount ?? record.elevatedRiskCount),
        exportableEvidenceCount: coerceNonNegativeInteger(counters.exportableEvidenceCount ?? record.exportableEvidenceCount),
        exportRowCount: coerceNonNegativeInteger(record.exportRowCount ?? counters.exportRowCount)
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (!left.generatedAt && !right.generatedAt) return left.ordinal - right.ordinal;
      if (!left.generatedAt) return 1;
      if (!right.generatedAt) return -1;
      return left.generatedAt.localeCompare(right.generatedAt) || left.ordinal - right.ordinal;
    })
    .map((snapshot, index) => ({ ...snapshot, ordinal: index + 1 }));
}

function runtimeRiskTierFromPolicy(sandboxPolicy = null, validation = null, operationalHealth = null) {
  const riskLabels = sandboxPolicy?.evidence?.riskLabels || [];
  const blockingReasons = sandboxPolicy?.enforcement?.blockingReasons || [];
  if ((validation?.errorCount || 0) > 0 || blockingReasons.length) return 'blocked';
  if (operationalHealth?.degradedMode?.active) return 'elevated';
  return deriveAnalyticsRiskTier(
    riskLabels,
    null,
    riskLabels.length ? 'low' : 'unknown'
  );
}

function buildAnalyticsExport(request, validation, readiness, recovery, workflowHandoff, providerContract, operationalHealth, history, now, input = {}, sandboxPolicy = null, workspaceAccessPlan = null) {
  const byStatus = {};
  const byRoute = {};
  const byAction = {};
  const byRiskTier = {};
  const byRiskLabel = {};
  const byDurationBucket = {};
  const durations = [];
  let acceptedCount = 0;
  let previewOnlyCount = 0;
  let exportableEvidenceCount = 0;
  const previousSnapshots = normalizeAnalyticsSnapshotHistory(input, request);
  const currentRiskLabels = sandboxPolicy?.evidence?.riskLabels || [];
  const currentRiskTier = runtimeRiskTierFromPolicy(sandboxPolicy, validation, operationalHealth);

  for (const event of history) {
    incrementCounter(byStatus, event.status);
    incrementCounter(byRoute, event.route || 'unrouted');
    incrementCounter(byRiskTier, event.riskTier || 'unknown');
    incrementCounter(byDurationBucket, event.durationBucket || classifyAnalyticsDurationBucket(event.durationMs));
    for (const label of event.riskLabels || []) incrementCounter(byRiskLabel, label);
    if (event.accepted) acceptedCount += 1;
    if (event.previewOnly) previewOnlyCount += 1;
    if (event.evidenceManifestId || (event.riskLabels || []).length || event.exitCode !== null) exportableEvidenceCount += 1;
    if (Number.isFinite(event.durationMs)) durations.push(event.durationMs);
  }

  incrementCounter(byAction, recovery.commandAction);
  for (const finding of validation.findings) incrementCounter(byAction, `validation.${finding.severity}`);
  for (const label of currentRiskLabels) incrementCounter(byRiskLabel, label, history.length ? 0 : 1);
  if (!history.length) {
    incrementCounter(byRiskTier, currentRiskTier);
    incrementCounter(byDurationBucket, 'unknown');
  }

  const terminalEvents = history.filter((event) => TERMINAL_EXECUTION_STATUSES.has(event.status));
  const lastTerminal = terminalEvents.at(-1) || null;
  const latestEvent = history.at(-1) || null;
  const totalDurationMs = durations.reduce((sum, duration) => sum + duration, 0);
  const averageDurationMs = durations.length ? Math.round(totalDurationMs / durations.length) : null;
  const failureCount = (byStatus.failed || 0) + (byStatus.timed_out || 0) + (byStatus.cancelled || 0) + (byStatus.blocked || 0);
  const successCount = byStatus.succeeded || 0;
  const currentSnapshot = {
    snapshotId: `analytics_snapshot_${stableShellExecId([
      request.idempotencyKey,
      now,
      workflowHandoff.stage,
      recovery.commandAction,
      String(history.length)
    ]).slice(0, 18)}`,
    generatedAt: now,
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    latestStatus: latestEvent?.status || recovery.restartSafeStatus,
    currentStage: workflowHandoff.stage,
    currentRoute: workflowHandoff.route,
    commandAction: recovery.commandAction,
    currentRiskTier,
    totalHistoryEvents: history.length,
    terminalEvents: terminalEvents.length,
    successCount,
    failureCount,
    validationErrorCount: validation.errorCount,
    healthActionableErrorCount: operationalHealth.actionableErrors.length,
    retryAttemptCount: operationalHealth.failureState.attempts,
    blockedRiskCount: byRiskTier.blocked || 0,
    elevatedRiskCount: byRiskTier.elevated || 0,
    exportableEvidenceCount,
    exportRowCount: history.length
  };
  const previousSnapshot = previousSnapshots.at(-1) || null;
  const deltaFromPrevious = previousSnapshot ? {
    previousSnapshotId: previousSnapshot.snapshotId,
    previousGeneratedAt: previousSnapshot.generatedAt,
    historyEvents: currentSnapshot.totalHistoryEvents - (previousSnapshot.totalHistoryEvents || 0),
    terminalEvents: currentSnapshot.terminalEvents - (previousSnapshot.terminalEvents || 0),
    successes: currentSnapshot.successCount - (previousSnapshot.successCount || 0),
    failures: currentSnapshot.failureCount - (previousSnapshot.failureCount || 0),
    validationErrors: currentSnapshot.validationErrorCount - (previousSnapshot.validationErrorCount || 0),
    actionableErrors: currentSnapshot.healthActionableErrorCount - (previousSnapshot.healthActionableErrorCount || 0),
    retryAttempts: currentSnapshot.retryAttemptCount - (previousSnapshot.retryAttemptCount || 0),
    blockedRiskEvents: currentSnapshot.blockedRiskCount - (previousSnapshot.blockedRiskCount || 0),
    elevatedRiskEvents: currentSnapshot.elevatedRiskCount - (previousSnapshot.elevatedRiskCount || 0),
    exportableEvidenceRows: currentSnapshot.exportableEvidenceCount - (previousSnapshot.exportableEvidenceCount || 0),
    stageChanged: previousSnapshot.currentStage !== currentSnapshot.currentStage,
    routeChanged: previousSnapshot.currentRoute !== currentSnapshot.currentRoute,
    statusChanged: previousSnapshot.latestStatus !== currentSnapshot.latestStatus,
    riskTierChanged: previousSnapshot.currentRiskTier !== currentSnapshot.currentRiskTier
  } : null;
  const trendWindow = [...previousSnapshots.slice(-4), {
    kind: 'shell-exec.analytics-snapshot.v1',
    ordinal: previousSnapshots.length + 1,
    ...currentSnapshot
  }];
  const exportBatchId = `shell_exec_export_${stableShellExecId([
    request.idempotencyKey,
    now,
    providerContract.syncMetadata.cursor,
    String(history.length)
  ]).slice(0, 20)}`;

  return {
    kind: 'shell-exec.analytics-export.v1',
    generatedAt: now,
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    counters: {
      totalHistoryEvents: history.length,
      terminalEvents: terminalEvents.length,
      activeEvents: history.filter((event) => ACTIVE_EXECUTION_STATUSES.has(event.status)).length,
      successCount,
      failureCount,
      acceptedCount,
      previewOnlyCount,
      validationErrorCount: validation.errorCount,
      validationWarningCount: validation.warningCount,
      readinessPassedCount: readiness.gates.filter((gate) => gate.passed).length,
      readinessFailedCount: readiness.gates.filter((gate) => !gate.passed).length,
      healthActionableErrorCount: operationalHealth.actionableErrors.length,
      retryAttemptCount: operationalHealth.failureState.attempts,
      blockedRiskCount: byRiskTier.blocked || 0,
      elevatedRiskCount: byRiskTier.elevated || 0,
      exportableEvidenceCount,
      pathOperandCount: workspaceAccessPlan?.operandCount || 0,
      outsideScopePathCount: workspaceAccessPlan?.outsideScope?.length || 0
    },
    breakdowns: {
      byStatus,
      byRoute,
      byAction,
      byRiskTier,
      byRiskLabel,
      byDurationBucket
    },
    duration: {
      sampleCount: durations.length,
      totalMs: totalDurationMs,
      averageMs: averageDurationMs,
      maxMs: durations.length ? Math.max(...durations) : null
    },
    snapshot: {
      currentStage: workflowHandoff.stage,
      currentRoute: workflowHandoff.route,
      commandAction: recovery.commandAction,
      restartSafeStatus: recovery.restartSafeStatus,
      latestStatus: latestEvent?.status || recovery.restartSafeStatus,
      latestRunId: latestEvent?.runId || recovery.runClaim.previousRunId || null,
      lastTerminalStatus: lastTerminal?.status || null,
      lastTerminalAt: lastTerminal?.occurredAt || null,
      currentRiskTier,
      currentRiskLabels,
      dispatchAllowed: recovery.dispatchAllowed,
      providerId: providerContract.provider.id,
      providerNegotiationStatus: providerContract.negotiation.status,
      externalHandoffState: providerContract.externalHandoffState.state,
      operationalHealthStatus: operationalHealth.health.status,
      degradedModeActive: operationalHealth.degradedMode.active,
      failureDiagnosticCode: operationalHealth.failureState.diagnostic?.classification?.code || null,
      failureRetryable: operationalHealth.failureState.diagnostic?.retryRecommendation?.retryable ?? null,
      retryAllowed: operationalHealth.retryPolicy.retryAllowed,
      retryAfterMs: operationalHealth.retryPolicy.nextAttemptAfterMs
    },
    snapshots: {
      current: currentSnapshot,
      previous: previousSnapshot,
      deltaFromPrevious,
      recent: trendWindow.map((snapshot) => ({
        snapshotId: snapshot.snapshotId,
        generatedAt: snapshot.generatedAt,
        latestStatus: snapshot.latestStatus,
        currentStage: snapshot.currentStage,
        currentRiskTier: snapshot.currentRiskTier,
        totalHistoryEvents: snapshot.totalHistoryEvents,
        successCount: snapshot.successCount,
        failureCount: snapshot.failureCount,
        validationErrorCount: snapshot.validationErrorCount,
        healthActionableErrorCount: snapshot.healthActionableErrorCount,
        retryAttemptCount: snapshot.retryAttemptCount,
        blockedRiskCount: snapshot.blockedRiskCount || 0,
        elevatedRiskCount: snapshot.elevatedRiskCount || 0,
        exportableEvidenceCount: snapshot.exportableEvidenceCount || 0
      }))
    },
    exportManifest: {
      batchId: exportBatchId,
      schema: 'shell-exec.analytics-export-row.v1',
      rowCount: history.length,
      generatedAt: now,
      providerCursor: providerContract.syncMetadata.cursor,
      partitionKey: `${surfaceId}/${request.idempotencyKey}`,
      checkpointRef: providerContract.syncMetadata.stateStoreKey,
      includesHistoryRows: history.length > 0,
      includesSnapshotDelta: Boolean(deltaFromPrevious),
      dimensions: ['status', 'route', 'action', 'riskTier', 'riskLabel', 'durationBucket'],
      evidencePolicy: {
        commandIncluded: true,
        cwdIncluded: true,
        envValuesIncluded: false,
        stdinInlineIncluded: false,
        evidenceManifestIdsIncluded: exportableEvidenceCount > 0
      }
    },
    exportRows: history.map((event) => ({
      surfaceId,
      exportBatchId,
      requestId: event.requestId,
      runId: event.runId,
      idempotencyKey: event.idempotencyKey,
      status: event.status,
      occurredAt: event.occurredAt,
      durationMs: event.durationMs,
      exitCode: event.exitCode,
      route: event.route,
      command: event.command,
      cwd: event.cwd,
      riskTier: event.riskTier,
      riskLabels: event.riskLabels,
      durationBucket: event.durationBucket,
      evidenceManifestId: event.evidenceManifestId,
      exportTags: event.exportTags
    }))
  };
}

function buildReportingTimeline(request, history, analyticsExport, workflowHandoff, now) {
  const historyItems = history.map((event) => ({
    id: `${event.runId}:${event.status}:${event.ordinal}`,
    type: TERMINAL_EXECUTION_STATUSES.has(event.status)
      ? 'terminal'
      : ACTIVE_EXECUTION_STATUSES.has(event.status)
        ? 'active'
        : 'checkpoint',
    at: event.occurredAt,
    status: event.status,
    title: `${event.status}: ${event.command || request.command || 'shell command'}`,
    detail: event.exitCode === null ? event.route : `${event.route || 'shellExec.run'} exit=${event.exitCode}`,
    riskTier: event.riskTier,
    riskLabels: event.riskLabels,
    durationBucket: event.durationBucket,
    evidenceManifestId: event.evidenceManifestId,
    exportTags: event.exportTags
  }));

  return {
    kind: 'shell-exec.reporting-timeline.v1',
    generatedAt: now,
    requestId: request.id,
    current: {
      stage: workflowHandoff.stage,
      route: workflowHandoff.route,
      status: analyticsExport.snapshot.latestStatus,
      dispatchAllowed: analyticsExport.snapshot.dispatchAllowed
    },
    range: {
      firstAt: history.find((event) => event.occurredAt)?.occurredAt || null,
      lastAt: [...history].reverse().find((event) => event.occurredAt)?.occurredAt || null
    },
    items: historyItems,
    analyticsSnapshot: {
      currentSnapshotId: analyticsExport.snapshots.current.snapshotId,
      previousSnapshotId: analyticsExport.snapshots.previous?.snapshotId || null,
      exportBatchId: analyticsExport.exportManifest.batchId,
      deltaFromPrevious: analyticsExport.snapshots.deltaFromPrevious,
      recentSnapshotCount: analyticsExport.snapshots.recent.length,
      currentRiskTier: analyticsExport.snapshot.currentRiskTier,
      dimensions: analyticsExport.exportManifest.dimensions
    },
    reportCards: [
      { id: 'executions', label: 'Executions', value: analyticsExport.counters.totalHistoryEvents },
      { id: 'successes', label: 'Succeeded', value: analyticsExport.counters.successCount },
      { id: 'failures', label: 'Needs attention', value: analyticsExport.counters.failureCount },
      { id: 'blocked_risk', label: 'Blocked risk', value: analyticsExport.counters.blockedRiskCount },
      { id: 'elevated_risk', label: 'Elevated risk', value: analyticsExport.counters.elevatedRiskCount },
      { id: 'evidence_rows', label: 'Evidence rows', value: analyticsExport.counters.exportableEvidenceCount },
      { id: 'avg_duration', label: 'Average duration ms', value: analyticsExport.duration.averageMs },
      {
        id: 'history_delta',
        label: 'New events',
        value: analyticsExport.snapshots.deltaFromPrevious?.historyEvents ?? analyticsExport.counters.totalHistoryEvents
      },
      {
        id: 'actionable_errors',
        label: 'Actionable errors',
        value: analyticsExport.counters.healthActionableErrorCount
      }
    ]
  };
}

function buildNextSteps(request, validation, readiness, recovery, providerContract, operationalHealth, lifecycleSettings = null) {
  if (recovery?.commandAction === 'return_persisted_result') {
    return [{ action: 'return_persisted_result', label: 'Return the recorded terminal result for this idempotency key', routeHint: 'shellExec.result' }];
  }
  if (recovery?.commandAction === 'recover_active_run') {
    return [{ action: 'recover_active_run', label: 'Recover the active hosted-kernel run before replaying dispatch', routeHint: 'shellExec.recover' }];
  }
  if (recovery?.commandAction === 'reclaim_expired_lease') {
    return [{
      action: 'reclaim_expired_lease',
      label: 'Reclaim the expired active shell-exec lease before replaying dispatch',
      routeHint: 'shellExec.recover',
      reclaimToken: recovery.runClaim.reclaimToken,
      reclaimReasons: recovery.runClaim.reclaimReasons
    }];
  }
  if (recovery?.commandAction === 'retry_after_backoff') {
    return [{
      action: 'retry_after_backoff',
      label: `Retry after ${operationalHealth.retryPolicy.nextAttemptAfterMs}ms backoff`,
      routeHint: 'shellExec.retry',
      retryAfterMs: operationalHealth.retryPolicy.nextAttemptAfterMs,
      nextAttemptKey: operationalHealth.retryPolicy.nextAttemptKey
    }];
  }
  if (recovery?.commandAction === 'hold_degraded_mode') {
    const commandFailure = operationalHealth.failureState.diagnostic?.retryRecommendation?.requiresCommandChange
      ? operationalHealth.failureState.diagnostic
      : null;
    if (commandFailure?.classification) {
      return [{
        action: commandFailure.classification.action,
        label: commandFailure.classification.message,
        code: commandFailure.classification.code,
        routeHint: commandFailure.retryRecommendation.routeHint,
        requiresCommandChange: commandFailure.retryRecommendation.requiresCommandChange,
        retryable: commandFailure.retryRecommendation.retryable
      }];
    }
    return operationalHealth.actionableErrors.length
      ? operationalHealth.actionableErrors.map((error) => ({
        action: error.action,
        label: error.message,
        code: error.code,
        routeHint: error.routeHint
      }))
      : [{ action: 'review_operational_health', label: operationalHealth.degradedMode.userVisibleMode, routeHint: operationalHealth.degradedMode.route }];
  }
  if (recovery?.commandAction === 'hold_lifecycle_settings') {
    return [{
      action: 'review_lifecycle_settings',
      label: lifecycleSettings?.disabledReasons?.length
        ? `Review lifecycle settings: ${lifecycleSettings.disabledReasons.join(', ')}`
        : 'Review lifecycle settings before dispatch',
      routeHint: 'shellExec.settings',
      nextDispatchAt: lifecycleSettings?.scheduling?.nextDispatchAt || null,
      capacity: lifecycleSettings?.scheduling?.capacity || null
    }];
  }
  if (recovery?.commandAction === 'hold_provider_capability_gap') {
    const providerIssue = providerContract.negotiation.contractIssues?.find((issue) => issue.severity === 'error')
      || providerContract.negotiation.contractIssues?.[0]
      || null;
    if (!providerContract.negotiation.missingCapabilities.length && providerIssue) {
      return [{
        action: providerContract.providerAcknowledgement.status === 'handoff_blocked'
          ? 'refresh_provider_handoff'
          : 'prepare_provider_acknowledgement',
        label: providerIssue.message,
        code: providerIssue.code,
        routeHint: providerContract.externalHandoffState.nextRoute,
        providerAcknowledgementStatus: providerContract.providerAcknowledgement.status,
        externalHandoffExpiresAt: providerContract.externalHandoffState.expiresAt
      }];
    }
    return [{
      action: 'negotiate_provider_capabilities',
      label: `Provider must support: ${providerContract.negotiation.missingCapabilities.join(', ')}`,
      routeHint: providerContract.externalHandoffState.nextRoute
    }];
  }
  if (!request.command) {
    return [{ action: 'supply_command', label: 'Enter a command or argv array', routeHint: 'shellExec.preview' }];
  }
  if (validation.errorCount > 0) {
    return validation.findings
      .filter((finding) => finding.severity === 'error')
      .map((finding) => ({ action: 'resolve_validation_error', label: finding.message, code: finding.code, routeHint: 'shellExec.preview' }));
  }
  if (request.requiresAcceptance && !request.accepted) {
    return [{ action: 'accept_preview', label: 'Review and accept the command preview', routeHint: 'shellExec.accept' }];
  }
  if (!readiness.ready) {
    return [{ action: 'complete_readiness_gate', label: `Complete gate: ${readiness.nextRequiredGate}`, routeHint: 'shellExec.preview' }];
  }
  return [{ action: 'dispatch_execution', label: 'Dispatch command to hosted kernel executor', routeHint: 'shellExec.run' }];
}

function buildAcceptanceReviewContract(request, preview, validation, readiness, recovery, providerContract, operationalHealth, acceptDisabledReasons, dispatchDisabledReasons, acceptanceToken, primaryStep, lifecycleSettings = null) {
  const failedGateIds = readiness.gates.filter((gate) => !gate.passed).map((gate) => gate.id);
  const blockingFindings = validation.findings.filter((finding) => finding.severity === 'error');
  const warningFindings = validation.findings.filter((finding) => finding.severity === 'warning');
  const requiredBeforeAccept = [
    ...blockingFindings.map((finding) => ({
      kind: 'validation',
      code: finding.code,
      message: finding.message,
      routeHint: 'shellExec.preview'
    })),
    ...failedGateIds
      .filter((gateId) => gateId !== 'acceptance_recorded' && gateId !== 'provider_health_fresh')
      .map((gateId) => ({
        kind: 'readiness_gate',
        code: gateId,
        message: `Readiness gate ${gateId} must pass before acceptance can be recorded.`,
        routeHint: 'shellExec.preview'
      }))
  ];
  const requiredBeforeDispatch = [
    ...(request.requiresAcceptance && !request.accepted ? [{
      kind: 'acceptance',
      code: 'acceptance_pending',
      message: 'Record user acceptance for this exact shell exec preview before dispatch.',
      routeHint: 'shellExec.accept'
    }] : []),
    ...(providerContract.negotiation.accepted ? [] : [{
      kind: 'provider',
      code: providerContract.negotiation.missingCapabilities.length
        ? 'provider_capability_gap'
        : 'provider_contract_ack_required',
      message: providerContract.negotiation.missingCapabilities.length
        ? `Provider is missing required capabilities: ${providerContract.negotiation.missingCapabilities.join(', ')}.`
        : 'Provider must acknowledge the shell exec dispatch contract.',
      routeHint: providerContract.externalHandoffState.nextRoute
    }]),
    ...(operationalHealth.retryPolicy.providerHealthRefreshRequired ? [{
      kind: 'provider_health',
      code: operationalHealth.health.healthFreshnessStatus,
      message: 'Refresh provider health before dispatch.',
      routeHint: 'shellExec.provider.health'
    }] : []),
    ...(lifecycleSettings?.commands?.dispatchAllowed === false ? [{
      kind: 'lifecycle',
      code: 'dispatch_held',
      message: lifecycleSettings.disabledReasons.length
        ? `Dispatch is held by lifecycle settings: ${lifecycleSettings.disabledReasons.join(', ')}.`
        : 'Dispatch is held by lifecycle settings.',
      routeHint: 'shellExec.settings'
    }] : []),
    ...(recovery.dispatchAllowed ? [] : [{
      kind: 'recovery',
      code: recovery.commandAction,
      message: recovery.statusReason,
      routeHint: primaryStep.routeHint
    }])
  ];
  const displayMode = blockingFindings.length
    ? 'blocked'
    : request.requiresAcceptance && !request.accepted
      ? 'needs_acceptance'
      : dispatchDisabledReasons.length
        ? 'accepted_waiting'
        : 'ready_to_run';

  return {
    kind: 'shell-exec.acceptance-review.v1',
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    displayMode,
    summary: {
      title: preview.title,
      commandLine: preview.command,
      executable: preview.commandIntent.executable,
      cwd: preview.cwd,
      riskLabels: preview.sandboxPolicy?.riskLabels || [],
      validationOk: validation.ok,
      readinessReady: readiness.ready,
      providerReady: providerContract.negotiation.dispatchEligible,
      operationalStatus: operationalHealth.health.status
    },
    acceptanceDecision: {
      required: request.requiresAcceptance,
      accepted: request.accepted,
      token: acceptanceToken,
      canAccept: request.requiresAcceptance && !request.accepted && acceptDisabledReasons.length === 0,
      disabledReasons: [...new Set(acceptDisabledReasons)].sort(),
      requiredBeforeAccept
    },
    dispatchDecision: {
      dispatchable: dispatchDisabledReasons.length === 0,
      disabledReasons: [...new Set(dispatchDisabledReasons)].sort(),
      requiredBeforeDispatch,
      providerAcknowledgementStatus: providerContract.providerAcknowledgement.status,
      lifecycleDispatchAllowed: lifecycleSettings?.commands?.dispatchAllowed ?? true,
      recoveryAction: recovery.commandAction
    },
    routeDataContract: {
      accept: {
        route: 'shellExec.accept',
        method: 'POST',
        requiredFields: ['requestId', 'idempotencyKey', 'acceptanceToken', 'accepted'],
        payloadRef: 'acceptance.payload'
      },
      run: {
        route: 'shellExec.run',
        method: 'POST',
        requiredFields: ['runtimeEnvelope.requestId', 'runtimeEnvelope.command', 'runtimeEnvelope.executionPlan'],
        payloadRef: 'runtimeEnvelope'
      },
      preview: {
        route: 'shellExec.preview',
        method: 'GET',
        requiredFields: ['requestId', 'idempotencyKey'],
        payloadRef: 'previewPanel'
      }
    },
    visibleChecklist: [
      { id: 'review_command', label: 'Review command', complete: Boolean(request.command) && validation.errorCount === 0 },
      { id: 'review_scope', label: 'Review workspace scope', complete: !failedGateIds.includes('workspace_scope_bound') && !failedGateIds.includes('path_operands_scoped') },
      { id: 'review_risk', label: 'Review risk labels', complete: !acceptDisabledReasons.includes('dangerous_command_requires_review') },
      { id: 'accept_preview', label: 'Accept preview', complete: request.accepted || !request.requiresAcceptance },
      { id: 'provider_ready', label: 'Provider ready', complete: providerContract.negotiation.dispatchEligible && !operationalHealth.retryPolicy.providerHealthRefreshRequired }
    ],
    userMessage: blockingFindings[0]?.message
      || requiredBeforeDispatch[0]?.message
      || warningFindings[0]?.message
      || 'Shell exec preview is accepted and ready for hosted-kernel dispatch.'
  };
}

function buildRouteClientContract(request, preview, validation, readiness, runtimeEnvelope, recovery, providerContract, operationalHealth, workflowHandoff, auditProof, nextSteps, now, lifecycleSettings = null, workspaceAccessPlan = null, sandboxPolicy = null, workspaceBoundaryReview = null) {
  const failedGates = readiness.gates.filter((gate) => !gate.passed);
  const blockingFindings = validation.findings.filter((finding) => finding.severity === 'error');
  const warningFindings = validation.findings.filter((finding) => finding.severity === 'warning');
  const primaryStep = nextSteps[0] || {
    action: 'wait',
    label: workflowHandoff.userVisibleStatus || 'Waiting for shell-exec route state',
    routeHint: workflowHandoff.route
  };
  const acceptDisabledReasons = [
    ...blockingFindings.map((finding) => finding.code),
    ...failedGates
      .filter((gate) => !['acceptance_recorded', 'provider_health_fresh'].includes(gate.id))
      .map((gate) => `gate:${gate.id}`)
  ];
  const dispatchDisabledReasons = [
    ...acceptDisabledReasons,
    ...(request.requiresAcceptance && !request.accepted ? ['acceptance_pending'] : []),
    ...(providerContract.negotiation.accepted
      ? []
      : providerContract.negotiation.missingCapabilities.length
        ? ['provider_capability_gap']
        : ['provider_contract_ack_required']),
    ...((providerContract.negotiation.contractIssues || []).map((issue) => `provider_contract:${issue.code}`)),
    ...(operationalHealth.retryPolicy.providerHealthRefreshRequired ? [`provider_health:${operationalHealth.health.healthFreshnessStatus}`] : []),
    ...(operationalHealth.degradedMode.dispatchAllowed ? [] : ['provider_health_degraded']),
    ...(lifecycleSettings?.commands?.dispatchAllowed === false ? lifecycleSettings.disabledReasons.map((reason) => `lifecycle:${reason}`) : []),
    ...(recovery.dispatchAllowed ? [] : [`recovery:${recovery.commandAction}`])
  ];
  const acceptanceToken = request.accepted
    ? `accepted_${stableShellExecId([request.idempotencyKey, request.reason || 'accepted', auditProof.generatedAt]).slice(0, 20)}`
    : `accept_${stableShellExecId([request.id, request.idempotencyKey, preview.boundary.effectiveCwd || 'workspace']).slice(0, 20)}`;
  const acceptanceReview = buildAcceptanceReviewContract(
    request,
    preview,
    validation,
    readiness,
    recovery,
    providerContract,
    operationalHealth,
    acceptDisabledReasons,
    dispatchDisabledReasons,
    acceptanceToken,
    primaryStep,
    lifecycleSettings
  );

  return {
    kind: 'shell-exec.route-client-contract.v1',
    generatedAt: now,
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    route: {
      current: workflowHandoff.route,
      stage: workflowHandoff.stage,
      next: primaryStep.routeHint,
      statusText: workflowHandoff.userVisibleStatus,
      dispatchable: workflowHandoff.handoffPayload.dispatchable
    },
    previewPanel: {
      kind: 'shell-exec.user-preview-panel.v1',
      title: preview.title,
      commandLine: preview.command,
      argv: preview.argv,
      commandIntent: preview.commandIntent,
      cwd: runtimeEnvelope.executor.cwd,
      timeoutLabel: `${request.timeoutMs}ms timeout`,
      badges: [
        preview.impact.writesFilesystem ? 'filesystem-write' : 'read-only-intent',
        preview.impact.usesNetwork ? 'network-access' : 'no-network-detected',
        request.stdin.provided ? 'stdin-provided' : 'no-stdin',
        request.envOverlay.entries.length ? 'env-overlay' : 'default-env',
        ...(sandboxPolicy?.evidence?.riskLabels || []).filter((label) => ['destructive-pattern', 'extended-timeout', 'workspace-scope-violation', 'permission-gap', 'workspace-boundary-blocked', 'workspace-boundary-review'].includes(label))
      ],
      environmentSummary: {
        allowlistCount: request.envAllowlist.length,
        overlayCount: request.envOverlay.entries.length,
        rejectedOverlayCount: request.envOverlay.rejected.length,
        overlayKeys: request.envOverlay.entries.map((entry) => entry.key)
      },
      workspaceAccessSummary: workspaceAccessPlan ? {
        kind: workspaceAccessPlan.kind,
        status: workspaceAccessPlan.status,
        cwd: workspaceAccessPlan.cwd,
        executable: workspaceAccessPlan.executable,
        operandCount: workspaceAccessPlan.operandCount,
        outsideScopePathCount: workspaceAccessPlan.outsideScope.length,
        writeCandidateCount: workspaceAccessPlan.writeCandidates.length,
        operands: workspaceAccessPlan.operands.map((operand) => ({
          token: operand.token,
          flag: operand.flag,
          resolvedPath: operand.resolvedPath,
          withinScope: operand.withinScope,
          access: operand.access
        }))
      } : null,
      workspaceBoundarySummary: workspaceBoundaryReview ? {
        kind: workspaceBoundaryReview.kind,
        status: workspaceBoundaryReview.status,
        effectiveCwd: workspaceBoundaryReview.effectiveCwd,
        requestScopedRoot: workspaceBoundaryReview.requestScopedRoot,
        persistedCwd: workspaceBoundaryReview.persistedCwd,
        persistedScopedRoot: workspaceBoundaryReview.persistedScopedRoot,
        matchingRootCount: workspaceBoundaryReview.matchingRootCount,
        blockingReasons: workspaceBoundaryReview.blockingReasons,
        warningReasons: workspaceBoundaryReview.warningReasons,
        auditRoute: workspaceBoundaryReview.auditHandoff.route
      } : null,
      stdinSummary: {
        mode: request.stdin.mode,
        provided: request.stdin.provided,
        byteLength: request.stdin.byteLength,
        digest: request.stdin.digest
      },
      sandboxSummary: sandboxPolicy ? {
        kind: sandboxPolicy.kind,
        mode: sandboxPolicy.mode,
        enforcementStatus: sandboxPolicy.enforcement.status,
        blockingReasons: sandboxPolicy.enforcement.blockingReasons,
        riskLabels: sandboxPolicy.evidence.riskLabels,
        evidenceRefs: sandboxPolicy.evidence.refs,
        timeoutRisk: sandboxPolicy.process.timeoutRisk,
        networkPolicy: sandboxPolicy.network.policy
      } : null
    },
    acceptance: {
      kind: 'shell-exec.acceptance-action.v1',
      required: request.requiresAcceptance,
      accepted: request.accepted,
      token: acceptanceToken,
      route: request.accepted ? 'shellExec.run' : 'shellExec.accept',
      method: 'POST',
      disabled: acceptDisabledReasons.length > 0 || !request.requiresAcceptance || request.accepted,
      disabledReasons: [...new Set(acceptDisabledReasons)].sort(),
      payload: {
        requestId: request.id,
        idempotencyKey: request.idempotencyKey,
        acceptanceToken,
        accepted: true,
        reason: request.reason || null,
        auditProofKind: auditProof.kind,
        validationDigest: auditProof.validationDigest
      },
      label: request.accepted ? 'Accepted' : 'Accept command'
    },
    acceptanceReview,
    readinessSummary: {
      kind: 'shell-exec.readiness-summary.v1',
      ready: readiness.ready,
      passedCount: readiness.gates.length - failedGates.length,
      failedCount: failedGates.length,
      nextRequiredGate: readiness.nextRequiredGate,
      failedGates: failedGates.map((gate) => ({ id: gate.id, label: gate.label }))
    },
    lifecycleControls: lifecycleSettings ? {
      kind: 'shell-exec.lifecycle-controls.v1',
      enabled: lifecycleSettings.enabled,
      maintenanceMode: lifecycleSettings.maintenanceMode,
      pauseReason: lifecycleSettings.pauseReason,
      route: 'shellExec.settings',
      commands: lifecycleSettings.commands,
      scheduling: lifecycleSettings.scheduling,
      disabledReasons: lifecycleSettings.disabledReasons,
      nextActionState: {
        action: primaryStep.action,
        routeHint: primaryStep.routeHint,
        canAccept: request.requiresAcceptance && !request.accepted && acceptDisabledReasons.length === 0 && lifecycleSettings.commands.acceptanceAllowed,
        canDispatch: workflowHandoff.handoffPayload.dispatchable && lifecycleSettings.commands.dispatchAllowed,
        canRetry: recovery.commandAction === 'retry_after_backoff' && lifecycleSettings.commands.retryAllowed,
        canRecover: recovery.commandAction === 'recover_active_run' && lifecycleSettings.commands.recoveryAllowed,
        scheduledFor: lifecycleSettings.scheduling.nextDispatchAt,
        blockedBy: lifecycleSettings.disabledReasons
      }
    } : null,
    validationSummary: {
      kind: 'shell-exec.validation-summary.v1',
      ok: validation.ok,
      counts: {
        errors: validation.errorCount,
        warnings: validation.warningCount,
        info: validation.infoCount
      },
      blockingCodes: blockingFindings.map((finding) => finding.code),
      warningCodes: warningFindings.map((finding) => finding.code),
      userMessage: blockingFindings[0]?.message
        || operationalHealth.failureState.diagnostic?.classification?.message
        || warningFindings[0]?.message
        || 'Shell exec preview is valid for the hosted-kernel route.'
    },
    failureSummary: operationalHealth.failureState.diagnostic?.active ? {
      kind: 'shell-exec.failure-summary.v1',
      code: operationalHealth.failureState.diagnostic.classification?.code || null,
      message: operationalHealth.failureState.diagnostic.classification?.message || null,
      severity: operationalHealth.failureState.diagnostic.classification?.severity || null,
      latestRunId: operationalHealth.failureState.latestRunId,
      exitCode: operationalHealth.failureState.diagnostic.exitCode,
      signal: operationalHealth.failureState.diagnostic.signal,
      retryable: operationalHealth.failureState.diagnostic.retryRecommendation?.retryable ?? null,
      requiresCommandChange: operationalHealth.failureState.diagnostic.retryRecommendation?.requiresCommandChange ?? null,
      routeHint: operationalHealth.failureState.diagnostic.retryRecommendation?.routeHint || null
    } : null,
    providerHealthSummary: {
      kind: 'shell-exec.provider-health-summary.v1',
      status: operationalHealth.health.providerStatus,
      freshnessStatus: operationalHealth.health.healthFreshnessStatus,
      checkedAt: operationalHealth.providerFreshness.checkedAt,
      ageMs: operationalHealth.providerFreshness.ageMs,
      maxDispatchAgeMs: operationalHealth.providerFreshness.maxDispatchAgeMs,
      refreshDue: operationalHealth.providerFreshness.refreshDue,
      dispatchExpired: operationalHealth.providerFreshness.dispatchExpired,
      blockingReasons: operationalHealth.providerFreshness.blockingReasons,
      nextRefreshDueAt: operationalHealth.providerFreshness.nextRefreshDueAt
    },
    providerContractSummary: {
      kind: 'shell-exec.provider-contract-summary.v1',
      providerId: providerContract.provider.id,
      negotiationStatus: providerContract.negotiation.status,
      dispatchEligible: providerContract.negotiation.dispatchEligible,
      missingCapabilities: providerContract.negotiation.missingCapabilities,
      contractIssueCodes: (providerContract.negotiation.contractIssues || []).map((issue) => issue.code),
      acknowledgementStatus: providerContract.providerAcknowledgement.status,
      acknowledged: providerContract.providerAcknowledgement.acknowledged,
      providerLeaseBound: providerContract.providerAcknowledgement.providerLease.bound,
      externalHandoffState: providerContract.externalHandoffState.state,
      externalHandoffExpired: providerContract.externalHandoffState.expired,
      nextRoute: providerContract.externalHandoffState.nextRoute
    },
    nextStepPlan: {
      kind: 'shell-exec.explainable-next-step.v1',
      primary: primaryStep,
      alternatives: nextSteps.slice(1),
      explanation: recovery.statusReason,
      retryAfterMs: operationalHealth.retryPolicy.nextAttemptAfterMs,
      inputContracts: acceptanceReview.routeDataContract,
      readinessChecklist: acceptanceReview.visibleChecklist,
      blockedBy: {
        accept: acceptanceReview.acceptanceDecision.disabledReasons,
        dispatch: acceptanceReview.dispatchDecision.disabledReasons
      },
      proofRef: {
        kind: auditProof.kind,
        requestId: auditProof.requestId,
        workflowRoute: auditProof.workflow.route,
        findingCodes: auditProof.validationDigest.findingCodes
      }
    },
    routeBindings: {
      preview: {
        route: 'shellExec.preview',
        enabled: true,
        payloadRef: 'previewPanel'
      },
      accept: {
        route: 'shellExec.accept',
        enabled: request.requiresAcceptance && !request.accepted && acceptDisabledReasons.length === 0,
        disabledReasons: [...new Set(acceptDisabledReasons)].sort(),
        payloadRef: 'acceptance.payload'
      },
      run: {
        route: 'shellExec.run',
        enabled: workflowHandoff.handoffPayload.dispatchable,
        disabledReasons: [...new Set(dispatchDisabledReasons)].sort(),
        payloadRef: 'runtimeEnvelope'
      },
      recover: {
        route: 'shellExec.recover',
        enabled: recovery.commandAction === 'recover_active_run' || recovery.commandAction === 'reclaim_expired_lease',
        payloadRef: 'recovery.runClaim'
      },
      result: {
        route: 'shellExec.result',
        enabled: recovery.commandAction === 'return_persisted_result',
        payloadRef: 'history.latest'
      },
      settings: {
        route: 'shellExec.settings',
        enabled: Boolean(lifecycleSettings),
        disabledReasons: [],
        payloadRef: 'lifecycleControls'
      }
    }
  };
}

export function describeShellExecSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const request = normalizeShellExecRequest(input);
  const clientState = normalizeClientState(input, request);
  const persistedState = normalizePersistedShellExecState(input, request, clientState);
  const providerLeaseState = normalizeProviderState(input, clientState);
  const persistedLeaseRecovery = buildPersistedLeaseRecoveryContract(
    request,
    persistedState,
    { provider: { id: providerLeaseState.providerId } },
    now,
    request.timeoutMs
  );
  const boundary = normalizeTenantPermissionBoundary(input, request, clientState, persistedState);
  const workspaceAccessPlan = buildWorkspaceAccessPlan(request, boundary);
  const workspaceBoundaryReview = buildWorkspaceBoundaryReview(request, boundary, persistedState);
  const sandboxPolicy = buildShellExecSandboxPolicy(request, boundary, workspaceAccessPlan, workspaceBoundaryReview);
  const providerHealth = normalizeProviderHealthState(input);
  const providerHealthFreshness = buildProviderHealthFreshness(providerHealth, now);
  const lifecycleSettings = normalizeLifecycleSettings(input, request, persistedState, providerHealth, now);
  const validation = buildValidationSummary(request, boundary, lifecycleSettings, workspaceAccessPlan, sandboxPolicy, persistedLeaseRecovery, workspaceBoundaryReview, providerHealthFreshness);
  const preview = buildPreviewContract(request, validation, clientState, boundary, workspaceAccessPlan, sandboxPolicy, workspaceBoundaryReview);
  const readiness = buildReadinessContract(request, validation, clientState, boundary, lifecycleSettings, workspaceAccessPlan, sandboxPolicy, workspaceBoundaryReview, providerHealthFreshness);
  const runtimeEnvelope = buildRuntimeEnvelope(request, clientState, readiness, boundary, lifecycleSettings, workspaceAccessPlan, sandboxPolicy, workspaceBoundaryReview);
  const providerContract = buildProviderServiceContract(input, request, validation, readiness, runtimeEnvelope, persistedState, clientState, now);
  const history = normalizeExecutionHistory(input, request, persistedState);
  const failureDiagnostic = buildFailureDiagnostic(input, request, persistedState, providerHealth, history);
  const operationalHealth = buildOperationalHealthContract(request, validation, readiness, persistedState, providerContract, history, input, now, providerHealth, lifecycleSettings, failureDiagnostic, providerHealthFreshness);
  const recovery = buildRecoveryContract(request, validation, readiness, runtimeEnvelope, persistedState, providerContract, operationalHealth, now, lifecycleSettings, persistedLeaseRecovery);
  const workflowHandoff = buildWorkflowHandoff(request, validation, readiness, preview, runtimeEnvelope, recovery, providerContract, operationalHealth, lifecycleSettings);
  const auditProof = buildAuditProof(request, validation, now, clientState, workflowHandoff, providerContract, boundary, operationalHealth, lifecycleSettings, workspaceAccessPlan, sandboxPolicy, workspaceBoundaryReview);
  const analyticsExport = buildAnalyticsExport(request, validation, readiness, recovery, workflowHandoff, providerContract, operationalHealth, history, now, input, sandboxPolicy, workspaceAccessPlan);
  const reportingTimeline = buildReportingTimeline(request, history, analyticsExport, workflowHandoff, now);
  const nextSteps = buildNextSteps(request, validation, readiness, recovery, providerContract, operationalHealth, lifecycleSettings);
  const routeContracts = buildRouteClientContract(request, preview, validation, readiness, runtimeEnvelope, recovery, providerContract, operationalHealth, workflowHandoff, auditProof, nextSteps, now, lifecycleSettings, workspaceAccessPlan, sandboxPolicy, workspaceBoundaryReview);
  const clientRuntimeState = buildClientRuntimeStatePatch(clientState, request, runtimeEnvelope, recovery, workflowHandoff, routeContracts, auditProof, providerContract, operationalHealth, reportingTimeline, now, lifecycleSettings);
  const clientWorkflowMemory = normalizeClientWorkflowMemory(input, clientState, request, routeContracts, recovery);
  const clientHandoffContinuity = buildClientHandoffContinuityContract(clientState, request, runtimeEnvelope, recovery, routeContracts, clientRuntimeState, clientWorkflowMemory, providerContract, operationalHealth, now);
  const clientWorkflowReceipt = buildClientWorkflowReceipt(clientState, request, runtimeEnvelope, recovery, workflowHandoff, routeContracts, auditProof, providerContract, operationalHealth, clientRuntimeState, now, clientWorkflowMemory, clientHandoffContinuity);
  const stateWrite = buildStateWriteContract(request, clientState, recovery, runtimeEnvelope, providerContract, boundary, operationalHealth, clientRuntimeState, lifecycleSettings, clientWorkflowReceipt, workspaceAccessPlan, analyticsExport, reportingTimeline, sandboxPolicy, workspaceBoundaryReview, clientHandoffContinuity);

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'shell-exec hosted-kernel preview, acceptance, readiness, validation, and audit contract',
    request,
    clientState,
    persistedState,
    persistedLeaseRecovery,
    boundary,
    workspaceAccessPlan,
    workspaceBoundaryReview,
    sandboxPolicy,
    preview,
    acceptance: auditProof.acceptance,
    readiness,
    runtimeEnvelope,
    providerContract,
    providerHealth,
    providerHealthFreshness,
    lifecycleSettings,
    failureDiagnostic,
    operationalHealth,
    recovery,
    stateWrite,
    workflowHandoff,
    clientRuntimeState,
    clientWorkflowMemory,
    clientHandoffContinuity,
    clientWorkflowReceipt,
    validation,
    history: {
      kind: 'shell-exec.history-snapshot.v1',
      requestId: request.id,
      eventCount: history.length,
      latest: history.at(-1) || null,
      events: history
    },
    analytics: analyticsExport,
    reporting: reportingTimeline,
    nextSteps,
    routeContracts,
    proof: auditProof,
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

export default describeShellExecSurface;
