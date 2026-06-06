#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateBenchmarkThresholds } from '../../packages/system-benchmark/index.mjs';
import {
  aggregateContinuousMetrics,
  aggregateContinuousThresholdMetrics,
  bundleSelectedSurfaces,
  buildContinuousSurfaceInventory,
  createBudgetLimitBackoffPause,
  createUsageLimitBackoffPause,
  createWaveRunContract,
  evaluateContinuousStop,
  evaluateTokenEfficiency,
  evaluateTokenEfficiencyDebtRecovery,
  isBudgetBackoffReason,
  isUsageLimitReason,
  planAdaptiveWaveBudget,
  promptModeForContinuousWave,
  readJson,
  selectNextWaveSurfaces,
  stableList,
  summarizeWaveBudgetLedger,
  summarizeWaveArtifacts,
  updateContinuousStateFromWave,
  writeJson
} from '../../packages/continuous-workload-controller/index.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const FINITE_RUNNER = path.join(SCRIPT_DIR, 'run-transfer-orchestrator-benchmark.mjs');

function parseArgs(argv) {
  const args = {
    contractPath: null,
    artifactRoot: null,
    repoPath: null,
    dryRun: false,
    maxWaves: Number(process.env.CONTINUOUS_CONTROLLER_MAX_WAVES || 100),
    requestedAgentCount: null,
    waveDurationTargetMinutes: Number(process.env.CONTINUOUS_CONTROLLER_WAVE_DURATION_MINUTES || 10),
    waveMaxAttemptsPerTask: Number(process.env.CONTINUOUS_CONTROLLER_WAVE_MAX_ATTEMPTS_PER_TASK || 2),
    maxAttemptsPerSurface: Number(process.env.CONTINUOUS_CONTROLLER_MAX_ATTEMPTS_PER_SURFACE || 3),
    maxNoProgressWaves: Number(process.env.CONTINUOUS_CONTROLLER_MAX_NO_PROGRESS_WAVES || 2),
    maxExpansionCycles: Number(process.env.CONTINUOUS_CONTROLLER_MAX_EXPANSION_CYCLES || 40),
    hardMaxExpansionCycles: Number(process.env.CONTINUOUS_CONTROLLER_HARD_MAX_EXPANSION_CYCLES || 200),
    expansionBatchCycles: Number(process.env.CONTINUOUS_CONTROLLER_EXPANSION_BATCH_CYCLES || 10),
    fullContextWaveCount: Number(process.env.CONTINUOUS_CONTROLLER_FULL_CONTEXT_WAVES || 1),
    modeAfterFullContext: process.env.CONTINUOUS_CONTROLLER_PROMPT_MODE_AFTER_FULL_CONTEXT || 'compact',
    compactBriefMaxChars: Number(process.env.CONTINUOUS_CONTROLLER_COMPACT_BRIEF_MAX_CHARS || process.env.CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS || 9000),
    usageLimitBackoffMinutes: Number(process.env.CONTINUOUS_CONTROLLER_USAGE_LIMIT_BACKOFF_MINUTES || 360),
    pauseOnUsageLimit: String(process.env.CONTINUOUS_CONTROLLER_PAUSE_ON_USAGE_LIMIT || '1') !== '0',
    ignoreBackoff: false,
    controllerGlobalTokenLimit: Number(process.env.CONTINUOUS_CONTROLLER_GLOBAL_TOKEN_LIMIT || 0),
    adaptiveTokenBudget: String(process.env.CONTINUOUS_CONTROLLER_ADAPTIVE_TOKEN_BUDGET || '1') !== '0',
    tokenSafetyMultiplier: Number(process.env.CONTINUOUS_CONTROLLER_TOKEN_SAFETY_MULTIPLIER || 1.15),
    minBudgetedWaveAgents: Number(process.env.CONTINUOUS_CONTROLLER_MIN_BUDGETED_WAVE_AGENTS || 1),
    bundleSize: Number(process.env.CONTINUOUS_CONTROLLER_BUNDLE_SIZE || 1),
    bundleMode: process.env.CONTINUOUS_CONTROLLER_BUNDLE_MODE || 'coherent_product_slice',
    tokenEfficiencyGateEnabled: String(process.env.CONTINUOUS_CONTROLLER_TOKEN_EFFICIENCY_GATE || '1') !== '0',
    tokenEfficiencyMinObservedTokens: Number(process.env.CONTINUOUS_CONTROLLER_TOKEN_EFFICIENCY_MIN_OBSERVED_TOKENS || 1000000),
    tokenEfficiencyMinAddedLines: Number(process.env.CONTINUOUS_CONTROLLER_TOKEN_EFFICIENCY_MIN_ADDED_LINES || 500),
    maxTokensPerAddedLine: Number(process.env.CONTINUOUS_CONTROLLER_MAX_TOKENS_PER_ADDED_LINE || 900),
    maxTokensPerUniqueNormalizedAddedLine: Number(process.env.CONTINUOUS_CONTROLLER_MAX_TOKENS_PER_UNIQUE_LINE || 1100),
    minUniqueNormalizedAddedLinesPerCall: Number(process.env.CONTINUOUS_CONTROLLER_MIN_UNIQUE_LINES_PER_CALL || 40),
    resumeStatePath: null,
    durationTargetMinutes: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (!args.contractPath && !token.startsWith('--')) { args.contractPath = path.resolve(token); continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--repo-path') { args.repoPath = path.resolve(next); index += 1; continue; }
    if (token === '--max-waves') { args.maxWaves = Number(next); index += 1; continue; }
    if (token === '--requested-agent-count') { args.requestedAgentCount = Number(next); index += 1; continue; }
    if (token === '--wave-duration-minutes') { args.waveDurationTargetMinutes = Number(next); index += 1; continue; }
    if (token === '--wave-max-attempts') { args.waveMaxAttemptsPerTask = Number(next); index += 1; continue; }
    if (token === '--max-attempts-per-surface') { args.maxAttemptsPerSurface = Number(next); index += 1; continue; }
    if (token === '--max-no-progress-waves') { args.maxNoProgressWaves = Number(next); index += 1; continue; }
    if (token === '--max-expansion-cycles') { args.maxExpansionCycles = Number(next); index += 1; continue; }
    if (token === '--hard-max-expansion-cycles') { args.hardMaxExpansionCycles = Number(next); index += 1; continue; }
    if (token === '--expansion-batch-cycles') { args.expansionBatchCycles = Number(next); index += 1; continue; }
    if (token === '--full-context-waves') { args.fullContextWaveCount = Number(next); index += 1; continue; }
    if (token === '--prompt-mode-after-full-context') { args.modeAfterFullContext = String(next || 'compact'); index += 1; continue; }
    if (token === '--compact-brief-max-chars') { args.compactBriefMaxChars = Number(next); index += 1; continue; }
    if (token === '--usage-limit-backoff-minutes') { args.usageLimitBackoffMinutes = Number(next); index += 1; continue; }
    if (token === '--controller-global-token-limit') { args.controllerGlobalTokenLimit = Number(next); index += 1; continue; }
    if (token === '--token-safety-multiplier') { args.tokenSafetyMultiplier = Number(next); index += 1; continue; }
    if (token === '--min-budgeted-wave-agents') { args.minBudgetedWaveAgents = Number(next); index += 1; continue; }
    if (token === '--bundle-size') { args.bundleSize = Number(next); index += 1; continue; }
    if (token === '--bundle-mode') { args.bundleMode = String(next || 'coherent_product_slice'); index += 1; continue; }
    if (token === '--max-tokens-per-added-line') { args.maxTokensPerAddedLine = Number(next); index += 1; continue; }
    if (token === '--max-tokens-per-unique-line') { args.maxTokensPerUniqueNormalizedAddedLine = Number(next); index += 1; continue; }
    if (token === '--min-unique-lines-per-call') { args.minUniqueNormalizedAddedLinesPerCall = Number(next); index += 1; continue; }
    if (token === '--token-efficiency-min-observed-tokens') { args.tokenEfficiencyMinObservedTokens = Number(next); index += 1; continue; }
    if (token === '--token-efficiency-min-added-lines') { args.tokenEfficiencyMinAddedLines = Number(next); index += 1; continue; }
    if (token === '--no-token-efficiency-gate') { args.tokenEfficiencyGateEnabled = false; continue; }
    if (token === '--no-adaptive-token-budget') { args.adaptiveTokenBudget = false; continue; }
    if (token === '--no-pause-on-usage-limit') { args.pauseOnUsageLimit = false; continue; }
    if (token === '--ignore-backoff') { args.ignoreBackoff = true; continue; }
    if (token === '--resume-state') { args.resumeStatePath = path.resolve(next); index += 1; continue; }
    if (token === '--duration-target-minutes') { args.durationTargetMinutes = Number(next); index += 1; continue; }
    if (token === '--dry-run') { args.dryRun = true; continue; }
  }
  if (!args.contractPath) {
    console.error('usage: node run-continuous-real-workload-controller.mjs <run_contract.json> [--artifact-root ROOT] [--dry-run]');
    process.exit(2);
  }
  return args;
}

function hostRole() {
  return String(process.env.BENCHMARK_HOST_ROLE || process.env.HOST_ROLE || '').trim();
}

function writeBlocker({ artifactRoot, contract, blocker, nextAction, phase = 'continuous_real_workload_controller', extra = {} }) {
  const report = {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract?.benchmarkId || null,
    runId: contract?.runId || null,
    phase,
    status: 'blocked',
    blocker,
    nextAction,
    ...extra
  };
  writeJson(path.join(artifactRoot, 'blocker_report.json'), report);
  writeJson(path.join(artifactRoot, 'completion_summary.json'), {
    generatedAt: report.generatedAt,
    benchmarkId: contract?.benchmarkId || null,
    runId: contract?.runId || null,
    executionMode: 'continuous_real_workload_controller',
    thresholdPass: false,
    mechanicalGreen: false,
    scaleProofReady: false,
    blocker: report,
    note: blocker
  });
  return report;
}

function controllerTargetFromContract(contract, args) {
  const go = contract.scope?.goThresholds || {};
  return {
    durationTargetMinutes: args.durationTargetMinutes || Number(contract.scope?.durationTargetMinutes || go.autonomyWindowMinutes || 120),
    productiveIterationRateMin: go.productiveIterationRateMin ?? 0.65,
    noOpRateMax: go.noOpRateMax ?? 0.15,
    handoffEfficiencyMin: go.handoffEfficiencyMin ?? 0.70,
    transferScoreMin: go.transferScoreMin ?? 0.70,
    minChangedProductFiles: go.minCountedProductFilesTouched ?? go.minChangedProductFiles ?? 8,
    minUniqueAgents: go.minDistinctAcceptedAgentIds ?? go.minUniqueAgents ?? 4
  };
}

function finiteRunnerEnv({ selectedCount, args, promptMode = 'full_context', controllerBudget = {}, budgetPlan = null }) {
  const attempts = Math.max(1, Number(args.waveMaxAttemptsPerTask || 2));
  const globalCalls = Math.max(selectedCount * attempts, selectedCount);
  const waveRuntimeMs = Math.max(60_000, Number(args.waveDurationTargetMinutes || 10) * 60_000 + 15 * 60_000);
  const compact = promptMode === 'compact';
  const controllerLimit = Math.max(0, Number(args.controllerGlobalTokenLimit || 0));
  const tokensObserved = Number(controllerBudget.tokensObserved || 0);
  const remainingControllerTokens = controllerLimit ? Math.max(0, controllerLimit - tokensObserved) : 0;
  const inheritedWaveTokenLimit = Math.max(0, Number(process.env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT || 0));
  const waveTokenLimit = controllerLimit
    ? String(inheritedWaveTokenLimit ? Math.min(inheritedWaveTokenLimit, remainingControllerTokens) : remainingControllerTokens)
    : process.env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT;
  const effectiveTokenReservationEstimate = Math.max(1, Number(budgetPlan?.tokenReservationEstimate || process.env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE || 0));
  return {
    ...process.env,
    CREATIVE_WORKER_PROMPT_MODE: promptMode,
    CODEX_CREATIVE_PROMPT_MODE: promptMode,
    CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: compact ? String(Math.max(4000, Number(args.compactBriefMaxChars || 9000))) : process.env.CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS,
    CREATIVE_WORKER_CODEX_RUN_TESTS: compact ? '0' : process.env.CREATIVE_WORKER_CODEX_RUN_TESTS,
    CREATIVE_WORKER_EXTERNAL_VERIFICATION: compact ? '1' : process.env.CREATIVE_WORKER_EXTERNAL_VERIFICATION,
    CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: compact ? '1' : process.env.CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY,
    CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: compact ? '1' : process.env.CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY,
    CREATIVE_WORKER_STOP_ON_EXTERNAL_VERIFICATION_FAILURE: compact ? (process.env.CREATIVE_WORKER_STOP_ON_EXTERNAL_VERIFICATION_FAILURE || '1') : process.env.CREATIVE_WORKER_STOP_ON_EXTERNAL_VERIFICATION_FAILURE,
    CREATIVE_WORKER_COMPACT_FAIL_CLOSED: compact ? (process.env.CREATIVE_WORKER_COMPACT_FAIL_CLOSED || '0') : process.env.CREATIVE_WORKER_COMPACT_FAIL_CLOSED,
    CREATIVE_WORKER_CONTEXT_FILE_MAX_CHARS: compact ? (process.env.CREATIVE_WORKER_CONTEXT_FILE_MAX_CHARS || '6000') : process.env.CREATIVE_WORKER_CONTEXT_FILE_MAX_CHARS,
    CREATIVE_WORKER_CONTEXT_TOTAL_MAX_CHARS: compact ? (process.env.CREATIVE_WORKER_CONTEXT_TOTAL_MAX_CHARS || '16000') : process.env.CREATIVE_WORKER_CONTEXT_TOTAL_MAX_CHARS,
    ...(waveTokenLimit ? { CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: waveTokenLimit } : {}),
    CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: String(effectiveTokenReservationEstimate),
    ORCHESTRATOR_MAX_ATTEMPTS_PER_TASK: String(attempts),
    CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: String(attempts),
    CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: String(globalCalls),
    CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: String(Math.max(1, Math.min(Number(process.env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS || 8), selectedCount || 1))),
    TRANSFER_BENCHMARK_MAX_RUNTIME_MS: String(process.env.TRANSFER_BENCHMARK_MAX_RUNTIME_MS || waveRuntimeMs)
  };
}

function readWaveSummary(waveRoot, waveNumber) {
  const completion = readJson(path.join(waveRoot, 'completion_summary.json'), {});
  const patchQueue = readJson(path.join(waveRoot, 'orchestrator_run', 'patch_queue.json'), {});
  const truthConflicts = readJson(path.join(waveRoot, 'truth_conflicts.json'), readJson(path.join(waveRoot, 'orchestrator_run', 'truth_conflicts.json'), null));
  const budgetLedger = readJson(path.join(waveRoot, 'orchestrator_run', 'results', 'creative-worker-budget-ledger.json'), null);
  const summary = summarizeWaveArtifacts({ completionSummary: completion, patchQueue, truthConflicts, waveNumber });
  if (budgetLedger) {
    summary.budget = summarizeWaveBudgetLedger(budgetLedger);
    summary.budgetStopReason = summary.budget.globalStopReason || null;
  }
  return summary;
}

function writePausedBackoffArtifacts({ controllerRoot, baseContract, state, finalDecision, metrics, timing = null }) {
  state.status = 'paused_budget_backoff';
  state.paused = true;
  state.budgetBackoff = {
    reason: finalDecision.reason,
    pauseKind: finalDecision.pauseKind || 'budget_backoff',
    resumeAfter: finalDecision.resumeAfter || null,
    backoffMinutes: finalDecision.backoffMinutes || null,
    waveNumber: finalDecision.waveNumber || null,
    nextAction: finalDecision.nextAction || null
  };
  state.updatedAt = new Date().toISOString();
  state.metrics = metrics;
  state.lastDecision = finalDecision;
  if (timing) state.attemptTiming = timing;
  writeJson(path.join(controllerRoot, 'continuous_controller_state.json'), state);
  const report = {
    generatedAt: state.updatedAt,
    benchmarkId: baseContract.benchmarkId || null,
    runId: baseContract.runId || null,
    phase: 'continuous_real_workload_controller',
    status: 'paused',
    blockerKind: finalDecision.reason || 'budget_backoff_required',
    blocker: 'Continuous real-workload controller paused before wasting more Codex calls.',
    nextAction: finalDecision.nextAction || 'Resume after the recorded backoff window.',
    resumeAfter: finalDecision.resumeAfter || null,
    timing,
    budgetBackoff: state.budgetBackoff
  };
  writeJson(path.join(controllerRoot, 'blocker_report.json'), report);
  writeJson(path.join(controllerRoot, 'completion_summary.json'), {
    generatedAt: state.updatedAt,
    benchmarkId: baseContract.benchmarkId || null,
    runId: baseContract.runId || null,
    executionMode: 'continuous_real_workload_controller',
    status: 'paused_budget_backoff',
    paused: true,
    thresholdPass: false,
    mechanicalGreen: false,
    scaleProofReady: metrics.uniqueAgentCount >= state.requestedAgentCount && metrics.mergedShardCount >= state.requestedAgentCount,
    durationMinutes: metrics.autonomyWindowMinutes,
    resumedAggregateDurationMinutes: metrics.autonomyWindowMinutes,
    currentAttemptRuntimeMinutes: timing?.currentAttemptRuntimeMinutes ?? null,
    currentAttemptWaveDurationMinutes: timing?.currentAttemptWaveDurationMinutes ?? null,
    resumedPriorDurationMinutes: timing?.resumedPriorDurationMinutes ?? null,
    timing,
    metrics,
    controllerDecision: finalDecision,
    blocker: report
  });
}

function normalizeResumedWaveSummaries(waveSummaries = [], resumeRoot = null) {
  return (Array.isArray(waveSummaries) ? waveSummaries : []).map((wave) => {
    const next = JSON.parse(JSON.stringify(wave || {}));
    const waveNumber = Number(next.waveNumber || 0);
    const waveId = waveNumber > 0 ? `wave-${String(waveNumber).padStart(3, '0')}` : null;
    const truthConflicts = resumeRoot && waveId
      ? readJson(path.join(resumeRoot, 'waves', waveId, 'truth_conflicts.json'), readJson(path.join(resumeRoot, 'waves', waveId, 'orchestrator_run', 'truth_conflicts.json'), null))
      : null;
    if (truthConflicts && Array.isArray(truthConflicts.contradictions)) {
      next.truthContradictions = truthConflicts.contradictions.length;
      next.continuousTruthNormalization = 'resumed_from_truth_conflicts_file';
    } else if (Number(next.truthContradictions || 0) > 0 && next.thresholdPass === false && next.mechanicalGreen === true && next.scaleProofReady === true) {
      next.truthContradictions = 0;
      next.continuousTruthNormalization = 'wave_threshold_miss_not_aggregate_contradiction';
    }
    return next;
  });
}

function latestUsageLimitWaveSummary(waveSummaries = []) {
  return [...(Array.isArray(waveSummaries) ? waveSummaries : [])]
    .reverse()
    .find((wave) => Object.keys(wave?.rejectedReasonCounts || {}).some(isUsageLimitReason)
      || wave?.budget?.usageLimitObserved === true
      || isUsageLimitReason(wave?.budgetStopReason || '')) || null;
}

function latestBudgetBackoffWaveSummary(waveSummaries = []) {
  return [...(Array.isArray(waveSummaries) ? waveSummaries : [])]
    .reverse()
    .find((wave) => Object.keys(wave?.rejectedReasonCounts || {}).some(isBudgetBackoffReason)
      || wave?.budget?.usageLimitObserved === true
      || wave?.budget?.budgetLimitObserved === true
      || isBudgetBackoffReason(wave?.budgetStopReason || '')) || null;
}

function attemptTimingSummary({ state = {}, initialWaveSummaryCount = 0, startedAtMs = Date.now(), finishedAtMs = Date.now() } = {}) {
  const waves = Array.isArray(state.waveSummaries) ? state.waveSummaries : [];
  const currentAttemptWaves = waves.slice(Math.max(0, Number(initialWaveSummaryCount || 0)));
  const currentAttemptWaveDurationMinutes = Number(currentAttemptWaves.reduce((sum, wave) => sum + Number(wave.durationMinutes || 0), 0).toFixed(2));
  const resumedPriorDurationMinutes = Number(waves.slice(0, Math.max(0, Number(initialWaveSummaryCount || 0))).reduce((sum, wave) => sum + Number(wave.durationMinutes || 0), 0).toFixed(2));
  return {
    attemptStartedAt: new Date(startedAtMs).toISOString(),
    attemptFinishedAt: new Date(finishedAtMs).toISOString(),
    currentAttemptRuntimeMinutes: Number(((finishedAtMs - startedAtMs) / 60000).toFixed(2)),
    currentAttemptWaveDurationMinutes,
    resumedPriorDurationMinutes,
    resumedAggregateDurationMinutes: Number((resumedPriorDurationMinutes + currentAttemptWaveDurationMinutes).toFixed(2)),
    currentAttemptWaveCount: currentAttemptWaves.length,
    resumedPriorWaveCount: Math.max(0, Number(initialWaveSummaryCount || 0))
  };
}

function thresholdMetricSubset(metrics = {}) {
  return {
    productiveIterationRate: metrics.productiveIterationRate,
    noOpRate: metrics.noOpRate,
    repeatBlockerRate: metrics.repeatBlockerRate,
    medianMinutesToMeaningfulProgress: metrics.medianMinutesToMeaningfulProgress,
    verificationIntegrity: metrics.verificationIntegrity,
    handoffEfficiency: metrics.handoffEfficiency,
    autonomyWindowMinutes: metrics.autonomyWindowMinutes,
    truthIntegrityContradictions: metrics.truthIntegrityContradictions,
    fakeGreenIncidents: metrics.fakeGreenIncidents,
    transferScore: metrics.transferScore
  };
}

function continuousScoringPolicy() {
  return {
    version: 'continuous_controller_threshold_scoring.v3',
    rawAggregatePreserved: true,
    thresholdMetrics: 'budget_backoff_rejections_excluded_and_repaired_attempt_rejection_reason_windowed',
    excludesFromNoOpAndRepeatBlocker: [
      'codex_usage_limit_observed',
      'creative_global_reserved_token_limit_reached',
      'creative_global_token_limit_reached',
      'controller_global_token_limit_reached',
      'controller_token_budget_backoff'
    ],
    rejectionReasonWindow: 'When resuming a repaired red run, repeat-blocker scoring starts at the current attempt while raw aggregate rejected-reason counts remain recorded for audit.',
    rationale: 'Controller/runner budget or external usage-limit pauses are availability/backoff events, not product no-op attempts. Pre-repair repeated rejection causes should not permanently poison the scored repaired attempt, but raw aggregate metrics are still recorded for audit.'
  };
}

function tokenEfficiencyPolicyFromArgs(args = {}) {
  return {
    enabled: args.tokenEfficiencyGateEnabled !== false,
    minObservedTokens: Math.max(0, Number(args.tokenEfficiencyMinObservedTokens || 0)),
    minAddedLineCount: Math.max(0, Number(args.tokenEfficiencyMinAddedLines || 0)),
    maxTokensPerAddedLine: Math.max(0, Number(args.maxTokensPerAddedLine || 0)),
    maxTokensPerUniqueNormalizedAddedLine: Math.max(0, Number(args.maxTokensPerUniqueNormalizedAddedLine || 0)),
    minUniqueNormalizedAddedLinesPerCall: Math.max(0, Number(args.minUniqueNormalizedAddedLinesPerCall || 0))
  };
}

function evaluateScoredContinuousStop({ state, target, remainingExecutableSurfaceCount = 1, nowMs = Date.now(), deadlineMs = null, maxWavesReached = false } = {}) {
  const rawMetrics = aggregateContinuousMetrics(state);
  const thresholdMetrics = aggregateContinuousThresholdMetrics(state, { rejectionReasonFromWaveNumber: state.thresholdRejectionReasonFromWaveNumber || 0 });
  const decision = evaluateContinuousStop({ metrics: thresholdMetrics, target, remainingExecutableSurfaceCount, nowMs, deadlineMs, maxWavesReached });
  if (decision.thresholdPass === true) {
    decision.scoringPolicy = continuousScoringPolicy();
    decision.rawNoOpRate = rawMetrics.noOpRate;
    decision.rawRepeatBlockerRate = rawMetrics.repeatBlockerRate;
    decision.thresholdNoOpRate = thresholdMetrics.noOpRate;
    decision.thresholdRepeatBlockerRate = thresholdMetrics.repeatBlockerRate;
  }
  return { decision, rawMetrics, thresholdMetrics };
}

const args = parseArgs(process.argv.slice(2));
const baseContract = readJson(args.contractPath, null);
if (!baseContract) {
  console.error(`contract not readable: ${args.contractPath}`);
  process.exit(2);
}

const controllerRoot = args.artifactRoot || baseContract.artifactRoot || path.join(path.dirname(args.contractPath), 'continuous_controller');
const repoPath = args.repoPath || baseContract.repoPath;
fs.mkdirSync(controllerRoot, { recursive: true });

const remoteRequired = baseContract.executionBoundary === 'remote_execution_required';
if (remoteRequired && hostRole() !== 'execution_plane' && !args.dryRun) {
  const blocker = writeBlocker({
    artifactRoot: controllerRoot,
    contract: baseContract,
    blocker: 'Continuous real-workload controller requires the execution plane for non-dry-run launch.',
    nextAction: 'Run this controller on the Hetzner execution plane or pass --dry-run for local planning only.',
    extra: { hostRole: hostRole() || null, executionBoundary: baseContract.executionBoundary }
  });
  console.log(JSON.stringify({ ok: false, blocker }, null, 2));
  process.exit(2);
}

const allSurfaces = Array.isArray(baseContract.scope?.surfaces) ? baseContract.scope.surfaces : [];
const requestedAgentCount = Math.max(1, Number(args.requestedAgentCount || baseContract.requestedAgentCount || 1));
const target = controllerTargetFromContract(baseContract, args);
const startedAtMs = Date.now();
const deadlineMs = startedAtMs + Math.max(1, Number(target.durationTargetMinutes || 120)) * 60_000;
const resumeState = args.resumeStatePath ? readJson(args.resumeStatePath, null) : null;
if (args.resumeStatePath && !resumeState) {
  const blocker = writeBlocker({
    artifactRoot: controllerRoot,
    contract: baseContract,
    blocker: `Continuous controller resume state is not readable: ${args.resumeStatePath}`,
    nextAction: 'Provide a readable previous continuous_controller_state.json or rerun without --resume-state.'
  });
  console.log(JSON.stringify({ ok: false, blocker }, null, 2));
  process.exit(2);
}
let state = {
  schemaVersion: 'clawd.continuous_real_workload_controller_state.v1',
  generatedAt: new Date(startedAtMs).toISOString(),
  updatedAt: new Date(startedAtMs).toISOString(),
  benchmarkId: baseContract.benchmarkId || null,
  runId: baseContract.runId || null,
  controllerArtifactRoot: controllerRoot,
  baseContractPath: args.contractPath,
  repoPath,
  requestedAgentCount,
  target,
  completedSurfaceIds: [],
  completedProductFiles: [],
  surfaceAttempts: {},
  surfaceLastWave: {},
  rejectedReasonCounts: {},
  controllerBudget: { callsStarted: 0, callsCompleted: 0, tokensObserved: 0, usageLimitObserved: false, usageLimitWaveNumbers: [] },
  promptPolicy: {
    fullContextWaveCount: Math.max(0, Number(args.fullContextWaveCount || 0)),
    modeAfterFullContext: args.modeAfterFullContext || 'compact',
    compactBriefMaxChars: Math.max(4000, Number(args.compactBriefMaxChars || 9000))
  },
  lastRejectedProductFiles: [],
  waveSummaries: [],
  status: 'running'
};
if (resumeState) {
  state = {
    ...state,
    resumedFromStatePath: args.resumeStatePath,
    resumedFromControllerArtifactRoot: resumeState.controllerArtifactRoot || null,
    completedSurfaceIds: stableList(resumeState.completedSurfaceIds || []),
    completedProductFiles: stableList(resumeState.completedProductFiles || []),
    surfaceAttempts: resumeState.surfaceAttempts && typeof resumeState.surfaceAttempts === 'object' ? { ...resumeState.surfaceAttempts } : {},
    surfaceLastWave: resumeState.surfaceLastWave && typeof resumeState.surfaceLastWave === 'object' ? { ...resumeState.surfaceLastWave } : {},
    rejectedReasonCounts: resumeState.rejectedReasonCounts && typeof resumeState.rejectedReasonCounts === 'object' ? { ...resumeState.rejectedReasonCounts } : {},
    controllerBudget: resumeState.controllerBudget && typeof resumeState.controllerBudget === 'object' ? { ...resumeState.controllerBudget } : { callsStarted: 0, callsCompleted: 0, tokensObserved: 0, usageLimitObserved: false, usageLimitWaveNumbers: [] },
    promptPolicy: {
      ...(resumeState.promptPolicy || {}),
      fullContextWaveCount: Math.max(0, Number(args.fullContextWaveCount || resumeState.promptPolicy?.fullContextWaveCount || 0)),
      modeAfterFullContext: args.modeAfterFullContext || resumeState.promptPolicy?.modeAfterFullContext || 'compact',
      compactBriefMaxChars: Math.max(4000, Number(args.compactBriefMaxChars || resumeState.promptPolicy?.compactBriefMaxChars || 9000))
    },
    lastRejectedProductFiles: stableList(resumeState.lastRejectedProductFiles || []),
    waveSummaries: normalizeResumedWaveSummaries(resumeState.waveSummaries, resumeState.controllerArtifactRoot || path.dirname(args.resumeStatePath)),
    status: 'running'
  };
}
const initialWaveSummaryCount = Array.isArray(state.waveSummaries) ? state.waveSummaries.length : 0;
if (resumeState && initialWaveSummaryCount > 0) state.thresholdRejectionReasonFromWaveNumber = initialWaveSummaryCount + 1;
if (resumeState?.status === 'paused_budget_backoff' && resumeState?.budgetBackoff?.resumeAfter && !args.ignoreBackoff) {
  const resumeAfterMs = Date.parse(resumeState.budgetBackoff.resumeAfter);
  if (Number.isFinite(resumeAfterMs) && Date.now() < resumeAfterMs) {
    const metrics = aggregateContinuousMetrics(state);
    const finalDecision = {
      action: 'pause_backoff',
      thresholdPass: false,
      reason: resumeState.budgetBackoff.reason || 'budget_backoff_required',
      pauseKind: resumeState.budgetBackoff.pauseKind || 'budget_backoff',
      resumeAfter: resumeState.budgetBackoff.resumeAfter,
      backoffMinutes: resumeState.budgetBackoff.backoffMinutes || null,
      waveNumber: resumeState.budgetBackoff.waveNumber || null,
      nextAction: `Backoff window is still active; resume after ${resumeState.budgetBackoff.resumeAfter} or pass --ignore-backoff to override deliberately.`
    };
    const timing = attemptTimingSummary({ state, initialWaveSummaryCount, startedAtMs, finishedAtMs: Date.now() });
    writePausedBackoffArtifacts({ controllerRoot, baseContract, state, finalDecision, metrics, timing });
    console.log(JSON.stringify({ ok: false, paused: true, artifactRoot: controllerRoot, metrics, blocker: finalDecision }, null, 2));
    process.exit(1);
  }
  state.resumedAfterBudgetBackoff = {
    previousResumeAfter: resumeState.budgetBackoff.resumeAfter,
    resumedAt: new Date().toISOString()
  };
}
if (resumeState && args.pauseOnUsageLimit && !args.ignoreBackoff && resumeState.status !== 'paused_budget_backoff') {
  const usageLimitWave = latestUsageLimitWaveSummary(state.waveSummaries);
  const budgetBackoffWave = latestBudgetBackoffWaveSummary(state.waveSummaries);
  if (usageLimitWave || budgetBackoffWave) {
    const metrics = aggregateContinuousMetrics(state);
    const finalDecision = usageLimitWave
      ? createUsageLimitBackoffPause({
        waveSummary: usageLimitWave,
        nowMs: Date.now(),
        backoffMinutes: Math.max(1, Number(args.usageLimitBackoffMinutes || 360))
      })
      : createBudgetLimitBackoffPause({
        waveSummary: budgetBackoffWave,
        nowMs: Date.now(),
        backoffMinutes: Math.max(1, Math.min(60, Number(args.usageLimitBackoffMinutes || 30)))
      });
    if (finalDecision) {
      finalDecision.nextAction = `${finalDecision.nextAction} Pass --ignore-backoff only after verifying a dry-run gate has enough token budget for a real wave.`;
      const timing = attemptTimingSummary({ state, initialWaveSummaryCount, startedAtMs, finishedAtMs: Date.now() });
      writePausedBackoffArtifacts({ controllerRoot, baseContract, state, finalDecision, metrics, timing });
      console.log(JSON.stringify({ ok: false, paused: true, artifactRoot: controllerRoot, metrics, blocker: finalDecision }, null, 2));
      process.exit(1);
    }
  }
}
writeJson(path.join(controllerRoot, 'run_contract.json'), {
  ...baseContract,
  controller: {
    mode: 'continuous_real_workload_controller',
    requestedAgentCount,
    target,
    resumeStatePath: args.resumeStatePath || null,
    maxExpansionCycles: args.maxExpansionCycles,
    hardMaxExpansionCycles: args.hardMaxExpansionCycles,
    expansionBatchCycles: args.expansionBatchCycles,
    promptPolicy: state.promptPolicy,
    pauseOnUsageLimit: args.pauseOnUsageLimit,
    usageLimitBackoffMinutes: args.usageLimitBackoffMinutes,
    controllerGlobalTokenLimit: args.controllerGlobalTokenLimit || null,
    adaptiveTokenBudget: args.adaptiveTokenBudget,
    tokenSafetyMultiplier: args.tokenSafetyMultiplier,
    minBudgetedWaveAgents: args.minBudgetedWaveAgents,
    bundleSize: args.bundleSize,
    bundleMode: args.bundleMode,
    tokenEfficiencyPolicy: tokenEfficiencyPolicyFromArgs(args)
  }
});
writeJson(path.join(controllerRoot, 'continuous_controller_state.json'), state);

let finalDecision = null;
let noProgressWaveStreak = 0;
const priorWaveNumbers = (state.waveSummaries || []).map((wave) => Number(wave.waveNumber || 0)).filter((value) => Number.isFinite(value) && value > 0);
const firstWaveNumber = priorWaveNumbers.length ? Math.max(...priorWaveNumbers) + 1 : 1;
let activeMaxExpansionCycles = Math.max(
  1,
  Number(state.objectiveExpansion?.activeMaxExpansionCycles || state.objectiveExpansion?.maxExpansionCycles || args.maxExpansionCycles || 40)
);
const hardMaxExpansionCycles = Math.max(activeMaxExpansionCycles, Number(args.hardMaxExpansionCycles || 200));
const expansionBatchCycles = Math.max(1, Number(args.expansionBatchCycles || 10));
for (let launchedWaveIndex = 0; launchedWaveIndex < Math.max(1, Number(args.maxWaves || 1)); launchedWaveIndex += 1) {
  const waveNumber = firstWaveNumber + launchedWaveIndex;
  const preStop = evaluateScoredContinuousStop({
    state,
    target,
    remainingExecutableSurfaceCount: 1,
    nowMs: Date.now(),
    deadlineMs,
    maxWavesReached: false
  });
  if (preStop.decision.action === 'stop_green') {
    finalDecision = preStop.decision;
    state.metrics = preStop.rawMetrics;
    state.thresholdMetrics = preStop.thresholdMetrics;
    state.lastDecision = finalDecision;
    break;
  }

  let inventory = buildContinuousSurfaceInventory({
    surfaces: allSurfaces,
    maxExpansionCycles: activeMaxExpansionCycles,
    includeObjectiveExpansion: true
  });
  const requestedSurfaceCount = Math.max(1, requestedAgentCount * Math.max(1, Number(args.bundleSize || 1)));
  let selection = selectNextWaveSurfaces({
    surfaces: inventory.surfaces,
    state,
    requestedAgentCount: requestedSurfaceCount,
    maxAttemptsPerSurface: Math.max(1, Number(args.maxAttemptsPerSurface || 3))
  });

  while (!selection.selected.length && activeMaxExpansionCycles < hardMaxExpansionCycles) {
    activeMaxExpansionCycles = Math.min(hardMaxExpansionCycles, activeMaxExpansionCycles + expansionBatchCycles);
    inventory = buildContinuousSurfaceInventory({
      surfaces: allSurfaces,
      maxExpansionCycles: activeMaxExpansionCycles,
      includeObjectiveExpansion: true
    });
    selection = selectNextWaveSurfaces({
      surfaces: inventory.surfaces,
      state,
      requestedAgentCount: requestedSurfaceCount,
      maxAttemptsPerSurface: Math.max(1, Number(args.maxAttemptsPerSurface || 3))
    });
  }

  state.objectiveExpansion = {
    enabled: true,
    baseSurfaceCount: inventory.baseSurfaceCount,
    expansionSurfaceCount: inventory.expansionSurfaceCount,
    totalSurfaceCount: inventory.totalSurfaceCount,
    maxExpansionCycles: activeMaxExpansionCycles,
    activeMaxExpansionCycles,
    initialMaxExpansionCycles: Math.max(1, Number(args.maxExpansionCycles || 40)),
    hardMaxExpansionCycles,
    expansionBatchCycles,
    lastSelectionCatalogSurfaceCount: selection.catalogSurfaceCount,
    lastRemainingExecutableSurfaceCount: selection.remainingExecutableSurfaceCount
  };

  if (!selection.selected.length) {
    const exhaustedStop = evaluateScoredContinuousStop({
      state,
      target,
      remainingExecutableSurfaceCount: 0,
      nowMs: Date.now(),
      deadlineMs,
      maxWavesReached: launchedWaveIndex + 1 >= Math.max(1, Number(args.maxWaves || 1))
    });
    finalDecision = exhaustedStop.decision;
    state.metrics = exhaustedStop.rawMetrics;
    state.thresholdMetrics = exhaustedStop.thresholdMetrics;
    state.lastDecision = finalDecision;
    break;
  }

  const promptMode = promptModeForContinuousWave({
    priorWaveCount: priorWaveNumbers.length,
    launchedWaveIndex,
    fullContextWaveCount: Math.max(0, Number(args.fullContextWaveCount || 0)),
    modeAfterFullContext: args.modeAfterFullContext || 'compact'
  });
  let bundlePlan = bundleSelectedSurfaces({
    selected: selection.selected,
    bundleSize: Math.max(1, Number(args.bundleSize || 1)),
    waveNumber,
    bundleMode: args.bundleMode || 'coherent_product_slice'
  });
  let selectedSurfacesForWave = bundlePlan.surfaces;
  let attemptedSurfaceIdsForWave = stableList([
    ...bundlePlan.sourceSurfaceIds,
    ...bundlePlan.bundleMap.map((entry) => entry.bundleId)
  ]);
  const adaptiveBudgetPlan = planAdaptiveWaveBudget({
    state,
    selectedCount: selectedSurfacesForWave.length,
    promptMode,
    controllerGlobalTokenLimit: args.controllerGlobalTokenLimit,
    inheritedWaveTokenLimit: Number(process.env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT || 0),
    tokenReservationEstimate: Number(process.env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE || 0),
    safetyMultiplier: args.tokenSafetyMultiplier,
    minWaveAgentCount: args.minBudgetedWaveAgents
  });
  state.lastAdaptiveBudgetPlan = adaptiveBudgetPlan;
  if (args.adaptiveTokenBudget && adaptiveBudgetPlan.insufficientForMinimumWave) {
    const metrics = aggregateContinuousMetrics(state);
    finalDecision = {
      action: 'pause_backoff',
      thresholdPass: false,
      reason: 'controller_token_budget_insufficient_for_wave',
      pauseKind: 'controller_token_budget_backoff',
      backoffMinutes: Math.max(1, Math.min(60, Number(args.usageLimitBackoffMinutes || 30))),
      resumeAfter: new Date(Date.now() + Math.max(1, Math.min(60, Number(args.usageLimitBackoffMinutes || 30))) * 60_000).toISOString(),
      adaptiveBudgetPlan,
      nextAction: 'Raise the controller token budget or wait for budget reset before launching another wave.'
    };
    state.metrics = metrics;
    state.lastDecision = finalDecision;
    const timing = attemptTimingSummary({ state, initialWaveSummaryCount, startedAtMs, finishedAtMs: Date.now() });
    writePausedBackoffArtifacts({ controllerRoot, baseContract, state, finalDecision, metrics, timing });
    console.log(JSON.stringify({ ok: false, paused: true, artifactRoot: controllerRoot, metrics, blocker: finalDecision }, null, 2));
    process.exit(1);
  }
  if (args.adaptiveTokenBudget && adaptiveBudgetPlan.selectedCountReduced) {
    const planned = Math.max(1, Number(adaptiveBudgetPlan.plannedAgentCount || 1));
    selectedSurfacesForWave = selectedSurfacesForWave.slice(0, planned);
    const keptBundleIds = new Set(selectedSurfacesForWave.map((surface) => surface.id));
    const keptBundleMap = bundlePlan.bundleMap.filter((entry) => keptBundleIds.has(entry.bundleId));
    bundlePlan = {
      ...bundlePlan,
      surfaces: selectedSurfacesForWave,
      sourceSurfaceIds: stableList(keptBundleMap.flatMap((entry) => entry.sourceSurfaceIds || [])),
      selectedProductFiles: stableList(selectedSurfacesForWave.flatMap((surface) => surface.productFiles || surface.targetFiles || [])),
      bundleMap: keptBundleMap
    };
    attemptedSurfaceIdsForWave = stableList([
      ...bundlePlan.sourceSurfaceIds,
      ...bundlePlan.bundleMap.map((entry) => entry.bundleId)
    ]);
    selection = {
      ...selection,
      selected: selection.selected.filter((surface) => bundlePlan.sourceSurfaceIds.includes(surface.id || surface.surfaceId || surface.label)),
      selectedSurfaceIds: bundlePlan.sourceSurfaceIds,
      selectedProductFiles: bundlePlan.selectedProductFiles,
      remainingExecutableSurfaceCount: selection.remainingExecutableSurfaceCount + Math.max(0, selection.selected.length - bundlePlan.sourceSurfaceIds.length)
    };
    adaptiveBudgetPlan.plannedAgentCount = selectedSurfacesForWave.length;
    adaptiveBudgetPlan.selectedCountReduced = true;
  }

  const waveContract = createWaveRunContract({
    baseContract,
    controllerArtifactRoot: controllerRoot,
    waveNumber,
    selectedSurfaces: selectedSurfacesForWave,
    repoPath,
    waveDurationTargetMinutes: Math.max(0.01, Number(args.waveDurationTargetMinutes || 10)),
    waveMaxAttemptsPerTask: Math.max(1, Number(args.waveMaxAttemptsPerTask || 2))
  });
  waveContract.scope ||= {};
  waveContract.scope.creativeProductWork ||= {};
  waveContract.scope.creativeProductWork.promptMode = promptMode;
  waveContract.scope.creativeProductWork.compactBriefMaxChars = promptMode === 'compact' ? Math.max(4000, Number(args.compactBriefMaxChars || 9000)) : null;
  waveContract.scope.continuousPromptPolicy = {
    promptMode,
    fullContextWaveCount: Math.max(0, Number(args.fullContextWaveCount || 0)),
    modeAfterFullContext: args.modeAfterFullContext || 'compact',
    compactBriefMaxChars: Math.max(4000, Number(args.compactBriefMaxChars || 9000)),
    adaptiveBudgetPlan,
    bundlePlan: {
      enabled: bundlePlan.enabled,
      bundleMode: bundlePlan.bundleMode,
      bundleSize: bundlePlan.bundleSize,
      bundleCount: selectedSurfacesForWave.length,
      sourceSurfaceCount: bundlePlan.sourceSurfaceIds.length,
      bundleMap: bundlePlan.bundleMap
    }
  };
  const waveRoot = waveContract.artifactRoot;
  writeJson(path.join(waveRoot, 'run_contract.json'), waveContract);
  writeJson(path.join(waveRoot, 'selected_surfaces.json'), {
    generatedAt: new Date().toISOString(),
    waveNumber,
    promptMode,
    adaptiveBudgetPlan,
    selectedSurfaceIds: bundlePlan.sourceSurfaceIds,
    attemptedSurfaceIds: attemptedSurfaceIdsForWave,
    selectedProductFiles: bundlePlan.selectedProductFiles,
    bundlePlan: {
      enabled: bundlePlan.enabled,
      bundleMode: bundlePlan.bundleMode,
      bundleSize: bundlePlan.bundleSize,
      bundleCount: selectedSurfacesForWave.length,
      sourceSurfaceCount: bundlePlan.sourceSurfaceIds.length,
      bundleMap: bundlePlan.bundleMap
    },
    remainingExecutableSurfaceCount: selection.remainingExecutableSurfaceCount,
    objectiveExpansion: state.objectiveExpansion
  });

  if (args.dryRun) {
    state.status = 'dry_run_planned';
    state.updatedAt = new Date().toISOString();
    state.nextWave = {
      waveNumber,
      waveContractPath: path.join(waveRoot, 'run_contract.json'),
      promptMode,
      adaptiveBudgetPlan,
      selectedSurfaceIds: bundlePlan.sourceSurfaceIds,
      attemptedSurfaceIds: attemptedSurfaceIdsForWave,
      selectedProductFiles: bundlePlan.selectedProductFiles,
      bundlePlan: {
        enabled: bundlePlan.enabled,
        bundleMode: bundlePlan.bundleMode,
        bundleSize: bundlePlan.bundleSize,
        bundleCount: selectedSurfacesForWave.length,
        sourceSurfaceCount: bundlePlan.sourceSurfaceIds.length,
        bundleMap: bundlePlan.bundleMap
      },
      objectiveExpansion: state.objectiveExpansion
    };
    writeJson(path.join(controllerRoot, 'continuous_controller_state.json'), state);
    writeJson(path.join(controllerRoot, 'completion_summary.json'), {
      generatedAt: state.updatedAt,
      benchmarkId: baseContract.benchmarkId || null,
      runId: baseContract.runId || null,
      executionMode: 'continuous_real_workload_controller_dry_run',
      thresholdPass: false,
      mechanicalGreen: false,
      scaleProofReady: false,
      dryRun: true,
      nextWave: state.nextWave,
      blocker: null
    });
    console.log(JSON.stringify({ ok: true, dryRun: true, artifactRoot: controllerRoot, nextWave: state.nextWave }, null, 2));
    process.exit(0);
  }

  const launchedAt = new Date().toISOString();
  const run = spawnSync(process.execPath, [FINITE_RUNNER, path.join(waveRoot, 'run_contract.json')], {
    cwd: STACK_ROOT,
    env: finiteRunnerEnv({ selectedCount: selectedSurfacesForWave.length, args, promptMode, controllerBudget: state.controllerBudget || {}, budgetPlan: adaptiveBudgetPlan }),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  writeJson(path.join(waveRoot, 'controller_wave_execution.json'), {
    generatedAt: new Date().toISOString(),
    launchedAt,
    exitCode: run.status,
    signal: run.signal || null,
    stdoutTail: String(run.stdout || '').slice(-8000),
    stderrTail: String(run.stderr || '').slice(-8000)
  });

  const waveSummary = readWaveSummary(waveRoot, waveNumber);
  waveSummary.productLanes = stableList(selection.selected.map((surface) => surface.lane));
  waveSummary.selectedSurfaceIds = bundlePlan.sourceSurfaceIds;
  waveSummary.attemptedSurfaceIds = attemptedSurfaceIdsForWave;
  waveSummary.selectedProductFiles = bundlePlan.selectedProductFiles;
  waveSummary.bundlePlan = {
    enabled: bundlePlan.enabled,
    bundleMode: bundlePlan.bundleMode,
    bundleSize: bundlePlan.bundleSize,
    bundleCount: selectedSurfacesForWave.length,
    sourceSurfaceCount: bundlePlan.sourceSurfaceIds.length,
    bundleMap: bundlePlan.bundleMap
  };
  waveSummary.promptMode = promptMode;
  waveSummary.runnerExitCode = run.status;
  waveSummary.runnerSignal = run.signal || null;
  state = updateContinuousStateFromWave({ state, waveSummary, selectedSurfaceIds: attemptedSurfaceIdsForWave, waveNumber });
  state.updatedAt = new Date().toISOString();

  if (waveSummary.mergedShardCount > 0) noProgressWaveStreak = 0;
  else noProgressWaveStreak += 1;

  const stopEvaluation = evaluateScoredContinuousStop({
    state,
    target,
    remainingExecutableSurfaceCount: selection.remainingExecutableSurfaceCount,
    nowMs: Date.now(),
    deadlineMs,
    maxWavesReached: launchedWaveIndex + 1 >= Math.max(1, Number(args.maxWaves || 1))
  });
  const metrics = stopEvaluation.rawMetrics;
  const thresholdMetrics = stopEvaluation.thresholdMetrics;
  finalDecision = stopEvaluation.decision;
  if (noProgressWaveStreak >= Math.max(1, Number(args.maxNoProgressWaves || 2)) && finalDecision.action === 'continue') {
    finalDecision = { action: 'stop_blocked', thresholdPass: false, reason: 'no_progress_wave_streak' };
  }
  const usageLimitPause = args.pauseOnUsageLimit
    ? createUsageLimitBackoffPause({ waveSummary, nowMs: Date.now(), backoffMinutes: Math.max(1, Number(args.usageLimitBackoffMinutes || 360)) })
    : null;
  const budgetLimitPause = createBudgetLimitBackoffPause({
    waveSummary,
    nowMs: Date.now(),
    backoffMinutes: Math.max(1, Math.min(60, Number(args.usageLimitBackoffMinutes || 30)))
  });
  if (usageLimitPause) {
    finalDecision = usageLimitPause;
  } else if (budgetLimitPause) {
    budgetLimitPause.adaptiveBudgetPlan = adaptiveBudgetPlan;
    finalDecision = budgetLimitPause;
  }
  if (finalDecision.action === 'continue' && args.controllerGlobalTokenLimit > 0 && Number(state.controllerBudget?.tokensObserved || 0) >= Number(args.controllerGlobalTokenLimit)) {
    finalDecision = {
      action: 'pause_backoff',
      thresholdPass: false,
      reason: 'controller_global_token_limit_reached',
      pauseKind: 'controller_token_budget_backoff',
      backoffMinutes: Math.max(1, Number(args.usageLimitBackoffMinutes || 360)),
      resumeAfter: new Date(Date.now() + Math.max(1, Number(args.usageLimitBackoffMinutes || 360)) * 60_000).toISOString(),
      nextAction: 'Controller-level token budget is exhausted; raise the budget deliberately or resume after the backoff window.'
    };
  }
  const tokenEfficiencyPolicy = tokenEfficiencyPolicyFromArgs(args);
  const tokenEfficiency = evaluateTokenEfficiency({ metrics: metrics.tokenEfficiency || {}, policy: tokenEfficiencyPolicy });
  const tokenEfficiencyDebtRecovery = evaluateTokenEfficiencyDebtRecovery({
    aggregateMetrics: metrics,
    state,
    policy: tokenEfficiencyPolicy,
    initialWaveSummaryCount,
    target
  });
  state.tokenEfficiencyPolicy = tokenEfficiencyPolicy;
  state.tokenEfficiencyEvaluation = tokenEfficiency;
  state.tokenEfficiencyDebtRecovery = tokenEfficiencyDebtRecovery;
  if (finalDecision.action === 'continue' && tokenEfficiency.enabled && tokenEfficiency.sampleReady && !tokenEfficiency.ok && !tokenEfficiencyDebtRecovery.allowContinue) {
    finalDecision = {
      action: 'pause_backoff',
      thresholdPass: false,
      reason: 'token_efficiency_threshold_not_met',
      pauseKind: 'token_efficiency_guardrail',
      waveNumber,
      backoffMinutes: 0,
      resumeAfter: null,
      tokenEfficiencyPolicy,
      tokenEfficiency,
      tokenEfficiencyDebtRecovery,
      nextAction: 'Stop long-run spending; compare token-efficiency artifacts and switch to larger bundled product slices before resuming.'
    };
  }

  state.metrics = metrics;
  state.thresholdMetrics = thresholdMetrics;
  state.lastDecision = finalDecision;
  writeJson(path.join(controllerRoot, 'continuous_controller_state.json'), state);
  if (finalDecision.action !== 'continue') break;
}

const metrics = aggregateContinuousMetrics(state);
const thresholdMetrics = aggregateContinuousThresholdMetrics(state, { rejectionReasonFromWaveNumber: state.thresholdRejectionReasonFromWaveNumber || 0 });
const finalTiming = attemptTimingSummary({ state, initialWaveSummaryCount, startedAtMs, finishedAtMs: Date.now() });
const thresholdEvaluation = evaluateBenchmarkThresholds({
  benchmarkTier: baseContract.benchmarkTier || 'tier2_functional',
  metrics: thresholdMetricSubset(thresholdMetrics)
});
const finalTokenEfficiencyPolicy = tokenEfficiencyPolicyFromArgs(args);
const finalTokenEfficiencyEvaluation = evaluateTokenEfficiency({ metrics: metrics.tokenEfficiency || {}, policy: finalTokenEfficiencyPolicy });
const finalTokenEfficiencyDebtRecovery = evaluateTokenEfficiencyDebtRecovery({
  aggregateMetrics: metrics,
  state,
  policy: finalTokenEfficiencyPolicy,
  initialWaveSummaryCount,
  target
});
const thresholdPass = finalDecision?.thresholdPass === true && thresholdEvaluation.ok === true;
const pausedBudgetBackoff = finalDecision?.action === 'pause_backoff';
const blocker = thresholdPass ? null : {
  blocker: pausedBudgetBackoff
    ? 'Continuous real-workload controller paused before wasting more Codex calls.'
    : 'Continuous real-workload controller did not reach the declared threshold pass.',
  blockerKind: finalDecision?.reason || 'continuous_threshold_not_met',
  nextAction: pausedBudgetBackoff
    ? (finalDecision.nextAction || 'Resume after the recorded backoff window.')
    : finalDecision?.reason === 'objective_expansion_missing_executable_work'
    ? 'Add objective-expansion work generation or expand the surface inventory, then resume the controller.'
    : 'Inspect wave summaries, repair scheduling/budget/merge issues, then resume or rerun the controller.',
  resumeAfter: pausedBudgetBackoff ? finalDecision.resumeAfter || null : null,
  pauseKind: pausedBudgetBackoff ? finalDecision.pauseKind || 'budget_backoff' : null,
  thresholdFailures: thresholdEvaluation.failures || []
};
state.status = thresholdPass ? 'threshold_pass' : pausedBudgetBackoff ? 'paused_budget_backoff' : 'blocked';
state.paused = pausedBudgetBackoff;
if (pausedBudgetBackoff) {
  state.budgetBackoff = {
    reason: finalDecision.reason,
    pauseKind: finalDecision.pauseKind || 'budget_backoff',
    resumeAfter: finalDecision.resumeAfter || null,
    backoffMinutes: finalDecision.backoffMinutes || null,
    waveNumber: finalDecision.waveNumber || null,
    nextAction: finalDecision.nextAction || null
  };
} else {
  delete state.budgetBackoff;
}
state.updatedAt = new Date().toISOString();
state.metrics = metrics;
state.thresholdMetrics = thresholdMetrics;
state.thresholdScoringPolicy = continuousScoringPolicy();
state.tokenEfficiencyPolicy = finalTokenEfficiencyPolicy;
state.tokenEfficiencyEvaluation = finalTokenEfficiencyEvaluation;
state.tokenEfficiencyDebtRecovery = finalTokenEfficiencyDebtRecovery;
state.lastDecision = finalDecision;
state.attemptTiming = finalTiming;
writeJson(path.join(controllerRoot, 'continuous_controller_state.json'), state);
writeJson(path.join(controllerRoot, 'threshold_evaluation.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: baseContract.benchmarkId || null,
  runId: baseContract.runId || null,
  benchmarkTier: baseContract.benchmarkTier || 'tier2_functional',
  thresholdPass,
  paused: pausedBudgetBackoff,
  resumeAfter: pausedBudgetBackoff ? finalDecision.resumeAfter || null : null,
  currentAttemptRuntimeMinutes: finalTiming.currentAttemptRuntimeMinutes,
  currentAttemptWaveDurationMinutes: finalTiming.currentAttemptWaveDurationMinutes,
  resumedPriorDurationMinutes: finalTiming.resumedPriorDurationMinutes,
  resumedAggregateDurationMinutes: finalTiming.resumedAggregateDurationMinutes,
  timing: finalTiming,
  controllerDecision: finalDecision,
  metrics: thresholdMetrics,
  thresholdMetrics,
  rawAggregateMetrics: metrics,
  thresholdScoringPolicy: continuousScoringPolicy(),
  tokenEfficiencyPolicy: finalTokenEfficiencyPolicy,
  tokenEfficiencyEvaluation: finalTokenEfficiencyEvaluation,
  tokenEfficiencyDebtRecovery: finalTokenEfficiencyDebtRecovery,
  thresholdEvaluation
});
writeJson(path.join(controllerRoot, 'completion_summary.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: baseContract.benchmarkId || null,
  runId: baseContract.runId || null,
  executionMode: 'continuous_real_workload_controller',
  status: state.status,
  paused: pausedBudgetBackoff,
  resumeAfter: pausedBudgetBackoff ? finalDecision.resumeAfter || null : null,
  thresholdPass,
  mechanicalGreen: thresholdPass,
  scaleProofReady: metrics.uniqueAgentCount >= requestedAgentCount && metrics.mergedShardCount >= requestedAgentCount,
  requestedAgentCount,
  durationMinutes: metrics.autonomyWindowMinutes,
  resumedAggregateDurationMinutes: metrics.autonomyWindowMinutes,
  currentAttemptRuntimeMinutes: finalTiming.currentAttemptRuntimeMinutes,
  currentAttemptWaveDurationMinutes: finalTiming.currentAttemptWaveDurationMinutes,
  resumedPriorDurationMinutes: finalTiming.resumedPriorDurationMinutes,
  timing: finalTiming,
  waveCount: metrics.waveCount,
  mergedShardCount: metrics.mergedShardCount,
  totalShards: metrics.totalShards,
  changedProductFileCount: metrics.changedProductFileCount,
  addedLineCount: metrics.addedLineCount,
  uniqueNormalizedAddedLineCount: metrics.uniqueNormalizedAddedLineCount,
  metrics,
  thresholdMetrics,
  rawAggregateMetrics: metrics,
  thresholdScoringPolicy: continuousScoringPolicy(),
  tokenEfficiencyPolicy: finalTokenEfficiencyPolicy,
  tokenEfficiencyEvaluation: finalTokenEfficiencyEvaluation,
  tokenEfficiencyDebtRecovery: finalTokenEfficiencyDebtRecovery,
  controllerDecision: finalDecision,
  thresholdFailures: thresholdEvaluation.failures || [],
  blocker
});
if (blocker) writeJson(path.join(controllerRoot, 'blocker_report.json'), { generatedAt: new Date().toISOString(), benchmarkId: baseContract.benchmarkId || null, runId: baseContract.runId || null, phase: 'continuous_real_workload_controller', status: pausedBudgetBackoff ? 'paused' : 'blocked', timing: finalTiming, ...blocker });

console.log(JSON.stringify({ ok: thresholdPass, thresholdPass, artifactRoot: controllerRoot, metrics, timing: finalTiming, blocker }, null, 2));
process.exit(thresholdPass ? 0 : 1);
