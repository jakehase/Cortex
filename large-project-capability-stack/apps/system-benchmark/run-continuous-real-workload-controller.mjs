#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BENCHMARK_TIER_THRESHOLDS, evaluateBenchmarkThresholds } from '../../packages/system-benchmark/index.mjs';
import { resolveAgentWorkRunInput } from '../../packages/agent-work-dsl/index.mjs';
import {
  envFromLlmMeteringPlan,
  resolveLlmMeteringAdapter
} from '../../packages/llm-metering-adapter/index.mjs';
import {
  createLearningLedger,
  promoteLearningFromRun,
  readLearningLedger,
  writeLearningLedger
} from '../../packages/orchestration-learning-ledger/index.mjs';
import {
  aggregateContinuousMetrics,
  aggregateContinuousThresholdMetrics,
  avoidSameWaveBundleFileCollisions,
  buildCollisionAwareRepairSelection,
  bundleSelectedSurfaces,
  createBudgetLimitBackoffPause,
  createObjectiveTruthRepairSurfaces,
  createProductionQualityRepairSurfaces,
  createUsageLimitBackoffPause,
  createWaveRunContract,
  deriveContinuousScaleProof,
  deriveObjectiveTruth,
  evaluateContinuousStop,
  evaluateProductionQualityGate,
  evaluateTokenEfficiency,
  evaluateTokenEfficiencyDebtRecovery,
  isBudgetBackoffReason,
  isUsageLimitReason,
  planObjectiveExpansionSurfaceSelection,
  planAdaptiveWaveBudget,
  promptModeForContinuousWave,
  readJson,
  stableList,
  summarizeWaveBudgetLedger,
  summarizeWaveArtifacts,
  updateContinuousStateFromWave,
  writeJson
} from '../../packages/continuous-workload-controller/index.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const FINITE_RUNNER = path.join(SCRIPT_DIR, 'run-transfer-orchestrator-benchmark.mjs');
const QUALITY_GATE_SCRIPT = path.join(SCRIPT_DIR, 'evaluate-production-quality-gate.mjs');
const STANDARD_HEAVY_WAVE_AGENT_COUNT = 45;

function parseArgs(argv) {
  const args = {
    contractPath: null,
    artifactRoot: null,
    repoPath: null,
    dryRun: false,
    maxWaves: Number(process.env.CONTINUOUS_CONTROLLER_MAX_WAVES || 100),
    requestedAgentCount: null,
    waveAgentCount: Number(process.env.CONTINUOUS_CONTROLLER_WAVE_AGENT_COUNT || 0),
    waveDurationTargetMinutes: Number(process.env.CONTINUOUS_CONTROLLER_WAVE_DURATION_MINUTES || 10),
    waveMaxAttemptsPerTask: Number(process.env.CONTINUOUS_CONTROLLER_WAVE_MAX_ATTEMPTS_PER_TASK || 2),
    maxAttemptsPerSurface: Number(process.env.CONTINUOUS_CONTROLLER_MAX_ATTEMPTS_PER_SURFACE || 3),
    maxNoProgressWaves: Number(process.env.CONTINUOUS_CONTROLLER_MAX_NO_PROGRESS_WAVES || 2),
    maxExpansionCycles: Number(process.env.CONTINUOUS_CONTROLLER_MAX_EXPANSION_CYCLES || 40),
    hardMaxExpansionCycles: Number(process.env.CONTINUOUS_CONTROLLER_HARD_MAX_EXPANSION_CYCLES || 200),
    expansionBatchCycles: Number(process.env.CONTINUOUS_CONTROLLER_EXPANSION_BATCH_CYCLES || 10),
    fullContextWaveCount: Number(process.env.CONTINUOUS_CONTROLLER_FULL_CONTEXT_WAVES || 0),
    modeAfterFullContext: process.env.CONTINUOUS_CONTROLLER_PROMPT_MODE_AFTER_FULL_CONTEXT || 'compact',
    compactBriefMaxChars: Number(process.env.CONTINUOUS_CONTROLLER_COMPACT_BRIEF_MAX_CHARS || process.env.CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS || 9000),
    contextGovernorEnabled: String(process.env.CONTINUOUS_CONTROLLER_CONTEXT_GOVERNOR || process.env.ORCHESTRATOR_CONTEXT_GOVERNOR || '1') !== '0',
    contextGovernorHardGate: String(process.env.CONTINUOUS_CONTROLLER_CONTEXT_GOVERNOR_HARD_GATE || process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_HARD_GATE || '1') !== '0',
    contextGovernorMaxWorkerTokens: Number(process.env.CONTINUOUS_CONTROLLER_CONTEXT_GOVERNOR_MAX_WORKER_TOKENS || process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_WORKER_TOKENS || 3200),
    contextGovernorTargetSavingsMin: Number(process.env.CONTINUOUS_CONTROLLER_CONTEXT_GOVERNOR_TARGET_SAVINGS_MIN || process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_TARGET_SAVINGS_MIN || 5),
    contextGovernorTargetSavingsMax: Number(process.env.CONTINUOUS_CONTROLLER_CONTEXT_GOVERNOR_TARGET_SAVINGS_MAX || process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_TARGET_SAVINGS_MAX || 10),
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
    checkpointTopLevelArtifacts: String(process.env.CONTINUOUS_CONTROLLER_CHECKPOINT_TOP_LEVEL_ARTIFACTS || '1') !== '0',
    productionQualityGateEnabled: String(process.env.CONTINUOUS_CONTROLLER_PRODUCTION_QUALITY_GATE || 'auto'),
    productionQualityRepairEnabled: String(process.env.CONTINUOUS_CONTROLLER_PRODUCTION_QUALITY_REPAIR || '1') !== '0',
    productionQualityRepairMaxSurfaces: Number(process.env.CONTINUOUS_CONTROLLER_PRODUCTION_QUALITY_REPAIR_MAX_SURFACES || 100),
    objectiveTruthGateEnabled: String(process.env.CONTINUOUS_CONTROLLER_OBJECTIVE_TRUTH_GATE || 'auto'),
    objectiveTruthSurfaceMatrixPath: process.env.CONTINUOUS_CONTROLLER_OBJECTIVE_SURFACE_MATRIX || null,
    objectiveTruthNegativeSpacePath: process.env.CONTINUOUS_CONTROLLER_OBJECTIVE_NEGATIVE_SPACE_QUEUE || null,
    objectiveTruthProductionQualityGatePath: process.env.CONTINUOUS_CONTROLLER_OBJECTIVE_PRODUCTION_QUALITY_GATE || null,
    objectiveTruthRepairEnabled: String(process.env.CONTINUOUS_CONTROLLER_OBJECTIVE_TRUTH_REPAIR || '1') !== '0',
    objectiveTruthRepairMaxSurfaces: Number(process.env.CONTINUOUS_CONTROLLER_OBJECTIVE_TRUTH_REPAIR_MAX_SURFACES || process.env.CONTINUOUS_CONTROLLER_PRODUCTION_QUALITY_REPAIR_MAX_SURFACES || 100),
    maxTestFailureRegressionCount: Number(process.env.CONTINUOUS_CONTROLLER_MAX_TEST_FAILURE_REGRESSION || 0),
    maxRouteCollisionCount: Number(process.env.CONTINUOUS_CONTROLLER_MAX_ROUTE_COLLISIONS || 0),
    maxDuplicateNormalizedLineRatio: Number(process.env.CONTINUOUS_CONTROLLER_MAX_DUPLICATE_NORMALIZED_LINE_RATIO || 0.25),
    minArchitectureFitnessScore: Number(process.env.CONTINUOUS_CONTROLLER_MIN_ARCHITECTURE_FITNESS_SCORE || 0.9),
    maxArchitectureViolationCount: Number(process.env.CONTINUOUS_CONTROLLER_MAX_ARCHITECTURE_VIOLATIONS || 0),
    orchestrationLearningMode: process.env.CONTINUOUS_CONTROLLER_ORCHESTRATION_LEARNING || process.env.ORCHESTRATION_LEARNING_ENABLED || 'auto',
    orchestrationLearningLedgerPath: process.env.CONTINUOUS_CONTROLLER_ORCHESTRATION_LEARNING_LEDGER_PATH || process.env.ORCHESTRATION_LEARNING_LEDGER_PATH || null,
    orchestrationLearningLimit: Number(process.env.CONTINUOUS_CONTROLLER_ORCHESTRATION_LEARNING_LIMIT || process.env.ORCHESTRATION_LEARNING_RETRIEVAL_LIMIT || 3),
    orchestrationLearningIncludeCandidates: (process.env.CONTINUOUS_CONTROLLER_ORCHESTRATION_LEARNING_INCLUDE_CANDIDATES || process.env.ORCHESTRATION_LEARNING_INCLUDE_CANDIDATES) === undefined
      ? undefined
      : String(process.env.CONTINUOUS_CONTROLLER_ORCHESTRATION_LEARNING_INCLUDE_CANDIDATES || process.env.ORCHESTRATION_LEARNING_INCLUDE_CANDIDATES) !== '0',
    resumeStatePath: null,
    durationTargetMinutes: null,
    meteringMode: process.env.CONTINUOUS_CONTROLLER_METERING_MODE || process.env.LLM_METERING_MODE || process.env.CODEX_METERING_MODE || 'auto'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (!args.contractPath && !token.startsWith('--')) { args.contractPath = path.resolve(token); continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--repo-path') { args.repoPath = path.resolve(next); index += 1; continue; }
    if (token === '--max-waves') { args.maxWaves = Number(next); index += 1; continue; }
    if (token === '--requested-agent-count') { args.requestedAgentCount = Number(next); index += 1; continue; }
    if (token === '--wave-agent-count') { args.waveAgentCount = Number(next); index += 1; continue; }
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
    if (token === '--context-governor-max-worker-tokens') { args.contextGovernorMaxWorkerTokens = Number(next); index += 1; continue; }
    if (token === '--context-governor-target-savings-min') { args.contextGovernorTargetSavingsMin = Number(next); index += 1; continue; }
    if (token === '--context-governor-target-savings-max') { args.contextGovernorTargetSavingsMax = Number(next); index += 1; continue; }
    if (token === '--no-context-governor') { args.contextGovernorEnabled = false; continue; }
    if (token === '--no-context-governor-hard-gate') { args.contextGovernorHardGate = false; continue; }
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
    if (token === '--top-level-checkpoint') { args.checkpointTopLevelArtifacts = true; continue; }
    if (token === '--no-top-level-checkpoint') { args.checkpointTopLevelArtifacts = false; continue; }
    if (token === '--production-quality-gate') { args.productionQualityGateEnabled = '1'; continue; }
    if (token === '--no-production-quality-gate') { args.productionQualityGateEnabled = '0'; continue; }
    if (token === '--production-quality-repair') { args.productionQualityRepairEnabled = true; continue; }
    if (token === '--no-production-quality-repair') { args.productionQualityRepairEnabled = false; continue; }
    if (token === '--production-quality-repair-max-surfaces') { args.productionQualityRepairMaxSurfaces = Number(next); index += 1; continue; }
    if (token === '--objective-truth-gate') { args.objectiveTruthGateEnabled = '1'; continue; }
    if (token === '--no-objective-truth-gate') { args.objectiveTruthGateEnabled = '0'; continue; }
    if (token === '--objective-surface-matrix') { args.objectiveTruthSurfaceMatrixPath = path.resolve(next); index += 1; continue; }
    if (token === '--objective-negative-space-queue') { args.objectiveTruthNegativeSpacePath = path.resolve(next); index += 1; continue; }
    if (token === '--objective-production-quality-gate') { args.objectiveTruthProductionQualityGatePath = path.resolve(next); index += 1; continue; }
    if (token === '--objective-truth-repair') { args.objectiveTruthRepairEnabled = true; continue; }
    if (token === '--no-objective-truth-repair') { args.objectiveTruthRepairEnabled = false; continue; }
    if (token === '--objective-truth-repair-max-surfaces') { args.objectiveTruthRepairMaxSurfaces = Number(next); index += 1; continue; }
    if (token === '--max-test-failure-regression') { args.maxTestFailureRegressionCount = Number(next); index += 1; continue; }
    if (token === '--max-route-collisions') { args.maxRouteCollisionCount = Number(next); index += 1; continue; }
    if (token === '--max-duplicate-normalized-line-ratio') { args.maxDuplicateNormalizedLineRatio = Number(next); index += 1; continue; }
    if (token === '--min-architecture-fitness-score') { args.minArchitectureFitnessScore = Number(next); index += 1; continue; }
    if (token === '--max-architecture-violations') { args.maxArchitectureViolationCount = Number(next); index += 1; continue; }
    if (token === '--orchestration-learning-ledger') { args.orchestrationLearningLedgerPath = path.resolve(next); args.orchestrationLearningMode = '1'; index += 1; continue; }
    if (token === '--orchestration-learning-limit') { args.orchestrationLearningLimit = Number(next); index += 1; continue; }
    if (token === '--no-orchestration-learning') { args.orchestrationLearningMode = '0'; continue; }
    if (token === '--trusted-learning-only') { args.orchestrationLearningIncludeCandidates = false; continue; }
    if (token === '--no-adaptive-token-budget') { args.adaptiveTokenBudget = false; continue; }
    if (token === '--no-pause-on-usage-limit') { args.pauseOnUsageLimit = false; continue; }
    if (token === '--ignore-backoff') { args.ignoreBackoff = true; continue; }
    if (token === '--resume-state') { args.resumeStatePath = path.resolve(next); index += 1; continue; }
    if (token === '--duration-target-minutes') { args.durationTargetMinutes = Number(next); index += 1; continue; }
    if (token === '--metering-mode') { args.meteringMode = String(next || 'auto'); index += 1; continue; }
    if (token === '--dry-run') { args.dryRun = true; continue; }
  }
  if (!args.contractPath) {
    console.error('usage: node run-continuous-real-workload-controller.mjs <run_contract.json|agent_work_spec.aw|agent_work_spec.json|compiled-agent-work-dir> [--artifact-root ROOT] [--dry-run]');
    process.exit(2);
  }
  return args;
}

function csvWithRequiredEntry(value = '', requiredEntry = '') {
  const required = String(requiredEntry || '').trim();
  const entries = stableList(String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean));
  if (required && !entries.includes(required)) entries.push(required);
  return entries.join(',');
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

function materializeDeploymentManifest({ artifactRoot, contract }) {
  const source = process.env.AGENT_WORK_DEPLOYMENT_MANIFEST
    || contract.deploymentManifestPath
    || contract.metadata?.deploymentManifestPath
    || contract.metadata?.deployment_manifest_path
    || null;
  if (!source) return null;
  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath)) return { sourcePath, copied: false, error: 'deployment_manifest_missing' };
  const manifest = readJson(sourcePath, null);
  const artifactPath = path.join(artifactRoot, 'deployment_manifest.json');
  if (path.resolve(sourcePath) !== path.resolve(artifactPath)) writeJson(artifactPath, manifest);
  return {
    sourcePath,
    artifactPath,
    copied: true,
    schemaVersion: manifest?.schemaVersion || null,
    bundleId: manifest?.bundleId || null,
    gitCommit: manifest?.git?.commit || null,
    gitDirty: manifest?.git?.dirty ?? null,
    fileCount: manifest?.fileCount ?? null,
    aggregateSha256: manifest?.aggregateSha256 || null
  };
}

