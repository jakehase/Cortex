const DIMENSIONS = [
  { id: 'product_diff', label: 'Real product-surface diffs exist', weight: 0.1 },
  { id: 'entrypoint', label: 'Route or entrypoint exists', weight: 0.07 },
  { id: 'ui', label: 'Primary UI exists', weight: 0.1 },
  { id: 'workflow', label: 'Workflow depth exists', weight: 0.2 },
  { id: 'persistence', label: 'Persistence and shared state work', weight: 0.16 },
  { id: 'edge_cases', label: 'Edge cases and regressions are covered', weight: 0.15 },
  { id: 'realism', label: 'Realism or parity proof exists', weight: 0.14 },
  { id: 'evidence_lineage', label: 'Evidence lineage is complete', weight: 0.08 }
];

const STATUS_PRESETS = {
  missing: {},
  route_only: { product_diff: 0.4, entrypoint: 1, ui: 0.1 },
  ui_stub: { product_diff: 0.5, entrypoint: 1, ui: 0.5, workflow: 0.1 },
  workflow_partial: { product_diff: 1, entrypoint: 1, ui: 0.75, workflow: 0.35, persistence: 0.15, edge_cases: 0.1 },
  persisted_partial: { product_diff: 1, entrypoint: 1, ui: 0.8, workflow: 0.5, persistence: 0.45, edge_cases: 0.2, realism: 0.1 },
  realism_partial: { product_diff: 1, entrypoint: 1, ui: 0.9, workflow: 0.7, persistence: 0.6, edge_cases: 0.45, realism: 0.45 },
  complete: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.id, 1]))
};

const EXECUTION_DIMENSIONS = [
  { id: 'control_plane_ready', weight: 1 },
  { id: 'execution_plane_ready', weight: 1 },
  { id: 'supervisor_truth', weight: 1 },
  { id: 'notifier_truth', weight: 0.75 },
  { id: 'repo_qualification', weight: 1 },
  { id: 'recovery_proven', weight: 0.75 },
  { id: 'no_null_blocker_contradiction', weight: 1 }
];

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function weightedAverage(entries) {
  const totalWeight = entries.reduce((sum, entry) => sum + (entry.weight || 0), 0);
  if (totalWeight <= 0) return 0;
  const total = entries.reduce((sum, entry) => sum + ((entry.value || 0) * (entry.weight || 0)), 0);
  return total / totalWeight;
}

function geometricMean(values) {
  const safe = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (safe.length === 0) return 0;
  if (safe.some((value) => value === 0)) return 0;
  const sum = safe.reduce((acc, value) => acc + Math.log(value), 0);
  return Math.exp(sum / safe.length);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeClaimId(value = '') {
  const normalized = String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) return null;
  if ([
    'real_codex_product_work',
    'real_codex_product_run',
    'real_codex_agents',
    'real_100_agent_codex_product_work',
    'real_100agent_codex_product_work',
    'real_model_product_work',
    'metered_codex_product_work',
    'codex_product_work',
    'full_product_parity_real_codex'
  ].includes(normalized)) return 'real_codex_product_work';
  if ([
    'deterministic_strict_runtime',
    'strict_runtime_validator',
    'strict_product_surface_runtime',
    'deterministic_validator',
    'semantic_runtime_validator'
  ].includes(normalized)) return 'deterministic_strict_runtime';
  if (['threshold_benchmark', 'benchmark_threshold', 'declared_benchmark', 'declared_benchmark_threshold'].includes(normalized)) return 'declared_benchmark_threshold';
  if (['full_clone', 'full_product_parity', 'full_mailchimp_clone'].includes(normalized)) return 'full_clone';
  return normalized;
}

function inferRequestedRunClaim(contract = {}) {
  const searchable = [
    contract.benchmarkId,
    contract.runId,
    contract.notes,
    contract.replyAnchor,
    contract.scope?.objective,
    contract.scope?.label,
    contract.scope?.description
  ].filter(Boolean).join('\n');
  const normalized = searchable
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const raw = searchable.toLowerCase();
  if (/(^|_)100real($|_)|(^|_)real100($|_)|(^|_)real_100($|_)|(^|_)100_agent_real($|_)/.test(normalized)) return 'real_codex_product_work';
  if (/\breal\s+100[-\s]*agent\b/.test(raw)) return 'real_codex_product_work';
  if (/(^|_)real_codex($|_)|(^|_)codex_(agent|worker|product|run)($|_)|(^|_)(metered|provider)_codex($|_)/.test(normalized)) return 'real_codex_product_work';
  if (/(^|_)real_(model|agent)_product($|_)|(^|_)model_product_work($|_)/.test(normalized)) return 'real_codex_product_work';
  if (/(^|_)strict_(validator|runtime)($|_)|(^|_)deterministic_(validator|runtime)($|_)/.test(normalized)) return 'deterministic_strict_runtime';
  if (/(^|_)full_(clone|product_parity)($|_)/.test(normalized)) return 'full_clone';
  return null;
}

