#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { BENCHMARK_TIER_THRESHOLDS } from '../../packages/system-benchmark/index.mjs';

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'required'].includes(String(value).trim().toLowerCase());
}

function positiveNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonNegativeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseActiveCodexCallSchedule(value) {
  const raw = String(value || '').trim();
  if (!raw) return { raw: '', valid: true, entries: [], defaultLimit: null, maxLimit: null };
  const entries = [];
  let defaultLimit = null;
  let valid = true;
  for (const part of raw.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const defaultMatch = /^default\s*:\s*(\d+)$/i.exec(part);
    const completedMatch = /^(?:completed|callsCompleted)\s*<\s*(\d+)\s*:\s*(\d+)$/i.exec(part);
    if (defaultMatch) {
      defaultLimit = positiveNumber(defaultMatch[1], null);
      valid &&= defaultLimit != null;
      continue;
    }
    if (completedMatch) {
      const completedBelow = positiveNumber(completedMatch[1], null);
      const limit = positiveNumber(completedMatch[2], null);
      if (completedBelow == null || limit == null) valid = false;
      else entries.push({ completedBelow, limit });
      continue;
    }
    valid = false;
  }
  entries.sort((a, b) => a.completedBelow - b.completedBelow);
  const maxLimit = Math.max(0, ...entries.map((entry) => entry.limit), defaultLimit || 0) || null;
  return { raw, valid: valid && (entries.length > 0 || defaultLimit != null), entries, defaultLimit, maxLimit };
}

function check(checks, ok, id, message, details = {}) {
  checks.push({ ok: Boolean(ok), id, message, ...details });
}

const contractPath = process.argv[2];
if (!contractPath) {
  console.error('usage: node apps/system-benchmark/verify-creative-relaunch-readiness.mjs <run_contract.json>');
  process.exit(2);
}

const contract = readJson(contractPath, null);
const checks = [];
const env = process.env;

check(checks, Boolean(contract), 'contract_readable', 'run contract is readable JSON', { contractPath });
if (!contract) {
  console.log(JSON.stringify({ ok: false, checks }, null, 2));
  process.exit(1);
}

