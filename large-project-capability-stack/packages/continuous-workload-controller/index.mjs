import fs from 'node:fs';
import path from 'node:path';

export function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || '').trim()).filter(Boolean))];
}

export function normalizeContinuousPromptMode(value = '') {
  const mode = String(value || '').trim().toLowerCase().replace(/-/g, '_');
  if (['compact', 'compact_surface_brief', 'delta', 'delta_compact'].includes(mode)) return 'compact';
  if (['full', 'full_context', 'legacy'].includes(mode)) return 'full_context';
  return 'full_context';
}

export function promptModeForContinuousWave({
  priorWaveCount = 0,
  launchedWaveIndex = 0,
  fullContextWaveCount = 1,
  modeAfterFullContext = 'compact'
} = {}) {
  const ordinal = Math.max(1, Number(priorWaveCount || 0) + Number(launchedWaveIndex || 0) + 1);
  const fullContextCount = Math.max(0, Number(fullContextWaveCount ?? 1));
  if (ordinal <= fullContextCount) return 'full_context';
  return normalizeContinuousPromptMode(modeAfterFullContext || 'compact');
}

export function planCreativeBundleRuntime({
  bundle = {},
  baseIterationTimeoutMs = 420_000,
  baseTokenReservationEstimate = 0,
  sourceSurfaceCount = null,
  productTargetCount = null,
  minProductTargetsToModify = null,
  maxComplexityFactor = 4,
  maxIterationTimeoutMs = 1_800_000,
  maxTokenReservationEstimate = 0
} = {}) {
  const enabled = bundle?.enabled === true;
  const sourceCount = Math.max(1, Number(sourceSurfaceCount
    ?? bundle?.sourceSurfaceCount
    ?? (Array.isArray(bundle?.sourceSurfaceIds) ? bundle.sourceSurfaceIds.length : 0)
    ?? 1));
  const targetCount = Math.max(1, Number(productTargetCount
    ?? bundle?.productTargetCount
    ?? (Array.isArray(bundle?.bundledProductFiles) ? bundle.bundledProductFiles.length : 0)
    ?? 1));
  const minTargets = Math.max(1, Number(minProductTargetsToModify ?? bundle?.minProductTargetsToModify ?? 1));
  const rawFactor = enabled ? Math.max(sourceCount, minTargets, Math.ceil(targetCount / 2)) : 1;
  const complexityFactor = Math.max(1, Math.min(Math.max(1, Number(maxComplexityFactor || 4)), rawFactor));
  const baseTimeout = Math.max(30_000, Number(baseIterationTimeoutMs || 420_000));
  const timeoutCeiling = Math.max(baseTimeout, Number(maxIterationTimeoutMs || 1_800_000));
  const iterationTimeoutMs = Math.min(timeoutCeiling, Math.ceil(baseTimeout * complexityFactor));
  const baseReservation = Math.max(0, Number(baseTokenReservationEstimate || 0));
  const reservationCeiling = Math.max(0, Number(maxTokenReservationEstimate || 0));
  const tokenReservationEstimate = baseReservation
    ? Math.ceil(reservationCeiling ? Math.min(reservationCeiling, baseReservation * complexityFactor) : baseReservation * complexityFactor)
    : 0;
  return {
    enabled,
    sourceSurfaceCount: sourceCount,
    productTargetCount: targetCount,
    minProductTargetsToModify: minTargets,
    complexityFactor,
    baseIterationTimeoutMs: baseTimeout,
    iterationTimeoutMs,
    baseTokenReservationEstimate: baseReservation,
    tokenReservationEstimate
  };
}

export function isUsageLimitReason(reason = '') {
  return /(?:^|[_ -])codex[_ -]usage[_ -]limit(?:[_ -]|$)|\busage[_ -]?limit[_ -]?(?:observed|reached|exceeded|hit)\b|\b(?:reached|exceeded|hit)\s+(?:your\s+)?usage\s+limit\b/i.test(String(reason || ''));
}

export function isBudgetLimitReason(reason = '') {
  return /(?:creative|controller)_global_(?:reserved_)?token_limit_reached|creative_global_call_limit_reached/i.test(String(reason || ''));
}

export function isBudgetBackoffReason(reason = '') {
  return isUsageLimitReason(reason) || isBudgetLimitReason(reason);
}

export function summarizeWaveBudgetLedger(ledger = {}) {
  const events = Array.isArray(ledger?.events) ? ledger.events : [];
  const usageLimitEvents = events.filter((event) => event?.usageLimit === true || isUsageLimitReason(event?.reason || event?.globalStop?.reason || ''));
  const globalStopReason = ledger?.globalStop?.reason || null;
  const usageLimitObserved = isUsageLimitReason(globalStopReason) || usageLimitEvents.length > 0;
  const budgetLimitObserved = isBudgetLimitReason(globalStopReason) || events.some((event) => isBudgetLimitReason(event?.reason || event?.globalStop?.reason || ''));
  const tokenBudgetSoftExceededEvents = events.filter((event) => event?.type === 'creative_token_budget_soft_exceeded' || /token_safety_exceeded|reserved_token_safety_exceeded/i.test(String(event?.reason || '')));
  return {
    callsStarted: Number(ledger?.callsStarted || 0),
    callsCompleted: Number(ledger?.callsCompleted || 0),
    tokensObserved: Number(ledger?.tokensObserved || 0),
    globalStopReason,
    usageLimitObserved,
    usageLimitEventCount: usageLimitEvents.length,
    budgetLimitObserved,
    tokenBudgetSoftExceeded: Boolean(ledger?.tokenBudgetSoftExceeded) || tokenBudgetSoftExceededEvents.length > 0,
    tokenBudgetSoftExceededEventCount: tokenBudgetSoftExceededEvents.length,
    tokenBudgetMode: ledger?.tokenBudgetMode || ledger?.metering?.tokenBudgetMode || null,
    limit: Number(ledger?.globalStop?.limit || 0) || null,
    projectedReservedTokens: Number(ledger?.globalStop?.projectedReservedTokens || 0) || null,
    tokenReservationEstimate: Number(ledger?.globalStop?.tokenReservationEstimate || 0) || null
  };
}

export function waveObservedUsageLimit(waveSummary = {}) {
  if (waveSummary?.budget?.usageLimitObserved === true) return true;
  if (isUsageLimitReason(waveSummary?.budgetStopReason || '')) return true;
  return Object.keys(waveSummary?.rejectedReasonCounts || {}).some((reason) => isUsageLimitReason(reason));
}

export function waveObservedBudgetLimit(waveSummary = {}) {
  if (waveSummary?.budget?.budgetLimitObserved === true) return true;
  if (isBudgetLimitReason(waveSummary?.budgetStopReason || '')) return true;
  return Object.keys(waveSummary?.rejectedReasonCounts || {}).some((reason) => isBudgetLimitReason(reason));
}

export function createUsageLimitBackoffPause({ waveSummary = {}, nowMs = Date.now(), backoffMinutes = 360 } = {}) {
  if (!waveObservedUsageLimit(waveSummary)) return null;
  const safeBackoffMinutes = Math.max(1, Number(backoffMinutes || 360));
  const resumeAfter = new Date(Number(nowMs) + safeBackoffMinutes * 60_000).toISOString();
  return {
    action: 'pause_backoff',
    thresholdPass: false,
    reason: 'codex_usage_limit_observed',
    pauseKind: 'usage_limit_backoff',
    waveNumber: waveSummary.waveNumber ?? null,
    backoffMinutes: safeBackoffMinutes,
    resumeAfter,
    nextAction: `Resume the continuous controller after ${resumeAfter}; do not launch more waves while Codex usage-limit is active.`
  };
}

export function createBudgetLimitBackoffPause({ waveSummary = {}, nowMs = Date.now(), backoffMinutes = 30 } = {}) {
  if (!waveObservedBudgetLimit(waveSummary)) return null;
  const safeBackoffMinutes = Math.max(1, Number(backoffMinutes || 30));
  const resumeAfter = new Date(Number(nowMs) + safeBackoffMinutes * 60_000).toISOString();
  const reason = waveSummary?.budgetStopReason
    || Object.keys(waveSummary?.rejectedReasonCounts || {}).find((entry) => isBudgetLimitReason(entry))
    || 'creative_global_token_limit_reached';
  return {
    action: 'pause_backoff',
    thresholdPass: false,
    reason,
    pauseKind: 'controller_budget_backoff',
    waveNumber: waveSummary.waveNumber ?? null,
    backoffMinutes: safeBackoffMinutes,
    resumeAfter,
    nextAction: `Resume or raise/adapt the controller token budget after ${resumeAfter}; do not launch more waves with insufficient reserved-token budget.`
  };
}

export function observedTokensPerCompletedCall({ state = {}, promptMode = 'compact', fallback = 80000, min = 65000, max = 140000 } = {}) {
  const mode = normalizeContinuousPromptMode(promptMode);
  const promptModeBudget = state.controllerBudget?.promptModes?.[mode] || null;
  const calls = Number(promptModeBudget?.callsCompleted || state.controllerBudget?.callsCompleted || 0);
  const tokens = Number(promptModeBudget?.tokensObserved || state.controllerBudget?.tokensObserved || 0);
  const observed = calls > 0 && tokens > 0 ? Math.ceil(tokens / calls) : Number(fallback || 80000);
  return Math.max(Number(min || 0), Math.min(Number(max || observed), observed));
}

export function planAdaptiveWaveBudget({
  state = {},
  selectedCount = 0,
  promptMode = 'compact',
  controllerGlobalTokenLimit = 0,
  inheritedWaveTokenLimit = 0,
  tokenReservationEstimate = 0,
  safetyMultiplier = 1.15,
  minWaveAgentCount = 1
} = {}) {
  const count = Math.max(0, Number(selectedCount || 0));
  const minimumWaveAgentCount = Math.max(1, Number(minWaveAgentCount || 1));
  const controllerLimit = Math.max(0, Number(controllerGlobalTokenLimit || 0));
  const inheritedLimit = Math.max(0, Number(inheritedWaveTokenLimit || 0));
  const tokensObserved = Number(state.controllerBudget?.tokensObserved || 0);
  const remainingControllerTokens = controllerLimit ? Math.max(0, controllerLimit - tokensObserved) : null;
  const observedPerCall = observedTokensPerCompletedCall({ state, promptMode, fallback: tokenReservationEstimate || 80000 });
  const reservationEstimate = Math.max(Number(tokenReservationEstimate || 0), Math.ceil(observedPerCall * Number(safetyMultiplier || 1.15)));
  const availableTokens = remainingControllerTokens == null
    ? inheritedLimit || null
    : inheritedLimit ? Math.min(remainingControllerTokens, inheritedLimit) : remainingControllerTokens;
  const requiredForSelected = count * reservationEstimate;
  const minRequired = minimumWaveAgentCount * reservationEstimate;
  const maxBudgetedAgents = availableTokens == null ? count : Math.floor(availableTokens / reservationEstimate);
  const plannedAgentCount = availableTokens == null ? count : Math.max(0, Math.min(count, maxBudgetedAgents));
  const insufficientSchedulableAgents = count < minimumWaveAgentCount;
  return {
    promptMode: normalizeContinuousPromptMode(promptMode),
    selectedCount: count,
    minWaveAgentCount: minimumWaveAgentCount,
    plannedAgentCount,
    selectedCountReduced: plannedAgentCount < count,
    observedTokensPerCompletedCall: observedPerCall,
    tokenReservationEstimate: reservationEstimate,
    safetyMultiplier: Number(safetyMultiplier || 1.15),
    controllerGlobalTokenLimit: controllerLimit || null,
    controllerTokensObserved: tokensObserved,
    remainingControllerTokens,
    inheritedWaveTokenLimit: inheritedLimit || null,
    availableTokens,
    requiredForSelected,
    minRequired,
    insufficientSchedulableAgents,
    insufficientForMinimumWave: insufficientSchedulableAgents || (availableTokens != null && availableTokens < minRequired),
    insufficientForMinimumWaveReason: insufficientSchedulableAgents
      ? 'insufficient_schedulable_shards'
      : availableTokens != null && availableTokens < minRequired ? 'insufficient_token_budget' : null
  };
}

function safeRatio(numerator, denominator, decimals = 2) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  if (!bottom || !Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  return Number((top / bottom).toFixed(decimals));
}

export function calculateTokenEfficiencyMetrics({
  tokensObserved = 0,
  callsCompleted = 0,
  addedLineCount = 0,
  uniqueNormalizedAddedLineCount = 0,
  changedProductFileCount = 0,
  mergedShardCount = 0
} = {}) {
  return {
    tokensObserved: Number(tokensObserved || 0),
    callsCompleted: Number(callsCompleted || 0),
    addedLineCount: Number(addedLineCount || 0),
    uniqueNormalizedAddedLineCount: Number(uniqueNormalizedAddedLineCount || 0),
    changedProductFileCount: Number(changedProductFileCount || 0),
    mergedShardCount: Number(mergedShardCount || 0),
    tokensPerAddedLine: safeRatio(tokensObserved, addedLineCount),
    tokensPerUniqueNormalizedAddedLine: safeRatio(tokensObserved, uniqueNormalizedAddedLineCount),
    tokensPerChangedProductFile: safeRatio(tokensObserved, changedProductFileCount),
    tokensPerMergedShard: safeRatio(tokensObserved, mergedShardCount),
    addedLinesPerCompletedCall: safeRatio(addedLineCount, callsCompleted),
    uniqueNormalizedAddedLinesPerCompletedCall: safeRatio(uniqueNormalizedAddedLineCount, callsCompleted)
  };
}

export function evaluateTokenEfficiency({ metrics = {}, policy = {} } = {}) {
  const enabled = policy.enabled !== false;
  if (!enabled) return { ok: true, enabled: false, failures: [], reason: null };
  const minObservedTokens = Math.max(0, Number(policy.minObservedTokens || 0));
  const minAddedLineCount = Math.max(0, Number(policy.minAddedLineCount || 0));
  const tokens = Number(metrics.tokensObserved || 0);
  const added = Number(metrics.addedLineCount || 0);
  const unique = Number(metrics.uniqueNormalizedAddedLineCount || 0);
  const insufficientSample = tokens < minObservedTokens || added < minAddedLineCount;
  if (insufficientSample) {
    return {
      ok: true,
      enabled: true,
      sampleReady: false,
      failures: [],
      reason: null,
      sample: { tokensObserved: tokens, minObservedTokens, addedLineCount: added, minAddedLineCount }
    };
  }
  const failures = [];
  const maxTokensPerAddedLine = Number(policy.maxTokensPerAddedLine || 0);
  const maxTokensPerUniqueNormalizedAddedLine = Number(policy.maxTokensPerUniqueNormalizedAddedLine || 0);
  const minUniqueNormalizedAddedLinesPerCall = Number(policy.minUniqueNormalizedAddedLinesPerCall || 0);
  if (maxTokensPerAddedLine > 0 && metrics.tokensPerAddedLine != null && metrics.tokensPerAddedLine > maxTokensPerAddedLine) {
    failures.push({ metric: 'tokensPerAddedLine', actual: metrics.tokensPerAddedLine, requirement: `<= ${maxTokensPerAddedLine}`, reason: 'token_efficiency_threshold_not_met' });
  }
  if (maxTokensPerUniqueNormalizedAddedLine > 0 && metrics.tokensPerUniqueNormalizedAddedLine != null && metrics.tokensPerUniqueNormalizedAddedLine > maxTokensPerUniqueNormalizedAddedLine) {
    failures.push({ metric: 'tokensPerUniqueNormalizedAddedLine', actual: metrics.tokensPerUniqueNormalizedAddedLine, requirement: `<= ${maxTokensPerUniqueNormalizedAddedLine}`, reason: 'token_efficiency_threshold_not_met' });
  }
  if (minUniqueNormalizedAddedLinesPerCall > 0 && metrics.uniqueNormalizedAddedLinesPerCompletedCall != null && metrics.uniqueNormalizedAddedLinesPerCompletedCall < minUniqueNormalizedAddedLinesPerCall) {
    failures.push({ metric: 'uniqueNormalizedAddedLinesPerCompletedCall', actual: metrics.uniqueNormalizedAddedLinesPerCompletedCall, requirement: `>= ${minUniqueNormalizedAddedLinesPerCall}`, reason: 'token_efficiency_threshold_not_met' });
  }
  return {
    ok: failures.length === 0,
    enabled: true,
    sampleReady: true,
    reason: failures.length ? 'token_efficiency_threshold_not_met' : null,
    failures,
    sample: { tokensObserved: tokens, minObservedTokens, addedLineCount: added, uniqueNormalizedAddedLineCount: unique, minAddedLineCount }
  };
}