function resolveRequestedRunClaim(contract = {}) {
  const explicitClaim = normalizeClaimId(
    contract.requestedClaim
      || contract.claimIntegrity?.requestedClaim
      || contract.metadata?.requestedClaim
      || contract.metadata?.claimIntegrity?.requestedClaim
      || contract.scope?.requestedClaim
      || contract.scope?.claimIntegrity?.requestedClaim
      || contract.scope?.truthClaims?.requestedClaim
      || null
  );
  return explicitClaim || inferRequestedRunClaim(contract) || 'declared_benchmark_threshold';
}

function medianNumber(values = []) {
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : round((sorted[middle - 1] + sorted[middle]) / 2, 2);
}

function percentileNumber(values = [], percentile = 0.95) {
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
  return sorted[index];
}

function looksLikeCodexCommand(value = '') {
  return /(^|[\s/])codex(?:\s|$)/i.test(String(value || ''))
    || /CODEX_BIN/i.test(String(value || ''))
    || /codex-creative-worker\.mjs/i.test(String(value || ''));
}

function looksLikeCodexEvidence(value = '') {
  return /OpenAI Codex|tokens used|codex_call_completed|tokensObserved|CODEX_AUTH_OK|codex-creative-worker/i.test(String(value || ''));
}

function deterministicBenchmarkMode(mode = '') {
  const normalized = normalizeClaimId(mode) || String(mode || '').toLowerCase();
  return normalized === 'deterministic_strict_runtime'
    || normalized.includes('deterministic')
    || normalized.includes('strict_product_surface_runtime')
    || normalized.includes('semantic_product_architecture')
    || normalized === 'verification_only';
}

function productDiffModeRequiresCodexForRealClaim(contract = {}) {
  return contract.scope?.productDiffMode === 'creative_product_work'
    || contract.scope?.creativeProductWork?.required === true
    || contract.scope?.agentWork?.required === true
    || contract.scope?.realModelWork?.required === true;
}

function truthyEnv(value) {
  return ['1', 'true', 'yes', 'on', 'required'].includes(String(value ?? '').trim().toLowerCase());
}

function addCheck(checks, { id, ok, observed = null, requirement = null, reason = null, severity = 'blocking' }) {
  const entry = { id, ok: Boolean(ok), observed, requirement, reason, severity };
  checks.push(entry);
  return entry;
}

export function evaluateBenchmarkRunClaimPreflight({ contract = {}, env = {} } = {}) {
  const requestedClaim = resolveRequestedRunClaim(contract);
  const checks = [];
  const realCodexClaim = requestedClaim === 'real_codex_product_work';
  const workerCommand = String(
    env.CREATIVE_WORKER_COMMAND
      || contract.scope?.creativeProductWork?.workerCommand
      || contract.scope?.agentWork?.workerCommand
      || contract.metadata?.workerCommand
      || ''
  ).trim();
  const productDiffMode = contract.scope?.productDiffMode || null;
  const codexCapableMode = productDiffModeRequiresCodexForRealClaim(contract);
  const budgetRequired = truthyEnv(env.CREATIVE_WORKER_BUDGET_REQUIRED)
    || contract.scope?.creativeProductWork?.budgetRequired === true
    || contract.scope?.creativeProductWork?.requireBudgetLedger === true
    || contract.scope?.agentWork?.budgetRequired === true
    || contract.scope?.agentWork?.requireBudgetLedger === true;
  const ledgerPath = String(
    env.CREATIVE_WORKER_BUDGET_LEDGER_PATH
      || contract.scope?.creativeProductWork?.budgetLedgerPath
      || contract.scope?.agentWork?.budgetLedgerPath
      || ''
  ).trim();

  addCheck(checks, {
    id: 'requested_claim_declared',
    ok: true,
    observed: requestedClaim,
    requirement: 'claim must be explicit or default to declared_benchmark_threshold',
    severity: 'info'
  });

  if (realCodexClaim) {
    addCheck(checks, {
      id: 'real_codex_claim_uses_model_worker_mode',
      ok: codexCapableMode,
      observed: { productDiffMode, creativeProductWorkRequired: contract.scope?.creativeProductWork?.required === true },
      requirement: 'productDiffMode=creative_product_work or equivalent model-worker mode',
      reason: codexCapableMode ? null : 'requested_real_codex_claim_uses_deterministic_or_verifier_only_mode'
    });
    addCheck(checks, {
      id: 'real_codex_claim_has_worker_command',
      ok: workerCommand.length > 0,
      observed: workerCommand || null,
      requirement: 'CREATIVE_WORKER_COMMAND / workerCommand configured',
      reason: workerCommand ? null : 'codex_worker_command_missing'
    });
    addCheck(checks, {
      id: 'real_codex_claim_worker_command_invokes_codex',
      ok: workerCommand.length > 0 && looksLikeCodexCommand(workerCommand),
      observed: workerCommand || null,
      requirement: 'worker command must visibly invoke Codex or codex-creative-worker',
      reason: workerCommand && !looksLikeCodexCommand(workerCommand) ? 'worker_command_not_codex_backed' : (workerCommand ? null : 'codex_worker_command_missing')
    });
    addCheck(checks, {
      id: 'real_codex_claim_requires_token_ledger',
      ok: budgetRequired,
      observed: { CREATIVE_WORKER_BUDGET_REQUIRED: env.CREATIVE_WORKER_BUDGET_REQUIRED || null, ledgerPath: ledgerPath || null },
      requirement: 'CREATIVE_WORKER_BUDGET_REQUIRED=true or contract budgetRequired/requireBudgetLedger=true so the worker fails closed without the provider token ledger',
      reason: budgetRequired ? null : 'provider_token_ledger_not_required_prelaunch'
    });
  }

  const blockingFailures = checks.filter((check) => check.severity !== 'info' && !check.ok);
  return {
    schemaVersion: 'claw.benchmark_claim_integrity_preflight.v1',
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId || null,
    runId: contract.runId || null,
    requestedClaim,
    ok: blockingFailures.length === 0,
    status: blockingFailures.length ? 'blocked' : 'ready',
    checks,
    blockingFailures,
    blockerFamily: blockingFailures.length ? 'claim_integrity_preflight_blocked' : null,
    blocker: blockingFailures.length
      ? `Requested claim ${requestedClaim} is not launchable with the declared worker/product-diff configuration.`
      : null,
    nextAction: blockingFailures.length
      ? 'Switch the contract to a metered Codex/creative product worker path or downgrade the requested claim before launch.'
      : null
  };
}