function controllerTargetFromContract(contract, args) {
  const go = contract.scope?.goThresholds || {};
  const tierThresholds = BENCHMARK_TIER_THRESHOLDS[contract.benchmarkTier || 'tier2_functional'] || BENCHMARK_TIER_THRESHOLDS.tier2_functional || {};
  const tierMin = (metric, fallback) => Number(tierThresholds[metric]?.min ?? fallback);
  const tierMax = (metric, fallback) => Number(tierThresholds[metric]?.max ?? fallback);
  return {
    durationTargetMinutes: args.durationTargetMinutes || Number(contract.scope?.durationTargetMinutes || go.autonomyWindowMinutes || tierMin('autonomyWindowMinutes', 120)),
    productiveIterationRateMin: Math.max(Number(go.productiveIterationRateMin ?? 0.65), tierMin('productiveIterationRate', 0.65)),
    noOpRateMax: Math.min(Number(go.noOpRateMax ?? tierMax('noOpRate', 0.15)), tierMax('noOpRate', 0.15)),
    repeatBlockerRateMax: Math.min(Number(go.repeatBlockerRateMax ?? tierMax('repeatBlockerRate', 0.10)), tierMax('repeatBlockerRate', 0.10)),
    handoffEfficiencyMin: Math.max(Number(go.handoffEfficiencyMin ?? 0.70), tierMin('handoffEfficiency', 0.70)),
    transferScoreMin: Math.max(Number(go.transferScoreMin ?? 0.70), tierMin('transferScore', 0.70)),
    minChangedProductFiles: go.minCountedProductFilesTouched ?? go.minChangedProductFiles ?? 8,
    minUniqueAgents: go.minDistinctAcceptedAgentIds ?? go.minUniqueAgents ?? 4
  };
}

function controllerMeteringEnv(args) {
  return {
    ...process.env,
    CONTINUOUS_CONTROLLER_METERING_MODE: args.meteringMode || process.env.CONTINUOUS_CONTROLLER_METERING_MODE || process.env.LLM_METERING_MODE || process.env.CODEX_METERING_MODE || 'auto'
  };
}

function finiteRunnerEnv({ selectedCount, args, promptMode = 'full_context', controllerBudget = {}, budgetPlan = null, meteringPlan = null }) {
  const attempts = Math.max(1, Number(args.waveMaxAttemptsPerTask || 2));
  const globalCalls = Math.max(selectedCount * attempts, selectedCount);
  const waveRuntimeMs = Math.max(60_000, Number(args.waveDurationTargetMinutes || 10) * 60_000 + 15 * 60_000);
  const waveTransferMaxRuntimeMs = Math.max(
    waveRuntimeMs,
    Number(process.env.CONTINUOUS_CONTROLLER_WAVE_TRANSFER_MAX_RUNTIME_MS || 0) || 0
  );
  const compact = promptMode === 'compact';
  const controllerLimit = Math.max(0, Number(args.controllerGlobalTokenLimit || 0));
  const tokensObserved = Number(controllerBudget.tokensObserved || 0);
  const remainingControllerTokens = controllerLimit ? Math.max(0, controllerLimit - tokensObserved) : 0;
  const inheritedWaveTokenLimit = Math.max(0, Number(process.env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT || 0));
  const hardTokenBudget = !meteringPlan || meteringPlan.tokenBudgetMode !== 'safety';
  const waveTokenLimit = hardTokenBudget && controllerLimit
    ? String(inheritedWaveTokenLimit ? Math.min(inheritedWaveTokenLimit, remainingControllerTokens) : remainingControllerTokens)
    : process.env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT;
  const effectiveTokenReservationEstimate = Math.max(1, Number(meteringPlan?.tokenReservationEstimate || budgetPlan?.tokenReservationEstimate || process.env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE || 0));
  const meteringEnv = meteringPlan ? envFromLlmMeteringPlan(meteringPlan, { physicalWorkerCount: selectedCount }) : {};
  const contextMaxWorkerTokens = Math.max(1, Number(args.contextGovernorMaxWorkerTokens || process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_WORKER_TOKENS || 3200));
  const workerWorkspaceMode = String(process.env.ORCHESTRATOR_WORKER_WORKSPACE_MODE || '').trim() || 'isolated_product_copy';
  const workerWorkspaceCopyPaths = csvWithRequiredEntry(process.env.ORCHESTRATOR_WORKER_WORKSPACE_COPY_PATHS || '', 'tests');
  return {
    ...process.env,
    ORCHESTRATOR_WORKER_WORKSPACE_MODE: workerWorkspaceMode,
    ORCHESTRATOR_WORKER_WORKSPACE_COPY_PATHS: workerWorkspaceCopyPaths,
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
    ORCHESTRATOR_CONTEXT_GOVERNOR: args.contextGovernorEnabled === false ? '0' : '1',
    ORCHESTRATOR_CONTEXT_GOVERNOR_HARD_GATE: args.contextGovernorHardGate === false ? '0' : '1',
    ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_WORKER_TOKENS: String(contextMaxWorkerTokens),
    ORCHESTRATOR_CONTEXT_GOVERNOR_TARGET_SAVINGS_MIN: String(Math.max(1, Number(args.contextGovernorTargetSavingsMin || 5))),
    ORCHESTRATOR_CONTEXT_GOVERNOR_TARGET_SAVINGS_MAX: String(Math.max(1, Number(args.contextGovernorTargetSavingsMax || 10))),
    ORCHESTRATOR_CONTEXT_GOVERNOR_WORKER_PROMPT_MODE: promptMode,
    CREATIVE_WORKER_PROMPT_TOKEN_BUDGET: String(contextMaxWorkerTokens),
    CREATIVE_WORKER_PROMPT_TOKEN_BUDGET_MODE: args.contextGovernorHardGate === false ? 'safety' : 'hard',
    ...(waveTokenLimit ? { CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: waveTokenLimit } : {}),
    CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: String(effectiveTokenReservationEstimate),
    ORCHESTRATOR_MAX_ATTEMPTS_PER_TASK: String(attempts),
    CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: String(attempts),
    CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: String(globalCalls),
    CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: String(Math.max(1, Math.min(Number(process.env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS || 8), selectedCount || 1))),
    TRANSFER_BENCHMARK_MAX_RUNTIME_MS: String(waveTransferMaxRuntimeMs),
    ...meteringEnv
  };
}

function readWaveSummary(waveRoot, waveNumber) {
  const completion = readJson(path.join(waveRoot, 'completion_summary.json'), {});
  const patchQueue = readJson(path.join(waveRoot, 'orchestrator_run', 'patch_queue.json'), {});
  const truthConflicts = readJson(path.join(waveRoot, 'truth_conflicts.json'), readJson(path.join(waveRoot, 'orchestrator_run', 'truth_conflicts.json'), null));
  const budgetLedger = readJson(path.join(waveRoot, 'orchestrator_run', 'results', 'creative-worker-budget-ledger.json'), null);
  const contextGovernor = readJson(path.join(waveRoot, 'context_governor_report.json'), readJson(path.join(waveRoot, 'orchestrator_run', 'context_governor_report.json'), null));
  const waveFactpackPath = fs.existsSync(path.join(waveRoot, 'wave_factpack.json'))
    ? path.join(waveRoot, 'wave_factpack.json')
    : fs.existsSync(path.join(waveRoot, 'orchestrator_run', 'wave_factpack.json'))
      ? path.join(waveRoot, 'orchestrator_run', 'wave_factpack.json')
      : null;
  const summary = summarizeWaveArtifacts({ completionSummary: completion, patchQueue, truthConflicts, waveNumber });
  if (budgetLedger) {
    summary.budget = summarizeWaveBudgetLedger(budgetLedger);
    summary.budgetStopReason = summary.budget.globalStopReason || null;
  }
  if (contextGovernor) {
    summary.contextGovernor = contextGovernor;
    summary.contextGovernorSavingsRatio = contextGovernor.observedSavingsRatio ?? null;
    summary.contextGovernorBudgetFailureCount = contextGovernor.budgetFailureCount ?? null;
  }
  if (waveFactpackPath) summary.waveFactpackPath = waveFactpackPath;
  return summary;
}