export function evaluateProductionQualityGate({ metrics = {}, policy = {} } = {}) {
  const enabled = policy.enabled === true;
  if (!enabled) return { ok: true, enabled: false, failures: [] };
  const failures = [];
  const check = ({ metric, actual = metrics[metric] ?? null, requirement, reason, predicate }) => {
    if (actual == null || Number.isNaN(actual)) {
      failures.push({ metric, actual, requirement, reason: 'missing_quality_gate_evidence' });
      return;
    }
    if (!predicate(Number(actual))) failures.push({ metric, actual, requirement, reason });
  };

  const maxTestFailureRegressionCount = Number(policy.maxTestFailureRegressionCount ?? 0);
  const maxRouteCollisionCount = Number(policy.maxRouteCollisionCount ?? 0);
  const maxDuplicateNormalizedLineRatio = Number(policy.maxDuplicateNormalizedLineRatio ?? 0.25);
  const minArchitectureFitnessScore = Number(policy.minArchitectureFitnessScore ?? 0.9);
  const maxArchitectureViolationCount = Number(policy.maxArchitectureViolationCount ?? 0);

  check({
    metric: 'testFailureRegressionCount',
    requirement: `<= ${maxTestFailureRegressionCount}`,
    reason: 'test_regression_introduced',
    predicate: (actual) => actual <= maxTestFailureRegressionCount
  });
  check({
    metric: 'routeCollisionCount',
    requirement: `<= ${maxRouteCollisionCount}`,
    reason: 'route_collision_detected',
    predicate: (actual) => actual <= maxRouteCollisionCount
  });
  check({
    metric: 'duplicateNormalizedLineRatio',
    requirement: `<= ${maxDuplicateNormalizedLineRatio}`,
    reason: 'duplicate_loc_ratio_too_high',
    predicate: (actual) => actual <= maxDuplicateNormalizedLineRatio
  });
  check({
    metric: 'architectureFitnessScore',
    requirement: `>= ${minArchitectureFitnessScore}`,
    reason: 'architecture_fitness_below_threshold',
    predicate: (actual) => actual >= minArchitectureFitnessScore
  });
  check({
    metric: 'architectureViolationCount',
    requirement: `<= ${maxArchitectureViolationCount}`,
    reason: 'architecture_violation_detected',
    predicate: (actual) => actual <= maxArchitectureViolationCount
  });
  if (policy.requireIntegrationHardeningPass !== false) {
    check({
      metric: 'integrationHardeningPass',
      requirement: '= 1',
      reason: 'integration_hardening_not_proven',
      predicate: (actual) => actual === 1
    });
  }
  if (policy.requireArchitectureGatePass !== false) {
    check({
      metric: 'architectureGatePass',
      requirement: '= 1',
      reason: 'architecture_gate_not_proven',
      predicate: (actual) => actual === 1
    });
  }
  if (policy.requireProductionQualityGatePass !== false) {
    check({
      metric: 'productionQualityGatePass',
      requirement: '= 1',
      reason: 'production_quality_gate_not_proven',
      predicate: (actual) => actual === 1
    });
  }

  return {
    ok: failures.length === 0,
    enabled: true,
    reason: failures.length ? 'production_quality_gate_failed' : null,
    failures,
    policy: {
      maxTestFailureRegressionCount,
      maxRouteCollisionCount,
      maxDuplicateNormalizedLineRatio,
      minArchitectureFitnessScore,
      maxArchitectureViolationCount,
      requireIntegrationHardeningPass: policy.requireIntegrationHardeningPass !== false,
      requireArchitectureGatePass: policy.requireArchitectureGatePass !== false,
      requireProductionQualityGatePass: policy.requireProductionQualityGatePass !== false
    }
  };
}

function tokenEfficiencyMetricsForWaves(waves = []) {
  const selected = Array.isArray(waves) ? waves : [];
  return calculateTokenEfficiencyMetrics({
    tokensObserved: selected.reduce((sum, wave) => sum + Number(wave?.budget?.tokensObserved || 0), 0),
    callsCompleted: selected.reduce((sum, wave) => sum + Number(wave?.budget?.callsCompleted || 0), 0),
    addedLineCount: selected.reduce((sum, wave) => sum + Number(wave?.addedLineCount || 0), 0),
    uniqueNormalizedAddedLineCount: selected.reduce((sum, wave) => sum + Number(wave?.uniqueNormalizedAddedLineCount || 0), 0),
    changedProductFileCount: stableList(selected.flatMap((wave) => wave?.mergedProductFiles || [])).length,
    mergedShardCount: selected.reduce((sum, wave) => sum + Number(wave?.mergedShardCount || 0), 0)
  });
}

export function evaluateTokenEfficiencyDebtRecovery({
  aggregateMetrics = {},
  state = {},
  policy = {},
  initialWaveSummaryCount = 0,
  target = {}
} = {}) {
  const aggregateTokenMetrics = aggregateMetrics.tokenEfficiency || aggregateMetrics;
  const aggregateEvaluation = evaluateTokenEfficiency({ metrics: aggregateTokenMetrics, policy });
  if (aggregateEvaluation.enabled === false || aggregateEvaluation.sampleReady === false || aggregateEvaluation.ok) {
    return { allowContinue: true, recoveryActive: false, aggregateEvaluation };
  }

  const waves = Array.isArray(state.waveSummaries) ? state.waveSummaries : [];
  const startIndex = Math.max(0, Math.min(waves.length, Number(initialWaveSummaryCount || 0)));
  const recoveryWaves = waves.slice(startIndex);
  const recoveryMetrics = tokenEfficiencyMetricsForWaves(recoveryWaves);
  const recoveryDurationMinutes = recoveryWaves.reduce((sum, wave) => sum + Number(wave?.durationMinutes || 0), 0);
  const slopePolicy = { ...policy, minObservedTokens: 0, minAddedLineCount: 1 };
  const recoveryEvaluation = evaluateTokenEfficiency({ metrics: recoveryMetrics, policy: slopePolicy });
  const durationTargetMinutes = Math.max(0, Number(target.durationTargetMinutes || 0));
  const aggregateDurationMinutes = Math.max(0, Number(aggregateMetrics.autonomyWindowMinutes || 0));
  const remainingMinutes = Math.max(0, durationTargetMinutes - aggregateDurationMinutes);

  let projectedMetrics = null;
  let projectedEvaluation = null;
  if (recoveryDurationMinutes > 0 && recoveryMetrics.tokensObserved > 0 && recoveryMetrics.addedLineCount > 0 && durationTargetMinutes > 0) {
    const tokensPerMinute = recoveryMetrics.tokensObserved / recoveryDurationMinutes;
    const addedLinesPerMinute = recoveryMetrics.addedLineCount / recoveryDurationMinutes;
    const uniqueLinesPerMinute = recoveryMetrics.uniqueNormalizedAddedLineCount / recoveryDurationMinutes;
    const callsPerMinute = recoveryMetrics.callsCompleted / recoveryDurationMinutes;
    projectedMetrics = calculateTokenEfficiencyMetrics({
      tokensObserved: Number(aggregateTokenMetrics.tokensObserved || 0) + tokensPerMinute * remainingMinutes,
      callsCompleted: Number(aggregateTokenMetrics.callsCompleted || 0) + callsPerMinute * remainingMinutes,
      addedLineCount: Number(aggregateTokenMetrics.addedLineCount || 0) + addedLinesPerMinute * remainingMinutes,
      uniqueNormalizedAddedLineCount: Number(aggregateTokenMetrics.uniqueNormalizedAddedLineCount || 0) + uniqueLinesPerMinute * remainingMinutes,
      changedProductFileCount: Number(aggregateTokenMetrics.changedProductFileCount || aggregateMetrics.changedProductFileCount || 0),
      mergedShardCount: Number(aggregateTokenMetrics.mergedShardCount || aggregateMetrics.mergedShardCount || 0)
    });
    projectedEvaluation = evaluateTokenEfficiency({ metrics: projectedMetrics, policy });
  }

  const allowContinue = recoveryEvaluation.ok === true && projectedEvaluation?.ok === true;
  return {
    allowContinue,
    recoveryActive: allowContinue,
    aggregateEvaluation,
    recoveryEvaluation,
    recoveryMetrics,
    recoveryWaveCount: recoveryWaves.length,
    recoveryDurationMinutes: Number(recoveryDurationMinutes.toFixed(2)),
    remainingMinutes: Number(remainingMinutes.toFixed(2)),
    projectedMetrics,
    projectedEvaluation,
    reason: allowContinue ? 'token_efficiency_debt_recovery_on_track' : 'token_efficiency_debt_recovery_not_on_track'
  };
}