function summarizeRunResultEvidence(resultRecords = [], { durationTargetMs = null } = {}) {
  const records = normalizeArray(resultRecords).filter(Boolean);
  const implementationDurations = [];
  const workerElapsedDurations = [];
  const verifierDurations = [];
  let commandPresentCount = 0;
  let codexCommandCount = 0;
  let codexEvidenceCount = 0;
  let deterministicImplementationCount = 0;
  let creativeImplementationCount = 0;
  let zeroImplementationDurationCount = 0;
  let modifiedProductResultCount = 0;
  let longVerifierResultCount = 0;
  const implementationModes = {};

  for (const record of records) {
    const implementation = record.implementation || {};
    const metadata = implementation.metadata || {};
    const command = String(implementation.command || metadata.command || metadata.workerCommand || '').trim();
    const mode = String(metadata.benchmarkMode || metadata.productDiffMode || metadata.mode || 'unknown');
    implementationModes[mode] = (implementationModes[mode] || 0) + 1;
    const durationMs = Number(implementation.durationMs || metadata.creativeWorkerRuntimeMs || 0);
    const elapsedMs = Number(record.elapsedMs || 0);
    implementationDurations.push(durationMs);
    workerElapsedDurations.push(elapsedMs);
    if (durationMs <= 0) zeroImplementationDurationCount += 1;
    if (command) commandPresentCount += 1;
    if (looksLikeCodexCommand(command)) codexCommandCount += 1;
    const implementationText = [
      command,
      implementation.stdout,
      implementation.stderr,
      metadata.workerCommand,
      metadata.budgetLedgerPath,
      metadata.creativeWorkerEvidence ? JSON.stringify(metadata.creativeWorkerEvidence).slice(0, 2000) : ''
    ].filter(Boolean).join('\n');
    if (looksLikeCodexEvidence(implementationText)) codexEvidenceCount += 1;
    const deterministic = deterministicBenchmarkMode(mode)
      || metadata.strictProductSurfaceRuntime === true
      || (durationMs <= 0 && !command && !looksLikeCodexEvidence(implementationText));
    if (deterministic) deterministicImplementationCount += 1;
    if (mode === 'creative_product_work' || metadata.creativeProductWorkRequired === true) creativeImplementationCount += 1;
    if (normalizeArray(implementation.modifiedFiles).length > 0) modifiedProductResultCount += 1;

    const recordVerifierDurations = normalizeArray(record.verifierResults).map((verifier) => Number(verifier?.durationMs || 0)).filter(Number.isFinite);
    verifierDurations.push(...recordVerifierDurations);
    if (durationTargetMs && recordVerifierDurations.some((value) => value >= durationTargetMs * 0.9)) longVerifierResultCount += 1;
  }

  return {
    resultCount: records.length,
    implementationModes,
    commandPresentCount,
    missingCommandCount: Math.max(0, records.length - commandPresentCount),
    codexCommandCount,
    codexEvidenceCount,
    deterministicImplementationCount,
    creativeImplementationCount,
    zeroImplementationDurationCount,
    modifiedProductResultCount,
    implementationDurationMs: {
      min: implementationDurations.length ? Math.min(...implementationDurations) : null,
      median: medianNumber(implementationDurations),
      p95: percentileNumber(implementationDurations, 0.95),
      max: implementationDurations.length ? Math.max(...implementationDurations) : null
    },
    workerElapsedMs: {
      min: workerElapsedDurations.length ? Math.min(...workerElapsedDurations) : null,
      median: medianNumber(workerElapsedDurations),
      p95: percentileNumber(workerElapsedDurations, 0.95),
      max: workerElapsedDurations.length ? Math.max(...workerElapsedDurations) : null
    },
    verifierDurationMs: {
      count: verifierDurations.length,
      min: verifierDurations.length ? Math.min(...verifierDurations) : null,
      median: medianNumber(verifierDurations),
      p95: percentileNumber(verifierDurations, 0.95),
      max: verifierDurations.length ? Math.max(...verifierDurations) : null
    },
    longVerifierResultCount,
    verifierOnlyDurationSuspect: records.length > 0
      && zeroImplementationDurationCount === records.length
      && durationTargetMs
      && longVerifierResultCount === records.length
  };
}