function writePausedBackoffArtifacts({ controllerRoot, baseContract, state, finalDecision, metrics, timing = null }) {
  const scaleProof = continuousScaleProofForArtifacts({ metrics, requestedAgentCount: state.requestedAgentCount, state });
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
  state.scaleProof = scaleProof;
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
    ...scaleProofArtifactFields(scaleProof),
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
    let next = JSON.parse(JSON.stringify(wave || {}));
    const waveNumber = Number(next.waveNumber || 0);
    const waveId = waveNumber > 0 ? `wave-${String(waveNumber).padStart(3, '0')}` : null;
    if (resumeRoot && waveId) {
      const waveRoot = path.join(resumeRoot, 'waves', waveId);
      const completion = readJson(path.join(waveRoot, 'completion_summary.json'), null);
      const patchQueue = readJson(path.join(waveRoot, 'orchestrator_run', 'patch_queue.json'), null);
      if (completion || patchQueue) {
        next = {
          ...next,
          ...summarizeWaveArtifacts({ completionSummary: completion || {}, patchQueue: patchQueue || {}, waveNumber })
        };
      }
    }
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

function continuousScaleProofForArtifacts({ metrics = {}, requestedAgentCount = 0, state = {} } = {}) {
  return deriveContinuousScaleProof({
    metrics,
    requestedAgentCount,
    waveAgentCount: state.waveAgentCount,
    waveSchedulingPolicy: state.waveSchedulingPolicy || {}
  });
}

function scaleProofArtifactFields(scaleProof = {}) {
  return {
    scaleProofReady: scaleProof.scaleProofReady === true,
    aggregateScaleProofReady: scaleProof.aggregateScaleProofReady === true,
    uniqueWorkerScaleProofReady: scaleProof.uniqueWorkerScaleProofReady === true,
    legacyUniqueWorkerScaleProofReady: scaleProof.legacyUniqueWorkerScaleProofReady === true,
    scaleProof
  };
}

function writeRunningTopLevelCheckpointArtifacts({
  controllerRoot,
  baseContract,
  state = {},
  requestedAgentCount = 1,
  metrics = {},
  thresholdMetrics = {},
  thresholdEvaluation = {},
  productionQualityPolicy = {},
  productionQualityEvaluation = {},
  orchestrationLearningPolicy = {},
  tokenEfficiencyPolicy = {},
  tokenEfficiencyEvaluation = {},
  tokenEfficiencyDebtRecovery = {},
  controllerDecision = {},
  timing = {}
} = {}) {
  const generatedAt = new Date().toISOString();
  const lastWave = Array.isArray(state.waveSummaries) && state.waveSummaries.length
    ? state.waveSummaries.at(-1)
    : null;
  const scaleProof = continuousScaleProofForArtifacts({ metrics, requestedAgentCount, state });
  const checkpoint = {
    generatedAt,
    benchmarkId: baseContract.benchmarkId || null,
    runId: baseContract.runId || null,
    executionMode: 'continuous_real_workload_controller',
    status: 'running_checkpoint',
    checkpoint: true,
    checkpointKind: 'top_level_after_wave',
    lastCompletedWaveNumber: lastWave?.waveNumber || null,
    paused: false,
    resumeAfter: null,
    thresholdPass: false,
    mechanicalGreen: false,
    ...scaleProofArtifactFields(scaleProof),
    requestedAgentCount,
    waveAgentCount: state.waveAgentCount || null,
    durationMinutes: metrics.autonomyWindowMinutes,
    resumedAggregateDurationMinutes: metrics.autonomyWindowMinutes,
    currentAttemptRuntimeMinutes: timing.currentAttemptRuntimeMinutes,
    currentAttemptWaveDurationMinutes: timing.currentAttemptWaveDurationMinutes,
    resumedPriorDurationMinutes: timing.resumedPriorDurationMinutes,
    timing,
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
    productionQualityPolicy,
    productionQualityEvaluation,
    productionQualityGate: state.productionQualityGate || null,
    productionQualityGateRun: state.productionQualityGateRun || null,
    orchestrationLearningPolicy,
    orchestrationLearning: state.orchestrationLearning || null,
    tokenEfficiencyPolicy,
    tokenEfficiencyEvaluation,
    tokenEfficiencyDebtRecovery,
    controllerDecision,
    thresholdFailures: thresholdEvaluation.failures || [],
    blocker: null,
    note: 'Running checkpoint written after a completed wave; final pass/blocker truth is written again when the controller exits.'
  };
  writeJson(path.join(controllerRoot, 'completion_summary.json'), checkpoint);
  writeJson(path.join(controllerRoot, 'threshold_evaluation.json'), {
    generatedAt,
    benchmarkId: baseContract.benchmarkId || null,
    runId: baseContract.runId || null,
    benchmarkTier: baseContract.benchmarkTier || 'tier2_functional',
    status: 'running_checkpoint',
    checkpoint: true,
    checkpointKind: 'top_level_after_wave',
    lastCompletedWaveNumber: lastWave?.waveNumber || null,
    thresholdPass: false,
    paused: false,
    resumeAfter: null,
    currentAttemptRuntimeMinutes: timing.currentAttemptRuntimeMinutes,
    currentAttemptWaveDurationMinutes: timing.currentAttemptWaveDurationMinutes,
    resumedPriorDurationMinutes: timing.resumedPriorDurationMinutes,
    resumedAggregateDurationMinutes: timing.resumedAggregateDurationMinutes,
    timing,
    controllerDecision,
    metrics: thresholdMetrics,
    thresholdMetrics,
    rawAggregateMetrics: metrics,
    ...scaleProofArtifactFields(scaleProof),
    thresholdScoringPolicy: continuousScoringPolicy(),
    productionQualityPolicy,
    productionQualityEvaluation,
    productionQualityGate: state.productionQualityGate || null,
    productionQualityGateRun: state.productionQualityGateRun || null,
    orchestrationLearningPolicy,
    orchestrationLearning: state.orchestrationLearning || null,
    tokenEfficiencyPolicy,
    tokenEfficiencyEvaluation,
    tokenEfficiencyDebtRecovery,
    thresholdEvaluation
  });
  writeJson(path.join(controllerRoot, 'blocker_report.json'), {
    generatedAt,
    benchmarkId: baseContract.benchmarkId || null,
    runId: baseContract.runId || null,
    phase: 'continuous_real_workload_controller',
    status: 'running_checkpoint',
    checkpoint: true,
    lastCompletedWaveNumber: lastWave?.waveNumber || null,
    blocker: null,
    blockerKind: null,
    nextAction: 'Controller is still running; read completion_summary.json or continuous_controller_state.json for the latest checkpoint, and wait for final threshold/blocker artifacts on exit.',
    supersedesPreviousBlocker: true
  });
}


function runFinalProductionQualityGate({ controllerRoot, repoPath, statePath, policy = {}, args = {} } = {}) {
  if (policy?.enabled !== true) return null;
  const outputDir = path.join(controllerRoot, 'production_quality_gate_run');
  fs.mkdirSync(outputDir, { recursive: true });
  const testCommand = process.env.PRODUCTION_QUALITY_TEST_COMMAND || 'npm test';
  const gateArgs = [
    QUALITY_GATE_SCRIPT,
    '--repo-path', repoPath,
    '--artifact-root', controllerRoot,
    '--state-path', statePath,
    '--test-command', testCommand,
    '--max-test-failure-regression', String(policy.maxTestFailureRegressionCount ?? 0),
    '--max-route-collisions', String(policy.maxRouteCollisionCount ?? 0),
    '--max-duplicate-normalized-line-ratio', String(policy.maxDuplicateNormalizedLineRatio ?? 0.25),
    '--min-architecture-fitness-score', String(policy.minArchitectureFitnessScore ?? 0.9),
    '--max-architecture-violations', String(policy.maxArchitectureViolationCount ?? 0)
  ];
  if (process.env.PRODUCTION_QUALITY_BASELINE_REPO) {
    gateArgs.push('--baseline-repo-path', process.env.PRODUCTION_QUALITY_BASELINE_REPO);
  } else {
    const baselineRef = process.env.PRODUCTION_QUALITY_BASELINE_REF || (fs.existsSync(path.join(controllerRoot, 'baseline_head.txt'))
      ? fs.readFileSync(path.join(controllerRoot, 'baseline_head.txt'), 'utf8').trim()
      : '');
    if (baselineRef) gateArgs.push('--baseline-ref', baselineRef);
  }
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, gateArgs, {
    cwd: STACK_ROOT,
    encoding: 'utf8',
    timeout: Number(process.env.PRODUCTION_QUALITY_GATE_TIMEOUT_MS || 45 * 60 * 1000),
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env }
  });
  const finishedAt = new Date().toISOString();
  const runReport = {
    generatedAt: finishedAt,
    startedAt,
    finishedAt,
    command: [process.execPath, ...gateArgs].join(' '),
    repoPath,
    statePath,
    testCommand,
    exitCode: result.status,
    signal: result.signal || null,
    error: result.error ? result.error.message : null,
    stdoutPath: path.join(outputDir, 'stdout.log'),
    stderrPath: path.join(outputDir, 'stderr.log')
  };
  fs.writeFileSync(runReport.stdoutPath, result.stdout || '');
  fs.writeFileSync(runReport.stderrPath, result.stderr || '');
  writeJson(path.join(outputDir, 'run_report.json'), runReport);
  const gatePath = path.join(controllerRoot, 'production_quality_gate.json');
  if (!fs.existsSync(gatePath)) {
    writeJson(gatePath, {
      generatedAt: finishedAt,
      ok: false,
      repoPath,
      statePath,
      metrics: {
        productionQualityGatePass: 0,
        testFailureRegressionCount: null,
        routeCollisionCount: null,
        integrationHardeningPass: 0,
        architectureGatePass: null
      },
      failures: [{ metric: 'productionQualityGate', actual: null, requirement: 'quality gate report written', reason: 'production_quality_gate_report_missing' }],
      runReport
    });
  }
  return runReport;
}

function realRunCoreReadyForProductionQuality({ metrics = {}, target = {} } = {}) {
  const durationTargetMinutes = Number(target.durationTargetMinutes || 120);
  const minProductiveIterationRate = Number(target.productiveIterationRateMin ?? 0.65);
  const maxNoOpRate = Number(target.noOpRateMax ?? 0.15);
  const maxRepeatBlockerRate = Number(target.repeatBlockerRateMax ?? 0.10);
  const minHandoffEfficiency = Number(target.handoffEfficiencyMin ?? 0.70);
  const minTransferScore = Number(target.transferScoreMin ?? 0.70);
  const minChangedProductFiles = Number(target.minChangedProductFiles ?? 8);
  const minUniqueAgents = Number(target.minUniqueAgents ?? 4);
  return Number(metrics.autonomyWindowMinutes || 0) >= durationTargetMinutes
    && Number(metrics.productiveIterationRate || 0) >= minProductiveIterationRate
    && Number(metrics.noOpRate ?? 1) <= maxNoOpRate
    && Number(metrics.repeatBlockerRate ?? 0) <= maxRepeatBlockerRate
    && Number(metrics.handoffEfficiency || 0) >= minHandoffEfficiency
    && Number(metrics.transferScore || 0) >= minTransferScore
    && Number(metrics.truthIntegrityContradictions || 0) === 0
    && Number(metrics.fakeGreenIncidents || 0) === 0
    && Number(metrics.changedProductFileCount || 0) >= minChangedProductFiles
    && Number(metrics.uniqueAgentCount || 0) >= minUniqueAgents;
}