const scope = contract.scope || {};
const creativePolicy = scope.creativeProductWork || {};
const surfaces = Array.isArray(scope.surfaces) ? scope.surfaces : [];
const tier = contract.benchmarkTier || contract.tier || 'tier1_creative_product_30m';
const thresholds = BENCHMARK_TIER_THRESHOLDS[tier] || {};
const workerCommand = String(env.CREATIVE_WORKER_COMMAND || creativePolicy.workerCommand || '').trim();
const workerCommandWrapperPath = (() => {
  const match = /(?:^|\s)(\/\S*codex-creative-worker\.mjs)(?:\s|$)/.exec(workerCommand);
  return match ? match[1] : null;
})();
const codexBin = String(env.CODEX_BIN || '').trim();
const codexSandbox = String(env.CODEX_CREATIVE_SANDBOX || '').trim();
const workerWorkspaceMode = String(env.ORCHESTRATOR_WORKER_WORKSPACE_MODE || 'shared').trim() || 'shared';
const workerWorkspaceCopyPaths = String(env.ORCHESTRATOR_WORKER_WORKSPACE_COPY_PATHS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const isolatedWorkspaceMode = ['isolated', 'isolated_copy', 'isolated_product_copy', 'sparse_copy'].includes(workerWorkspaceMode);
const minIterationsOverride = positiveNumber(env.CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE || env.CREATIVE_WORKER_MIN_ITERATIONS, null);
const effectiveMinIterations = minIterationsOverride ?? Math.max(1, Number(creativePolicy.minIterations || 3));
const maxIterations = positiveNumber(env.CODEX_CREATIVE_MAX_ITERATIONS, null);
const perWorkerCalls = positiveNumber(env.CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT, null);
const maxActiveCodexCalls = positiveNumber(env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS, null);
const activeCodexCallSchedule = parseActiveCodexCallSchedule(env.CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE || '');
const maxEffectiveActiveCodexCalls = Math.max(maxActiveCodexCalls || 0, activeCodexCallSchedule.maxLimit || 0) || null;
const globalCalls = positiveNumber(env.CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT, null);
const globalTokens = positiveNumber(env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT, null);
const tokenReservationEstimate = positiveNumber(env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE, null);
const minRuntimeOverride = nonNegativeNumber(env.CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE, null);
const verifierDurationOverride = nonNegativeNumber(env.MAILCHIMP_BENCHMARK_SURFACE_MIN_DURATION_MS_OVERRIDE, null);
const iterationTimeoutMs = positiveNumber(env.CODEX_CREATIVE_ITERATION_TIMEOUT_MS, null);
const commandTimeoutMs = positiveNumber(env.CREATIVE_WORKER_COMMAND_TIMEOUT_MS, null);
const workerTimeoutMs = positiveNumber(env.ORCHESTRATOR_WORKER_TIMEOUT_MS, null);
const reservationTimeoutMs = positiveNumber(env.CREATIVE_WORKER_BUDGET_RESERVATION_TIMEOUT_MS, null);
const promptMode = String(env.CREATIVE_WORKER_PROMPT_MODE || env.CODEX_CREATIVE_PROMPT_MODE || creativePolicy.promptMode || 'full_context').trim().replace(/-/g, '_') || 'full_context';
const compactBriefMaxChars = positiveNumber(env.CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS, null);
const compactFallback = parseBool(env.CREATIVE_WORKER_COMPACT_FAIL_CLOSED, promptMode === 'compact');
const requireRepairSignal = parseBool(env.CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY, promptMode === 'compact');
const codexRunsTests = parseBool(env.CREATIVE_WORKER_CODEX_RUN_TESTS, promptMode !== 'compact');
const externalVerification = parseBool(env.CREATIVE_WORKER_EXTERNAL_VERIFICATION, promptMode === 'compact');
const targetedExternalVerificationOnly = parseBool(env.CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY, false);
const maxObservedTokensPerMinute = positiveNumber(env.CREATIVE_WORKER_MAX_OBSERVED_TOKENS_PER_MINUTE, null);
const transferBenchmarkMaxRuntimeMs = positiveNumber(env.TRANSFER_BENCHMARK_MAX_RUNTIME_MS, null);
const requestedAgents = Number(contract.requestedAgentCount || 0);
const durationTargetMs = Math.max(0, Number(scope.durationTargetMinutes || 0) * 60_000);

check(checks, scope.productDiffMode === 'creative_product_work' || creativePolicy.required === true, 'creative_product_mode', 'contract is in creative product-work mode', { productDiffMode: scope.productDiffMode, creativeRequired: creativePolicy.required === true });
check(checks, contract.executionBoundary !== 'remote_execution_required' || env.BENCHMARK_HOST_ROLE === 'execution_plane' || env.HOST_ROLE === 'execution_plane', 'execution_plane_marker_present', 'remote-required contract is launched with execution-plane host marker', { executionBoundary: contract.executionBoundary || null, BENCHMARK_HOST_ROLE: env.BENCHMARK_HOST_ROLE || null, HOST_ROLE: env.HOST_ROLE || null });
check(checks, surfaces.length > 0, 'surface_matrix_present', 'contract has a surface matrix', { surfaceCount: surfaces.length });
check(checks, requestedAgents > 0, 'requested_agent_count_present', 'contract declares requested agent count', { requestedAgentCount: contract.requestedAgentCount || null });
check(checks, Boolean(workerCommand), 'creative_worker_command_present', 'CREATIVE_WORKER_COMMAND is configured', { workerCommand: workerCommand || null });
check(checks, /codex-creative-worker\.mjs/.test(workerCommand), 'creative_worker_wrapper_required', 'worker command uses codex-creative-worker.mjs wrapper, not raw codex', { workerCommand: workerCommand || null });
check(checks, Boolean(workerCommandWrapperPath) && fs.existsSync(workerCommandWrapperPath), 'creative_worker_wrapper_absolute_path_exists', 'worker command uses an absolute codex-creative-worker.mjs path that exists from product-repo cwd', { workerCommand: workerCommand || null, workerCommandWrapperPath });
check(checks, Boolean(codexBin) && path.isAbsolute(codexBin) && fs.existsSync(codexBin), 'codex_bin_absolute_path_exists', 'CODEX_BIN is an absolute executable path visible to noninteractive workers', { CODEX_BIN: codexBin || null });
check(checks, ['workspace-write', 'danger-full-access'].includes(codexSandbox), 'codex_sandbox_explicit', 'Codex sandbox mode is explicit for reproducibility', { CODEX_CREATIVE_SANDBOX: codexSandbox || null });
check(checks, !isolatedWorkspaceMode || workerWorkspaceCopyPaths.includes('tests'), 'isolated_workspace_tests_copied', 'isolated worker workspace mode copies tests for verifier execution', { ORCHESTRATOR_WORKER_WORKSPACE_MODE: workerWorkspaceMode, ORCHESTRATOR_WORKER_WORKSPACE_COPY_PATHS: workerWorkspaceCopyPaths });
check(checks, parseBool(env.CREATIVE_WORKER_CORTEX_REQUIRED, false), 'cortex_required', 'creative workers are configured to fail closed without Cortex context');
check(checks, parseBool(env.CREATIVE_WORKER_BUDGET_REQUIRED, false), 'budget_required', 'creative workers are configured to fail closed without the shared budget ledger');
check(checks, effectiveMinIterations >= 1 && effectiveMinIterations <= 2, 'bounded_min_iterations', 'effective creative-worker min iterations is bounded to 1-2', { CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: env.CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE || null, contractMinIterations: creativePolicy.minIterations || null, effectiveMinIterations });
check(checks, maxIterations != null && maxIterations >= effectiveMinIterations && maxIterations <= 2, 'bounded_iterations', 'CODEX_CREATIVE_MAX_ITERATIONS is bounded to 1-2 and is not below effective min iterations', { CODEX_CREATIVE_MAX_ITERATIONS: env.CODEX_CREATIVE_MAX_ITERATIONS || null, effectiveMinIterations });
check(checks, perWorkerCalls != null && perWorkerCalls >= 1 && perWorkerCalls <= 2, 'bounded_per_worker_calls', 'per-worker Codex call limit is bounded to 1-2', { CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: env.CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT || null });
check(checks, activeCodexCallSchedule.valid, 'active_codex_call_schedule_valid', 'optional active Codex-call schedule is parseable', { CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE: env.CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE || null, parsed: activeCodexCallSchedule.raw ? activeCodexCallSchedule : null });
check(checks, maxEffectiveActiveCodexCalls != null && maxEffectiveActiveCodexCalls >= 1 && maxEffectiveActiveCodexCalls <= 20, 'bounded_active_codex_calls', 'shared active Codex-call semaphore/schedule is present and capped at <=20', { CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS || null, CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE: env.CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE || null, maxEffectiveActiveCodexCalls });
check(checks, globalCalls != null && globalCalls >= 1 && (!requestedAgents || globalCalls <= requestedAgents * 2), 'bounded_global_calls', 'global Codex call limit is present and not more than 2x requested agents', { CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: env.CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT || null, requestedAgentCount: requestedAgents || null });
check(checks, globalTokens != null && globalTokens >= 50_000, 'bounded_global_tokens', 'global token breaker is present', { CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT || null });
check(checks, tokenReservationEstimate != null && tokenReservationEstimate >= 20_000 && tokenReservationEstimate <= globalTokens, 'token_reservation_estimate_present', 'in-flight Codex calls reserve estimated tokens before launch', { CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE || null, CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT || null });
check(checks, maxEffectiveActiveCodexCalls != null && tokenReservationEstimate != null && globalTokens != null && (maxEffectiveActiveCodexCalls * tokenReservationEstimate) <= globalTokens, 'active_calls_fit_token_budget', 'active Codex-call cap/schedule fits inside global token budget using reservation estimate', { CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS || null, CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE: env.CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE || null, maxEffectiveActiveCodexCalls, CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE || null, CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT || null });
check(checks, ['full_context', 'compact'].includes(promptMode), 'creative_prompt_mode_valid', 'creative worker prompt mode is explicit/valid', { CREATIVE_WORKER_PROMPT_MODE: env.CREATIVE_WORKER_PROMPT_MODE || null, CODEX_CREATIVE_PROMPT_MODE: env.CODEX_CREATIVE_PROMPT_MODE || null, promptMode });
check(checks, promptMode !== 'compact' || (compactBriefMaxChars != null && compactBriefMaxChars >= 4000 && compactBriefMaxChars <= 20000), 'compact_brief_size_bounded', 'compact mode has an explicit bounded surface brief size', { CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: env.CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS || null, promptMode });
check(checks, promptMode !== 'compact' || compactFallback, 'compact_fail_closed_fallback_enabled', 'compact mode falls back to full-context on weak/no-delta output', { CREATIVE_WORKER_COMPACT_FAIL_CLOSED: env.CREATIVE_WORKER_COMPACT_FAIL_CLOSED || null, promptMode });
check(checks, promptMode !== 'compact' || !compactFallback || (maxIterations != null && maxIterations >= 2), 'compact_fallback_has_iteration_slot', 'compact fail-closed fallback has a second iteration slot available', { CODEX_CREATIVE_MAX_ITERATIONS: env.CODEX_CREATIVE_MAX_ITERATIONS || null, promptMode, compactFallback });
check(checks, promptMode !== 'compact' || !compactFallback || (perWorkerCalls != null && perWorkerCalls >= 2), 'compact_fallback_has_per_worker_call_slot', 'compact fail-closed fallback is not disabled by the per-worker Codex call limit', { CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: env.CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT || null, promptMode, compactFallback });
check(checks, promptMode !== 'compact' || !compactFallback || (globalCalls != null && (!requestedAgents || globalCalls >= requestedAgents * 2)), 'compact_fallback_has_global_call_slots', 'compact fail-closed fallback is not disabled by the global Codex call limit', { CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: env.CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT || null, requestedAgentCount: requestedAgents || null, promptMode, compactFallback });
check(checks, promptMode !== 'compact' || requireRepairSignal, 'compact_retry_requires_repair_signal', 'compact mode does not take second attempts without a real repair signal', { CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: env.CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY || null, promptMode });
check(checks, promptMode !== 'compact' || !codexRunsTests, 'compact_moves_tests_outside_codex', 'compact mode keeps full verification outside Codex to avoid token waste', { CREATIVE_WORKER_CODEX_RUN_TESTS: env.CREATIVE_WORKER_CODEX_RUN_TESTS || null, promptMode });
check(checks, promptMode !== 'compact' || externalVerification, 'compact_external_verification_enabled', 'compact mode enables wrapper-side targeted verification/repair summaries', { CREATIVE_WORKER_EXTERNAL_VERIFICATION: env.CREATIVE_WORKER_EXTERNAL_VERIFICATION || null, promptMode });
check(checks, promptMode !== 'compact' || targetedExternalVerificationOnly, 'compact_targeted_external_verification_only', 'compact mode filters wrapper-side verifier commands to the assigned surface/package', { CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: env.CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY || null, promptMode });
check(checks, maxObservedTokensPerMinute == null || maxObservedTokensPerMinute >= 50_000, 'burn_rate_governor_config_valid', 'optional observed-token burn-rate governor is configured with a sane positive limit', { CREATIVE_WORKER_MAX_OBSERVED_TOKENS_PER_MINUTE: env.CREATIVE_WORKER_MAX_OBSERVED_TOKENS_PER_MINUTE || null });
check(checks, promptMode !== 'compact' || !activeCodexCallSchedule.raw || (activeCodexCallSchedule.defaultLimit != null && activeCodexCallSchedule.defaultLimit >= 2), 'compact_tail_drain_reopens', 'compact active-call schedule reopens terminal drain instead of leaving the final wave serialized at 1', { CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE: env.CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE || null, parsed: activeCodexCallSchedule.raw ? activeCodexCallSchedule : null });
check(checks, transferBenchmarkMaxRuntimeMs != null && (!durationTargetMs || transferBenchmarkMaxRuntimeMs >= durationTargetMs + 15 * 60_000), 'transfer_max_runtime_explicit_tail_grace', 'TRANSFER_BENCHMARK_MAX_RUNTIME_MS is explicit and gives queued/draining workers at least 15 minutes past the duration target', { TRANSFER_BENCHMARK_MAX_RUNTIME_MS: env.TRANSFER_BENCHMARK_MAX_RUNTIME_MS || null, durationTargetMinutes: scope.durationTargetMinutes || null });
check(checks, iterationTimeoutMs != null && iterationTimeoutMs <= 300_000, 'bounded_iteration_timeout', 'Codex iteration timeout is explicitly bounded to <=5 minutes', { CODEX_CREATIVE_ITERATION_TIMEOUT_MS: env.CODEX_CREATIVE_ITERATION_TIMEOUT_MS || null });
check(checks, commandTimeoutMs != null && iterationTimeoutMs != null && reservationTimeoutMs != null && commandTimeoutMs >= reservationTimeoutMs + iterationTimeoutMs + 60_000, 'creative_worker_command_timeout_tolerates_semaphore_and_codex', 'creative worker command timeout is explicit and covers semaphore wait + Codex iteration timeout + 60s', { CREATIVE_WORKER_COMMAND_TIMEOUT_MS: env.CREATIVE_WORKER_COMMAND_TIMEOUT_MS || null, CREATIVE_WORKER_BUDGET_RESERVATION_TIMEOUT_MS: env.CREATIVE_WORKER_BUDGET_RESERVATION_TIMEOUT_MS || null, CODEX_CREATIVE_ITERATION_TIMEOUT_MS: env.CODEX_CREATIVE_ITERATION_TIMEOUT_MS || null });
check(checks, workerTimeoutMs != null && commandTimeoutMs != null && workerTimeoutMs >= Math.max(commandTimeoutMs + 60_000, durationTargetMs || 0), 'worker_timeout_tolerates_semaphore', 'orchestrator worker timeout is explicit and long enough for command timeout plus cleanup', { ORCHESTRATOR_WORKER_TIMEOUT_MS: env.ORCHESTRATOR_WORKER_TIMEOUT_MS || null, CREATIVE_WORKER_COMMAND_TIMEOUT_MS: env.CREATIVE_WORKER_COMMAND_TIMEOUT_MS || null, durationTargetMinutes: scope.durationTargetMinutes || null });
check(checks, reservationTimeoutMs != null && reservationTimeoutMs >= Math.max(600_000, Math.min(durationTargetMs || 0, workerTimeoutMs || 0)), 'reservation_timeout_tolerates_semaphore', 'budget reservation timeout is explicit and long enough for queued workers', { CREATIVE_WORKER_BUDGET_RESERVATION_TIMEOUT_MS: env.CREATIVE_WORKER_BUDGET_RESERVATION_TIMEOUT_MS || null });
check(checks, minRuntimeOverride === 0 || Number(creativePolicy.minWorkerRuntimeMs || 0) === 0, 'no_per_shard_time_trap', 'per-shard creative worker min-runtime trap is disabled; autonomy stays run-level', { CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: env.CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE || null, contractMinWorkerRuntimeMs: creativePolicy.minWorkerRuntimeMs || 0 });
check(checks, verifierDurationOverride == null || verifierDurationOverride <= 300_000, 'no_verifier_sleep_trap', 'surface verifier duration override is not forcing 30-minute sleeps per shard', { MAILCHIMP_BENCHMARK_SURFACE_MIN_DURATION_MS_OVERRIDE: env.MAILCHIMP_BENCHMARK_SURFACE_MIN_DURATION_MS_OVERRIDE || null });
check(checks, !Object.prototype.hasOwnProperty.call(thresholds, 'minCreativeWorkerMinutes'), 'no_min_creative_worker_minutes_threshold', 'tier threshold no longer rewards per-shard elapsed-time burning', { tier });
check(checks, Object.prototype.hasOwnProperty.call(thresholds, 'autonomyWindowMinutes'), 'run_level_autonomy_threshold_present', 'run-level autonomy window threshold is still present', { tier });

const failed = checks.filter((entry) => !entry.ok);
const result = {
  ok: failed.length === 0,
  generatedAt: new Date().toISOString(),
  contractPath: path.resolve(contractPath),
  benchmarkId: contract.benchmarkId || null,
  runId: contract.runId || null,
  requestedAgentCount: contract.requestedAgentCount || null,
  surfaceCount: surfaces.length,
  failedCheckCount: failed.length,
  checks
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