function normalizeTokenEvidence(tokenEvidence = {}) {
  const callsStarted = Number(tokenEvidence.codexCallsStarted ?? tokenEvidence.callsStarted ?? 0);
  const callsCompleted = Number(tokenEvidence.codexCallsCompleted ?? tokenEvidence.callsCompleted ?? 0);
  const tokensObserved = Number(tokenEvidence.tokensObserved || 0);
  return {
    ledgerPresent: tokenEvidence.ledgerPresent === true || Boolean(tokenEvidence.ledgerPath),
    ledgerPath: tokenEvidence.ledgerPath || null,
    codexCallsStarted: Number.isFinite(callsStarted) ? callsStarted : 0,
    codexCallsCompleted: Number.isFinite(callsCompleted) ? callsCompleted : 0,
    tokensObserved: Number.isFinite(tokensObserved) ? tokensObserved : 0,
    globalStop: tokenEvidence.globalStop || null
  };
}

function requiredAcceptedResultCountForContract(contract = {}, requestedAgentCount = 0) {
  const requested = Math.max(1, Number(requestedAgentCount || 0));
  const policy = contract.scope?.surfaceReliability || contract.scope?.successTolerance || {};
  const toleranceEnabled = policy.enabled === true || contract.benchmarkTier === 'tier3_game_vertical_slice_100agent';
  if (!toleranceEnabled) return requested;
  const configuredRatio = Number(policy.greenMinVerifiedProductiveRatio ?? policy.greenMinSurfaceRatio);
  const ratio = Number.isFinite(configuredRatio) ? configuredRatio : 0.95;
  return Math.max(1, Math.ceil(requested * Math.min(1, Math.max(0, ratio))));
}