function refreshProductionQualityGateForRepair({ controllerRoot, repoPath, state, productionQualityPolicy, args, target, initialWaveSummaryCount, startedAtMs } = {}) {
  if (productionQualityPolicy?.enabled !== true || args.productionQualityRepairEnabled === false) return null;
  const thresholdMetricsBeforeGate = aggregateContinuousThresholdMetrics(state, { rejectionReasonFromWaveNumber: state.thresholdRejectionReasonFromWaveNumber || 0 });
  if (!realRunCoreReadyForProductionQuality({ metrics: thresholdMetricsBeforeGate, target })) return null;

  const statePath = path.join(controllerRoot, 'continuous_controller_state.json');
  state.productionQualityRepair ||= { enabled: true, attempts: [] };
  state.productionQualityRepair.enabled = true;
  state.productionQualityRepair.lastCoreReadyAt = new Date().toISOString();
  state.updatedAt = new Date().toISOString();
  writeJson(statePath, state);

  const gateRun = runFinalProductionQualityGate({ controllerRoot, repoPath, statePath, policy: productionQualityPolicy, args });
  if (gateRun) state.productionQualityGateRun = gateRun;
  const gateReport = readJson(path.join(controllerRoot, 'production_quality_gate.json'), null);
  if (gateReport && typeof gateReport === 'object') state.productionQualityGate = gateReport.metrics || gateReport;
  const thresholdMetricsAfterGate = aggregateContinuousThresholdMetrics(state, { rejectionReasonFromWaveNumber: state.thresholdRejectionReasonFromWaveNumber || 0 });
  const evaluation = evaluateProductionQualityGate({ metrics: thresholdMetricsAfterGate, policy: productionQualityPolicy });
  state.productionQualityEvaluation = evaluation;

  const repairSurfaces = evaluation.ok === true ? [] : createProductionQualityRepairSurfaces({
    qualityGate: gateReport || {},
    state: { ...state, thresholdMetrics: thresholdMetricsAfterGate, metrics: aggregateContinuousMetrics(state) },
    waveNumber: Number(state.waveSummaries?.length || 0) + 1,
    maxSurfaces: Math.max(1, Number(args.productionQualityRepairMaxSurfaces || 100))
  });
  const attempt = {
    generatedAt: new Date().toISOString(),
    coreReady: true,
    gateRun,
    evaluation,
    repairSurfaceCount: repairSurfaces.length,
    repairSurfaceIds: repairSurfaces.map((surface) => surface.id).slice(0, 200)
  };
  state.productionQualityRepair.attempts = [...(state.productionQualityRepair.attempts || []), attempt].slice(-50);
  state.productionQualityRepair.lastAttempt = attempt;
  state.metrics = aggregateContinuousMetrics(state);
  state.thresholdMetrics = thresholdMetricsAfterGate;
  state.updatedAt = new Date().toISOString();
  state.attemptTiming = attemptTimingSummary({ state, initialWaveSummaryCount, startedAtMs, finishedAtMs: Date.now() });
  writeJson(statePath, state);
  return { gateReport, gateRun, evaluation, repairSurfaces, thresholdMetrics: thresholdMetricsAfterGate };
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
    transferScore: metrics.transferScore,
    creativeWorkerEvidenceIntegrity: metrics.creativeWorkerEvidenceIntegrity,
    creativeIterationIntegrity: metrics.creativeIterationIntegrity,
    creativeProductDeltaIntegrity: metrics.creativeProductDeltaIntegrity,
    templateFallbackRate: metrics.templateFallbackRate,
    testFailureRegressionCount: metrics.testFailureRegressionCount,
    routeCollisionCount: metrics.routeCollisionCount,
    duplicateNormalizedLineRatio: metrics.duplicateNormalizedLineRatio,
    architectureFitnessScore: metrics.architectureFitnessScore,
    architectureViolationCount: metrics.architectureViolationCount,
    architectureGatePass: metrics.architectureGatePass,
    integrationHardeningPass: metrics.integrationHardeningPass,
    productionQualityGatePass: metrics.productionQualityGatePass
  };
}

