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
  return /(?:^|_)codex_usage_limit|usage[_ -]?limit|try again at/i.test(String(reason || ''));
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
  return {
    callsStarted: Number(ledger?.callsStarted || 0),
    callsCompleted: Number(ledger?.callsCompleted || 0),
    tokensObserved: Number(ledger?.tokensObserved || 0),
    globalStopReason,
    usageLimitObserved,
    usageLimitEventCount: usageLimitEvents.length,
    budgetLimitObserved,
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
  const minRequired = Math.max(1, Number(minWaveAgentCount || 1)) * reservationEstimate;
  const maxBudgetedAgents = availableTokens == null ? count : Math.floor(availableTokens / reservationEstimate);
  const plannedAgentCount = availableTokens == null ? count : Math.max(0, Math.min(count, maxBudgetedAgents));
  return {
    promptMode: normalizeContinuousPromptMode(promptMode),
    selectedCount: count,
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
    insufficientForMinimumWave: availableTokens != null && availableTokens < minRequired
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

export function isProductSourceFile(filePath = '') {
  return /^(apps|packages)\//.test(String(filePath || ''))
    && /\.(?:mjs|js|jsx|ts|tsx|html|css)$/i.test(String(filePath || ''))
    && !/(^|\/)tests?\//i.test(String(filePath || ''));
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
  avoidRecentlyRejectedFiles = true
} = {}) {
  const catalog = buildExecutableSurfaceCatalog(surfaces);
  const completed = new Set(state.completedSurfaceIds || []);
  const rejectedFiles = new Set(avoidRecentlyRejectedFiles ? (state.lastRejectedProductFiles || []) : []);
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
      if (pass === 0 && rejectedFiles.has(primary)) continue;
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
  contract.scope = {
    ...contract.scope,
    durationTargetMinutes: waveDurationTargetMinutes,
    continuousControllerWave: true,
    waveNumber,
    waveMaxAttemptsPerTask,
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
  return contract;
}

export function summarizePatchQueue(patchQueue = {}) {
  const merged = Array.isArray(patchQueue.merged) ? patchQueue.merged : [];
  const rejected = Array.isArray(patchQueue.rejected) ? patchQueue.rejected : Array.isArray(patchQueue.rejections) ? patchQueue.rejections : [];
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
  const rejectedReasonCounts = {};
  const rejectedProductFiles = new Set();
  for (const entry of rejected) {
    const reason = entry.reason || entry.rejectionReason || entry.status || entry.metadata?.reason || 'unknown';
    rejectedReasonCounts[reason] = (rejectedReasonCounts[reason] || 0) + 1;
    for (const file of entry.filePaths || entry.files || []) {
      if (isProductSourceFile(file)) rejectedProductFiles.add(file);
    }
  }
  return {
    mergedPatchCount: merged.length,
    rejectedPatchCount: rejected.length,
    mergedSurfaceIds: stableList(merged.flatMap(patchSurfaceIds)),
    mergedAgentIds: stableList(merged.map((entry) => entry.agentId)),
    mergedProductFiles: stableList(merged.flatMap((entry) => entry.filePaths || []).filter(isProductSourceFile)),
    rejectedReasonCounts,
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
    rejectedReasonCounts: patchSummary.rejectedReasonCounts,
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

export function aggregateContinuousMetrics(state = {}, options = {}) {
  const scoringMode = options.scoringMode || 'raw';
  const excludeBudgetBackoffRejections = Boolean(options.excludeBudgetBackoffRejections || scoringMode === 'threshold');
  const fromWaveNumber = Number(options.fromWaveNumber || 0);
  const waves = Array.isArray(state.waveSummaries) ? state.waveSummaries : [];
  const selectedWaves = fromWaveNumber > 0 ? waves.filter((wave) => Number(wave.waveNumber || 0) >= fromWaveNumber) : waves;
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
  const productLaneCount = stableList(waves.flatMap((wave) => wave.productLanes || [])).length;
  const scoredRejectedReasonCounts = mergeReasonCounts(selectedWaves, { excludeBudgetBackoffReasons: excludeBudgetBackoffRejections });
  const tokenEfficiency = calculateTokenEfficiencyMetrics({
    tokensObserved: state.controllerBudget?.tokensObserved || 0,
    callsCompleted: state.controllerBudget?.callsCompleted || 0,
    addedLineCount,
    uniqueNormalizedAddedLineCount,
    changedProductFileCount: changedProductFiles.length,
    mergedShardCount: merged
  });
  return {
    scoringMode,
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
    productiveIterationRate: totalShards ? Number((selectedMerged / totalShards).toFixed(4)) : 0,
    noOpRate: totalShards ? Number(((totalShards - selectedMerged) / totalShards).toFixed(4)) : 1,
    repeatBlockerRate: repeatBlockerRateFromReasonCounts(scoredRejectedReasonCounts),
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

export function evaluateContinuousStop({ metrics, target = {}, remainingExecutableSurfaceCount = 0, nowMs = Date.now(), deadlineMs = null, maxWavesReached = false }) {
  const durationTargetMinutes = Number(target.durationTargetMinutes || 120);
  const minProductiveIterationRate = Number(target.productiveIterationRateMin ?? 0.65);
  const maxNoOpRate = Number(target.noOpRateMax ?? 0.15);
  const minHandoffEfficiency = Number(target.handoffEfficiencyMin ?? 0.70);
  const minTransferScore = Number(target.transferScoreMin ?? 0.70);
  const minChangedProductFiles = Number(target.minChangedProductFiles ?? 8);
  const minUniqueAgents = Number(target.minUniqueAgents ?? 4);
  const green = metrics.autonomyWindowMinutes >= durationTargetMinutes
    && metrics.productiveIterationRate >= minProductiveIterationRate
    && metrics.noOpRate <= maxNoOpRate
    && metrics.handoffEfficiency >= minHandoffEfficiency
    && metrics.transferScore >= minTransferScore
    && metrics.truthIntegrityContradictions === 0
    && metrics.fakeGreenIncidents === 0
    && metrics.changedProductFileCount >= minChangedProductFiles
    && metrics.uniqueAgentCount >= minUniqueAgents;
  if (green) return { action: 'stop_green', thresholdPass: true, reason: 'continuous_real_workload_threshold_pass' };
  if (deadlineMs != null && nowMs >= deadlineMs) return { action: 'stop_blocked', thresholdPass: false, reason: 'duration_deadline_reached_without_threshold_pass' };
  if (maxWavesReached) return { action: 'stop_blocked', thresholdPass: false, reason: 'max_waves_reached_without_threshold_pass' };
  if (remainingExecutableSurfaceCount <= 0) return { action: 'stop_blocked', thresholdPass: false, reason: 'objective_expansion_missing_executable_work' };
  return { action: 'continue', thresholdPass: false, reason: 'more_executable_work_available' };
}

export function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