export function compileBenchmarkRunClaimIntegrityAudit({
  contract = {},
  resultRecords = [],
  thresholdPass = false,
  mechanicalGreen = false,
  scaleProofReady = false,
  tokenEvidence = {},
  durationEvidence = {}
} = {}) {
  const requestedClaim = resolveRequestedRunClaim(contract);
  const durationTargetMs = Number(durationEvidence.durationTargetMinutes || contract.scope?.durationTargetMinutes || 0) > 0
    ? Number(durationEvidence.durationTargetMinutes || contract.scope?.durationTargetMinutes) * 60_000
    : null;
  const observed = summarizeRunResultEvidence(resultRecords, { durationTargetMs });
  const tokens = normalizeTokenEvidence(tokenEvidence);
  const resultCount = observed.resultCount;
  const requestedAgentCount = Number(contract.requestedAgentCount || resultCount || 0);
  const requiredAcceptedResultCount = requiredAcceptedResultCountForContract(contract, requestedAgentCount || resultCount || 1);
  const requiredCodexCalls = Math.max(1, requestedAgentCount || resultCount || 1);
  const checks = [];

  addCheck(checks, {
    id: 'declared_benchmark_threshold_passed',
    ok: thresholdPass === true,
    observed: thresholdPass,
    requirement: 'thresholdPass=true for the declared benchmark claim',
    severity: requestedClaim === 'declared_benchmark_threshold' ? 'blocking' : 'supporting'
  });
  addCheck(checks, {
    id: 'mechanical_and_scale_green',
    ok: mechanicalGreen === true && scaleProofReady === true,
    observed: { mechanicalGreen, scaleProofReady },
    requirement: 'mechanicalGreen=true and scaleProofReady=true',
    severity: requestedClaim === 'real_codex_product_work' ? 'blocking' : 'supporting'
  });

  const realCodexChecks = [];
  const addRealCheck = (entry) => {
    addCheck(checks, { ...entry, severity: requestedClaim === 'real_codex_product_work' ? 'blocking' : 'supporting' });
    realCodexChecks.push(checks[checks.length - 1]);
  };
  addRealCheck({
    id: 'real_codex_result_count_matches_requested_scale',
    ok: resultCount >= requiredAcceptedResultCount,
    observed: { resultCount, requestedAgentCount, requiredAcceptedResultCount },
    requirement: 'result count meets the declared accepted-work floor for requested agent/surface scale'
  });
  addRealCheck({
    id: 'real_codex_implementation_commands_present',
    ok: resultCount > 0 && observed.commandPresentCount === resultCount,
    observed: { commandPresentCount: observed.commandPresentCount, resultCount },
    requirement: 'every implementation result records the model/worker command'
  });
  addRealCheck({
    id: 'real_codex_implementation_commands_invoke_codex',
    ok: resultCount > 0 && observed.codexCommandCount === resultCount,
    observed: { codexCommandCount: observed.codexCommandCount, resultCount },
    requirement: 'every implementation command visibly invokes Codex or codex-creative-worker'
  });
  addRealCheck({
    id: 'real_codex_no_deterministic_implementation_credit',
    ok: observed.deterministicImplementationCount === 0,
    observed: { deterministicImplementationCount: observed.deterministicImplementationCount, resultCount, implementationModes: observed.implementationModes },
    requirement: 'deterministic/strict-runtime implementation paths must be absent'
  });
  addRealCheck({
    id: 'real_codex_implementation_runtime_positive',
    ok: resultCount > 0 && Number(observed.implementationDurationMs.median || 0) > 0 && observed.zeroImplementationDurationCount === 0,
    observed: { implementationDurationMs: observed.implementationDurationMs, zeroImplementationDurationCount: observed.zeroImplementationDurationCount },
    requirement: 'implementation runtime must be positive and not satisfied only by verifier runtime'
  });
  addRealCheck({
    id: 'real_codex_token_ledger_present',
    ok: tokens.ledgerPresent === true,
    observed: tokens,
    requirement: 'creative/Codex token ledger must be present'
  });
  addRealCheck({
    id: 'real_codex_calls_observed',
    ok: tokens.codexCallsStarted >= requiredCodexCalls && tokens.codexCallsCompleted >= requiredCodexCalls,
    observed: { codexCallsStarted: tokens.codexCallsStarted, codexCallsCompleted: tokens.codexCallsCompleted, requiredCodexCalls },
    requirement: 'Codex calls started/completed at or above requested agent scale'
  });
  addRealCheck({
    id: 'real_codex_provider_tokens_observed',
    ok: tokens.tokensObserved > 0,
    observed: { tokensObserved: tokens.tokensObserved },
    requirement: 'provider-observed token usage must be non-zero'
  });
  addRealCheck({
    id: 'real_codex_duration_not_verifier_only',
    ok: observed.verifierOnlyDurationSuspect !== true,
    observed: {
      verifierOnlyDurationSuspect: observed.verifierOnlyDurationSuspect,
      longVerifierResultCount: observed.longVerifierResultCount,
      resultCount,
      implementationDurationMs: observed.implementationDurationMs,
      verifierDurationMs: observed.verifierDurationMs
    },
    requirement: 'duration target must not be satisfied solely by long-running verifiers'
  });

  const realCodexAllowed = realCodexChecks.every((check) => check.ok);
  const deterministicStrictRuntimeAllowed = thresholdPass === true
    && resultCount > 0
    && observed.deterministicImplementationCount === resultCount
    && observed.modifiedProductResultCount === resultCount;
  const declaredBenchmarkAllowed = thresholdPass === true;
  const allowedClaims = [];
  if (declaredBenchmarkAllowed) allowedClaims.push('declared_benchmark_threshold');
  if (deterministicStrictRuntimeAllowed) allowedClaims.push('deterministic_strict_runtime');
  if (realCodexAllowed) allowedClaims.push('real_codex_product_work');
  const disallowedClaims = [];
  if (!realCodexAllowed) disallowedClaims.push({ claim: 'real_codex_product_work', failedChecks: realCodexChecks.filter((check) => !check.ok).map((check) => check.id) });
  if (!deterministicStrictRuntimeAllowed) disallowedClaims.push({ claim: 'deterministic_strict_runtime', reason: 'deterministic strict-runtime result shape not fully present or threshold did not pass' });
  if (!declaredBenchmarkAllowed) disallowedClaims.push({ claim: 'declared_benchmark_threshold', reason: 'thresholdPass is false' });
  const requestedClaimAllowed = allowedClaims.includes(requestedClaim);
  const highestHonestClaim = realCodexAllowed
    ? 'real_codex_product_work'
    : deterministicStrictRuntimeAllowed
      ? 'deterministic_strict_runtime'
      : declaredBenchmarkAllowed
        ? 'declared_benchmark_threshold'
        : 'none';
  const blockingFailures = checks.filter((check) => check.severity === 'blocking' && !check.ok);

  return {
    schemaVersion: 'claw.benchmark_claim_integrity_audit.v1',
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId || null,
    runId: contract.runId || null,
    requestedClaim,
    requestedClaimAllowed,
    status: requestedClaimAllowed ? 'green' : 'claim_blocked',
    highestHonestClaim,
    allowedClaims,
    disallowedClaims,
    observed,
    tokenEvidence: tokens,
    checks,
    blockingFailures,
    fakeGreenRisk: thresholdPass === true && !requestedClaimAllowed,
    downgrade: requestedClaimAllowed ? null : {
      from: requestedClaim,
      to: highestHonestClaim,
      reason: blockingFailures[0]?.reason || blockingFailures[0]?.id || 'requested_claim_not_supported_by_artifacts'
    },
    blockerFamily: requestedClaimAllowed ? null : 'claim_integrity_mismatch',
    blocker: requestedClaimAllowed
      ? null
      : `Requested claim ${requestedClaim} is not supported by terminal run evidence; highest honest claim is ${highestHonestClaim}.`,
    nextAction: requestedClaimAllowed
      ? null
      : 'Rerun with the correct worker path and evidence ledger for the requested claim, or downgrade the reported claim.'
  };
}