function continuousScoringPolicy() {
  return {
    version: 'continuous_controller_threshold_scoring.v5',
    rawAggregatePreserved: true,
    thresholdMetrics: 'budget_backoff_rejections_excluded_and_repaired_attempt_rejection_windowed_with_blocker_signatures_and_creative_evidence_from_admitted_patches_plus_optional_production_architecture_gate',
    excludesFromNoOpAndRepeatBlocker: [
      'codex_usage_limit_observed',
      'creative_global_reserved_token_limit_reached',
      'creative_global_token_limit_reached',
      'controller_global_token_limit_reached',
      'controller_token_budget_backoff'
    ],
    rejectionReasonWindow: 'When resuming a repaired red run, repeat-blocker scoring starts at the current attempt while raw aggregate rejected-reason counts remain recorded for audit.',
    repeatBlockerIdentity: 'Repeat-blocker scoring uses artifact-level blocker signatures: rejection reason plus rejected product-file cluster when available.',
    creativeProductWorkEvidence: 'Creative integrity metrics are scored from admitted patch metadata at patch_queue.merged[].metadata.implementation.metadata.creativeWorkerEvidence, requiring a Codex/creative-worker command, positive worker runtime, at least one iteration, product modified files, and no template fallback.',
    productionArchitectureGate: 'Production-architecture tiers additionally require non-regressing tests, zero route collisions, bounded duplicate normalized LOC, architecture evidence integrity, integration hardening proof, and explicit production quality pass evidence.',
    rationale: 'Controller/runner budget or external usage-limit pauses are availability/backoff events, not product no-op attempts. Pre-repair repeated rejection causes should not permanently poison the scored repaired attempt, but raw aggregate metrics are still recorded for audit. Unrelated verifier failures on different product slices should not be collapsed into one repeated blocker merely because they share a broad rejection reason. Creative product-work tiers must carry their per-wave admitted creative evidence into the root canonical threshold metrics rather than dropping those fields during continuous aggregation. Higher production-architecture claims cannot be earned by raw LOC or syntax-only gates; they require integration and architecture fitness evidence.'
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

function productionQualityPolicyFromArgs(args = {}, contract = {}) {
  const autoEnabled = /production|architecture/i.test(String(contract.benchmarkTier || ''))
    || contract.scope?.productionQualityRequired === true
    || contract.scope?.architectureQualityRequired === true;
  const requested = String(args.productionQualityGateEnabled ?? 'auto').toLowerCase();
  const enabled = requested === 'auto' ? autoEnabled : !['0', 'false', 'off', 'no'].includes(requested);
  return {
    enabled,
    maxTestFailureRegressionCount: Math.max(0, Number(args.maxTestFailureRegressionCount || 0)),
    maxRouteCollisionCount: Math.max(0, Number(args.maxRouteCollisionCount || 0)),
    maxDuplicateNormalizedLineRatio: Math.max(0, Number(args.maxDuplicateNormalizedLineRatio || 0.25)),
    minArchitectureFitnessScore: Math.max(0, Number(args.minArchitectureFitnessScore || 0.9)),
    maxArchitectureViolationCount: Math.max(0, Number(args.maxArchitectureViolationCount || 0)),
    requireIntegrationHardeningPass: contract.scope?.requireIntegrationHardeningPass !== false,
    requireArchitectureGatePass: contract.scope?.requireArchitectureGatePass !== false,
    requireProductionQualityGatePass: contract.scope?.requireProductionQualityGatePass !== false
  };
}

function productionQualityTargetFromPolicy(target = {}, policy = {}) {
  return {
    ...target,
    productionQualityRequired: policy.enabled === true,
    architectureQualityRequired: policy.enabled === true,
    maxTestFailureRegressionCount: policy.maxTestFailureRegressionCount,
    maxRouteCollisionCount: policy.maxRouteCollisionCount,
    maxDuplicateNormalizedLineRatio: policy.maxDuplicateNormalizedLineRatio,
    minArchitectureFitnessScore: policy.minArchitectureFitnessScore,
    maxArchitectureViolationCount: policy.maxArchitectureViolationCount,
    requireIntegrationHardeningPass: policy.requireIntegrationHardeningPass,
    requireArchitectureGatePass: policy.requireArchitectureGatePass,
    requireProductionQualityGatePass: policy.requireProductionQualityGatePass
  };
}

function resolveOptionalPath(value, baseDir = process.cwd()) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  return path.isAbsolute(text) ? text : path.resolve(baseDir, text);
}

function objectiveTruthPolicyFromArgs({ args = {}, contract = {}, controllerRoot, productionQualityPolicy = {} } = {}) {
  const configured = contract.scope?.objectiveTruth || contract.scope?.supervisorTruth || contract.metadata?.objectiveTruth || contract.metadata?.supervisorTruth || {};
  const requested = String(args.objectiveTruthGateEnabled ?? configured.enabled ?? 'auto').trim().toLowerCase();
  const baseDir = path.dirname(args.contractPath || controllerRoot || process.cwd());
  const surfaceMatrixPath = resolveOptionalPath(args.objectiveTruthSurfaceMatrixPath || configured.surfaceMatrixPath || configured.surfaceMatrix || configured.matrixPath, baseDir);
  const negativeSpacePath = resolveOptionalPath(args.objectiveTruthNegativeSpacePath || configured.negativeSpacePath || configured.negativeSpaceQueuePath || configured.nextWorkQueuePath, baseDir);
  const productionQualityGatePath = resolveOptionalPath(args.objectiveTruthProductionQualityGatePath || configured.productionQualityGatePath || configured.qualityGatePath || null, baseDir);
  const autoEnabled = Boolean(
    configured.enabled === true
    || configured.required === true
    || configured.surfaceMatrixRequired === true
    || configured.negativeSpaceRequired === true
    || configured.productionQualityRequired === true
    || surfaceMatrixPath
    || negativeSpacePath
    || productionQualityGatePath
  );
  const enabled = requested === 'auto' ? autoEnabled : parseLearningBool(requested, autoEnabled);
  return {
    enabled,
    required: enabled && configured.required !== false,
    surfaceMatrixRequired: enabled && configured.surfaceMatrixRequired !== false && Boolean(surfaceMatrixPath || configured.surfaceMatrixRequired === true),
    negativeSpaceRequired: enabled && configured.negativeSpaceRequired !== false && Boolean(negativeSpacePath || configured.negativeSpaceRequired === true),
    productionQualityRequired: enabled && (configured.productionQualityRequired === true || Boolean(productionQualityGatePath)),
    surfaceMatrixPath,
    negativeSpacePath,
    productionQualityGatePath,
    repairEnabled: enabled && args.objectiveTruthRepairEnabled !== false && configured.repairEnabled !== false,
    repairMaxSurfaces: Math.max(1, Number(args.objectiveTruthRepairMaxSurfaces || configured.repairMaxSurfaces || args.productionQualityRepairMaxSurfaces || 100)),
    source: 'generic_objective_truth_policy'
  };
}

function objectiveTruthTargetFromPolicy(target = {}, policy = {}) {
  if (!policy.enabled) return target;
  return {
    ...target,
    objectiveTruthRequired: policy.required === true,
    objectiveTruth: {
      enabled: true,
      required: policy.required === true,
      surfaceMatrixRequired: policy.surfaceMatrixRequired === true,
      negativeSpaceRequired: policy.negativeSpaceRequired === true,
      productionQualityRequired: policy.productionQualityRequired === true
    },
    supervisorTruthRequired: policy.required === true
  };
}

function readObjectiveTruthInputs({ policy = {}, state = {}, metrics = {}, target = {} } = {}) {
  if (!policy.enabled) return null;
  const surfaceMatrix = policy.surfaceMatrixPath ? readJson(policy.surfaceMatrixPath, null) : null;
  const negativeSpace = policy.negativeSpacePath ? readJson(policy.negativeSpacePath, null) : null;
  const productionQualityGate = policy.productionQualityGatePath ? readJson(policy.productionQualityGatePath, null) : null;
  const objectiveTruth = deriveObjectiveTruth({
    surfaceMatrix,
    negativeSpace,
    productionQualityGate,
    completedSurfaceIds: state.completedSurfaceIds || [],
    metrics,
    target,
    requireSurfaceMatrix: policy.surfaceMatrixRequired === true,
    requireNegativeSpace: policy.negativeSpaceRequired === true,
    requireProductionQuality: policy.productionQualityRequired === true
  });
  objectiveTruth.policy = policy;
  objectiveTruth.sourcePaths = {
    surfaceMatrixPath: policy.surfaceMatrixPath || null,
    negativeSpacePath: policy.negativeSpacePath || null,
    productionQualityGatePath: policy.productionQualityGatePath || null
  };
  state.objectiveTruth = objectiveTruth;
  state.objectiveTruthPolicy = policy;
  return { surfaceMatrix, negativeSpace, productionQualityGate, objectiveTruth };
}

function parseLearningBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function orchestrationLearningPolicyFromArgs({ args = {}, contract = {}, controllerRoot, productionQualityPolicy = {} } = {}) {
  const configured = contract.scope?.orchestrationLearning || contract.metadata?.orchestrationLearning || contract.metadata?.orchestration_learning || {};
  const requested = String(args.orchestrationLearningMode ?? configured.enabled ?? 'auto').trim().toLowerCase();
  const autoEnabled = Boolean(
    configured.enabled === true
    || configured.ledgerPath
    || configured.path
    || args.orchestrationLearningLedgerPath
    || process.env.ORCHESTRATION_LEARNING_LEDGER_PATH
    || productionQualityPolicy.enabled === true
  );
  const enabled = requested === 'auto' ? autoEnabled : parseLearningBool(requested, autoEnabled);
  if (!enabled) return { enabled: false, reason: 'disabled' };
  const ledgerPath = path.resolve(args.orchestrationLearningLedgerPath || configured.ledgerPath || configured.path || path.join(controllerRoot, 'orchestration_learning_ledger.json'));
  return {
    enabled: true,
    ledgerPath,
    limit: Math.max(0, Number(args.orchestrationLearningLimit || configured.limit || configured.retrievalLimit || 3)),
    includeCandidates: parseLearningBool(args.orchestrationLearningIncludeCandidates, configured.includeCandidates !== false),
    languageVersion: configured.languageVersion || 'agent_work_v0.1_fragment',
    promotionPolicy: {
      architecturePatternsRequireProductionQualityGate: true,
      antiPatternsRecordedFromRejectedPatches: true,
      source: 'continuous_real_workload_controller'
    }
  };
}

function ensureOrchestrationLearningLedger(policy = {}, contract = {}) {
  if (!policy.enabled || !policy.ledgerPath) return null;
  const existing = fs.existsSync(policy.ledgerPath)
    ? readLearningLedger(policy.ledgerPath)
    : createLearningLedger({ project: contract.benchmarkId || contract.runId || 'orchestration' });
  writeLearningLedger(policy.ledgerPath, existing);
  return existing;
}

function promoteWaveLearning({ policy = {}, waveRoot, baseContract, waveNumber } = {}) {
  if (!policy.enabled || !policy.ledgerPath || !waveRoot) return null;
  const patchQueue = readJson(path.join(waveRoot, 'orchestrator_run', 'patch_queue.json'), {});
  const productionQualityGate = readJson(path.join(waveRoot, 'production_quality_gate.json'), {});
  const ledger = readLearningLedger(policy.ledgerPath, createLearningLedger({ project: baseContract.benchmarkId || baseContract.runId || 'orchestration' }));
  const { ledger: nextLedger, artifacts } = promoteLearningFromRun({
    ledger,
    patchQueue,
    productionQualityGate,
    runRoot: waveRoot,
    benchmarkId: baseContract.benchmarkId || '',
    runId: `${baseContract.runId || 'continuous'}-wave-${String(waveNumber || 0).padStart(3, '0')}`,
    project: baseContract.benchmarkId || baseContract.runId || ledger.project || 'orchestration'
  });
  writeLearningLedger(policy.ledgerPath, nextLedger);
  return {
    ledgerPath: policy.ledgerPath,
    learnedArtifactCount: artifacts.length,
    trustedArchitecturePatternCount: artifacts.filter((artifact) => artifact.kind === 'architecture_pattern' && artifact.trust === 'trusted').length,
    candidateArchitecturePatternCount: artifacts.filter((artifact) => artifact.kind === 'architecture_pattern' && artifact.trust !== 'trusted').length,
    antiPatternCount: artifacts.filter((artifact) => artifact.kind === 'anti_pattern').length,
    artifactIds: artifacts.map((artifact) => artifact.id)
  };
}

function evaluateScoredContinuousStop({ state, target, remainingExecutableSurfaceCount = 1, nowMs = Date.now(), deadlineMs = null, maxWavesReached = false } = {}) {
  const rawMetrics = aggregateContinuousMetrics(state);
  const thresholdMetrics = aggregateContinuousThresholdMetrics(state, { rejectionReasonFromWaveNumber: state.thresholdRejectionReasonFromWaveNumber || 0 });
  const objectiveTruthInputs = readObjectiveTruthInputs({ policy: state.objectiveTruthPolicy || {}, state, metrics: thresholdMetrics, target });
  const objectiveRemaining = Number(objectiveTruthInputs?.objectiveTruth?.remainingExecutableSurfaceCount || 0);
  const decision = evaluateContinuousStop({
    metrics: thresholdMetrics,
    target,
    remainingExecutableSurfaceCount: Math.max(Number(remainingExecutableSurfaceCount || 0), objectiveRemaining),
    nowMs,
    deadlineMs,
    maxWavesReached,
    objectiveTruth: objectiveTruthInputs?.objectiveTruth || null
  });
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
let resolvedRunInput;
try {
  resolvedRunInput = resolveAgentWorkRunInput(args.contractPath, { outputDir: args.artifactRoot || undefined, artifactRoot: args.artifactRoot || undefined });
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: 'agent_work_run_input_unreadable', message: error?.message || String(error), inputPath: args.contractPath }, null, 2));
  process.exit(2);
}
const baseContract = resolvedRunInput.runContract;
args.contractPath = resolvedRunInput.runContractPath || args.contractPath;