export function isProductSourceFile(filePath = '') {
  const rel = String(filePath || '').replace(/^\.\//, '');
  const appPackageProduct = /^(apps|packages)\//.test(rel)
    && /\.(?:mjs|js|jsx|ts|tsx|html|css)$/i.test(rel)
    && !/(^|\/)tests?\//i.test(rel);
  const godotProduct = (
    rel === 'project.godot'
    || /^(?:scripts|scenes|ui|assets|autoload|addons|tools\/editor|tools\/qa)\//.test(rel)
  )
    && /\.(?:gd|tscn|tres|res|cfg|json|import|shader|material|godot)$/i.test(rel)
    && !/(^|\/)(?:docs?|tests?|__tests__|artifacts?|benchmarks?|fixtures?|mocks?|coverage|dist|build)\//i.test(rel);
  return appPackageProduct || godotProduct;
}

export function primaryProductFile(surface = {}) {
  const candidates = stableList([
    ...(surface.targetFiles || []),
    ...(surface.productFiles || []),
    surface.productFile,
    surface.targetFile,
    ...(surface.allowedFiles || [])
  ]);
  return candidates.find(isProductSourceFile) || null;
}

export function surfaceWorkKey(surface = {}) {
  return String(surface.id || surface.surfaceId || surface.label || '').trim();
}

export function surfaceWithPrimaryFile(surface = {}) {
  const primary = primaryProductFile(surface);
  if (!primary) return null;
  return {
    ...surface,
    targetFiles: [primary],
    productFiles: [primary],
    allowedFiles: stableList([primary, ...(surface.allowedFiles || []).filter((entry) => !isProductSourceFile(entry))]),
    metadata: {
      ...(surface.metadata || {}),
      continuousControllerPrimaryFile: primary,
      continuousControllerOriginalTargetFiles: stableList(surface.targetFiles || []),
      continuousControllerOriginalProductFiles: stableList(surface.productFiles || [])
    }
  };
}

export function productFilesForSurface(surface = {}) {
  return stableList([
    ...(surface.targetFiles || []),
    ...(surface.productFiles || []),
    surface.productFile,
    surface.targetFile,
    ...(surface.allowedFiles || [])
  ]).filter(isProductSourceFile);
}

export function bundleSelectedSurfaces({ selected = [], bundleSize = 1, waveNumber = null, bundleMode = 'coherent_product_slice' } = {}) {
  const normalized = selected.map(surfaceWithPrimaryFile).filter(Boolean);
  const size = Math.max(1, Number(bundleSize || 1));
  if (size <= 1) {
    return {
      enabled: false,
      bundleMode,
      bundleSize: size,
      surfaces: normalized,
      sourceSurfaceIds: normalized.map(surfaceWorkKey),
      selectedProductFiles: normalized.map(primaryProductFile).filter(Boolean),
      bundleMap: normalized.map((surface) => ({
        bundleId: surfaceWorkKey(surface),
        sourceSurfaceIds: [surfaceWorkKey(surface)],
        productFiles: productFilesForSurface(surface)
      }))
    };
  }

  const chunks = [];
  for (let index = 0; index < normalized.length; index += size) chunks.push(normalized.slice(index, index + size));
  const bundled = chunks.map((chunk, index) => {
    const sourceSurfaceIds = stableList(chunk.map(surfaceWorkKey));
    const productFiles = stableList(chunk.flatMap(productFilesForSurface));
    const nonProductAllowed = stableList(chunk.flatMap((surface) => surface.allowedFiles || []).filter((entry) => !isProductSourceFile(entry)));
    const lane = stableList(chunk.map((surface) => surface.lane || surface.productLane || surface.metadata?.lane).filter(Boolean))[0] || 'mixed_product_lane';
    const titleBits = chunk.map((surface) => surface.label || surface.title || surface.id).filter(Boolean).slice(0, 4);
    const bundleId = `bundle_${String(index + 1).padStart(3, '0')}__${slugify(sourceSurfaceIds.join('__')).slice(0, 90)}`;
    return {
      id: bundleId,
      label: `Bundled product slice ${index + 1}: ${titleBits.join(' + ')}`,
      lane,
      productLane: lane,
      domain: `bundled_${lane}`,
      productGoal: [
        `Make one coherent Mailchimp product-slice improvement across ${productFiles.length} assigned product target(s).`,
        `Touch multiple assigned product targets when possible; avoid tiny one-file marker deltas.`,
        `Source surface objectives:`,
        ...chunk.map((surface, chunkIndex) => `${chunkIndex + 1}. ${surface.productGoal || surface.goal || surface.label || surface.id}`),
        `Assigned product targets: ${productFiles.join(', ')}`
      ].join('\n'),
      targetFiles: productFiles,
      productFiles,
      allowedFiles: stableList([...productFiles, ...nonProductAllowed]),
      verification: stableList(chunk.flatMap((surface) => surface.verification || [])),
      targetedTests: stableList(chunk.flatMap((surface) => surface.targetedTests || [])),
      issueIds: stableList([bundleId, ...sourceSurfaceIds, ...productFiles]),
      status: 'planned',
      phase: `continuous_controller_wave_${waveNumber || 'unknown'}_bundle_${String(index + 1).padStart(3, '0')}`,
      sourceSurfaces: chunk.map((surface) => ({
        id: surfaceWorkKey(surface),
        label: surface.label || surface.title || null,
        productGoal: surface.productGoal || surface.goal || null,
        productFiles: productFilesForSurface(surface)
      })),
      metadata: {
        continuousControllerBundledSurface: true,
        continuousControllerBundleMode: bundleMode,
        continuousControllerBundleSize: chunk.length,
        continuousControllerBundleIndex: index + 1,
        continuousControllerWave: waveNumber,
        bundledSurfaceIds: sourceSurfaceIds,
        bundledProductFiles: productFiles,
        minProductTargetsToModify: productFiles.length > 1 ? Math.min(productFiles.length, Math.max(2, Math.ceil(productFiles.length / 2))) : 1,
        primaryFileConstrained: false,
        creativeProductWorkRequired: true,
        freshProductDiffRequired: true
      }
    };
  });
  return {
    enabled: true,
    bundleMode,
    bundleSize: size,
    surfaces: bundled,
    sourceSurfaceIds: stableList(normalized.map(surfaceWorkKey)),
    selectedProductFiles: stableList(bundled.flatMap((surface) => surface.productFiles || [])),
    bundleMap: bundled.map((surface) => ({
      bundleId: surface.id,
      sourceSurfaceIds: surface.metadata.bundledSurfaceIds || [],
      productFiles: surface.productFiles || []
    }))
  };
}

export function avoidSameWaveBundleFileCollisions(bundlePlan = {}, { enabled = true } = {}) {
  if (!enabled) return { ...bundlePlan, sameWaveFileCollisionAvoidance: { enabled: false } };
  const surfaces = Array.isArray(bundlePlan.surfaces) ? bundlePlan.surfaces : [];
  const bundleMap = Array.isArray(bundlePlan.bundleMap) ? bundlePlan.bundleMap : [];
  const usedFiles = new Set();
  const keptSurfaces = [];
  const keptBundleMap = [];
  const droppedBundles = [];

  surfaces.forEach((surface, index) => {
    const mapEntry = bundleMap[index] || {};
    const bundleId = surface.id || mapEntry.bundleId || surfaceWorkKey(surface);
    const productFiles = stableList([
      ...(surface.productFiles || []),
      ...(surface.targetFiles || []),
      ...(mapEntry.productFiles || [])
    ]).filter(isProductSourceFile);
    const conflictingFiles = productFiles.filter((file) => usedFiles.has(file));
    if (conflictingFiles.length) {
      droppedBundles.push({
        bundleId,
        sourceSurfaceIds: stableList([...(mapEntry.sourceSurfaceIds || []), ...(surface.metadata?.bundledSurfaceIds || [])]),
        productFiles,
        conflictingFiles
      });
      return;
    }
    productFiles.forEach((file) => usedFiles.add(file));
    keptSurfaces.push(surface);
    keptBundleMap.push(mapEntry.bundleId ? mapEntry : {
      bundleId,
      sourceSurfaceIds: stableList(surface.metadata?.bundledSurfaceIds || [surfaceWorkKey(surface)]),
      productFiles
    });
  });

  if (!droppedBundles.length) {
    return {
      ...bundlePlan,
      sameWaveFileCollisionAvoidance: {
        enabled: true,
        droppedBundleCount: 0,
        keptBundleCount: surfaces.length,
        reason: 'no_same_wave_product_file_collisions'
      }
    };
  }

  return {
    ...bundlePlan,
    surfaces: keptSurfaces,
    sourceSurfaceIds: stableList(keptBundleMap.flatMap((entry) => entry.sourceSurfaceIds || [])),
    selectedProductFiles: stableList(keptSurfaces.flatMap((surface) => [...(surface.productFiles || []), ...(surface.targetFiles || [])]).filter(isProductSourceFile)),
    bundleMap: keptBundleMap,
    sameWaveFileCollisionAvoidance: {
      enabled: true,
      droppedBundleCount: droppedBundles.length,
      keptBundleCount: keptSurfaces.length,
      droppedSourceSurfaceCount: stableList(droppedBundles.flatMap((entry) => entry.sourceSurfaceIds || [])).length,
      droppedBundles,
      reason: 'same_wave_product_file_overlap'
    }
  };
}

function objectiveTruthCompletionSet(ids = []) {
  return new Set(stableList(ids).map((id) => String(id || '').trim()).filter(Boolean));
}

function objectiveTruthSurfaceCompletionKeys(surface = {}, index = 0) {
  const sourceId = objectiveTruthSurfaceId(surface, index);
  return stableList([
    sourceId,
    `objective_truth_surface__${slugify(sourceId)}`,
    surface.id,
    surface.surfaceId,
    surface.leafId,
    surface.parentSurfaceId,
    surface.label
  ]);
}

function objectiveTruthWorkCompletionKeys(item = {}, index = 0, sourceKind = 'negative_space') {
  const id = String(item.id || item.surfaceId || item.parentSurfaceId || item.label || `work_${index + 1}`);
  return stableList([
    id,
    `objective_truth_${sourceKind}__${slugify(id)}`,
    item.sourceId,
    item.parentSurfaceId,
    item.label
  ]);
}

function objectiveTruthItemCompleted(keys = [], completed = new Set()) {
  return keys.some((key) => completed.has(String(key || '').trim()));
}

export const DEFAULT_OBJECTIVE_EXPANSION_DIMENSIONS = [
  {
    id: 'client_runtime_adoption',
    title: 'client runtime adoption',
    prompt: 'Wire the assigned product source more deeply into request/client state, runtime data contracts, and user-visible workflow handoff behavior.'
  },
  {
    id: 'state_persistence_recovery',
    title: 'state persistence and recovery',
    prompt: 'Add concrete persisted state shaping, recovery paths, idempotent commands, and restart-safe status semantics for this product surface.'
  },
  {
    id: 'tenant_permissions_boundaries',
    title: 'tenant and permission boundaries',
    prompt: 'Deepen workspace scoping, role/permission handling, tenant isolation, audit handoff, and safe boundary behavior in this source file.'
  },
  {
    id: 'operational_health_errors',
    title: 'operational health and error handling',
    prompt: 'Add real health, validation, failure-state, retry/backoff, degraded-mode, and actionable-error behavior for this surface.'
  },
  {
    id: 'analytics_exports_history',
    title: 'analytics, export, and history depth',
    prompt: 'Add concrete analytics counters, history snapshots, export-ready summaries, and timeline/reporting state for this product area.'
  },
  {
    id: 'lifecycle_settings_controls',
    title: 'lifecycle settings and controls',
    prompt: 'Deepen lifecycle commands, settings validation, enable/disable controls, scheduling controls, and next-action state for this product workflow.'
  },
  {
    id: 'integration_provider_contracts',
    title: 'service/provider contracts',
    prompt: 'Add product-specific provider/service contract behavior, sync metadata, capability negotiation, and external handoff state where appropriate.'
  },
  {
    id: 'ui_preview_acceptance',
    title: 'UI preview and acceptance evidence',
    prompt: 'Add user-visible preview, acceptance, readiness, validation summary, and explainable next-step data contracts consumed by routes or clients.'
  }
];

function slugify(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'surface';
}

function rewriteVerificationForExpandedSurface(commands = [], expandedId, primaryFile) {
  return stableList(commands).map((command) => {
    const text = String(command || '');
    if (!text.includes('verify-mailchimp-no-generic-shim.mjs')) return text;
    return text
      .replace(/verify-mailchimp-no-generic-shim\.mjs\s+\S+/, `verify-mailchimp-no-generic-shim.mjs ${expandedId}`)
      .replace(/--file\s+\S+/, `--file ${primaryFile}`);
  });
}

export function createObjectiveExpansionSurface(surface = {}, { cycle = 1, dimension = DEFAULT_OBJECTIVE_EXPANSION_DIMENSIONS[0], dimensionIndex = 0 } = {}) {
  const normalized = surfaceWithPrimaryFile(surface);
  if (!normalized) return null;
  const primary = primaryProductFile(normalized);
  const baseId = surfaceWorkKey(normalized) || slugify(normalized.label || primary);
  const parentSurfaceId = normalized.parentSurfaceId || normalized.productArea || normalized.domain || normalized.metadata?.parentSurfaceId || baseId;
  const expandedId = `${slugify(parentSurfaceId)}__continuation_${String(cycle).padStart(3, '0')}__${dimension.id}__primary_${slugify(primary)}`;
  const baseGoal = normalized.productGoal || normalized.label || `Improve ${parentSurfaceId}`;
  const continuationTitle = `continuation ${String(cycle).padStart(3, '0')} — ${dimension.title}`;
  return {
    ...cloneJson(normalized),
    id: expandedId,
    sourceLeafId: `${slugify(parentSurfaceId)}__continuation_${String(cycle).padStart(3, '0')}`,
    label: `${normalized.productArea || parentSurfaceId}: ${continuationTitle}. ${dimension.prompt} — primary ${primary}`,
    issueIds: stableList([expandedId, parentSurfaceId, primary]),
    productGoal: `${baseGoal} Continuation objective: ${dimension.prompt} Primary product file for this shard: ${primary}. Make a fresh, concrete product behavior delta in this file only; do not repeat prior marker/generic helper patterns.`,
    targetFiles: [primary],
    productFiles: [primary],
    allowedFiles: stableList([primary, ...(normalized.allowedFiles || []).filter((entry) => !isProductSourceFile(entry))]),
    targetedTests: stableList(normalized.targetedTests || []),
    verification: rewriteVerificationForExpandedSurface(normalized.verification || [], expandedId, primary),
    status: 'planned',
    phase: `continuous_objective_expansion_${String(cycle).padStart(3, '0')}_${String(dimensionIndex + 1).padStart(3, '0')}`,
    metadata: {
      ...(normalized.metadata || {}),
      objectiveExpansionGenerated: true,
      objectiveExpansionCycle: cycle,
      objectiveExpansionDimensionId: dimension.id,
      objectiveExpansionDimensionTitle: dimension.title,
      objectiveExpansionPrompt: dimension.prompt,
      objectiveExpansionSourceSurfaceId: baseId,
      continuousControllerPrimaryFile: primary,
      primaryFileConstrained: true,
      freshProductDiffRequired: true,
      creativeProductWorkRequired: true
    }
  };
}

function meaningfulTokens(value = '') {
  return stableList(String(value || '')
    .toLowerCase()
    .replace(/\.(?:test|spec)\.(?:mjs|js|ts|tsx)$/i, '')
    .replace(/\.(?:mjs|js|ts|tsx)$/i, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !['test', 'tests', 'route', 'routes', 'index'].includes(token)));
}

function productFileMatchesFailedTest(productFile = '', testFile = '') {
  const testTokens = meaningfulTokens(path.basename(String(testFile || '')));
  if (!testTokens.length) return false;
  const productTokens = meaningfulTokens(String(productFile || ''));
  const overlap = testTokens.filter((token) => productTokens.includes(token));
  return overlap.length >= Math.min(2, testTokens.length) || overlap.some((token) => token.length >= 8);
}

function pushRepairTarget(targets, file, patch = {}) {
  if (!isProductSourceFile(file)) return;
  const existing = targets.get(file) || { file, reasons: [], routeCollisions: [], failedTestFiles: [], duplicateLineExamples: [] };
  existing.reasons = stableList([...(existing.reasons || []), ...(patch.reasons || [])]);
  existing.routeCollisions = [...(existing.routeCollisions || []), ...(patch.routeCollisions || [])];
  existing.failedTestFiles = stableList([...(existing.failedTestFiles || []), ...(patch.failedTestFiles || [])]);
  existing.duplicateLineExamples = stableList([...(existing.duplicateLineExamples || []), ...(patch.duplicateLineExamples || [])]);
  targets.set(file, existing);
}

export function createProductionQualityRepairSurfaces({
  qualityGate = {},
  state = {},
  waveNumber = null,
  maxSurfaces = 100,
  generatedAt = new Date().toISOString()
} = {}) {
  const targets = new Map();
  const globalTargets = [];
  const failures = Array.isArray(qualityGate.failures) ? qualityGate.failures : [];
  const failureReasons = stableList(failures.map((failure) => failure.reason || failure.metric));
  const metrics = qualityGate.metrics || {};
  const policy = qualityGate.policy || {};
  const testFailureRegressionCount = Number(metrics.testFailureRegressionCount ?? metrics.test_failure_regression_count ?? 0);
  const testRegressionFailureExplicit = failures.some((failure) => {
    const metric = String(failure.metric || '');
    const reason = String(failure.reason || '');
    if (metric !== 'testFailureRegressionCount' && reason !== 'test_regression_introduced') return false;
    if (failure.actual === undefined || failure.actual === null) return true;
    const actual = Number(failure.actual ?? testFailureRegressionCount);
    return Number.isFinite(actual) && actual > 0;
  });
  const shouldRepairTestFailures = testFailureRegressionCount > 0 || testRegressionFailureExplicit;
  const duplicateRoutes = Array.isArray(qualityGate.routeAudit?.duplicateRoutes) ? qualityGate.routeAudit.duplicateRoutes : [];
  for (const collision of duplicateRoutes) {
    for (const entry of collision.entries || []) {
      pushRepairTarget(targets, entry.file, {
        reasons: ['route_collision_detected'],
        routeCollisions: [{ route: collision.route, count: collision.count, peerFiles: stableList((collision.entries || []).map((item) => item.file)) }]
      });
    }
  }

  const failedTestFiles = stableList([
    ...(qualityGate.testFailureHints?.failedTestFiles || []),
    ...(qualityGate.testFailureHints?.failedTestLocations || []).map((entry) => entry.file)
  ]);
  const changedProductFiles = stableList([
    ...(state.thresholdMetrics?.changedProductFiles || []),
    ...(state.metrics?.changedProductFiles || []),
    ...(qualityGate.metrics?.changedProductFiles || [])
  ]).filter(isProductSourceFile);
  if (shouldRepairTestFailures) {
    for (const failedTestFile of failedTestFiles) {
      for (const productFile of changedProductFiles) {
        if (productFileMatchesFailedTest(productFile, failedTestFile)) {
          pushRepairTarget(targets, productFile, {
            reasons: ['test_regression_introduced'],
            failedTestFiles: [failedTestFile]
          });
        }
      }
    }
  }

  const duplicateRatio = Number(metrics.duplicateNormalizedLineRatio ?? metrics.duplicate_normalized_line_ratio ?? 0);
  const duplicateLimit = Number(policy.maxDuplicateNormalizedLineRatio ?? policy.max_duplicate_normalized_line_ratio ?? 0);
  const duplicateRatioFailed = failureReasons.includes('duplicate_loc_ratio_too_high')
    || failures.some((failure) => String(failure.metric || '') === 'duplicateNormalizedLineRatio')
    || (Number.isFinite(duplicateRatio) && Number.isFinite(duplicateLimit) && duplicateLimit > 0 && duplicateRatio > duplicateLimit);
  if (duplicateRatioFailed) {
    const duplicateLineExamples = stableList([
      ...((qualityGate.duplicateLineAudit?.topDuplicateNormalizedLines || []).map((entry) => `${entry.count}× ${entry.line}`)),
      ...((qualityGate.duplicateLineExamples || []).map((entry) => typeof entry === 'string' ? entry : `${entry.count || '?'}× ${entry.line || entry.normalized || ''}`))
    ]).filter(Boolean).slice(0, 12);
    if (changedProductFiles.length > 1) {
      globalTargets.push({
        file: changedProductFiles[0],
        files: changedProductFiles,
        reasons: ['duplicate_loc_ratio_too_high'],
        routeCollisions: [],
        failedTestFiles: [],
        duplicateLineExamples,
        globalDiffCompaction: true
      });
    } else {
      for (const productFile of changedProductFiles) {
        pushRepairTarget(targets, productFile, {
          reasons: ['duplicate_loc_ratio_too_high'],
          duplicateLineExamples
        });
      }
    }
  }

  const sortedTargets = [...globalTargets, ...targets.values()]
    .sort((a, b) => {
      if (a.globalDiffCompaction && !b.globalDiffCompaction) return -1;
      if (!a.globalDiffCompaction && b.globalDiffCompaction) return 1;
      return b.reasons.length - a.reasons.length || a.file.localeCompare(b.file);
    })
    .slice(0, Math.max(1, Number(maxSurfaces || 100)));

  return sortedTargets.map((target, index) => {
    const targetFiles = stableList(target.files || [target.file]).filter(isProductSourceFile);
    const primaryFile = target.file || targetFiles[0];
    const routeLines = target.routeCollisions.length
      ? [
        'Route collision context:',
        ...target.routeCollisions.slice(0, 5).map((collision) => `- ${collision.route} is registered by ${collision.peerFiles.join(', ')}`)
      ]
      : [];
    const testLines = target.failedTestFiles.length
      ? ['Failing test context:', ...target.failedTestFiles.slice(0, 8).map((file) => `- ${file}`)]
      : [];
    const duplicateExampleLines = target.duplicateLineExamples?.length
      ? ['Top repeated meaningful added lines:', ...target.duplicateLineExamples.slice(0, 10).map((line) => `- ${line}`)]
      : [];
    const dedupeLines = target.reasons.includes('duplicate_loc_ratio_too_high')
      ? [
        'Duplicate-line/bloat context:',
        `- Current duplicate normalized line ratio: ${Number.isFinite(duplicateRatio) ? duplicateRatio : 'unknown'}`,
        `- Maximum allowed duplicate normalized line ratio: ${Number.isFinite(duplicateLimit) && duplicateLimit > 0 ? duplicateLimit : 'benchmark policy'}`,
        target.globalDiffCompaction
          ? `- This is a global diff-compaction shard. Edit only these changed product files: ${targetFiles.join(', ')}.`
          : '- Remove repeated helper/payload/code blocks in the primary file; keep the smallest behavior-preserving implementation.',
        '- Prefer deleting, extracting, or reusing existing code over adding new branches. Do not add new feature behavior just to make lines unique.',
        ...duplicateExampleLines
      ]
      : [];
    const id = target.globalDiffCompaction
      ? `production_quality_repair__wave_${String(waveNumber || 'next').padStart(3, '0')}__${String(index + 1).padStart(3, '0')}__global_diff_compaction`
      : `production_quality_repair__wave_${String(waveNumber || 'next').padStart(3, '0')}__${String(index + 1).padStart(3, '0')}__${slugify(primaryFile)}`;
    const verification = stableList([
      ...target.failedTestFiles.map((file) => `node --test ${file}`),
      target.routeCollisions.length ? 'node apps/system-benchmark/evaluate-production-quality-gate.mjs --repo-path . --artifact-root artifacts/production-quality-repair-route-check --skip-tests' : null,
      target.globalDiffCompaction ? 'git diff --check' : null
    ]);
    return {
      id,
      label: target.globalDiffCompaction ? 'Production quality repair: global diff compaction' : `Production quality repair ${index + 1}: ${primaryFile}`,
      lane: 'production_quality_repair',
      productLane: 'production_quality_repair',
      domain: 'production_quality_repair',
      productGoal: [
        'Real-run production quality repair objective: fix the failing production-quality gate without manual intervention.',
        target.globalDiffCompaction
          ? `Primary product files for this repair shard: ${targetFiles.join(', ')}.`
          : `Primary product file for this repair shard: ${primaryFile}.`,
        `Gate failures: ${failureReasons.join(', ') || 'production_quality_gate_failed'}.`,
        ...routeLines,
        ...testLines,
        ...dedupeLines,
        target.globalDiffCompaction
          ? 'Make a compact cleanup pass across only the listed changed product files. The desired result is fewer meaningful repeated added lines, not a larger rewritten feature.'
          : 'Make a targeted product-code repair in this file only. Do not add benchmark shims, docs-only changes, tests-only changes, marker constants, or broad unrelated features.',
        'Prefer a small compatibility-preserving fix that reduces the recorded route collisions, duplicate-line ratio, or true test regressions and keeps existing product behavior intact.'
      ].join('\n'),
      targetFiles,
      productFiles: targetFiles,
      allowedFiles: targetFiles,
      verification,
      targetedTests: target.failedTestFiles,
      issueIds: stableList([id, primaryFile, ...target.reasons, ...target.failedTestFiles]),
      status: 'planned',
      phase: `production_quality_repair_wave_${String(waveNumber || 'next').padStart(3, '0')}_${String(index + 1).padStart(3, '0')}`,
      metadata: {
        productionQualityRepair: true,
        productionQualityRepairGeneratedAt: generatedAt,
        productionQualityRepairWave: waveNumber || null,
        productionQualityRepairReasons: target.reasons,
        productionQualityRepairFailedTestFiles: target.failedTestFiles,
        productionQualityRepairRouteCollisions: target.routeCollisions,
        productionQualityRepairDuplicateLineExamples: target.duplicateLineExamples || [],
        productionQualityRepairGlobalDiffCompaction: target.globalDiffCompaction === true,
        continuousControllerPrimaryFile: primaryFile,
        primaryFileConstrained: !target.globalDiffCompaction,
        freshProductDiffRequired: true,
        creativeProductWorkRequired: true
      }
    };
  });
}

const OBJECTIVE_TRUTH_GREEN_STATUSES = new Set(['green', 'complete', 'completed', 'all_complete', 'pass', 'passed', 'ok', 'done']);
const OBJECTIVE_TRUTH_RED_STATUSES = new Set(['red', 'partial', 'blocked', 'missing', 'open', 'failed', 'fail', 'not_full_clone', 'not_full_parity']);

function objectiveTruthStatus(value = '') {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return 'unknown';
  if (OBJECTIVE_TRUTH_GREEN_STATUSES.has(status)) return 'green';
  if (OBJECTIVE_TRUTH_RED_STATUSES.has(status)) return 'red';
  if (/^(?:phase\d+_)?(?:.*_)?green(?:_.*)?$/.test(status)) return 'green';
  if (/red|partial|block|missing|open|fail|unknown|not_full/.test(status)) return 'red';
  return 'unknown';
}

function objectiveTruthSurfaceId(surface = {}, index = 0) {
  return String(surface.id || surface.surfaceId || surface.leafId || surface.parentSurfaceId || surface.label || `surface_${index + 1}`);
}

function objectiveTruthSurfaceFiles(surface = {}) {
  return stableList([
    ...(surface.productFiles || []),
    ...(surface.product_files || []),
    ...(surface.targetFiles || []),
    ...(surface.target_files || []),
    ...(surface.allowedFiles || []),
    ...(surface.allowed_files || []),
    surface.productFile,
    surface.targetFile
  ]).filter(isProductSourceFile);
}

function objectiveTruthSurfaceTests(surface = {}) {
  return stableList([
    ...(surface.targetedTests || []),
    ...(surface.targeted_tests || []),
    ...(surface.verification || []).filter((entry) => /(?:^|\s)(?:node\s+--test|npm\s+test|pnpm\s+test|yarn\s+test)/.test(String(entry || ''))),
    surface.testFile
  ]);
}

function objectiveTruthSurfaceWork(surface = {}, index = 0) {
  const id = objectiveTruthSurfaceId(surface, index);
  const productFiles = objectiveTruthSurfaceFiles(surface);
  const targetedTests = objectiveTruthSurfaceTests(surface);
  const label = surface.label || surface.title || id;
  const blockers = Array.isArray(surface.blockers) ? surface.blockers : [];
  const blockerText = blockers.map((blocker) => blocker.kind || blocker.reason || blocker.metric || blocker.blockerKind || '').filter(Boolean).join(', ');
  return {
    id: `objective_truth_surface__${slugify(id)}`,
    sourceId: id,
    sourceKind: 'surface_matrix',
    parentSurfaceId: surface.parentSurfaceId || surface.parentId || null,
    lane: surface.lane || surface.productLane || surface.domain || 'objective_truth_surface',
    productGoal: surface.productGoal || surface.requiredWork || surface.goal || `Close or honestly block objective surface ${label}.${blockerText ? ` Current blockers: ${blockerText}.` : ''}`,
    allowedFiles: stableList([...(surface.allowedFiles || []), ...(surface.allowed_files || []), ...productFiles, ...targetedTests]),
    productFiles,
    targetFiles: productFiles,
    targetedTests,
    verification: stableList([...(surface.verification || []), ...targetedTests.map((file) => `node --test ${file}`)]),
    stopCondition: surface.stopCondition || 'objective_surface_green_or_blocker_report',
    originalSurface: surface
  };
}

function objectiveTruthWorkQueue(queue = {}) {
  if (Array.isArray(queue)) return queue;
  if (Array.isArray(queue.work)) return queue.work;
  if (Array.isArray(queue.nextWorkQueue)) return queue.nextWorkQueue;
  if (Array.isArray(queue.next_work_queue)) return queue.next_work_queue;
  if (Array.isArray(queue.surfaces)) return queue.surfaces;
  return [];
}

function normalizeObjectiveWorkItem(item = {}, index = 0, sourceKind = 'next_work_queue') {
  const id = String(item.id || item.surfaceId || item.parentSurfaceId || item.label || `work_${index + 1}`);
  const productFiles = objectiveTruthSurfaceFiles(item);
  const targetedTests = objectiveTruthSurfaceTests(item);
  return {
    id: `objective_truth_${sourceKind}__${slugify(id)}`,
    sourceId: id,
    sourceKind,
    parentSurfaceId: item.parentSurfaceId || item.parentId || null,
    lane: item.lane || item.productLane || item.domain || sourceKind,
    productGoal: item.productGoal || item.requiredWork || item.goal || item.strictGap || `Close or honestly block objective work item ${id}.`,
    allowedFiles: stableList([...(item.allowedFiles || []), ...(item.allowed_files || []), ...productFiles, ...targetedTests]),
    productFiles,
    targetFiles: productFiles,
    targetedTests,
    verification: stableList([...(item.verification || []), ...targetedTests.map((file) => `node --test ${file}`)]),
    stopCondition: item.stopCondition || 'objective_work_item_green_or_blocker_report',
    originalWorkItem: item
  };
}

function numericObjectiveCount(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

export function deriveObjectiveTruth({
  surfaceMatrix = null,
  negativeSpace = null,
  productionQualityGate = null,
  completedSurfaceIds = [],
  metrics = {},
  target = {},
  requireSurfaceMatrix = false,
  requireNegativeSpace = false,
  requireProductionQuality = false,
  generatedAt = new Date().toISOString()
} = {}) {
  const objectiveConfig = target.objectiveTruth || target.supervisorTruth || {};
  const surfaceMatrixRequired = requireSurfaceMatrix || target.surfaceMatrixRequired === true || objectiveConfig.surfaceMatrixRequired === true;
  const negativeSpaceRequired = requireNegativeSpace || target.negativeSpaceRequired === true || objectiveConfig.negativeSpaceRequired === true;
  const productionQualityRequired = requireProductionQuality || target.productionQualityRequired === true || target.architectureQualityRequired === true || objectiveConfig.productionQualityRequired === true;
  const enabled = surfaceMatrixRequired || negativeSpaceRequired || productionQualityRequired || Boolean(surfaceMatrix || negativeSpace || productionQualityGate);

  const failures = [];
  const nextWorkQueue = [];
  const completed = objectiveTruthCompletionSet(completedSurfaceIds);

  const matrixPresent = Boolean(surfaceMatrix && typeof surfaceMatrix === 'object');
  const matrixSurfaces = matrixPresent && Array.isArray(surfaceMatrix.surfaces) ? surfaceMatrix.surfaces : [];
  const rawRedMatrixSurfaces = matrixSurfaces.filter((surface, index) => {
    const status = objectiveTruthStatus(surface.status || surface.supervisorStatus || surface.matrixStatus || surface.parityStatus);
    if (status === 'green') return false;
    if (status === 'unknown' && (surface.blockers || surface.requiredWork || surface.open_gap_families || surface.evidence)) return true;
    return status !== 'green';
  });
  const completedRedMatrixSurfaces = rawRedMatrixSurfaces.filter((surface, index) => objectiveTruthItemCompleted(objectiveTruthSurfaceCompletionKeys(surface, matrixSurfaces.indexOf(surface) >= 0 ? matrixSurfaces.indexOf(surface) : index), completed));
  const redMatrixSurfaces = rawRedMatrixSurfaces.filter((surface, index) => !objectiveTruthItemCompleted(objectiveTruthSurfaceCompletionKeys(surface, matrixSurfaces.indexOf(surface) >= 0 ? matrixSurfaces.indexOf(surface) : index), completed));
  const blockedMatrixSurfaces = redMatrixSurfaces.filter((surface) => objectiveTruthStatus(surface.status || surface.supervisorStatus || surface.matrixStatus || surface.parityStatus) === 'red' && /block/.test(String(surface.status || surface.supervisorStatus || '').toLowerCase()));
  const rawMatrixOverallStatus = matrixPresent
    ? objectiveTruthStatus(surfaceMatrix.status || surfaceMatrix.matrixStatus || surfaceMatrix.surfaceMatrixStatus || surfaceMatrix.parityStatus || (redMatrixSurfaces.length ? 'red' : 'all_complete'))
    : 'missing';
  const matrixOverallStatus = matrixPresent && rawRedMatrixSurfaces.length > 0 && redMatrixSurfaces.length === 0
    ? 'green'
    : rawMatrixOverallStatus;
  const matrixOk = matrixPresent ? matrixOverallStatus === 'green' && redMatrixSurfaces.length === 0 : !surfaceMatrixRequired;
  if (!matrixOk) {
    failures.push({
      metric: 'surfaceMatrixStatus',
      actual: matrixPresent ? (surfaceMatrix.status || surfaceMatrix.matrixStatus || surfaceMatrix.surfaceMatrixStatus || 'red') : null,
      requirement: 'all_complete',
      reason: matrixPresent ? 'surface_matrix_red' : 'surface_matrix_missing',
      redSurfaceCount: redMatrixSurfaces.length,
      completedRedSurfaceCount: completedRedMatrixSurfaces.length
    });
    redMatrixSurfaces.forEach((surface, index) => nextWorkQueue.push(objectiveTruthSurfaceWork(surface, index)));
  }

  const negativePresent = Boolean(negativeSpace && typeof negativeSpace === 'object');
  const rawNegativeWork = negativePresent ? objectiveTruthWorkQueue(negativeSpace) : [];
  const completedNegativeWork = rawNegativeWork.filter((item, index) => objectiveTruthItemCompleted(objectiveTruthWorkCompletionKeys(item, index, 'negative_space'), completed));
  const negativeWork = rawNegativeWork.filter((item, index) => !objectiveTruthItemCompleted(objectiveTruthWorkCompletionKeys(item, index, 'negative_space'), completed));
  const rawOpenNegativeSpaceCount = negativePresent
    ? numericObjectiveCount(negativeSpace.openNegativeSpaceCandidateCount, negativeSpace.negativeSpaceCandidateCount, negativeSpace.nextWorkQueueCount, negativeSpace.count, rawNegativeWork.length) ?? 0
    : null;
  const openNegativeSpaceCount = negativePresent ? Math.max(0, Number(rawOpenNegativeSpaceCount || 0) - completedNegativeWork.length) : null;
  const negativeSpaceOk = negativePresent
    ? (negativeSpace.thresholdPass === true || negativeSpace.ok === true || Number(openNegativeSpaceCount || 0) === 0)
    : !negativeSpaceRequired;
  if (!negativeSpaceOk) {
    failures.push({
      metric: 'negativeSpaceOpenCount',
      actual: negativePresent ? openNegativeSpaceCount : null,
      requirement: '= 0',
      reason: negativePresent ? 'negative_space_open' : 'negative_space_missing'
    });
    negativeWork.forEach((item, index) => nextWorkQueue.push(normalizeObjectiveWorkItem(item, index, 'negative_space')));
  }

  const qualityPresent = Boolean(productionQualityGate && typeof productionQualityGate === 'object') || metrics.productionQualityGatePass != null;
  const qualityMetrics = productionQualityGate?.metrics || productionQualityGate || {};
  const productionQualityOk = qualityPresent
    ? (productionQualityGate?.ok === true || Number(metrics.productionQualityGatePass ?? qualityMetrics.productionQualityGatePass ?? 0) === 1)
    : !productionQualityRequired;
  if (!productionQualityOk) {
    failures.push({
      metric: 'productionQualityGatePass',
      actual: qualityPresent ? Number(metrics.productionQualityGatePass ?? qualityMetrics.productionQualityGatePass ?? 0) : null,
      requirement: '= 1',
      reason: qualityPresent ? 'production_quality_gate_failed' : 'production_quality_gate_missing'
    });
  }

  const executableNextWorkQueue = nextWorkQueue.filter((item) => objectiveTruthSurfaceFiles(item).length > 0 || (item.productFiles || []).some(isProductSourceFile));
  const supervisorStatus = failures.length === 0 ? 'green' : 'red';
  const primaryFailure = failures[0] || null;
  const blockerKind = primaryFailure?.reason || null;
  const blocker = supervisorStatus === 'green' ? null : {
    blocker: 'Objective truth is red; orchestration cannot claim completion from throughput alone.',
    blockerKind,
    nextAction: executableNextWorkQueue.length
      ? 'Continue with objective-truth repair surfaces until the matrix, negative-space queue, and required quality gate are green.'
      : 'Add or repair executable objective-truth work items with product target files, or write a precise blocker for the missing proof.',
    failures,
    redSurfaceCount: redMatrixSurfaces.length,
    openNegativeSpaceCount,
    executableWorkItemCount: executableNextWorkQueue.length
  };

  return {
    schemaVersion: 'clawd.objective_truth.v1',
    generatedAt,
    enabled,
    supervisorStatus,
    thresholdPass: supervisorStatus === 'green',
    stopAllowed: supervisorStatus === 'green',
    failures,
    blocker,
    surfaceMatrix: {
      required: surfaceMatrixRequired,
      present: matrixPresent,
      ok: matrixOk,
      status: matrixPresent ? (matrixOk ? 'all_complete' : (surfaceMatrix.status || surfaceMatrix.matrixStatus || surfaceMatrix.surfaceMatrixStatus || 'red')) : 'missing',
      rawStatus: matrixPresent ? (surfaceMatrix.status || surfaceMatrix.matrixStatus || surfaceMatrix.surfaceMatrixStatus || null) : null,
      surfaceCount: matrixSurfaces.length,
      rawRedSurfaceCount: rawRedMatrixSurfaces.length,
      redSurfaceCount: redMatrixSurfaces.length,
      completedRedSurfaceCount: completedRedMatrixSurfaces.length,
      blockedSurfaceCount: blockedMatrixSurfaces.length
    },
    negativeSpace: {
      required: negativeSpaceRequired,
      present: negativePresent,
      ok: negativeSpaceOk,
      openCount: openNegativeSpaceCount,
      rawOpenCount: rawOpenNegativeSpaceCount,
      completedWorkItemCount: completedNegativeWork.length,
      workItemCount: negativeWork.length
    },
    productionQuality: {
      required: productionQualityRequired,
      present: qualityPresent,
      ok: productionQualityOk,
      metrics: qualityMetrics
    },
    nextWorkQueue,
    executableNextWorkQueue,
    remainingExecutableSurfaceCount: executableNextWorkQueue.length
  };
}

export function createObjectiveTruthRepairSurfaces({
  objectiveTruth = {},
  qualityGate = null,
  state = {},
  waveNumber = null,
  maxSurfaces = 100,
  generatedAt = new Date().toISOString()
} = {}) {
  const surfaces = [];
  if (objectiveTruth?.productionQuality?.required === true && objectiveTruth?.productionQuality?.ok !== true && qualityGate) {
    surfaces.push(...createProductionQualityRepairSurfaces({
      qualityGate,
      state,
      waveNumber,
      maxSurfaces,
      generatedAt
    }));
  }

  const queue = Array.isArray(objectiveTruth?.executableNextWorkQueue) && objectiveTruth.executableNextWorkQueue.length
    ? objectiveTruth.executableNextWorkQueue
    : Array.isArray(objectiveTruth?.nextWorkQueue) ? objectiveTruth.nextWorkQueue : [];
  for (const item of queue) {
    const productFiles = objectiveTruthSurfaceFiles(item);
    if (!productFiles.length) continue;
    const targetedTests = objectiveTruthSurfaceTests(item);
    const id = String(item.id || item.sourceId || `objective_truth_work_${surfaces.length + 1}`);
    surfaces.push({
      id,
      label: item.label || `Objective truth repair: ${item.sourceId || id}`,
      lane: item.lane || 'objective_truth_repair',
      productLane: item.productLane || item.lane || 'objective_truth_repair',
      domain: item.domain || 'objective_truth_repair',
      productGoal: [
        'Generic agent-orchestration objective-truth repair objective: close the referenced surface/negative-space gap without relying on benchmark-specific shims.',
        item.productGoal || item.requiredWork || item.goal || `Close objective work item ${item.sourceId || id}.`,
        'Make a real product-surface change in the allowed target files and provide executable proof; docs-only, tests-only, and marker-only changes do not count.'
      ].join('\n'),
      targetFiles: productFiles,
      productFiles,
      allowedFiles: stableList([...(item.allowedFiles || []), ...productFiles, ...targetedTests]),
      verification: stableList([...(item.verification || []), ...targetedTests.map((file) => `node --test ${file}`)]),
      targetedTests,
      stopCondition: item.stopCondition || 'objective_surface_green_or_blocker_report',
      issueIds: stableList([id, item.sourceId, item.sourceKind, ...productFiles]),
      status: 'planned',
      phase: `objective_truth_repair_wave_${String(waveNumber || 'next').padStart(3, '0')}`,
      metadata: {
        ...(item.metadata || {}),
        objectiveTruthRepair: true,
        objectiveTruthRepairGeneratedAt: generatedAt,
        objectiveTruthRepairWave: waveNumber || null,
        objectiveTruthSourceKind: item.sourceKind || 'objective_truth',
        objectiveTruthSourceId: item.sourceId || id,
        freshProductDiffRequired: true,
        creativeProductWorkRequired: true,
        primaryFileConstrained: productFiles.length === 1
      }
    });
    if (surfaces.length >= Math.max(1, Number(maxSurfaces || 100))) break;
  }
  return surfaces.slice(0, Math.max(1, Number(maxSurfaces || 100)));
}

export function buildObjectiveExpansionSurfaces({
  surfaces = [],
  maxExpansionCycles = 20,
  dimensions = DEFAULT_OBJECTIVE_EXPANSION_DIMENSIONS
} = {}) {
  const catalog = buildExecutableSurfaceCatalog(surfaces);
  const firstByPrimaryFile = new Map();
  for (const surface of catalog) {
    const primary = primaryProductFile(surface);
    if (primary && !firstByPrimaryFile.has(primary)) firstByPrimaryFile.set(primary, surface);
  }
  const expanded = [];
  const safeDimensions = Array.isArray(dimensions) && dimensions.length ? dimensions : DEFAULT_OBJECTIVE_EXPANSION_DIMENSIONS;
  for (let cycle = 1; cycle <= Math.max(0, Number(maxExpansionCycles || 0)); cycle += 1) {
    let dimensionIndex = 0;
    for (const surface of firstByPrimaryFile.values()) {
      const dimension = safeDimensions[(cycle + dimensionIndex - 1) % safeDimensions.length];
      const expandedSurface = createObjectiveExpansionSurface(surface, { cycle, dimension, dimensionIndex });
      if (expandedSurface) expanded.push(expandedSurface);
      dimensionIndex += 1;
    }
  }
  return expanded;
}

export function buildContinuousSurfaceInventory({ surfaces = [], maxExpansionCycles = 20, includeObjectiveExpansion = true } = {}) {
  const baseCatalog = buildExecutableSurfaceCatalog(surfaces);
  const expansionSurfaces = includeObjectiveExpansion ? buildObjectiveExpansionSurfaces({ surfaces, maxExpansionCycles }) : [];
  return {
    surfaces: [...baseCatalog, ...expansionSurfaces],
    baseSurfaceCount: baseCatalog.length,
    expansionSurfaceCount: expansionSurfaces.length,
    totalSurfaceCount: baseCatalog.length + expansionSurfaces.length
  };
}

function uniquePrimaryProductFileCount(surfaces = []) {
  return new Set(buildExecutableSurfaceCatalog(surfaces).map(primaryProductFile).filter(Boolean)).size;
}

export function planObjectiveExpansionSurfaceSelection({
  surfaces = [],
  state = {},
  requestedAgentCount = 1,
  maxAttemptsPerSurface = 3,
  activeMaxExpansionCycles = 1,
  hardMaxExpansionCycles = activeMaxExpansionCycles,
  expansionBatchCycles = 1,
  includeObjectiveExpansion = true
} = {}) {
  const requested = Math.max(1, Number(requestedAgentCount || 1));
  const hard = Math.max(1, Number(hardMaxExpansionCycles || activeMaxExpansionCycles || 1));
  const batch = Math.max(1, Number(expansionBatchCycles || 1));
  const initialActiveMaxExpansionCycles = Math.max(1, Math.min(hard, Number(activeMaxExpansionCycles || 1)));
  let active = initialActiveMaxExpansionCycles;
  const uniquePrimaryFileCount = uniquePrimaryProductFileCount(surfaces);
  const desiredSelectionCount = Math.max(1, Math.min(requested, uniquePrimaryFileCount || requested));

  const buildSelection = () => {
    const inventory = buildContinuousSurfaceInventory({
      surfaces,
      maxExpansionCycles: active,
      includeObjectiveExpansion
    });
    const selection = selectNextWaveSurfaces({
      surfaces: inventory.surfaces,
      state,
      requestedAgentCount: requested,
      maxAttemptsPerSurface
    });
    return { inventory, selection };
  };

  let { inventory, selection } = buildSelection();
  while (includeObjectiveExpansion && selection.selected.length < desiredSelectionCount && active < hard) {
    active = Math.min(hard, active + batch);
    ({ inventory, selection } = buildSelection());
  }

  return {
    inventory,
    selection,
    activeMaxExpansionCycles: active,
    initialActiveMaxExpansionCycles,
    hardMaxExpansionCycles: hard,
    expansionBatchCycles: batch,
    uniquePrimaryProductFileCount: uniquePrimaryFileCount,
    desiredSelectionCount,
    selectionShortfall: Math.max(0, desiredSelectionCount - selection.selected.length),
    expandedForUnderfilledWave: active > initialActiveMaxExpansionCycles
  };
}

export function buildExecutableSurfaceCatalog(surfaces = []) {
  return stableList(surfaces.map((surface) => surfaceWorkKey(surface)))
    .map((id) => surfaces.find((surface) => surfaceWorkKey(surface) === id))
    .map(surfaceWithPrimaryFile)
    .filter(Boolean);
}

function compareSurfaceForScheduling(a, b, state) {
  const aId = surfaceWorkKey(a);
  const bId = surfaceWorkKey(b);
  const aAttempts = Number(state.surfaceAttempts?.[aId] || 0);
  const bAttempts = Number(state.surfaceAttempts?.[bId] || 0);
  if (aAttempts !== bAttempts) return aAttempts - bAttempts;
  const aLast = Number(state.surfaceLastWave?.[aId] || 0);
  const bLast = Number(state.surfaceLastWave?.[bId] || 0);
  if (aLast !== bLast) return aLast - bLast;
  return aId.localeCompare(bId);
}

export function selectNextWaveSurfaces({
  surfaces = [],
  state = {},
  requestedAgentCount = 1,
  maxAttemptsPerSurface = 3,
  avoidRecentlyRejectedFiles = true,
  recentlyRejectedWaveWindow = Number.POSITIVE_INFINITY,
  allowRecentlyRejectedFileFallback = false
} = {}) {
  const catalog = buildExecutableSurfaceCatalog(surfaces);
  const completed = new Set(state.completedSurfaceIds || []);
  const recentRejectedFiles = avoidRecentlyRejectedFiles
    ? stableList([
      ...(state.lastRejectedProductFiles || []),
      ...(Array.isArray(state.waveSummaries)
        ? state.waveSummaries.slice(-Math.max(0, Number(recentlyRejectedWaveWindow || 0))).flatMap((wave) => wave?.rejectedProductFiles || [])
        : [])
    ])
    : [];
  const rejectedFiles = new Set(recentRejectedFiles);
  const selected = [];
  const selectedFiles = new Set();
  const candidates = catalog
    .filter((surface) => !completed.has(surfaceWorkKey(surface)))
    .filter((surface) => Number(state.surfaceAttempts?.[surfaceWorkKey(surface)] || 0) < maxAttemptsPerSurface)
    .sort((a, b) => compareSurfaceForScheduling(a, b, state));

  for (const pass of [0, 1]) {
    for (const surface of candidates) {
      if (selected.length >= requestedAgentCount) break;
      const id = surfaceWorkKey(surface);
      if (selected.some((entry) => surfaceWorkKey(entry) === id)) continue;
      const primary = primaryProductFile(surface);
      if (!primary || selectedFiles.has(primary)) continue;
      if (rejectedFiles.has(primary) && (pass === 0 || (!allowRecentlyRejectedFileFallback && selected.length > 0))) continue;
      selected.push(surface);
      selectedFiles.add(primary);
    }
    if (selected.length >= requestedAgentCount) break;
  }

  return {
    selected,
    selectedSurfaceIds: selected.map(surfaceWorkKey),
    selectedProductFiles: selected.map(primaryProductFile).filter(Boolean),
    remainingExecutableSurfaceCount: candidates.length - selected.length,
    catalogSurfaceCount: catalog.length
  };
}

export function buildCollisionAwareRepairSelection({
  repairSurfaces = [],
  backfillSurfaces = [],
  state = {},
  requestedSurfaceCount = 1,
  maxAttemptsPerSurface = 3
} = {}) {
  const limit = Math.max(1, Number(requestedSurfaceCount || 1));
  const completed = new Set(state.completedSurfaceIds || []);
  const selected = [];
  const selectedRepair = [];
  const selectedBackfill = [];
  const usedSurfaceIds = new Set();
  const usedFiles = new Set();
  const repairIds = new Set(buildExecutableSurfaceCatalog(repairSurfaces).map(surfaceWorkKey));
  const deferredRepairSurfaces = [];

  const canAttempt = (surface) => {
    const id = surfaceWorkKey(surface);
    return id
      && !completed.has(id)
      && Number(state.surfaceAttempts?.[id] || 0) < Math.max(1, Number(maxAttemptsPerSurface || 3));
  };
  const fileConflicts = (surface) => productFilesForSurface(surface).filter((file) => usedFiles.has(file));
  const rememberSelected = (surface, collection) => {
    selected.push(surface);
    collection.push(surface);
    usedSurfaceIds.add(surfaceWorkKey(surface));
    for (const file of productFilesForSurface(surface)) usedFiles.add(file);
  };

  const repairCandidates = buildExecutableSurfaceCatalog(repairSurfaces).filter(canAttempt);
  for (const surface of repairCandidates) {
    if (selected.length >= limit) {
      deferredRepairSurfaces.push({ surfaceId: surfaceWorkKey(surface), reason: 'wave_selection_limit_reached', productFiles: productFilesForSurface(surface) });
      continue;
    }
    const conflictingFiles = fileConflicts(surface);
    if (conflictingFiles.length) {
      deferredRepairSurfaces.push({ surfaceId: surfaceWorkKey(surface), reason: 'same_wave_product_file_overlap', conflictingFiles, productFiles: productFilesForSurface(surface) });
      continue;
    }
    rememberSelected(surface, selectedRepair);
  }

  const backfillCandidates = buildExecutableSurfaceCatalog(backfillSurfaces)
    .filter(canAttempt)
    .filter((surface) => !repairIds.has(surfaceWorkKey(surface)))
    .sort((a, b) => compareSurfaceForScheduling(a, b, state));
  for (const surface of backfillCandidates) {
    if (selected.length >= limit) break;
    const id = surfaceWorkKey(surface);
    if (usedSurfaceIds.has(id)) continue;
    if (fileConflicts(surface).length) continue;
    rememberSelected(surface, selectedBackfill);
  }

  const selectedProductFiles = stableList(selected.flatMap((surface) => productFilesForSurface(surface)));
  return {
    selected,
    selectedSurfaceIds: selected.map(surfaceWorkKey),
    selectedProductFiles,
    remainingExecutableSurfaceCount: Math.max(0, repairCandidates.length - selectedRepair.length) + Math.max(0, backfillCandidates.length - selectedBackfill.length),
    catalogSurfaceCount: repairCandidates.length + backfillCandidates.length,
    repairBackfill: {
      enabled: true,
      requestedSurfaceCount: limit,
      repairCandidateCount: repairCandidates.length,
      selectedRepairSurfaceCount: selectedRepair.length,
      selectedBackfillSurfaceCount: selectedBackfill.length,
      deferredRepairSurfaceCount: deferredRepairSurfaces.length,
      selectedRepairSurfaceIds: selectedRepair.map(surfaceWorkKey),
      selectedBackfillSurfaceIds: selectedBackfill.map(surfaceWorkKey),
      deferredRepairSurfaces: deferredRepairSurfaces.slice(0, 200),
      selectedProductFiles
    }
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createWaveRunContract({
  baseContract,
  controllerArtifactRoot,
  waveNumber,
  selectedSurfaces,
  repoPath,
  waveDurationTargetMinutes = 10,
  waveMaxAttemptsPerTask = 2,
  generatedAt = new Date().toISOString()
}) {
  if (!baseContract || typeof baseContract !== 'object') throw new Error('baseContract is required');
  const waveId = `wave-${String(waveNumber).padStart(3, '0')}`;
  const artifactRoot = path.join(controllerArtifactRoot, 'waves', waveId);
  const contract = cloneJson(baseContract);
  contract.generatedAt = generatedAt;
  contract.runId = `${baseContract.runId || baseContract.benchmarkId || 'continuous'}-${waveId}`;
  contract.parentRunId = baseContract.runId || null;
  contract.artifactRoot = artifactRoot;
  contract.localArtifactRoot = artifactRoot;
  contract.repoPath = repoPath || baseContract.repoPath;
  contract.executionBoundary = baseContract.executionBoundary || 'remote_execution_required';
  contract.stopCondition = 'wave_green_or_blocker_report';
  contract.scope ||= {};
  const controllerManagedExpansionPolicy = cloneJson(contract.scope.expansionPolicy || {});
  contract.scope = {
    ...contract.scope,
    durationTargetMinutes: waveDurationTargetMinutes,
    continuousControllerWave: true,
    waveNumber,
    waveMaxAttemptsPerTask,
    expansionPolicy: {},
    surfaces: selectedSurfaces.map((surface, index) => ({
      ...cloneJson(surface),
      phase: `continuous_controller_${waveId}_${String(index + 1).padStart(3, '0')}`,
      metadata: {
        ...(surface.metadata || {}),
        continuousControllerWave: waveNumber,
        continuousControllerWaveId: waveId,
        continuousControllerSelectedAt: generatedAt
      }
    }))
  };
  contract.metadata ||= {};
  contract.metadata.continuousControllerManagedExpansionPolicy = controllerManagedExpansionPolicy;
  if (contract.metadata.agentWorkDsl?.policies?.expansionPolicy) {
    contract.metadata.agentWorkDsl.policies.expansionPolicy = {};
  }
  return contract;
}

export function summarizePatchQueue(patchQueue = {}) {
  const merged = Array.isArray(patchQueue.merged) ? patchQueue.merged : [];
  const rejected = Array.isArray(patchQueue.rejected) ? patchQueue.rejected : Array.isArray(patchQueue.rejections) ? patchQueue.rejections : [];
  const implementationEvidence = (entry = {}) => entry.metadata?.implementation || entry.implementation || {};
  const creativeEvidence = (entry = {}) => implementationEvidence(entry).metadata?.creativeWorkerEvidence || entry.metadata?.creativeWorkerEvidence || entry.creativeWorkerEvidence || {};
  const architectureEvidence = (entry = {}) => implementationEvidence(entry).metadata?.architectureEvidence || entry.metadata?.architectureEvidence || entry.architectureEvidence || {};
  const implementationCommand = (entry = {}) => String(implementationEvidence(entry).command || implementationEvidence(entry).metadata?.workerCommand || '');
  const implementationMode = (entry = {}) => String(implementationEvidence(entry).metadata?.benchmarkMode || implementationEvidence(entry).metadata?.productDiffMode || implementationEvidence(entry).mode || '');
  const implementationRuntimeMs = (entry = {}) => Number(implementationEvidence(entry).durationMs || creativeEvidence(entry).creativeWorkerRuntimeMs || 0);
  const evidenceProductFiles = (entry = {}) => stableList([
    ...(creativeEvidence(entry).productModifiedFiles || []),
    ...(implementationEvidence(entry).metadata?.productModifiedFiles || []),
    ...(implementationEvidence(entry).modifiedFiles || [])
  ]).filter(isProductSourceFile);
  const creativeWorkerEvidenceOk = (entry = {}) => {
    const evidence = creativeEvidence(entry);
    const command = implementationCommand(entry);
    return evidence.evidencePresent === true
      && evidence.ok !== false
      && command.length > 0
      && /codex|creative-worker/i.test(command)
      && /creative_product_work/i.test(implementationMode(entry))
      && implementationRuntimeMs(entry) > 0;
  };
  const creativeIterationOk = (entry = {}) => {
    const evidence = creativeEvidence(entry);
    return evidence.evidencePresent === true
      && evidence.ok !== false
      && Number(evidence.iterationCount || implementationEvidence(entry).metadata?.creativeIterations || 0) > 0;
  };
  const creativeProductDeltaOk = (entry = {}) => {
    const evidence = creativeEvidence(entry);
    const productFiles = evidenceProductFiles(entry);
    return evidence.evidencePresent === true
      && evidence.ok !== false
      && Number(evidence.productTargetsModifiedCount || productFiles.length || 0) > 0
      && productFiles.length > 0;
  };
  const creativeTemplateFallback = (entry = {}) => {
    const evidence = creativeEvidence(entry);
    return evidence.templateFallback === true
      || evidence.templateFallbackUsed === true
      || implementationEvidence(entry).metadata?.templateFallback === true
      || (Array.isArray(evidence.failureReasons) && evidence.failureReasons.some((reason) => /template.*fallback/i.test(String(reason || ''))));
  };
  const architectureLayeredDesignOk = (entry = {}) => {
    const evidence = architectureEvidence(entry);
    const layerCount = Number(evidence.layerCount || (Array.isArray(evidence.layers) ? evidence.layers.length : 0) || 0);
    const evidencePrimaryFileCount = Array.isArray(evidence.evidencePrimaryRuntimeFiles)
      ? evidence.evidencePrimaryRuntimeFiles.length
      : Array.isArray(evidence.modifiedPrimaryRuntimeFiles)
      ? evidence.modifiedPrimaryRuntimeFiles.length
      : 0;
    const signaledFileCount = Array.isArray(evidence.signaledFiles) ? evidence.signaledFiles.length : 0;
    return layerCount >= 2 && evidencePrimaryFileCount >= 2 && signaledFileCount >= 2;
  };
  const architectureRuntimeIntegrationOk = (entry = {}) => {
    const evidence = architectureEvidence(entry);
    return evidence.runtimeIntegrated === true
      || evidence.runtimeIntegrationEvidence?.ok === true
      || evidence.integrationEvidence?.ok === true;
  };
  const architectureProductDeltaOk = (entry = {}) => {
    const evidence = architectureEvidence(entry);
    const modifiedPrimaryFileCount = Array.isArray(evidence.modifiedPrimaryRuntimeFiles) ? evidence.modifiedPrimaryRuntimeFiles.length : 0;
    const modifiedRequiredLayerCount = Array.isArray(evidence.modifiedRequiredLayers)
      ? evidence.modifiedRequiredLayers.length
      : modifiedPrimaryFileCount > 0 ? 1 : 0;
    const modifiedSignaledFileCount = Array.isArray(evidence.modifiedSignaledFiles)
      ? evidence.modifiedSignaledFiles.length
      : modifiedPrimaryFileCount > 0 ? 1 : 0;
    return modifiedPrimaryFileCount >= 1 && modifiedRequiredLayerCount >= 1 && modifiedSignaledFileCount >= 1;
  };
  const architectureBoilerplateViolation = (entry = {}) => {
    const evidence = architectureEvidence(entry);
    return evidence.markerOnly === true
      || evidence.semanticBloatAudit?.semanticBloatSuspect === true
      || evidence.runtimeIntegrationEvidence?.generatedRuntimeOnly === true
      || evidence.runtimeIntegrationEvidence?.existingProductCallRequired === true && evidence.runtimeIntegrationEvidence?.existingProductCallWired !== true
      || evidence.reason === 'semantic_bloat_product_delta'
      || evidence.reason === 'shallow_semantic_patch'
      || evidence.reason === 'export_only_semantic_runtime';
  };
  const architectureEvidenceOk = (entry = {}) => {
    const evidence = architectureEvidence(entry);
    return evidence.ok === true
      && architectureLayeredDesignOk(entry)
      && architectureRuntimeIntegrationOk(entry)
      && architectureProductDeltaOk(entry)
      && !architectureBoilerplateViolation(entry);
  };
  const creativeEvidenceSummary = (() => {
    const evaluatedMergedPatchCount = merged.length;
    const creativeWorkerEvidenceOkCount = merged.filter(creativeWorkerEvidenceOk).length;
    const creativeIterationOkCount = merged.filter(creativeIterationOk).length;
    const creativeProductDeltaOkCount = merged.filter(creativeProductDeltaOk).length;
    const templateFallbackCount = merged.filter(creativeTemplateFallback).length;
    const ratio = (count) => evaluatedMergedPatchCount ? Number((count / evaluatedMergedPatchCount).toFixed(4)) : null;
    return {
      evaluatedMergedPatchCount,
      creativeWorkerEvidenceOkCount,
      creativeIterationOkCount,
      creativeProductDeltaOkCount,
      templateFallbackCount,
      creativeWorkerEvidenceIntegrity: ratio(creativeWorkerEvidenceOkCount),
      creativeIterationIntegrity: ratio(creativeIterationOkCount),
      creativeProductDeltaIntegrity: ratio(creativeProductDeltaOkCount),
      templateFallbackRate: ratio(templateFallbackCount)
    };
  })();
  const architectureEvidenceSummary = (() => {
    const evaluatedMergedPatchCount = merged.length;
    const architectureEvidenceOkCount = merged.filter(architectureEvidenceOk).length;
    const architectureLayeredDesignOkCount = merged.filter(architectureLayeredDesignOk).length;
    const architectureRuntimeIntegrationOkCount = merged.filter(architectureRuntimeIntegrationOk).length;
    const architectureProductDeltaOkCount = merged.filter(architectureProductDeltaOk).length;
    const architectureBoilerplateViolationCount = merged.filter(architectureBoilerplateViolation).length;
    const ratio = (count) => evaluatedMergedPatchCount ? Number((count / evaluatedMergedPatchCount).toFixed(4)) : null;
    return {
      evaluatedMergedPatchCount,
      architectureEvidenceOkCount,
      architectureLayeredDesignOkCount,
      architectureRuntimeIntegrationOkCount,
      architectureProductDeltaOkCount,
      architectureBoilerplateViolationCount,
      architectureFitnessScore: ratio(architectureEvidenceOkCount),
      architectureLayeredDesignIntegrity: ratio(architectureLayeredDesignOkCount),
      architectureRuntimeIntegrationIntegrity: ratio(architectureRuntimeIntegrationOkCount),
      architectureProductDeltaIntegrity: ratio(architectureProductDeltaOkCount),
      architectureBoilerplateViolationRate: ratio(architectureBoilerplateViolationCount)
    };
  })();
  const patchSurfaceIds = (entry = {}) => stableList([
    entry.shardId,
    entry.taskId,
    ...(entry.surfaceIds || []),
    ...(entry.metadata?.surfaceIds || []),
    ...(entry.metadata?.proofCarryingClaim?.surfaceIds || []),
    ...(entry.metadata?.architectureEvidence?.surfaceIds || []),
    ...(entry.metadata?.implementation?.metadata?.proofCarryingClaim?.surfaceIds || []),
    ...(entry.metadata?.implementation?.metadata?.architectureEvidence?.surfaceIds || []),
    ...(entry.metadata?.implementation?.metadata?.creativeWorkerEvidence?.sourceSurfaceIds || [])
  ]);
  const rejectionReason = (entry = {}) => entry.reason || entry.rejectionReason || entry.status || entry.metadata?.reason || 'unknown';
  const rejectionProductFiles = (entry = {}) => stableList(entry.filePaths || entry.files || []).filter(isProductSourceFile).sort();
  const rejectionBlockerSignature = (entry = {}) => {
    const reason = rejectionReason(entry);
    const files = rejectionProductFiles(entry);
    // Repeat-blocker scoring should identify repeated blocker families, not collapse
    // unrelated verifier failures under one broad rejection reason.  Product-file
    // clusters are the most stable artifact-level identity available across waves.
    return files.length ? `${reason}::${files.join('+')}` : reason;
  };
  const rejectedReasonCounts = {};
  const rejectedBlockerSignatureCounts = {};
  const rejectedProductFiles = new Set();
  for (const entry of rejected) {
    const reason = rejectionReason(entry);
    rejectedReasonCounts[reason] = (rejectedReasonCounts[reason] || 0) + 1;
    const signature = rejectionBlockerSignature(entry);
    rejectedBlockerSignatureCounts[signature] = (rejectedBlockerSignatureCounts[signature] || 0) + 1;
    for (const file of rejectionProductFiles(entry)) {
      if (isProductSourceFile(file)) rejectedProductFiles.add(file);
    }
  }
  return {
    mergedPatchCount: merged.length,
    rejectedPatchCount: rejected.length,
    mergedSurfaceIds: stableList(merged.flatMap(patchSurfaceIds)),
    mergedAgentIds: stableList(merged.map((entry) => entry.agentId)),
    mergedProductFiles: stableList(merged.flatMap((entry) => entry.filePaths || []).filter(isProductSourceFile)),
    creativeEvidenceSummary,
    architectureEvidenceSummary,
    rejectedReasonCounts,
    rejectedBlockerSignatureCounts,
    rejectedProductFiles: [...rejectedProductFiles]
  };
}

function countWaveTruthContradictions(completionSummary = {}, truthConflicts = null) {
  if (truthConflicts && Array.isArray(truthConflicts.contradictions)) return truthConflicts.contradictions.length;
  const rawCount = Number(completionSummary.runStateTruth?.truth?.contradictionCount || 0);
  const expectedWaveThresholdMiss = completionSummary.thresholdPass !== true
    && completionSummary.mechanicalGreen === true
    && completionSummary.scaleProofReady === true
    && Boolean(completionSummary.blocker)
    && /threshold|duration|tier/i.test(JSON.stringify(completionSummary.blocker || {}));
  return expectedWaveThresholdMiss ? 0 : rawCount;
}

export function summarizeWaveArtifacts({ completionSummary = {}, patchQueue = {}, truthConflicts = null, waveNumber = null } = {}) {
  const patchSummary = summarizePatchQueue(patchQueue || {});
  const landing = completionSummary.landingEvidenceSummary || {};
  return {
    waveNumber,
    runId: completionSummary.runId || null,
    thresholdPass: completionSummary.thresholdPass === true,
    mechanicalGreen: completionSummary.mechanicalGreen === true,
    scaleProofReady: completionSummary.scaleProofReady === true,
    durationMinutes: Number(completionSummary.durationMinutes || completionSummary.elapsedMinutes || 0),
    shardCount: Number(completionSummary.shardCount || 0),
    mergedShardCount: Number(completionSummary.mergedShardCount || patchSummary.mergedPatchCount || 0),
    rejectedPatchCount: Number(completionSummary.concurrencyTruth?.rejectedPatchCount ?? patchSummary.rejectedPatchCount ?? 0),
    peakConcurrency: Number(completionSummary.peakConcurrency || completionSummary.concurrencyTruth?.peakConcurrentWorkers || 0),
    uniqueAgentIds: stableList(completionSummary.concurrencyTruth?.uniqueAgentIds || patchSummary.mergedAgentIds || []),
    activeWorkerMinutes: Number(completionSummary.concurrencyTruth?.activeWorkerMinutes || 0),
    truthContradictions: countWaveTruthContradictions(completionSummary, truthConflicts),
    fakeGreenIncidents: completionSummary.thresholdPass === true && completionSummary.mechanicalGreen !== true ? 1 : 0,
    mergedSurfaceIds: patchSummary.mergedSurfaceIds,
    mergedProductFiles: patchSummary.mergedProductFiles,
    creativeEvidenceSummary: patchSummary.creativeEvidenceSummary,
    architectureEvidenceSummary: patchSummary.architectureEvidenceSummary,
    creativeEvidenceEvaluatedCount: Number(patchSummary.creativeEvidenceSummary?.evaluatedMergedPatchCount || 0),
    creativeWorkerEvidenceOkCount: Number(patchSummary.creativeEvidenceSummary?.creativeWorkerEvidenceOkCount || 0),
    creativeIterationOkCount: Number(patchSummary.creativeEvidenceSummary?.creativeIterationOkCount || 0),
    creativeProductDeltaOkCount: Number(patchSummary.creativeEvidenceSummary?.creativeProductDeltaOkCount || 0),
    templateFallbackCount: Number(patchSummary.creativeEvidenceSummary?.templateFallbackCount || 0),
    creativeWorkerEvidenceIntegrity: patchSummary.creativeEvidenceSummary?.creativeWorkerEvidenceIntegrity ?? null,
    creativeIterationIntegrity: patchSummary.creativeEvidenceSummary?.creativeIterationIntegrity ?? null,
    creativeProductDeltaIntegrity: patchSummary.creativeEvidenceSummary?.creativeProductDeltaIntegrity ?? null,
    templateFallbackRate: patchSummary.creativeEvidenceSummary?.templateFallbackRate ?? null,
    architectureEvidenceEvaluatedCount: Number(patchSummary.architectureEvidenceSummary?.evaluatedMergedPatchCount || 0),
    architectureEvidenceOkCount: Number(patchSummary.architectureEvidenceSummary?.architectureEvidenceOkCount || 0),
    architectureLayeredDesignOkCount: Number(patchSummary.architectureEvidenceSummary?.architectureLayeredDesignOkCount || 0),
    architectureRuntimeIntegrationOkCount: Number(patchSummary.architectureEvidenceSummary?.architectureRuntimeIntegrationOkCount || 0),
    architectureProductDeltaOkCount: Number(patchSummary.architectureEvidenceSummary?.architectureProductDeltaOkCount || 0),
    architectureBoilerplateViolationCount: Number(patchSummary.architectureEvidenceSummary?.architectureBoilerplateViolationCount || 0),
    architectureFitnessScore: patchSummary.architectureEvidenceSummary?.architectureFitnessScore ?? null,
    architectureLayeredDesignIntegrity: patchSummary.architectureEvidenceSummary?.architectureLayeredDesignIntegrity ?? null,
    architectureRuntimeIntegrationIntegrity: patchSummary.architectureEvidenceSummary?.architectureRuntimeIntegrationIntegrity ?? null,
    architectureProductDeltaIntegrity: patchSummary.architectureEvidenceSummary?.architectureProductDeltaIntegrity ?? null,
    architectureBoilerplateViolationRate: patchSummary.architectureEvidenceSummary?.architectureBoilerplateViolationRate ?? null,
    rejectedReasonCounts: patchSummary.rejectedReasonCounts,
    rejectedBlockerSignatureCounts: patchSummary.rejectedBlockerSignatureCounts,
    rejectedProductFiles: patchSummary.rejectedProductFiles,
    landingEvidenceSummary: landing,
    addedLineCount: Number(landing.addedLineStats?.addedLineCount || 0),
    uniqueNormalizedAddedLineCount: Number(landing.addedLineStats?.uniqueNormalizedAddedLineCount || 0),
    duplicateLineRatio: Number(landing.addedLineStats?.duplicateLineRatio || 0)
  };
}

export function updateContinuousStateFromWave({ state, waveSummary, selectedSurfaceIds = [], waveNumber }) {
  const next = cloneJson(state || {});
  next.waveSummaries ||= [];
  next.completedSurfaceIds ||= [];
  next.surfaceAttempts ||= {};
  next.surfaceLastWave ||= {};
  next.completedProductFiles ||= [];
  next.rejectedReasonCounts ||= {};
  next.rejectedBlockerSignatureCounts ||= {};
  next.controllerBudget ||= { callsStarted: 0, callsCompleted: 0, tokensObserved: 0, usageLimitObserved: false, usageLimitWaveNumbers: [], budgetLimitObserved: false, budgetLimitWaveNumbers: [], promptModes: {} };
  next.controllerBudget.promptModes ||= {};
  for (const id of selectedSurfaceIds) {
    next.surfaceAttempts[id] = Number(next.surfaceAttempts[id] || 0) + 1;
    next.surfaceLastWave[id] = waveNumber;
  }
  for (const id of waveSummary.mergedSurfaceIds || []) {
    if (!next.completedSurfaceIds.includes(id)) next.completedSurfaceIds.push(id);
  }
  for (const file of waveSummary.mergedProductFiles || []) {
    if (!next.completedProductFiles.includes(file)) next.completedProductFiles.push(file);
  }
  for (const [reason, count] of Object.entries(waveSummary.rejectedReasonCounts || {})) {
    next.rejectedReasonCounts[reason] = Number(next.rejectedReasonCounts[reason] || 0) + Number(count || 0);
  }
  for (const [signature, count] of Object.entries(waveSummary.rejectedBlockerSignatureCounts || {})) {
    next.rejectedBlockerSignatureCounts[signature] = Number(next.rejectedBlockerSignatureCounts[signature] || 0) + Number(count || 0);
  }
  next.lastRejectedProductFiles = waveSummary.rejectedProductFiles || [];
  if (waveSummary.budget) {
    next.controllerBudget.callsStarted = Number(next.controllerBudget.callsStarted || 0) + Number(waveSummary.budget.callsStarted || 0);
    next.controllerBudget.callsCompleted = Number(next.controllerBudget.callsCompleted || 0) + Number(waveSummary.budget.callsCompleted || 0);
    next.controllerBudget.tokensObserved = Number(next.controllerBudget.tokensObserved || 0) + Number(waveSummary.budget.tokensObserved || 0);
    const promptMode = normalizeContinuousPromptMode(waveSummary.promptMode || 'full_context');
    next.controllerBudget.promptModes[promptMode] ||= { callsStarted: 0, callsCompleted: 0, tokensObserved: 0, waveNumbers: [] };
    const promptBudget = next.controllerBudget.promptModes[promptMode];
    promptBudget.callsStarted = Number(promptBudget.callsStarted || 0) + Number(waveSummary.budget.callsStarted || 0);
    promptBudget.callsCompleted = Number(promptBudget.callsCompleted || 0) + Number(waveSummary.budget.callsCompleted || 0);
    promptBudget.tokensObserved = Number(promptBudget.tokensObserved || 0) + Number(waveSummary.budget.tokensObserved || 0);
    promptBudget.waveNumbers = stableList([...(promptBudget.waveNumbers || []), waveNumber]).map(Number).filter(Number.isFinite);
    if (waveObservedUsageLimit(waveSummary)) {
      next.controllerBudget.usageLimitObserved = true;
      next.controllerBudget.usageLimitWaveNumbers = stableList([...(next.controllerBudget.usageLimitWaveNumbers || []), waveNumber]).map(Number).filter(Number.isFinite);
    }
    if (waveObservedBudgetLimit(waveSummary)) {
      next.controllerBudget.budgetLimitObserved = true;
      next.controllerBudget.budgetLimitWaveNumbers = stableList([...(next.controllerBudget.budgetLimitWaveNumbers || []), waveNumber]).map(Number).filter(Number.isFinite);
    }
  }
  next.waveSummaries.push(waveSummary);
  return next;
}

function waveRejectedReasonCounts(wave = {}) {
  return wave?.rejectedReasonCounts && typeof wave.rejectedReasonCounts === 'object' ? wave.rejectedReasonCounts : {};
}

function waveRejectedBlockerSignatureCounts(wave = {}) {
  return wave?.rejectedBlockerSignatureCounts && typeof wave.rejectedBlockerSignatureCounts === 'object'
    ? wave.rejectedBlockerSignatureCounts
    : waveRejectedReasonCounts(wave);
}

function blockerSignatureReason(signature = '') {
  return String(signature || '').split('::')[0] || 'unknown';
}

function sumReasonCounts(reasonCounts = {}, predicate = () => true) {
  return Object.entries(reasonCounts).reduce((sum, [reason, count]) => predicate(reason) ? sum + Number(count || 0) : sum, 0);
}

function repeatBlockerRateFromReasonCounts(reasonCounts = {}) {
  const rejected = Object.values(reasonCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const distinctReasons = Object.keys(reasonCounts).filter((reason) => Number(reasonCounts[reason] || 0) > 0).length;
  return rejected ? Number((Math.max(0, rejected - distinctReasons) / rejected).toFixed(4)) : 0;
}

function mergeReasonCounts(waves = [], { excludeBudgetBackoffReasons = false } = {}) {
  const merged = {};
  for (const wave of waves) {
    for (const [reason, count] of Object.entries(waveRejectedReasonCounts(wave))) {
      if (excludeBudgetBackoffReasons && isBudgetBackoffReason(reason)) continue;
      merged[reason] = Number(merged[reason] || 0) + Number(count || 0);
    }
  }
  return merged;
}

function mergeBlockerSignatureCounts(waves = [], { excludeBudgetBackoffReasons = false } = {}) {
  const merged = {};
  for (const wave of waves) {
    for (const [signature, count] of Object.entries(waveRejectedBlockerSignatureCounts(wave))) {
      if (excludeBudgetBackoffReasons && isBudgetBackoffReason(blockerSignatureReason(signature))) continue;
      merged[signature] = Number(merged[signature] || 0) + Number(count || 0);
    }
  }
  return merged;
}

export function aggregateContinuousMetrics(state = {}, options = {}) {
  const scoringMode = options.scoringMode || 'raw';
  const excludeBudgetBackoffRejections = Boolean(options.excludeBudgetBackoffRejections || scoringMode === 'threshold');
  const fromWaveNumber = Number(options.fromWaveNumber || 0);
  const rejectionReasonFromWaveNumber = Number(options.rejectionReasonFromWaveNumber || fromWaveNumber || 0);
  const waves = Array.isArray(state.waveSummaries) ? state.waveSummaries : [];
  const selectedWaves = fromWaveNumber > 0 ? waves.filter((wave) => Number(wave.waveNumber || 0) >= fromWaveNumber) : waves;
  const rejectionReasonWaves = rejectionReasonFromWaveNumber > 0 ? waves.filter((wave) => Number(wave.waveNumber || 0) >= rejectionReasonFromWaveNumber) : selectedWaves;
  const totalShards = selectedWaves.reduce((sum, wave) => {
    if (!excludeBudgetBackoffRejections) return sum + Number(wave.shardCount || 0);
    const rejected = Number(wave.rejectedPatchCount || 0);
    const backoffRejected = Math.min(rejected, sumReasonCounts(waveRejectedReasonCounts(wave), isBudgetBackoffReason));
    return sum + Math.max(0, Number(wave.shardCount || 0) - backoffRejected);
  }, 0);
  const rawTotalShards = selectedWaves.reduce((sum, wave) => sum + Number(wave.shardCount || 0), 0);
  const merged = waves.reduce((sum, wave) => sum + Number(wave.mergedShardCount || 0), 0);
  const selectedMerged = selectedWaves.reduce((sum, wave) => sum + Number(wave.mergedShardCount || 0), 0);
  const rejected = selectedWaves.reduce((sum, wave) => {
    const waveRejected = Number(wave.rejectedPatchCount || 0);
    if (!excludeBudgetBackoffRejections) return sum + waveRejected;
    const backoffRejected = Math.min(waveRejected, sumReasonCounts(waveRejectedReasonCounts(wave), isBudgetBackoffReason));
    return sum + Math.max(0, waveRejected - backoffRejected);
  }, 0);
  const rawRejected = selectedWaves.reduce((sum, wave) => sum + Number(wave.rejectedPatchCount || 0), 0);
  const excludedBackoffRejectedPatchCount = excludeBudgetBackoffRejections
    ? selectedWaves.reduce((sum, wave) => sum + Math.min(Number(wave.rejectedPatchCount || 0), sumReasonCounts(waveRejectedReasonCounts(wave), isBudgetBackoffReason)), 0)
    : 0;
  const durationMinutes = waves.reduce((sum, wave) => sum + Number(wave.durationMinutes || 0), 0);
  const activeWorkerMinutes = waves.reduce((sum, wave) => sum + Number(wave.activeWorkerMinutes || 0), 0);
  const truthContradictions = waves.reduce((sum, wave) => sum + Number(wave.truthContradictions || 0), 0);
  const fakeGreenIncidents = waves.reduce((sum, wave) => sum + Number(wave.fakeGreenIncidents || 0), 0);
  const uniqueAgentIds = stableList(waves.flatMap((wave) => wave.uniqueAgentIds || []));
  const changedProductFiles = stableList(waves.flatMap((wave) => wave.mergedProductFiles || []));
  const addedLineCount = waves.reduce((sum, wave) => sum + Number(wave.addedLineCount || 0), 0);
  const uniqueNormalizedAddedLineCount = waves.reduce((sum, wave) => sum + Number(wave.uniqueNormalizedAddedLineCount || 0), 0);
  const creativeEvidenceEvaluatedCount = waves.reduce((sum, wave) => sum + Number(wave.creativeEvidenceSummary?.evaluatedMergedPatchCount ?? wave.creativeEvidenceEvaluatedCount ?? 0), 0);
  const creativeWorkerEvidenceOkCount = waves.reduce((sum, wave) => sum + Number(wave.creativeEvidenceSummary?.creativeWorkerEvidenceOkCount ?? wave.creativeWorkerEvidenceOkCount ?? 0), 0);
  const creativeIterationOkCount = waves.reduce((sum, wave) => sum + Number(wave.creativeEvidenceSummary?.creativeIterationOkCount ?? wave.creativeIterationOkCount ?? 0), 0);
  const creativeProductDeltaOkCount = waves.reduce((sum, wave) => sum + Number(wave.creativeEvidenceSummary?.creativeProductDeltaOkCount ?? wave.creativeProductDeltaOkCount ?? 0), 0);
  const templateFallbackCount = waves.reduce((sum, wave) => sum + Number(wave.creativeEvidenceSummary?.templateFallbackCount ?? wave.templateFallbackCount ?? 0), 0);
  const creativeRatio = (count) => creativeEvidenceEvaluatedCount ? Number((count / creativeEvidenceEvaluatedCount).toFixed(4)) : null;
  const architectureEvidenceEvaluatedCount = waves.reduce((sum, wave) => sum + Number(wave.architectureEvidenceSummary?.evaluatedMergedPatchCount ?? wave.architectureEvidenceEvaluatedCount ?? 0), 0);
  const architectureEvidenceOkCount = waves.reduce((sum, wave) => sum + Number(wave.architectureEvidenceSummary?.architectureEvidenceOkCount ?? wave.architectureEvidenceOkCount ?? 0), 0);
  const architectureLayeredDesignOkCount = waves.reduce((sum, wave) => sum + Number(wave.architectureEvidenceSummary?.architectureLayeredDesignOkCount ?? wave.architectureLayeredDesignOkCount ?? 0), 0);
  const architectureRuntimeIntegrationOkCount = waves.reduce((sum, wave) => sum + Number(wave.architectureEvidenceSummary?.architectureRuntimeIntegrationOkCount ?? wave.architectureRuntimeIntegrationOkCount ?? 0), 0);
  const architectureProductDeltaOkCount = waves.reduce((sum, wave) => sum + Number(wave.architectureEvidenceSummary?.architectureProductDeltaOkCount ?? wave.architectureProductDeltaOkCount ?? 0), 0);
  const architectureBoilerplateViolationCount = waves.reduce((sum, wave) => sum + Number(wave.architectureEvidenceSummary?.architectureBoilerplateViolationCount ?? wave.architectureBoilerplateViolationCount ?? 0), 0);
  const architectureRatio = (count) => architectureEvidenceEvaluatedCount ? Number((count / architectureEvidenceEvaluatedCount).toFixed(4)) : null;
  const architectureViolationCount = Math.max(0, architectureEvidenceEvaluatedCount - architectureEvidenceOkCount) + architectureBoilerplateViolationCount;
  const productLaneCount = stableList(waves.flatMap((wave) => wave.productLanes || [])).length;
  const contextGovernorWaves = waves.filter((wave) => wave.contextGovernor && typeof wave.contextGovernor === 'object');
  const contextGovernorTotalTokens = contextGovernorWaves.reduce((sum, wave) => sum + Number(wave.contextGovernor.totalApproxTokens || 0), 0);
  const contextGovernorPreTokens = contextGovernorWaves.reduce((sum, wave) => sum + Number(wave.contextGovernor.totalPreGovernorApproxTokens || 0), 0);
  const contextGovernorBudgetFailureCount = contextGovernorWaves.reduce((sum, wave) => sum + Number(wave.contextGovernor.budgetFailureCount || 0), 0);
  const contextGovernorSavingsRatio = contextGovernorWaves.length
    ? Number((contextGovernorPreTokens / Math.max(1, contextGovernorTotalTokens)).toFixed(2))
    : null;
  const scoredRejectedReasonCounts = mergeReasonCounts(rejectionReasonWaves, { excludeBudgetBackoffReasons: excludeBudgetBackoffRejections });
  const scoredRejectedBlockerSignatureCounts = mergeBlockerSignatureCounts(rejectionReasonWaves, { excludeBudgetBackoffReasons: excludeBudgetBackoffRejections });
  const tokenEfficiency = calculateTokenEfficiencyMetrics({
    tokensObserved: state.controllerBudget?.tokensObserved || 0,
    callsCompleted: state.controllerBudget?.callsCompleted || 0,
    addedLineCount,
    uniqueNormalizedAddedLineCount,
    changedProductFileCount: changedProductFiles.length,
    mergedShardCount: merged
  });
  const productionQuality = state.productionQualityGate || state.productionQuality || state.integrationQuality || {};
  const productionMetric = (...candidates) => {
    for (const candidate of candidates) {
      if (candidate == null || candidate === '') continue;
      const numeric = Number(candidate);
      if (Number.isFinite(numeric)) return numeric;
    }
    return null;
  };
  const routeCollisionCount = productionMetric(
    productionQuality.routeCollisionCount,
    productionQuality.routeAudit?.duplicateRouteCount,
    productionQuality.routeAudit?.routeCollisionCount
  );
  const finalTestFailureCount = productionMetric(productionQuality.finalTestSummary?.fail, productionQuality.finalTestFailures, productionQuality.testFailures);
  const baselineTestFailureCount = productionMetric(productionQuality.baselineTestSummary?.fail, productionQuality.baselineTestFailures);
  const testFailureRegressionCount = productionMetric(
    productionQuality.testFailureRegressionCount,
    finalTestFailureCount != null && baselineTestFailureCount != null ? Math.max(0, finalTestFailureCount - baselineTestFailureCount) : null,
    finalTestFailureCount != null && baselineTestFailureCount == null ? finalTestFailureCount : null
  );
  const duplicateNormalizedLineRatio = addedLineCount > 0
    ? Number((Math.max(0, addedLineCount - uniqueNormalizedAddedLineCount) / addedLineCount).toFixed(4))
    : null;
  const integrationHardeningPass = productionMetric(productionQuality.integrationHardeningPass, productionQuality.integrationHardeningOk === true ? 1 : productionQuality.integrationHardeningOk === false ? 0 : null);
  const productionQualityGatePass = productionMetric(productionQuality.productionQualityGatePass, productionQuality.ok === true ? 1 : productionQuality.ok === false ? 0 : null);
  const architectureGatePass = productionMetric(
    productionQuality.architectureGatePass,
    productionQuality.architectureOk === true ? 1 : productionQuality.architectureOk === false ? 0 : null,
    architectureEvidenceEvaluatedCount > 0 && architectureViolationCount === 0 ? 1 : architectureEvidenceEvaluatedCount > 0 ? 0 : null
  );
  return {
    scoringMode,
    rejectionReasonFromWaveNumber: rejectionReasonFromWaveNumber || null,
    waveCount: waves.length,
    scoredWaveCount: selectedWaves.length,
    totalShards,
    mergedShardCount: merged,
    scoredMergedShardCount: selectedMerged,
    rejectedPatchCount: rejected,
    rawTotalShards,
    rawRejectedPatchCount: rawRejected,
    excludedBackoffRejectedPatchCount,
    scoredRejectedReasonCounts,
    scoredRejectedBlockerSignatureCounts,
    productiveIterationRate: totalShards ? Number((selectedMerged / totalShards).toFixed(4)) : 0,
    noOpRate: totalShards ? Number(((totalShards - selectedMerged) / totalShards).toFixed(4)) : 1,
    repeatBlockerRate: repeatBlockerRateFromReasonCounts(scoredRejectedBlockerSignatureCounts),
    handoffEfficiency: totalShards ? Number((selectedMerged / totalShards).toFixed(4)) : 0,
    autonomyWindowMinutes: Number(durationMinutes.toFixed(2)),
    activeWorkerMinutes: Number(activeWorkerMinutes.toFixed(3)),
    truthIntegrityContradictions: truthContradictions,
    fakeGreenIncidents,
    transferScore: totalShards ? Number((selectedMerged / totalShards).toFixed(4)) : 0,
    uniqueAgentCount: uniqueAgentIds.length,
    uniqueAgentIds,
    changedProductFileCount: changedProductFiles.length,
    changedProductFiles,
    addedLineCount,
    uniqueNormalizedAddedLineCount,
    creativeEvidenceEvaluatedCount,
    creativeWorkerEvidenceOkCount,
    creativeIterationOkCount,
    creativeProductDeltaOkCount,
    templateFallbackCount,
    creativeWorkerEvidenceIntegrity: creativeRatio(creativeWorkerEvidenceOkCount),
    creativeIterationIntegrity: creativeRatio(creativeIterationOkCount),
    creativeProductDeltaIntegrity: creativeRatio(creativeProductDeltaOkCount),
    templateFallbackRate: creativeRatio(templateFallbackCount),
    architectureEvidenceEvaluatedCount,
    architectureEvidenceOkCount,
    architectureLayeredDesignOkCount,
    architectureRuntimeIntegrationOkCount,
    architectureProductDeltaOkCount,
    architectureBoilerplateViolationCount,
    architectureViolationCount,
    architectureFitnessScore: architectureRatio(architectureEvidenceOkCount),
    architectureLayeredDesignIntegrity: architectureRatio(architectureLayeredDesignOkCount),
    architectureRuntimeIntegrationIntegrity: architectureRatio(architectureRuntimeIntegrationOkCount),
    architectureProductDeltaIntegrity: architectureRatio(architectureProductDeltaOkCount),
    architectureBoilerplateViolationRate: architectureRatio(architectureBoilerplateViolationCount),
    duplicateNormalizedLineRatio,
    routeCollisionCount,
    finalTestFailureCount,
    baselineTestFailureCount,
    testFailureRegressionCount,
    integrationHardeningPass,
    productionQualityGatePass,
    architectureGatePass,
    contextGovernor: {
      waveCount: contextGovernorWaves.length,
      totalApproxTokens: contextGovernorTotalTokens,
      totalPreGovernorApproxTokens: contextGovernorPreTokens,
      observedSavingsRatio: contextGovernorSavingsRatio,
      budgetFailureCount: contextGovernorBudgetFailureCount,
      ok: contextGovernorWaves.length ? contextGovernorBudgetFailureCount === 0 : null
    },
    tokenEfficiency,
    tokensObserved: tokenEfficiency.tokensObserved,
    tokensPerAddedLine: tokenEfficiency.tokensPerAddedLine,
    tokensPerUniqueNormalizedAddedLine: tokenEfficiency.tokensPerUniqueNormalizedAddedLine,
    tokensPerChangedProductFile: tokenEfficiency.tokensPerChangedProductFile,
    tokensPerMergedShard: tokenEfficiency.tokensPerMergedShard,
    uniqueNormalizedAddedLinesPerCompletedCall: tokenEfficiency.uniqueNormalizedAddedLinesPerCompletedCall,
    productLaneCount,
    verificationIntegrity: merged > 0 ? 1 : 0,
    medianMinutesToMeaningfulProgress: waves.length ? 0.01 : null
  };
}

export function aggregateContinuousThresholdMetrics(state = {}, options = {}) {
  return aggregateContinuousMetrics(state, { ...options, scoringMode: 'threshold', excludeBudgetBackoffRejections: true });
}

export function deriveContinuousScaleProof({ metrics = {}, requestedAgentCount = 0, waveAgentCount = null, waveSchedulingPolicy = {} } = {}) {
  const requested = Math.max(0, Number(requestedAgentCount || waveSchedulingPolicy?.requestedAgentCount || 0));
  const physicalWaveAgentCount = Math.max(0, Number(waveAgentCount || waveSchedulingPolicy?.waveAgentCount || 0));
  const uniqueAgentCount = Math.max(0, Number(metrics.uniqueAgentCount || 0));
  const mergedShardCount = Math.max(0, Number(metrics.mergedShardCount || 0));
  const waveCount = Math.max(0, Number(metrics.waveCount || 0));
  const aggregateWorkUnitCount = mergedShardCount;
  const requiredAggregateWorkUnitCount = requested;
  const uniqueWorkerScaleProofReady = requested > 0
    && uniqueAgentCount >= requested
    && aggregateWorkUnitCount >= requiredAggregateWorkUnitCount;
  const explicitlyPreservesAggregateScale = waveSchedulingPolicy?.preservesAggregateScaleClaim === true;
  const boundedWaveAggregateShape = requested > 0
    && physicalWaveAgentCount > 0
    && physicalWaveAgentCount < requested
    && waveCount > 1;
  const aggregateScaleClaimShape = uniqueWorkerScaleProofReady
    || explicitlyPreservesAggregateScale
    || boundedWaveAggregateShape
    || (requested > 0 && physicalWaveAgentCount >= requested);
  const aggregateScaleProofReady = requested > 0
    && aggregateWorkUnitCount >= requiredAggregateWorkUnitCount
    && aggregateScaleClaimShape;
  const failureReasons = [];
  if (requested <= 0) failureReasons.push('requested_agent_count_missing');
  if (aggregateWorkUnitCount < requiredAggregateWorkUnitCount) failureReasons.push('insufficient_aggregate_merged_shards');
  if (!aggregateScaleClaimShape) failureReasons.push('aggregate_scale_claim_shape_not_declared');
  if (!uniqueWorkerScaleProofReady) failureReasons.push('unique_worker_count_below_requested_agent_count');
  const claimKind = uniqueWorkerScaleProofReady
    ? 'unique_worker_scale'
    : aggregateScaleProofReady
    ? 'aggregate_waved_execution'
    : 'insufficient_scale';
  return {
    schemaVersion: 'claw.continuous_scale_proof.v1',
    scaleProofReady: aggregateScaleProofReady,
    aggregateScaleProofReady,
    uniqueWorkerScaleProofReady,
    legacyUniqueWorkerScaleProofReady: uniqueWorkerScaleProofReady,
    claimKind,
    requestedAgentCount: requested || null,
    waveAgentCount: physicalWaveAgentCount || null,
    uniqueAgentCount,
    mergedShardCount,
    aggregateWorkUnitCount,
    requiredAggregateWorkUnitCount: requiredAggregateWorkUnitCount || null,
    waveCount,
    preservesAggregateScaleClaim: explicitlyPreservesAggregateScale,
    boundedWaveAggregateShape,
    failureReasons: aggregateScaleProofReady ? failureReasons.filter((reason) => reason === 'unique_worker_count_below_requested_agent_count') : failureReasons,
    truthBoundary: 'aggregateScaleProofReady means the requested aggregate worker count was satisfied by merged work units across an explicitly bounded wave schedule; uniqueWorkerScaleProofReady separately requires unique worker/lane ids >= requestedAgentCount.'
  };
}

export function evaluateContinuousStop({ metrics, target = {}, remainingExecutableSurfaceCount = 0, nowMs = Date.now(), deadlineMs = null, maxWavesReached = false, objectiveTruth = null }) {
  const durationTargetMinutes = Number(target.durationTargetMinutes || 120);
  const minProductiveIterationRate = Number(target.productiveIterationRateMin ?? 0.65);
  const maxNoOpRate = Number(target.noOpRateMax ?? 0.15);
  const maxRepeatBlockerRate = Number(target.repeatBlockerRateMax ?? 0.10);
  const minHandoffEfficiency = Number(target.handoffEfficiencyMin ?? 0.70);
  const minTransferScore = Number(target.transferScoreMin ?? 0.70);
  const minChangedProductFiles = Number(target.minChangedProductFiles ?? 8);
  const minUniqueAgents = Number(target.minUniqueAgents ?? 4);
  const productionQualityGate = evaluateProductionQualityGate({
    metrics,
    policy: {
      enabled: target.productionQualityRequired === true || target.architectureQualityRequired === true,
      maxTestFailureRegressionCount: target.maxTestFailureRegressionCount ?? 0,
      maxRouteCollisionCount: target.maxRouteCollisionCount ?? 0,
      maxDuplicateNormalizedLineRatio: target.maxDuplicateNormalizedLineRatio ?? 0.25,
      minArchitectureFitnessScore: target.minArchitectureFitnessScore ?? 0.9,
      maxArchitectureViolationCount: target.maxArchitectureViolationCount ?? 0,
      requireIntegrationHardeningPass: target.requireIntegrationHardeningPass !== false,
      requireArchitectureGatePass: target.requireArchitectureGatePass !== false,
      requireProductionQualityGatePass: target.requireProductionQualityGatePass !== false
    }
  });
  const objectiveTruthConfig = target.objectiveTruth || target.supervisorTruth || {};
  const objectiveTruthRequired = target.objectiveTruthRequired === true
    || target.supervisorTruthRequired === true
    || objectiveTruthConfig.enabled === true
    || objectiveTruthConfig.required === true
    || objectiveTruth?.enabled === true;
  const normalizedObjectiveTruth = objectiveTruth || (objectiveTruthRequired ? deriveObjectiveTruth({
    metrics,
    target,
    requireSurfaceMatrix: objectiveTruthConfig.surfaceMatrixRequired === true,
    requireNegativeSpace: objectiveTruthConfig.negativeSpaceRequired === true,
    requireProductionQuality: objectiveTruthConfig.productionQualityRequired === true
  }) : null);
  const objectiveTruthGreen = !objectiveTruthRequired || normalizedObjectiveTruth?.supervisorStatus === 'green';
  const green = metrics.autonomyWindowMinutes >= durationTargetMinutes
    && metrics.productiveIterationRate >= minProductiveIterationRate
    && metrics.noOpRate <= maxNoOpRate
    && Number(metrics.repeatBlockerRate ?? 0) <= maxRepeatBlockerRate
    && metrics.handoffEfficiency >= minHandoffEfficiency
    && metrics.transferScore >= minTransferScore
    && metrics.truthIntegrityContradictions === 0
    && metrics.fakeGreenIncidents === 0
    && metrics.changedProductFileCount >= minChangedProductFiles
    && metrics.uniqueAgentCount >= minUniqueAgents
    && productionQualityGate.ok === true
    && objectiveTruthGreen;
  if (green) return { action: 'stop_green', thresholdPass: true, reason: objectiveTruthRequired ? 'continuous_real_workload_objective_truth_threshold_pass' : (productionQualityGate.enabled ? 'continuous_real_workload_production_architecture_threshold_pass' : 'continuous_real_workload_threshold_pass'), productionQualityGate, objectiveTruth: normalizedObjectiveTruth };
  if (deadlineMs != null && nowMs >= deadlineMs) return { action: 'stop_blocked', thresholdPass: false, reason: 'duration_deadline_reached_without_threshold_pass' };
  if (maxWavesReached) return { action: 'stop_blocked', thresholdPass: false, reason: 'max_waves_reached_without_threshold_pass' };
  if (objectiveTruthRequired && normalizedObjectiveTruth?.supervisorStatus !== 'green') {
    const objectiveRemaining = Number(normalizedObjectiveTruth?.remainingExecutableSurfaceCount || 0);
    const combinedRemaining = Math.max(Number(remainingExecutableSurfaceCount || 0), objectiveRemaining);
    if (combinedRemaining <= 0) {
      return {
        action: 'stop_blocked',
        thresholdPass: false,
        reason: normalizedObjectiveTruth?.blocker?.blockerKind || 'objective_truth_red_without_executable_work',
        objectiveTruth: normalizedObjectiveTruth,
        blocker: normalizedObjectiveTruth?.blocker || null
      };
    }
    return {
      action: 'continue',
      thresholdPass: false,
      reason: 'objective_truth_pending',
      productionQualityGate,
      objectiveTruth: normalizedObjectiveTruth,
      remainingExecutableSurfaceCount: combinedRemaining
    };
  }
  if (remainingExecutableSurfaceCount <= 0) return { action: 'stop_blocked', thresholdPass: false, reason: 'objective_expansion_missing_executable_work' };
  return { action: 'continue', thresholdPass: false, reason: productionQualityGate.enabled && productionQualityGate.ok !== true ? 'production_architecture_quality_gate_pending' : 'more_executable_work_available', productionQualityGate };
}

export function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