function lineageCompleteness(lineage = {}) {
  const hasChangedFiles = Array.isArray(lineage.changedProductFiles) && lineage.changedProductFiles.length > 0;
  const hasProofArtifacts = Array.isArray(lineage.proofArtifacts) && lineage.proofArtifacts.length > 0;
  if (!hasChangedFiles && !hasProofArtifacts) return 0;
  const checks = [
    typeof lineage.targetReference === 'string' && lineage.targetReference.trim().length > 0,
    hasChangedFiles,
    hasProofArtifacts,
    Number.isFinite(lineage.confidence),
    Array.isArray(lineage.missingAdjacent)
  ];
  return checks.filter(Boolean).length / checks.length;
}

function normalizeLeafDimensions(leaf = {}) {
  const preset = STATUS_PRESETS[leaf.currentState] || {};
  const explicit = leaf.dimensions || {};
  const lineageValue = explicit.evidence_lineage ?? (leaf.lineageScore ?? lineageCompleteness(leaf.evidence));
  return Object.fromEntries(DIMENSIONS.map((dimension) => [
    dimension.id,
    clamp01(explicit[dimension.id] ?? preset[dimension.id] ?? (dimension.id === 'evidence_lineage' ? lineageValue : 0))
  ]));
}

function classifyLeaf(score) {
  if (score >= 0.999) return 'complete';
  if (score >= 0.65) return 'advanced';
  if (score > 0) return 'partial';
  return 'missing';
}

function summarizeLeaf(leaf = {}) {
  const dimensions = normalizeLeafDimensions(leaf);
  const dimensionScores = DIMENSIONS.map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
    weight: dimension.weight,
    value: dimensions[dimension.id]
  }));
  const score = weightedAverage(dimensionScores);
  const realism = dimensions.realism;
  const lineage = dimensions.evidence_lineage;
  const started = score > 0;
  const criticalMissing = score < 0.35;
  return {
    id: leaf.id,
    label: leaf.label || leaf.id,
    weight: Number(leaf.weight || 1),
    currentState: leaf.currentState || classifyLeaf(score),
    score: round(score),
    realism: round(realism),
    lineage: round(lineage),
    started,
    criticalMissing,
    evidence: {
      targetReference: leaf.evidence?.targetReference || null,
      changedProductFiles: normalizeArray(leaf.evidence?.changedProductFiles),
      proofArtifacts: normalizeArray(leaf.evidence?.proofArtifacts),
      confidence: Number.isFinite(leaf.evidence?.confidence) ? round(leaf.evidence.confidence) : null,
      missingAdjacent: normalizeArray(leaf.evidence?.missingAdjacent)
    },
    dimensionScores
  };
}