const controllerRoot = args.artifactRoot || baseContract.artifactRoot || path.join(path.dirname(args.contractPath), 'continuous_controller');
const repoPath = args.repoPath || baseContract.repoPath;
fs.mkdirSync(controllerRoot, { recursive: true });
const deploymentManifest = materializeDeploymentManifest({ artifactRoot: controllerRoot, contract: baseContract });
writeJson(path.join(controllerRoot, 'runner_input_resolution.json'), {
  ...resolvedRunInput,
  runContract: undefined,
  compilation: undefined,
  deploymentManifest
});

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
const explicitWaveAgentCount = Number(args.waveAgentCount || 0);
const waveAgentCount = Math.max(1, Number(explicitWaveAgentCount || Math.min(STANDARD_HEAVY_WAVE_AGENT_COUNT, requestedAgentCount)));
const productionQualityPolicy = productionQualityPolicyFromArgs(args, baseContract);
const objectiveTruthPolicy = objectiveTruthPolicyFromArgs({ args, contract: baseContract, controllerRoot, productionQualityPolicy });
const target = objectiveTruthTargetFromPolicy(productionQualityTargetFromPolicy(controllerTargetFromContract(baseContract, args), productionQualityPolicy), objectiveTruthPolicy);
const orchestrationLearningPolicy = orchestrationLearningPolicyFromArgs({ args, contract: baseContract, controllerRoot, productionQualityPolicy });
const initialOrchestrationLearningLedger = ensureOrchestrationLearningLedger(orchestrationLearningPolicy, baseContract);
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
  waveAgentCount,
  waveSchedulingPolicy: {
    requestedAgentCount,
    waveAgentCount,
    standardHeavyWaveAgentCount: STANDARD_HEAVY_WAVE_AGENT_COUNT,
    preservesAggregateScaleClaim: waveAgentCount < requestedAgentCount,
    reason: waveAgentCount < requestedAgentCount
      ? 'physical_wave_width_limited_to_standard_45_worker_codex_throughput_while_preserving_aggregate_scale_proof'
      : 'wave_width_matches_requested_agent_count'
  },
  target,
  productionQualityPolicy,
  objectiveTruthPolicy,
  orchestrationLearningPolicy,
  orchestrationLearning: orchestrationLearningPolicy.enabled ? {
    enabled: true,
    ledgerPath: orchestrationLearningPolicy.ledgerPath,
    initialArchitecturePatternCount: initialOrchestrationLearningLedger?.architecturePatterns?.length || 0,
    initialAntiPatternCount: initialOrchestrationLearningLedger?.antiPatterns?.length || 0,
    initialRepairStrategyCount: initialOrchestrationLearningLedger?.repairStrategies?.length || 0,
    promotions: []
  } : { enabled: false },
  completedSurfaceIds: [],
  completedProductFiles: [],
  surfaceAttempts: {},
  surfaceLastWave: {},
  rejectedReasonCounts: {},
  controllerBudget: { callsStarted: 0, callsCompleted: 0, tokensObserved: 0, usageLimitObserved: false, usageLimitWaveNumbers: [] },
  promptPolicy: {
    fullContextWaveCount: Math.max(0, Number(args.fullContextWaveCount || 0)),
    modeAfterFullContext: args.modeAfterFullContext || 'compact',
    compactBriefMaxChars: Math.max(4000, Number(args.compactBriefMaxChars || 9000)),
    meteringMode: args.meteringMode || 'auto',
    contextGovernor: {
      enabled: args.contextGovernorEnabled !== false,
      hardGate: args.contextGovernorHardGate !== false,
      maxWorkerTokens: Math.max(1, Number(args.contextGovernorMaxWorkerTokens || 3200)),
      targetSavingsMin: Math.max(1, Number(args.contextGovernorTargetSavingsMin || 5)),
      targetSavingsMax: Math.max(1, Number(args.contextGovernorTargetSavingsMax || 10))
    }
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
    waveAgentCount,
    waveSchedulingPolicy: {
      ...(resumeState.waveSchedulingPolicy || {}),
      requestedAgentCount,
      waveAgentCount,
      standardHeavyWaveAgentCount: STANDARD_HEAVY_WAVE_AGENT_COUNT,
      preservesAggregateScaleClaim: waveAgentCount < requestedAgentCount,
      reason: waveAgentCount < requestedAgentCount
        ? 'physical_wave_width_limited_to_standard_45_worker_codex_throughput_while_preserving_aggregate_scale_proof'
        : 'wave_width_matches_requested_agent_count'
    },
    promptPolicy: {
      ...(resumeState.promptPolicy || {}),
      fullContextWaveCount: Math.max(0, Number(args.fullContextWaveCount || resumeState.promptPolicy?.fullContextWaveCount || 0)),
      modeAfterFullContext: args.modeAfterFullContext || resumeState.promptPolicy?.modeAfterFullContext || 'compact',
      compactBriefMaxChars: Math.max(4000, Number(args.compactBriefMaxChars || resumeState.promptPolicy?.compactBriefMaxChars || 9000)),
      meteringMode: args.meteringMode || resumeState.promptPolicy?.meteringMode || 'auto',
      contextGovernor: {
        ...(resumeState.promptPolicy?.contextGovernor || {}),
        enabled: args.contextGovernorEnabled !== false,
        hardGate: args.contextGovernorHardGate !== false,
        maxWorkerTokens: Math.max(1, Number(args.contextGovernorMaxWorkerTokens || resumeState.promptPolicy?.contextGovernor?.maxWorkerTokens || 3200)),
        targetSavingsMin: Math.max(1, Number(args.contextGovernorTargetSavingsMin || resumeState.promptPolicy?.contextGovernor?.targetSavingsMin || 5)),
        targetSavingsMax: Math.max(1, Number(args.contextGovernorTargetSavingsMax || resumeState.promptPolicy?.contextGovernor?.targetSavingsMax || 10))
      }
    },
    productionQualityPolicy,
    objectiveTruthPolicy,
    orchestrationLearningPolicy,
    orchestrationLearning: {
      ...(resumeState.orchestrationLearning || (orchestrationLearningPolicy.enabled ? { enabled: true, ledgerPath: orchestrationLearningPolicy.ledgerPath, promotions: [] } : { enabled: false })),
      enabled: orchestrationLearningPolicy.enabled === true,
      ledgerPath: orchestrationLearningPolicy.ledgerPath || resumeState.orchestrationLearning?.ledgerPath || null,
      promotions: Array.isArray(resumeState.orchestrationLearning?.promotions) ? [...resumeState.orchestrationLearning.promotions] : []
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
    waveAgentCount,
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
    meteringMode: args.meteringMode || 'auto',
    tokenSafetyMultiplier: args.tokenSafetyMultiplier,
    minBudgetedWaveAgents: args.minBudgetedWaveAgents,
    bundleSize: args.bundleSize,
    bundleMode: args.bundleMode,
    tokenEfficiencyPolicy: tokenEfficiencyPolicyFromArgs(args),
    objectiveTruthPolicy,
    orchestrationLearningPolicy
  }
});
writeJson(path.join(controllerRoot, 'continuous_controller_state.json'), state);
if (args.checkpointTopLevelArtifacts && !args.dryRun) {
  const initialMetrics = aggregateContinuousMetrics(state);
  const initialThresholdMetrics = aggregateContinuousThresholdMetrics(state, { rejectionReasonFromWaveNumber: state.thresholdRejectionReasonFromWaveNumber || 0 });
  const initialThresholdEvaluation = evaluateBenchmarkThresholds({
    benchmarkTier: baseContract.benchmarkTier || 'tier2_functional',
    metrics: thresholdMetricSubset(initialThresholdMetrics)
  });
  const initialTokenEfficiencyPolicy = tokenEfficiencyPolicyFromArgs(args);
  const initialTokenEfficiencyEvaluation = evaluateTokenEfficiency({ metrics: initialMetrics.tokenEfficiency || {}, policy: initialTokenEfficiencyPolicy });
  const initialCheckpointTiming = attemptTimingSummary({ state, initialWaveSummaryCount, startedAtMs, finishedAtMs: Date.now() });
  writeRunningTopLevelCheckpointArtifacts({
    controllerRoot,
    baseContract,
    state,
    requestedAgentCount,
    metrics: initialMetrics,
    thresholdMetrics: initialThresholdMetrics,
    thresholdEvaluation: initialThresholdEvaluation,
    productionQualityPolicy,
    productionQualityEvaluation: evaluateProductionQualityGate({ metrics: initialThresholdMetrics, policy: productionQualityPolicy }),
    orchestrationLearningPolicy,
    tokenEfficiencyPolicy: initialTokenEfficiencyPolicy,
    tokenEfficiencyEvaluation: initialTokenEfficiencyEvaluation,
    tokenEfficiencyDebtRecovery: { sampleReady: false, ok: null, allowContinue: true, reason: 'launch_checkpoint_before_next_wave' },
    controllerDecision: { action: 'continue', thresholdPass: false, reason: 'controller_started_or_resumed', nextAction: 'Controller is running and will refresh top-level artifacts after each completed wave.' },
    timing: initialCheckpointTiming
  });
}

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
  const promptMode = promptModeForContinuousWave({
    priorWaveCount: priorWaveNumbers.length,
    launchedWaveIndex,
    fullContextWaveCount: Math.max(0, Number(args.fullContextWaveCount || 0)),
    modeAfterFullContext: args.modeAfterFullContext || 'compact'
  });
  let meteringPlan = resolveLlmMeteringAdapter({
    env: controllerMeteringEnv(args),
    requestedAgentCount,
    selectedLogicalSurfaceCount: waveAgentCount,
    requestedBundleSize: Math.max(1, Number(args.bundleSize || 1)),
    waveMaxAttemptsPerTask: Math.max(1, Number(args.waveMaxAttemptsPerTask || 2)),
    promptMode,
    compactBriefMaxChars: Math.max(4000, Number(args.compactBriefMaxChars || 9000)),
    controllerGlobalTokenLimit: args.controllerGlobalTokenLimit,
    inheritedWaveTokenLimit: Number(process.env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT || 0),
    tokenReservationEstimate: Number(process.env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE || 0),
    maxActiveCodexCalls: Number(process.env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS || 8)
  });
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

  let forcedObjectiveTruthSurfaces = null;
  if (preStop.decision.reason === 'objective_truth_pending' && objectiveTruthPolicy.enabled === true && objectiveTruthPolicy.repairEnabled === true) {
    const qualityGate = objectiveTruthPolicy.productionQualityGatePath ? readJson(objectiveTruthPolicy.productionQualityGatePath, null) : null;
    forcedObjectiveTruthSurfaces = createObjectiveTruthRepairSurfaces({
      objectiveTruth: preStop.decision.objectiveTruth,
      qualityGate,
      state: { ...state, thresholdMetrics: preStop.thresholdMetrics, metrics: preStop.rawMetrics },
      waveNumber,
      maxSurfaces: Math.max(1, Number(objectiveTruthPolicy.repairMaxSurfaces || args.objectiveTruthRepairMaxSurfaces || 100))
    });
    state.objectiveTruthRepair ||= { enabled: true, attempts: [] };
    state.objectiveTruthRepair.lastPlannedAt = new Date().toISOString();
    state.objectiveTruthRepair.nextRepairSurfaceCount = forcedObjectiveTruthSurfaces.length;
    state.objectiveTruthRepair.nextRepairSurfaceIds = forcedObjectiveTruthSurfaces.map((surface) => surface.id).slice(0, 200);
    if (!forcedObjectiveTruthSurfaces.length) {
      finalDecision = {
        action: 'stop_blocked',
        thresholdPass: false,
        reason: preStop.decision.objectiveTruth?.blocker?.blockerKind || 'objective_truth_repair_targets_missing',
        objectiveTruth: preStop.decision.objectiveTruth,
        nextAction: 'Objective truth is red, but no executable generic repair surfaces could be derived. Add product target files to the surface matrix/negative-space queue or write a precise blocker.'
      };
      state.metrics = preStop.rawMetrics;
      state.thresholdMetrics = preStop.thresholdMetrics;
      state.lastDecision = finalDecision;
      break;
    }
  }

  let forcedQualityRepairSurfaces = null;
  if (!forcedObjectiveTruthSurfaces && preStop.decision.reason === 'production_architecture_quality_gate_pending' && productionQualityPolicy.enabled === true && args.productionQualityRepairEnabled !== false) {
    const repairRefresh = refreshProductionQualityGateForRepair({
      controllerRoot,
      repoPath,
      state,
      productionQualityPolicy,
      args,
      target,
      initialWaveSummaryCount,
      startedAtMs
    });
    if (repairRefresh?.evaluation?.ok === true) {
      const postGateStop = evaluateScoredContinuousStop({
        state,
        target,
        remainingExecutableSurfaceCount: 1,
        nowMs: Date.now(),
        deadlineMs,
        maxWavesReached: false
      });
      finalDecision = postGateStop.decision;
      state.metrics = postGateStop.rawMetrics;
      state.thresholdMetrics = postGateStop.thresholdMetrics;
      state.lastDecision = finalDecision;
      break;
    }
    if (repairRefresh && repairRefresh.repairSurfaces.length > 0) {
      forcedQualityRepairSurfaces = repairRefresh.repairSurfaces;
      state.productionQualityRepair ||= { enabled: true, attempts: [] };
      state.productionQualityRepair.mode = 'repair_wave_next';
      state.productionQualityRepair.nextRepairSurfaceCount = forcedQualityRepairSurfaces.length;
      state.productionQualityRepair.nextRepairSurfaceIds = forcedQualityRepairSurfaces.map((surface) => surface.id).slice(0, 200);
    } else if (repairRefresh && repairRefresh.evaluation?.ok !== true) {
      const metrics = aggregateContinuousMetrics(state);
      finalDecision = {
        action: 'stop_blocked',
        thresholdPass: false,
        reason: 'production_quality_repair_targets_missing',
        productionQualityEvaluation: repairRefresh.evaluation,
        nextAction: 'Quality gate is red after the real-run core objective, but the controller could not derive product repair surfaces from the gate artifact. Improve production-quality diagnostics before relaunching.'
      };
      state.metrics = metrics;
      state.thresholdMetrics = repairRefresh.thresholdMetrics || aggregateContinuousThresholdMetrics(state, { rejectionReasonFromWaveNumber: state.thresholdRejectionReasonFromWaveNumber || 0 });
      state.lastDecision = finalDecision;
      break;
    }
  }

  const forcedControllerRepairSurfaces = forcedObjectiveTruthSurfaces || forcedQualityRepairSurfaces;
  const forcedControllerRepairKind = forcedObjectiveTruthSurfaces ? 'objective_truth_repair' : (forcedQualityRepairSurfaces ? 'production_quality_repair' : null);
  const requestedSurfaceCount = Math.max(
    1,
    meteringPlan.mode === 'oauth_message_metered'
      ? waveAgentCount
      : waveAgentCount * Math.max(1, Number(args.bundleSize || 1))
  );
  let expansionSelectionPlan = planObjectiveExpansionSurfaceSelection({
    surfaces: allSurfaces,
    state,
    requestedAgentCount: requestedSurfaceCount,
    maxAttemptsPerSurface: Math.max(1, Number(args.maxAttemptsPerSurface || 3)),
    activeMaxExpansionCycles,
    hardMaxExpansionCycles,
    expansionBatchCycles,
    includeObjectiveExpansion: true
  });
  activeMaxExpansionCycles = expansionSelectionPlan.activeMaxExpansionCycles;
  let baseInventory = expansionSelectionPlan.inventory;
  let inventory = baseInventory;
  let selection = expansionSelectionPlan.selection;

  if (forcedControllerRepairSurfaces) {
    inventory = {
      surfaces: forcedControllerRepairSurfaces,
      baseSurfaceCount: forcedControllerRepairSurfaces.length,
      expansionSurfaceCount: baseInventory.expansionSurfaceCount,
      totalSurfaceCount: forcedControllerRepairSurfaces.length + baseInventory.totalSurfaceCount,
      backfillBaseSurfaceCount: baseInventory.baseSurfaceCount,
      backfillExpansionSurfaceCount: baseInventory.expansionSurfaceCount,
      backfillTotalSurfaceCount: baseInventory.totalSurfaceCount,
      productionQualityRepair: forcedControllerRepairKind === 'production_quality_repair',
      objectiveTruthRepair: forcedControllerRepairKind === 'objective_truth_repair'
    };
    selection = {
      ...buildCollisionAwareRepairSelection({
        repairSurfaces: forcedControllerRepairSurfaces,
        backfillSurfaces: baseInventory.surfaces,
        state,
        requestedSurfaceCount,
        maxAttemptsPerSurface: Math.max(1, Number(args.maxAttemptsPerSurface || 3))
      }),
      productionQualityRepair: forcedControllerRepairKind === 'production_quality_repair',
      objectiveTruthRepair: forcedControllerRepairKind === 'objective_truth_repair'
    };
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
    lastRemainingExecutableSurfaceCount: selection.remainingExecutableSurfaceCount,
    uniquePrimaryProductFileCount: expansionSelectionPlan.uniquePrimaryProductFileCount,
    desiredSelectionCount: expansionSelectionPlan.desiredSelectionCount,
    selectionShortfall: forcedControllerRepairSurfaces ? 0 : expansionSelectionPlan.selectionShortfall,
    expandedForUnderfilledWave: forcedControllerRepairSurfaces ? false : expansionSelectionPlan.expandedForUnderfilledWave,
    repairBackfill: selection.repairBackfill || { enabled: false },
    productionQualityRepairActive: forcedControllerRepairKind === 'production_quality_repair',
    objectiveTruthRepairActive: forcedControllerRepairKind === 'objective_truth_repair'
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

  meteringPlan = resolveLlmMeteringAdapter({
    env: controllerMeteringEnv(args),
    requestedAgentCount,
    selectedLogicalSurfaceCount: selection.selected.length,
    requestedBundleSize: Math.max(1, Number(args.bundleSize || 1)),
    waveMaxAttemptsPerTask: Math.max(1, Number(args.waveMaxAttemptsPerTask || 2)),
    promptMode,
    compactBriefMaxChars: Math.max(4000, Number(args.compactBriefMaxChars || 9000)),
    controllerGlobalTokenLimit: args.controllerGlobalTokenLimit,
    inheritedWaveTokenLimit: Number(process.env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT || 0),
    tokenReservationEstimate: Number(process.env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE || 0),
    maxActiveCodexCalls: Number(process.env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS || 8)
  });
  let bundlePlan = bundleSelectedSurfaces({
    selected: selection.selected,
    bundleSize: Math.max(1, Number(meteringPlan.effectiveBundleSize || args.bundleSize || 1)),
    waveNumber,
    bundleMode: args.bundleMode || 'coherent_product_slice'
  });
  if (forcedControllerRepairKind === 'objective_truth_repair') {
    const preCollisionSourceSurfaceCount = bundlePlan.sourceSurfaceIds.length;
    const collisionSafeBundlePlan = avoidSameWaveBundleFileCollisions(bundlePlan, { enabled: true });
    if (collisionSafeBundlePlan.sameWaveFileCollisionAvoidance?.droppedBundleCount > 0) {
      bundlePlan = collisionSafeBundlePlan;
      selection = {
        ...selection,
        selected: selection.selected.filter((surface) => bundlePlan.sourceSurfaceIds.includes(surface.id || surface.surfaceId || surface.label)),
        selectedSurfaceIds: bundlePlan.sourceSurfaceIds,
        selectedProductFiles: bundlePlan.selectedProductFiles,
        remainingExecutableSurfaceCount: selection.remainingExecutableSurfaceCount + Math.max(0, preCollisionSourceSurfaceCount - bundlePlan.sourceSurfaceIds.length)
      };
    } else {
      bundlePlan = collisionSafeBundlePlan;
    }
  }
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
  adaptiveBudgetPlan.meteringAdapter = meteringPlan;
  state.lastAdaptiveBudgetPlan = adaptiveBudgetPlan;
  if (adaptiveBudgetPlan.insufficientSchedulableAgents) {
    const metrics = aggregateContinuousMetrics(state);
    finalDecision = {
      action: 'stop_blocked',
      thresholdPass: false,
      reason: 'insufficient_schedulable_shards_for_min_wave_agents',
      adaptiveBudgetPlan,
      requestedAgentCount,
      waveAgentCount,
      selectedLogicalSurfaceCount: selectedSurfacesForWave.length,
      minWaveAgentCount: adaptiveBudgetPlan.minWaveAgentCount,
      repairBackfill: selection.repairBackfill || null,
      nextAction: 'Repair scheduling/admission so the requested scale has enough collision-safe runnable shards before launching another spending wave.'
    };
    state.metrics = metrics;
    state.lastDecision = finalDecision;
    break;
  }
  const adaptiveTokenBudgetEnabled = args.adaptiveTokenBudget && meteringPlan.adaptiveTokenBudgetEnabled !== false;
  if (adaptiveTokenBudgetEnabled && adaptiveBudgetPlan.insufficientForMinimumWave) {
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
  if (adaptiveTokenBudgetEnabled && adaptiveBudgetPlan.selectedCountReduced) {
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
  meteringPlan = {
    ...meteringPlan,
    actualPhysicalWorkerCount: selectedSurfacesForWave.length,
    actualLogicalSurfaceCount: bundlePlan.sourceSurfaceIds.length,
    adaptiveTokenBudgetEnabled
  };
  adaptiveBudgetPlan.meteringAdapter = meteringPlan;
  state.lastMeteringPlan = meteringPlan;

  const previousWaveFactpackPath = state.lastWaveFactpackPath || (state.waveSummaries || []).slice(-1)[0]?.waveFactpackPath || null;
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
  waveContract.scope.contextGovernor = {
    ...(waveContract.scope.contextGovernor || {}),
    enabled: args.contextGovernorEnabled !== false,
    hardGate: args.contextGovernorHardGate !== false,
    maxWorkerTokens: Math.max(1, Number(args.contextGovernorMaxWorkerTokens || 3200)),
    targetSavingsMin: Math.max(1, Number(args.contextGovernorTargetSavingsMin || 5)),
    targetSavingsMax: Math.max(1, Number(args.contextGovernorTargetSavingsMax || 10)),
    workerPromptMode: promptMode,
    previousWaveFactpackPath
  };
  waveContract.scope.creativeProductWork ||= {};
  waveContract.scope.creativeProductWork.promptMode = promptMode;
  waveContract.scope.creativeProductWork.compactBriefMaxChars = promptMode === 'compact' ? Math.max(4000, Number(args.compactBriefMaxChars || 9000)) : null;
  waveContract.scope.orchestrationLearning = orchestrationLearningPolicy.enabled ? {
    ...(baseContract.scope?.orchestrationLearning || {}),
    enabled: true,
    ledgerPath: orchestrationLearningPolicy.ledgerPath,
    limit: orchestrationLearningPolicy.limit,
    includeCandidates: orchestrationLearningPolicy.includeCandidates,
    languageVersion: orchestrationLearningPolicy.languageVersion,
    promotionPolicy: orchestrationLearningPolicy.promotionPolicy
  } : { enabled: false };
  waveContract.scope.continuousPromptPolicy = {
    promptMode,
    fullContextWaveCount: Math.max(0, Number(args.fullContextWaveCount || 0)),
    modeAfterFullContext: args.modeAfterFullContext || 'compact',
    compactBriefMaxChars: Math.max(4000, Number(args.compactBriefMaxChars || 9000)),
    contextGovernor: waveContract.scope.contextGovernor,
    orchestrationLearning: waveContract.scope.orchestrationLearning,
    waveSchedulingPolicy: state.waveSchedulingPolicy,
    meteringAdapter: meteringPlan,
    adaptiveBudgetPlan,
    bundlePlan: {
      enabled: bundlePlan.enabled,
      bundleMode: bundlePlan.bundleMode,
      bundleSize: bundlePlan.bundleSize,
      bundleCount: selectedSurfacesForWave.length,
      sourceSurfaceCount: bundlePlan.sourceSurfaceIds.length,
      bundleMap: bundlePlan.bundleMap,
      sameWaveFileCollisionAvoidance: bundlePlan.sameWaveFileCollisionAvoidance || { enabled: false }
    },
    productionQualityRepair: forcedControllerRepairKind === 'production_quality_repair' ? {
      active: true,
      repairSurfaceCount: forcedControllerRepairSurfaces.length,
      source: 'production_quality_gate'
    } : { active: false },
    objectiveTruthRepair: forcedControllerRepairKind === 'objective_truth_repair' ? {
      active: true,
      repairSurfaceCount: forcedControllerRepairSurfaces.length,
      source: 'objective_truth'
    } : { active: false }
  };
  const waveRoot = waveContract.artifactRoot;
  writeJson(path.join(waveRoot, 'run_contract.json'), waveContract);
  writeJson(path.join(waveRoot, 'selected_surfaces.json'), {
    generatedAt: new Date().toISOString(),
    waveNumber,
    promptMode,
    adaptiveBudgetPlan,
    meteringAdapter: meteringPlan,
    waveSchedulingPolicy: state.waveSchedulingPolicy,
    contextGovernor: waveContract.scope.contextGovernor,
    orchestrationLearning: waveContract.scope.orchestrationLearning,
    selectedSurfaceIds: bundlePlan.sourceSurfaceIds,
    attemptedSurfaceIds: attemptedSurfaceIdsForWave,
    selectedProductFiles: bundlePlan.selectedProductFiles,
    bundlePlan: {
      enabled: bundlePlan.enabled,
      bundleMode: bundlePlan.bundleMode,
      bundleSize: bundlePlan.bundleSize,
      bundleCount: selectedSurfacesForWave.length,
      sourceSurfaceCount: bundlePlan.sourceSurfaceIds.length,
      bundleMap: bundlePlan.bundleMap,
      sameWaveFileCollisionAvoidance: bundlePlan.sameWaveFileCollisionAvoidance || { enabled: false }
    },
    productionQualityRepair: forcedControllerRepairKind === 'production_quality_repair' ? {
      active: true,
      repairSurfaceCount: forcedControllerRepairSurfaces.length,
      selectedRepairSurfaceCount: selectedSurfacesForWave.length,
      repairBackfill: selection.repairBackfill || null,
      source: 'production_quality_gate'
    } : { active: false },
    objectiveTruthRepair: forcedControllerRepairKind === 'objective_truth_repair' ? {
      active: true,
      repairSurfaceCount: forcedControllerRepairSurfaces.length,
      selectedRepairSurfaceCount: selectedSurfacesForWave.length,
      repairBackfill: selection.repairBackfill || null,
      source: 'objective_truth'
    } : { active: false },
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
      meteringAdapter: meteringPlan,
      waveSchedulingPolicy: state.waveSchedulingPolicy,
      contextGovernor: waveContract.scope.contextGovernor,
      orchestrationLearning: waveContract.scope.orchestrationLearning,
      selectedSurfaceIds: bundlePlan.sourceSurfaceIds,
      attemptedSurfaceIds: attemptedSurfaceIdsForWave,
      selectedProductFiles: bundlePlan.selectedProductFiles,
      bundlePlan: {
        enabled: bundlePlan.enabled,
        bundleMode: bundlePlan.bundleMode,
        bundleSize: bundlePlan.bundleSize,
        bundleCount: selectedSurfacesForWave.length,
        sourceSurfaceCount: bundlePlan.sourceSurfaceIds.length,
        bundleMap: bundlePlan.bundleMap,
        sameWaveFileCollisionAvoidance: bundlePlan.sameWaveFileCollisionAvoidance || { enabled: false }
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
    env: finiteRunnerEnv({ selectedCount: selectedSurfacesForWave.length, args, promptMode, controllerBudget: state.controllerBudget || {}, budgetPlan: adaptiveBudgetPlan, meteringPlan }),
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
    bundleMap: bundlePlan.bundleMap,
    sameWaveFileCollisionAvoidance: bundlePlan.sameWaveFileCollisionAvoidance || { enabled: false }
  };
  waveSummary.meteringAdapter = meteringPlan;
  waveSummary.promptMode = promptMode;
  waveSummary.runnerExitCode = run.status;
  waveSummary.runnerSignal = run.signal || null;
  const learningPromotion = promoteWaveLearning({ policy: orchestrationLearningPolicy, waveRoot, baseContract, waveNumber });
  if (learningPromotion) {
    waveSummary.orchestrationLearningPromotion = learningPromotion;
    state.orchestrationLearning ||= { enabled: true, ledgerPath: orchestrationLearningPolicy.ledgerPath, promotions: [] };
    state.orchestrationLearning.enabled = true;
    state.orchestrationLearning.ledgerPath = orchestrationLearningPolicy.ledgerPath;
    state.orchestrationLearning.lastPromotion = learningPromotion;
    state.orchestrationLearning.promotions = [...(state.orchestrationLearning.promotions || []), { waveNumber, ...learningPromotion }].slice(-50);
  }
  state = updateContinuousStateFromWave({ state, waveSummary, selectedSurfaceIds: attemptedSurfaceIdsForWave, waveNumber });
  if (waveSummary.waveFactpackPath) state.lastWaveFactpackPath = waveSummary.waveFactpackPath;
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
  if (args.checkpointTopLevelArtifacts && finalDecision.action === 'continue') {
    const checkpointTiming = attemptTimingSummary({ state, initialWaveSummaryCount, startedAtMs, finishedAtMs: Date.now() });
    const checkpointThresholdEvaluation = evaluateBenchmarkThresholds({
      benchmarkTier: baseContract.benchmarkTier || 'tier2_functional',
      metrics: thresholdMetricSubset(thresholdMetrics)
    });
    const checkpointProductionQualityEvaluation = evaluateProductionQualityGate({ metrics: thresholdMetrics, policy: productionQualityPolicy });
    writeRunningTopLevelCheckpointArtifacts({
      controllerRoot,
      baseContract,
      state,
      requestedAgentCount,
      metrics,
      thresholdMetrics,
      thresholdEvaluation: checkpointThresholdEvaluation,
      productionQualityPolicy,
      productionQualityEvaluation: checkpointProductionQualityEvaluation,
      orchestrationLearningPolicy,
      tokenEfficiencyPolicy,
      tokenEfficiencyEvaluation: tokenEfficiency,
      tokenEfficiencyDebtRecovery,
      controllerDecision: finalDecision,
      timing: checkpointTiming
    });
  }
  if (finalDecision.action !== 'continue') break;
}

const finalStatePath = path.join(controllerRoot, 'continuous_controller_state.json');
const productionQualityGateRun = runFinalProductionQualityGate({
  controllerRoot,
  repoPath,
  statePath: finalStatePath,
  policy: productionQualityPolicy,
  args
});
if (productionQualityGateRun) state.productionQualityGateRun = productionQualityGateRun;
const recordedProductionQualityGate = readJson(path.join(controllerRoot, 'production_quality_gate.json'), null);
if (recordedProductionQualityGate && typeof recordedProductionQualityGate === 'object') {
  state.productionQualityGate = recordedProductionQualityGate.metrics || recordedProductionQualityGate;
}
const metrics = aggregateContinuousMetrics(state);
const thresholdMetrics = aggregateContinuousThresholdMetrics(state, { rejectionReasonFromWaveNumber: state.thresholdRejectionReasonFromWaveNumber || 0 });
const finalScaleProof = continuousScaleProofForArtifacts({ metrics, requestedAgentCount, state });
const finalTiming = attemptTimingSummary({ state, initialWaveSummaryCount, startedAtMs, finishedAtMs: Date.now() });
const thresholdEvaluation = evaluateBenchmarkThresholds({
  benchmarkTier: baseContract.benchmarkTier || 'tier2_functional',
  metrics: thresholdMetricSubset(thresholdMetrics)
});
const finalProductionQualityEvaluation = evaluateProductionQualityGate({ metrics: thresholdMetrics, policy: productionQualityPolicy });
const finalObjectiveTruthInputs = readObjectiveTruthInputs({
  policy: state.objectiveTruthPolicy || objectiveTruthPolicy || {},
  state,
  metrics: thresholdMetrics,
  target
});
const finalUnmetGates = {
  scale: {
    requestedAgentCount,
    aggregateScaleProofReady: finalScaleProof.aggregateScaleProofReady === true,
    uniqueWorkerScaleProofReady: finalScaleProof.uniqueWorkerScaleProofReady === true,
    scaleClaimKind: finalScaleProof.claimKind,
    minUniqueAgents: Number(target.minUniqueAgents || 0),
    uniqueAgentCount: Number(thresholdMetrics.uniqueAgentCount || 0),
    ok: Number(thresholdMetrics.uniqueAgentCount || 0) >= Number(target.minUniqueAgents || 0)
  },
  productBreadth: {
    minChangedProductFiles: Number(target.minChangedProductFiles || 0),
    changedProductFileCount: Number(thresholdMetrics.changedProductFileCount || 0),
    ok: Number(thresholdMetrics.changedProductFileCount || 0) >= Number(target.minChangedProductFiles || 0)
  },
  objectiveTruth: finalObjectiveTruthInputs?.objectiveTruth ? {
    required: true,
    supervisorStatus: finalObjectiveTruthInputs.objectiveTruth.supervisorStatus || null,
    remainingExecutableSurfaceCount: Number(finalObjectiveTruthInputs.objectiveTruth.remainingExecutableSurfaceCount || 0),
    negativeSpaceOpenCount: Number(finalObjectiveTruthInputs.objectiveTruth.negativeSpace?.openCount || 0),
    productionQualityOk: finalObjectiveTruthInputs.objectiveTruth.productionQuality?.ok ?? null,
    ok: finalObjectiveTruthInputs.objectiveTruth.supervisorStatus === 'green'
  } : { required: false, ok: true },
  productionQuality: {
    required: productionQualityPolicy.enabled === true,
    ok: finalProductionQualityEvaluation.ok === true,
    failures: finalProductionQualityEvaluation.failures || []
  },
  thresholdFailures: thresholdEvaluation.failures || [],
  terminalReason: finalDecision?.reason || null
};
if (finalDecision?.thresholdPass === true && thresholdEvaluation.ok !== true) {
  finalDecision = {
    action: 'stop_blocked',
    thresholdPass: false,
    reason: 'canonical_threshold_evaluation_failed',
    priorControllerDecision: finalDecision,
    thresholdFailures: thresholdEvaluation.failures || [],
    nextAction: 'Repair controller stop criteria so it cannot declare green unless the canonical benchmark threshold evaluator is also green.'
  };
}
if (finalDecision?.thresholdPass === true && finalProductionQualityEvaluation.ok !== true) {
  finalDecision = {
    action: 'stop_blocked',
    thresholdPass: false,
    reason: 'production_architecture_quality_gate_failed',
    priorControllerDecision: finalDecision,
    productionQualityFailures: finalProductionQualityEvaluation.failures || [],
    nextAction: 'Run the integration hardening phase: fix test regressions, route collisions, duplicate LOC, and architecture violations before claiming production-quality output.'
  };
}
const finalTokenEfficiencyPolicy = tokenEfficiencyPolicyFromArgs(args);
const finalTokenEfficiencyEvaluation = evaluateTokenEfficiency({ metrics: metrics.tokenEfficiency || {}, policy: finalTokenEfficiencyPolicy });
const finalTokenEfficiencyDebtRecovery = evaluateTokenEfficiencyDebtRecovery({
  aggregateMetrics: metrics,
  state,
  policy: finalTokenEfficiencyPolicy,
  initialWaveSummaryCount,
  target
});
const thresholdPass = finalDecision?.thresholdPass === true && thresholdEvaluation.ok === true && finalProductionQualityEvaluation.ok === true;
const pausedBudgetBackoff = finalDecision?.action === 'pause_backoff';
const blocker = thresholdPass ? null : {
  blocker: pausedBudgetBackoff
    ? 'Continuous real-workload controller paused before wasting more Codex calls.'
    : 'Continuous real-workload controller did not reach the declared threshold pass.',
  blockerKind: finalDecision?.reason || 'continuous_threshold_not_met',
  nextAction: pausedBudgetBackoff
    ? (finalDecision.nextAction || 'Resume after the recorded backoff window.')
    : finalDecision?.reason === 'production_architecture_quality_gate_failed'
    ? 'Run the integration hardening phase: fix test regressions, route collisions, duplicate LOC, and architecture violations before claiming production-quality output.'
    : finalDecision?.reason === 'insufficient_schedulable_shards_for_min_wave_agents'
    ? 'Repair scheduling/admission so the requested scale has enough collision-safe runnable shards before launching another spending wave.'
    : finalDecision?.reason === 'objective_expansion_missing_executable_work'
    ? 'Add objective-expansion work generation or expand the surface inventory, then resume the controller.'
    : 'Inspect unmetGates in this blocker, repair scheduling/quality/objective-truth gaps, then resume or rerun the controller.',
  resumeAfter: pausedBudgetBackoff ? finalDecision.resumeAfter || null : null,
  pauseKind: pausedBudgetBackoff ? finalDecision.pauseKind || 'budget_backoff' : null,
  unmetGates: { ...finalUnmetGates, terminalReason: finalDecision?.reason || null },
  thresholdFailures: thresholdEvaluation.failures || [],
  productionQualityFailures: finalProductionQualityEvaluation.failures || []
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
state.scaleProof = finalScaleProof;
state.thresholdScoringPolicy = continuousScoringPolicy();
state.productionQualityPolicy = productionQualityPolicy;
state.productionQualityEvaluation = finalProductionQualityEvaluation;
state.orchestrationLearningPolicy = orchestrationLearningPolicy;
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
  ...scaleProofArtifactFields(finalScaleProof),
  thresholdScoringPolicy: continuousScoringPolicy(),
  productionQualityPolicy,
  productionQualityEvaluation: finalProductionQualityEvaluation,
  productionQualityGate: state.productionQualityGate || null,
  productionQualityGateRun: state.productionQualityGateRun || null,
  orchestrationLearningPolicy,
  orchestrationLearning: state.orchestrationLearning || null,
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
  ...scaleProofArtifactFields(finalScaleProof),
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
  productionQualityPolicy,
  productionQualityEvaluation: finalProductionQualityEvaluation,
  productionQualityGate: state.productionQualityGate || null,
  productionQualityGateRun: state.productionQualityGateRun || null,
  orchestrationLearningPolicy,
  orchestrationLearning: state.orchestrationLearning || null,
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