function summarizeSurface(surface = {}) {
  const leaves = normalizeArray(surface.leaves).map(summarizeLeaf);
  const weight = Number(surface.weight || 1);
  const score = weightedAverage(leaves.map((leaf) => ({ value: leaf.score, weight: leaf.weight })));
  const coverage = weightedAverage(leaves.map((leaf) => ({ value: leaf.started ? 1 : 0, weight: leaf.weight })));
  const realism = weightedAverage(leaves.map((leaf) => ({ value: leaf.realism, weight: leaf.weight })));
  const lineage = weightedAverage(leaves.map((leaf) => ({ value: leaf.lineage, weight: leaf.weight })));
  const criticalMissingCount = leaves.filter((leaf) => leaf.criticalMissing).length;
  return {
    id: surface.id,
    label: surface.label || surface.id,
    weight,
    score: round(score),
    coverage: round(coverage),
    realism: round(realism),
    lineage: round(lineage),
    currentState: surface.currentState || (score === 0 ? 'open' : score >= 0.999 ? 'complete' : 'partial'),
    leaves,
    leafCount: leaves.length,
    criticalMissingCount,
    status: score === 0 ? 'open' : score >= 0.999 ? 'complete' : 'partial'
  };
}

function summarizeExecutionReadiness(readiness = {}) {
  const entries = EXECUTION_DIMENSIONS.map((dimension) => ({
    id: dimension.id,
    weight: dimension.weight,
    value: clamp01(readiness[dimension.id])
  }));
  const score = weightedAverage(entries);
  return {
    score: round(score),
    entries: entries.map((entry) => ({ ...entry, value: round(entry.value) }))
  };
}

function buildNegativeSpaceLedger(surfaces = []) {
  const entries = [];
  for (const surface of surfaces) {
    for (const leaf of surface.leaves) {
      if (leaf.score >= 0.999) continue;
      entries.push({
        surfaceId: surface.id,
        surfaceLabel: surface.label,
        leafId: leaf.id,
        leafLabel: leaf.label,
        score: leaf.score,
        realism: leaf.realism,
        lineage: leaf.lineage,
        critical: leaf.criticalMissing,
        missingAdjacent: leaf.evidence.missingAdjacent
      });
    }
  }
  return {
    totalEntries: entries.length,
    criticalEntries: entries.filter((entry) => entry.critical).length,
    entries: entries.sort((a, b) => a.score - b.score || a.surfaceLabel.localeCompare(b.surfaceLabel))
  };
}

function computeAxes({ surfaces, execution }) {
  const weightedSurfaceScore = weightedAverage(surfaces.map((surface) => ({ value: surface.score, weight: surface.weight })));
  const weightedCoverage = weightedAverage(surfaces.map((surface) => ({ value: surface.coverage, weight: surface.weight })));
  const weightedRealism = weightedAverage(surfaces.map((surface) => ({ value: surface.realism, weight: surface.weight })));
  const weightedLineage = weightedAverage(surfaces.map((surface) => ({ value: surface.lineage, weight: surface.weight })));
  return {
    executionReadiness: round(execution.score),
    productSurfaceCoverage: round(weightedCoverage),
    depthParityQuality: round(weightedSurfaceScore),
    verifiedRealism: round(weightedRealism),
    evidenceLineage: round(weightedLineage)
  };
}

function computeProgress({ surfaces, axes, negativeSpace }) {
  const productAxes = [axes.productSurfaceCoverage, axes.depthParityQuality, axes.verifiedRealism, axes.evidenceLineage].map((value) => Math.max(value, 0.02));
  const productRaw = geometricMean(productAxes);
  const sortedSurfaceScores = surfaces.map((surface) => surface.score).sort((a, b) => a - b);
  const weakestCount = Math.max(1, Math.ceil(sortedSurfaceScores.length / 4));
  const weakestAverage = sortedSurfaceScores.slice(0, weakestCount).reduce((sum, score) => sum + score, 0) / weakestCount;
  const totalLeaves = surfaces.reduce((sum, surface) => sum + surface.leafCount, 0);
  const criticalMissingRatio = totalLeaves > 0 ? negativeSpace.criticalEntries / totalLeaves : 1;
  const negativeSpacePenalty = Math.max(0.05, 1 - criticalMissingRatio);
  const productProgress = productRaw * (0.6 + (0.4 * weakestAverage)) * negativeSpacePenalty;
  const campaignReadiness = geometricMean([Math.max(productProgress, 0.001), Math.max(axes.executionReadiness, 0.001)]);
  const confidence = Math.min(1, axes.evidenceLineage * Math.min(1, Math.sqrt(totalLeaves / 40)));
  return {
    cloneParityPercent: round(productProgress * 100, 1),
    campaignReadinessPercent: round(campaignReadiness * 100, 1),
    confidencePercent: round(confidence * 100, 1),
    diagnostics: {
      productRaw: round(productRaw),
      weakestQuartileAverage: round(weakestAverage),
      criticalMissingRatio: round(criticalMissingRatio),
      negativeSpacePenalty: round(negativeSpacePenalty)
    }
  };
}

function higherEstimateRequirements(surfaces = [], thresholds = [10, 25, 50]) {
  const incomplete = surfaces
    .flatMap((surface) => surface.leaves
      .filter((leaf) => leaf.score < 0.999)
      .map((leaf) => ({ surface, leaf })))
    .sort((a, b) => (a.leaf.score - b.leaf.score) || (b.surface.weight - a.surface.weight));

  return Object.fromEntries(thresholds.map((threshold) => {
    const count = threshold <= 10 ? 8 : threshold <= 25 ? 18 : 32;
    const needed = incomplete.slice(0, count).map(({ surface, leaf }) => `${surface.label}: ${leaf.label}`);
    return [threshold, needed];
  }));
}

export function buildAdversarialAudit(report, { proposedPercent = null } = {}) {
  const weakestSurfaces = [...report.surfaces]
    .sort((a, b) => a.score - b.score || b.weight - a.weight)
    .slice(0, 5)
    .map((surface) => ({
      id: surface.id,
      label: surface.label,
      score: surface.score,
      criticalMissingCount: surface.criticalMissingCount
    }));

  const strongestCounterexamples = report.negativeSpace.entries.slice(0, 12).map((entry) => ({
    surface: entry.surfaceLabel,
    leaf: entry.leafLabel,
    score: entry.score,
    missingAdjacent: entry.missingAdjacent
  }));

  const reasons = [];
  if (report.axes.executionReadiness > report.axes.depthParityQuality + 0.35) reasons.push('execution_readiness_outpaces_product_parity');
  if (report.negativeSpace.criticalEntries > 0) reasons.push('large_negative_space_remains');
  if (report.axes.verifiedRealism < 0.2) reasons.push('realism_proof_is_sparse');
  if (report.axes.evidenceLineage < 0.75) reasons.push('evidence_lineage_is_incomplete');
  if (Number.isFinite(proposedPercent) && proposedPercent > report.progress.cloneParityPercent + 3) reasons.push('proposed_percent_exceeds_artifact_backed_estimate');

  return {
    reasonsEstimateMayBeTooHigh: [...new Set(reasons)],
    weakestSurfaces,
    strongestCounterexamples,
    higherEstimateRequirements: higherEstimateRequirements(report.surfaces)
  };
}

export function buildClaimResponseFrame(report, { proposedPercent = null } = {}) {
  return {
    observed: {
      axes: report.axes,
      negativeSpace: {
        totalEntries: report.negativeSpace.totalEntries,
        criticalEntries: report.negativeSpace.criticalEntries
      }
    },
    estimated: {
      cloneParityPercent: report.progress.cloneParityPercent,
      campaignReadinessPercent: report.progress.campaignReadinessPercent,
      proposedPercent
    },
    confidence: {
      percent: report.progress.confidencePercent,
      note: report.progress.confidencePercent >= 75 ? 'artifact-backed' : 'estimate is still coarse and should be treated conservatively'
    },
    missing: report.negativeSpace.entries.slice(0, 10).map((entry) => `${entry.surfaceLabel}: ${entry.leafLabel}`),
    higherEstimateRequirements: buildAdversarialAudit(report, { proposedPercent }).higherEstimateRequirements
  };
}

export function compileClaimIntegrityReport({
  title = 'claim_integrity_report',
  anchor = null,
  targetPath = null,
  requestedFidelity = null,
  requestedClaim = null,
  executionReadiness = {},
  surfaces = []
} = {}) {
  const summarizedSurfaces = normalizeArray(surfaces).map(summarizeSurface);
  const execution = summarizeExecutionReadiness(executionReadiness);
  const axes = computeAxes({ surfaces: summarizedSurfaces, execution });
  const negativeSpace = buildNegativeSpaceLedger(summarizedSurfaces);
  const progress = computeProgress({ surfaces: summarizedSurfaces, axes, negativeSpace });
  const report = {
    generatedAt: new Date().toISOString(),
    title,
    anchor,
    targetPath,
    requestedFidelity,
    requestedClaim,
    dimensions: DIMENSIONS,
    executionReadiness: execution,
    axes,
    surfaces: summarizedSurfaces,
    negativeSpace,
    progress
  };
  return {
    ...report,
    adversarialAudit: buildAdversarialAudit(report)
  };
}

export const DEFAULT_DIMENSIONS = DIMENSIONS;
export const DEFAULT_STATUS_PRESETS = STATUS_PRESETS;
