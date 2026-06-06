import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateContinuousMetrics,
  aggregateContinuousThresholdMetrics,
  bundleSelectedSurfaces,
  buildContinuousSurfaceInventory,
  buildObjectiveExpansionSurfaces,
  calculateTokenEfficiencyMetrics,
  createBudgetLimitBackoffPause,
  createUsageLimitBackoffPause,
  createWaveRunContract,
  evaluateContinuousStop,
  evaluateTokenEfficiency,
  planCreativeBundleRuntime,
  planAdaptiveWaveBudget,
  promptModeForContinuousWave,
  selectNextWaveSurfaces,
  summarizeWaveBudgetLedger,
  summarizeWaveArtifacts,
  updateContinuousStateFromWave
} from '../packages/continuous-workload-controller/index.mjs';

const surfaces = [
  { id: 'campaign_domain_wave_1', lane: 'jobs_delivery_automation', targetFiles: ['packages/app/domain-campaigns.mjs'], allowedFiles: ['packages/app/domain-campaigns.mjs', 'tests/campaign-editor-depth.test.mjs'], verification: ['node --test tests/campaign-editor-depth.test.mjs'] },
  { id: 'campaign_routes_wave_1', lane: 'jobs_delivery_automation', targetFiles: ['packages/app/routes/campaigns.mjs'], allowedFiles: ['packages/app/routes/campaigns.mjs', 'tests/campaign-editor-depth.test.mjs'], verification: ['node --test tests/campaign-editor-depth.test.mjs'] },
  { id: 'campaign_domain_wave_2', lane: 'reporting_analytics', targetFiles: ['packages/app/domain-campaigns.mjs'], allowedFiles: ['packages/app/domain-campaigns.mjs', 'tests/campaign-editor-depth.test.mjs'], verification: ['node --test tests/campaign-editor-depth.test.mjs'] },
  { id: 'templates_wave_1', lane: 'frontend_product_experience', targetFiles: ['packages/app/routes/templates.mjs'], allowedFiles: ['packages/app/routes/templates.mjs', 'tests/template-variants-routes.test.mjs'], verification: ['node --test tests/template-variants-routes.test.mjs'] },
  { id: 'docs_only_bad', lane: 'frontend_product_experience', targetFiles: ['docs/README.md'], allowedFiles: ['docs/README.md'], verification: ['node --test tests/example.test.mjs'] }
];

test('continuous controller selects one executable surface per primary product file', () => {
  const selection = selectNextWaveSurfaces({ surfaces, requestedAgentCount: 3, state: {} });
  assert.equal(selection.selected.length, 3);
  assert.deepEqual(selection.selectedProductFiles.sort(), [
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/campaigns.mjs',
    'packages/app/routes/templates.mjs'
  ]);
  assert.equal(selection.selectedSurfaceIds.includes('docs_only_bad'), false);
});

test('continuous controller defers recently rejected files on the first scheduling pass', () => {
  const selection = selectNextWaveSurfaces({
    surfaces,
    requestedAgentCount: 2,
    state: { lastRejectedProductFiles: ['packages/app/domain-campaigns.mjs'] }
  });
  assert.deepEqual(selection.selectedProductFiles.sort(), [
    'packages/app/routes/campaigns.mjs',
    'packages/app/routes/templates.mjs'
  ]);
});

test('wave contract turns a continuous objective into a finite wave executor contract', () => {
  const baseContract = {
    benchmarkId: 'mailchimp_campaign_email_builder_real_workload_tranche',
    runId: 'controller-v3',
    benchmarkTier: 'tier2_functional',
    repoPath: '/remote/repo',
    requestedAgentCount: 15,
    executionBoundary: 'remote_execution_required',
    scope: { durationTargetMinutes: 120, productDiffMode: 'creative_product_work', surfaces }
  };
  const selected = selectNextWaveSurfaces({ surfaces, requestedAgentCount: 2, state: {} }).selected;
  const wave = createWaveRunContract({
    baseContract,
    controllerArtifactRoot: '/remote/artifacts/controller-v3',
    waveNumber: 2,
    selectedSurfaces: selected,
    repoPath: '/remote/repo-copy',
    waveDurationTargetMinutes: 10,
    waveMaxAttemptsPerTask: 2,
    generatedAt: '2026-06-05T00:00:00.000Z'
  });
  assert.equal(wave.runId, 'controller-v3-wave-002');
  assert.equal(wave.repoPath, '/remote/repo-copy');
  assert.equal(wave.scope.durationTargetMinutes, 10);
  assert.equal(wave.scope.waveMaxAttemptsPerTask, 2);
  assert.equal(wave.scope.surfaces.length, 2);
  assert.equal(wave.scope.surfaces.every((surface) => surface.metadata.continuousControllerWave === 2), true);
});

test('continuous controller aggregates wave truth without calling partial product output green', () => {
  const completionSummary = {
    runId: 'wave-001',
    thresholdPass: false,
    mechanicalGreen: false,
    scaleProofReady: false,
    durationMinutes: 5.5,
    shardCount: 3,
    mergedShardCount: 2,
    concurrencyTruth: {
      rejectedPatchCount: 1,
      activeWorkerMinutes: 15,
      uniqueAgentIds: ['agent-1', 'agent-2', 'agent-3']
    },
    landingEvidenceSummary: {
      addedLineStats: { addedLineCount: 120, uniqueNormalizedAddedLineCount: 100, duplicateLineRatio: 0.1 }
    },
    runStateTruth: { truth: { contradictionCount: 0 } }
  };
  const patchQueue = {
    merged: [
      { shardId: 'campaign_domain_wave_1', agentId: 'agent-1', filePaths: ['packages/app/domain-campaigns.mjs'] },
      { shardId: 'templates_wave_1', agentId: 'agent-2', filePaths: ['packages/app/routes/templates.mjs'] }
    ],
    rejected: [
      { shardId: 'campaign_routes_wave_1', agentId: 'agent-3', reason: 'non_additive_conflict', filePaths: ['packages/app/routes/campaigns.mjs'] }
    ]
  };
  const waveSummary = summarizeWaveArtifacts({ completionSummary, patchQueue, waveNumber: 1 });
  let state = updateContinuousStateFromWave({ state: {}, waveSummary, selectedSurfaceIds: ['campaign_domain_wave_1', 'templates_wave_1', 'campaign_routes_wave_1'], waveNumber: 1 });
  const metrics = aggregateContinuousMetrics(state);
  assert.equal(metrics.mergedShardCount, 2);
  assert.equal(metrics.totalShards, 3);
  assert.equal(metrics.productiveIterationRate, 0.6667);
  assert.equal(metrics.changedProductFileCount, 2);
  assert.equal(metrics.truthIntegrityContradictions, 0);

  const decision = evaluateContinuousStop({
    metrics,
    target: { durationTargetMinutes: 120, minChangedProductFiles: 8, minUniqueAgents: 4 },
    remainingExecutableSurfaceCount: 10,
    nowMs: 10,
    deadlineMs: 10_000
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.thresholdPass, false);
});

test('continuous controller stops blocked when finite inventory is exhausted before threshold', () => {
  const metrics = {
    autonomyWindowMinutes: 6,
    productiveIterationRate: 0.8,
    noOpRate: 0.2,
    handoffEfficiency: 0.8,
    transferScore: 0.8,
    truthIntegrityContradictions: 0,
    fakeGreenIncidents: 0,
    changedProductFileCount: 8,
    uniqueAgentCount: 8
  };
  const decision = evaluateContinuousStop({ metrics, target: { durationTargetMinutes: 120 }, remainingExecutableSurfaceCount: 0, nowMs: 10, deadlineMs: 10_000 });
  assert.equal(decision.action, 'stop_blocked');
  assert.equal(decision.reason, 'objective_expansion_missing_executable_work');
});

test('objective expansion generates continuation surfaces after finite inventory is complete', () => {
  const expanded = buildObjectiveExpansionSurfaces({ surfaces, maxExpansionCycles: 2 });
  assert.equal(expanded.length, 6);
  assert.equal(expanded.every((surface) => surface.metadata.objectiveExpansionGenerated), true);
  assert.equal(expanded.every((surface) => surface.targetFiles.length === 1), true);
  assert.equal(expanded.some((surface) => surface.id.includes('continuation_001')), true);

  const inventory = buildContinuousSurfaceInventory({ surfaces, maxExpansionCycles: 2 });
  const completedBaseIds = surfaces.filter((surface) => !surface.id.includes('docs_only')).map((surface) => surface.id);
  const selection = selectNextWaveSurfaces({
    surfaces: inventory.surfaces,
    requestedAgentCount: 3,
    state: { completedSurfaceIds: completedBaseIds }
  });
  assert.equal(selection.selected.length, 3);
  assert.equal(selection.selected.every((surface) => surface.metadata.objectiveExpansionGenerated), true);
  assert.deepEqual(selection.selectedProductFiles.sort(), [
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/campaigns.mjs',
    'packages/app/routes/templates.mjs'
  ]);
});

test('objective expansion cycles can grow fresh executable work after the current window is exhausted', () => {
  const oneCycleInventory = buildContinuousSurfaceInventory({ surfaces, maxExpansionCycles: 1 });
  const exhaustedIds = oneCycleInventory.surfaces.map((surface) => surface.id);
  const exhaustedSelection = selectNextWaveSurfaces({
    surfaces: oneCycleInventory.surfaces,
    requestedAgentCount: 3,
    state: { completedSurfaceIds: exhaustedIds }
  });
  assert.equal(exhaustedSelection.selected.length, 0);

  const twoCycleInventory = buildContinuousSurfaceInventory({ surfaces, maxExpansionCycles: 2 });
  const expandedSelection = selectNextWaveSurfaces({
    surfaces: twoCycleInventory.surfaces,
    requestedAgentCount: 3,
    state: { completedSurfaceIds: exhaustedIds }
  });
  assert.equal(expandedSelection.selected.length, 3);
  assert.equal(expandedSelection.selected.every((surface) => surface.id.includes('continuation_002')), true);
});

test('continuous controller can bundle selected surfaces into coherent multi-file product slices', () => {
  const selection = selectNextWaveSurfaces({ surfaces, requestedAgentCount: 4, state: {} });
  const bundlePlan = bundleSelectedSurfaces({ selected: selection.selected, bundleSize: 2, waveNumber: 9 });
  assert.equal(bundlePlan.enabled, true);
  assert.equal(bundlePlan.surfaces.length, 2);
  assert.equal(bundlePlan.bundleMap[0].sourceSurfaceIds.length, 2);
  assert.equal(bundlePlan.surfaces[0].metadata.continuousControllerBundledSurface, true);
  assert.equal(bundlePlan.surfaces[0].targetFiles.length, 2);
  assert.equal(bundlePlan.surfaces[0].metadata.minProductTargetsToModify, 2);
  assert.ok(bundlePlan.surfaces[0].productGoal.includes('coherent Mailchimp product-slice'));
});

test('bundled creative workers scale Codex timeout and token reservation by bundle complexity', () => {
  const single = planCreativeBundleRuntime({
    bundle: { enabled: false },
    baseIterationTimeoutMs: 240_000,
    baseTokenReservationEstimate: 65_000
  });
  assert.equal(single.iterationTimeoutMs, 240_000);
  assert.equal(single.tokenReservationEstimate, 65_000);
  assert.equal(single.complexityFactor, 1);

  const bundled = planCreativeBundleRuntime({
    bundle: {
      enabled: true,
      sourceSurfaceIds: ['campaign_domain_wave_1', 'campaign_routes_wave_1'],
      bundledProductFiles: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs'],
      minProductTargetsToModify: 2
    },
    baseIterationTimeoutMs: 240_000,
    baseTokenReservationEstimate: 65_000
  });
  assert.equal(bundled.complexityFactor, 2);
  assert.equal(bundled.iterationTimeoutMs, 480_000);
  assert.equal(bundled.tokenReservationEstimate, 130_000);

  const capped = planCreativeBundleRuntime({
    bundle: {
      enabled: true,
      sourceSurfaceIds: ['a', 'b', 'c', 'd', 'e'],
      bundledProductFiles: ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs', 'e.mjs'],
      minProductTargetsToModify: 5
    },
    baseIterationTimeoutMs: 420_000,
    baseTokenReservationEstimate: 100_000,
    maxComplexityFactor: 3,
    maxIterationTimeoutMs: 900_000,
    maxTokenReservationEstimate: 250_000
  });
  assert.equal(capped.complexityFactor, 3);
  assert.equal(capped.iterationTimeoutMs, 900_000);
  assert.equal(capped.tokenReservationEstimate, 250_000);
});

test('merged bundled patches credit component surface ids for future scheduling', () => {
  const patchQueue = {
    merged: [{
      shardId: 'bundle_001',
      agentId: 'agent-1',
      filePaths: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs'],
      metadata: {
        implementation: {
          metadata: {
            proofCarryingClaim: { surfaceIds: ['campaign_domain_wave_1', 'campaign_routes_wave_1'] },
            creativeWorkerEvidence: { sourceSurfaceIds: ['campaign_domain_wave_1', 'campaign_routes_wave_1'] }
          }
        }
      }
    }]
  };
  const waveSummary = summarizeWaveArtifacts({
    waveNumber: 9,
    completionSummary: { shardCount: 1, mergedShardCount: 1, durationMinutes: 3, concurrencyTruth: { uniqueAgentIds: ['agent-1'] } },
    patchQueue
  });
  assert.equal(waveSummary.mergedSurfaceIds.includes('campaign_domain_wave_1'), true);
  assert.equal(waveSummary.mergedSurfaceIds.includes('campaign_routes_wave_1'), true);
  const state = updateContinuousStateFromWave({ state: {}, waveSummary, selectedSurfaceIds: ['bundle_001', 'campaign_domain_wave_1', 'campaign_routes_wave_1'], waveNumber: 9 });
  assert.equal(state.completedSurfaceIds.includes('campaign_domain_wave_1'), true);
  assert.equal(state.completedSurfaceIds.includes('campaign_routes_wave_1'), true);
});

test('wave-local threshold misses do not poison aggregate continuous truth when truth conflicts are empty', () => {
  const completionSummary = {
    thresholdPass: false,
    mechanicalGreen: true,
    scaleProofReady: true,
    durationMinutes: 10,
    shardCount: 1,
    mergedShardCount: 1,
    runStateTruth: { truth: { contradictionCount: 1 } },
    blocker: { blocker: 'threshold not met for finite wave duration target' },
    concurrencyTruth: { uniqueAgentIds: ['agent-1'] },
    landingEvidenceSummary: { addedLineStats: { addedLineCount: 10, uniqueNormalizedAddedLineCount: 10 } }
  };
  const patchQueue = { merged: [{ shardId: 'campaign_domain_wave_1', agentId: 'agent-1', filePaths: ['packages/app/domain-campaigns.mjs'] }] };
  const waveSummary = summarizeWaveArtifacts({ completionSummary, patchQueue, truthConflicts: { contradictions: [] }, waveNumber: 1 });
  assert.equal(waveSummary.truthContradictions, 0);
  const metrics = aggregateContinuousMetrics({ waveSummaries: [waveSummary] });
  assert.equal(metrics.truthIntegrityContradictions, 0);
});

test('threshold metrics exclude controller backoff rejection shards while preserving raw aggregate truth', () => {
  const makeWave = ({ waveNumber, shardCount, mergedShardCount, rejectedPatchCount = 0, reason = null, durationMinutes = 5 }) => ({
    waveNumber,
    shardCount,
    mergedShardCount,
    rejectedPatchCount,
    durationMinutes,
    activeWorkerMinutes: mergedShardCount * 4,
    truthContradictions: 0,
    fakeGreenIncidents: 0,
    uniqueAgentIds: ['agent-1', 'agent-2', 'agent-3', 'agent-4'],
    mergedProductFiles: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs', 'packages/app/routes/templates.mjs', 'packages/app/domain-leads.mjs', 'packages/app/routes/reports.mjs', 'packages/app/routes/leads.mjs', 'packages/app/routes/integrations.mjs', 'packages/app/domain-commerce-revenue.mjs'],
    rejectedReasonCounts: reason ? { [reason]: rejectedPatchCount } : {},
    addedLineCount: mergedShardCount * 10,
    uniqueNormalizedAddedLineCount: mergedShardCount * 9
  });
  const state = {
    waveSummaries: [
      makeWave({ waveNumber: 1, shardCount: 52, mergedShardCount: 0, rejectedPatchCount: 52, reason: 'codex_usage_limit_observed', durationMinutes: 1 }),
      makeWave({ waveNumber: 2, shardCount: 40, mergedShardCount: 0, rejectedPatchCount: 40, reason: 'creative_global_reserved_token_limit_reached', durationMinutes: 1 }),
      makeWave({ waveNumber: 3, shardCount: 330, mergedShardCount: 330, durationMinutes: 122 })
    ]
  };
  const raw = aggregateContinuousMetrics(state);
  assert.equal(raw.noOpRate, 0.218);
  assert.equal(raw.repeatBlockerRate > 0.9, true);

  const scored = aggregateContinuousThresholdMetrics(state);
  assert.equal(scored.excludedBackoffRejectedPatchCount, 92);
  assert.equal(scored.noOpRate, 0);
  assert.equal(scored.repeatBlockerRate, 0);

  const decision = evaluateContinuousStop({
    metrics: scored,
    target: { durationTargetMinutes: 120, minChangedProductFiles: 8, minUniqueAgents: 4 },
    remainingExecutableSurfaceCount: 0
  });
  assert.equal(decision.action, 'stop_green');
  assert.equal(decision.thresholdPass, true);
});

test('token efficiency metrics flag expensive accepted output after enough sample evidence', () => {
  const metrics = calculateTokenEfficiencyMetrics({
    tokensObserved: 1_200_000,
    callsCompleted: 12,
    addedLineCount: 1000,
    uniqueNormalizedAddedLineCount: 900,
    changedProductFileCount: 5,
    mergedShardCount: 12
  });
  assert.equal(metrics.tokensPerAddedLine, 1200);
  assert.equal(metrics.tokensPerUniqueNormalizedAddedLine, 1333.33);
  assert.equal(metrics.uniqueNormalizedAddedLinesPerCompletedCall, 75);
  const evaluation = evaluateTokenEfficiency({
    metrics,
    policy: {
      minObservedTokens: 1_000_000,
      minAddedLineCount: 500,
      maxTokensPerAddedLine: 900,
      maxTokensPerUniqueNormalizedAddedLine: 1100,
      minUniqueNormalizedAddedLinesPerCall: 40
    }
  });
  assert.equal(evaluation.ok, false);
  assert.deepEqual(evaluation.failures.map((failure) => failure.metric), ['tokensPerAddedLine', 'tokensPerUniqueNormalizedAddedLine']);

  const notReady = evaluateTokenEfficiency({ metrics, policy: { minObservedTokens: 2_000_000, maxTokensPerAddedLine: 900 } });
  assert.equal(notReady.ok, true);
  assert.equal(notReady.sampleReady, false);
});

test('continuous controller switches to compact prompts after configured full-context waves', () => {
  assert.equal(promptModeForContinuousWave({ priorWaveCount: 0, launchedWaveIndex: 0, fullContextWaveCount: 1 }), 'full_context');
  assert.equal(promptModeForContinuousWave({ priorWaveCount: 0, launchedWaveIndex: 1, fullContextWaveCount: 1 }), 'compact');
  assert.equal(promptModeForContinuousWave({ priorWaveCount: 2, launchedWaveIndex: 0, fullContextWaveCount: 1 }), 'compact');
  assert.equal(promptModeForContinuousWave({ priorWaveCount: 0, launchedWaveIndex: 0, fullContextWaveCount: 0 }), 'compact');
});

test('continuous controller turns Codex usage-limit evidence into a resumable backoff pause', () => {
  const ledgerSummary = summarizeWaveBudgetLedger({
    callsStarted: 8,
    callsCompleted: 8,
    tokensObserved: 0,
    globalStop: { reason: 'codex_usage_limit_observed' },
    events: [{ type: 'codex_call_completed', usageLimit: true }]
  });
  assert.equal(ledgerSummary.usageLimitObserved, true);
  assert.equal(ledgerSummary.globalStopReason, 'codex_usage_limit_observed');

  const waveSummary = summarizeWaveArtifacts({
    waveNumber: 7,
    completionSummary: { shardCount: 15, mergedShardCount: 8, durationMinutes: 4, concurrencyTruth: { uniqueAgentIds: ['agent-1'] } },
    patchQueue: { rejected: [{ shardId: 'surface-a', rejectionReason: 'codex_usage_limit_observed' }] }
  });
  waveSummary.budget = ledgerSummary;
  waveSummary.budgetStopReason = ledgerSummary.globalStopReason;

  const pause = createUsageLimitBackoffPause({ waveSummary, nowMs: Date.parse('2026-06-05T21:00:00.000Z'), backoffMinutes: 90 });
  assert.equal(pause.action, 'pause_backoff');
  assert.equal(pause.reason, 'codex_usage_limit_observed');
  assert.equal(pause.resumeAfter, '2026-06-05T22:30:00.000Z');

  const state = updateContinuousStateFromWave({ state: {}, waveSummary, selectedSurfaceIds: ['surface-a'], waveNumber: 7 });
  assert.equal(state.controllerBudget.usageLimitObserved, true);
  assert.equal(state.controllerBudget.callsStarted, 8);
  assert.deepEqual(state.controllerBudget.usageLimitWaveNumbers, [7]);
});

test('continuous controller treats reserved-token exhaustion as budget backoff instead of no-progress churn', () => {
  const ledgerSummary = summarizeWaveBudgetLedger({
    callsStarted: 0,
    callsCompleted: 0,
    tokensObserved: 0,
    globalStop: {
      reason: 'creative_global_reserved_token_limit_reached',
      limit: 2055,
      tokenReservationEstimate: 65000,
      projectedReservedTokens: 65000
    }
  });
  assert.equal(ledgerSummary.budgetLimitObserved, true);
  assert.equal(ledgerSummary.globalStopReason, 'creative_global_reserved_token_limit_reached');

  const waveSummary = summarizeWaveArtifacts({
    waveNumber: 14,
    completionSummary: { shardCount: 15, mergedShardCount: 0, durationMinutes: 0.02 },
    patchQueue: { rejected: [{ shardId: 'surface-a', rejectionReason: 'creative_global_reserved_token_limit_reached' }] }
  });
  waveSummary.budget = ledgerSummary;
  waveSummary.budgetStopReason = ledgerSummary.globalStopReason;

  const pause = createBudgetLimitBackoffPause({ waveSummary, nowMs: Date.parse('2026-06-06T01:41:00.000Z'), backoffMinutes: 15 });
  assert.equal(pause.action, 'pause_backoff');
  assert.equal(pause.reason, 'creative_global_reserved_token_limit_reached');

  const state = updateContinuousStateFromWave({ state: {}, waveSummary, selectedSurfaceIds: ['surface-a'], waveNumber: 14 });
  assert.equal(state.controllerBudget.budgetLimitObserved, true);
  assert.deepEqual(state.controllerBudget.budgetLimitWaveNumbers, [14]);
});

test('adaptive wave budget sizes compact waves from observed token burn and detects insufficient budget', () => {
  const state = {
    controllerBudget: {
      tokensObserved: 2497945,
      promptModes: {
        compact: { callsCompleted: 35, tokensObserved: 2497945 }
      }
    }
  };
  const plan = planAdaptiveWaveBudget({
    state,
    selectedCount: 15,
    promptMode: 'compact',
    controllerGlobalTokenLimit: 6000000,
    tokenReservationEstimate: 65000,
    safetyMultiplier: 1.15,
    minWaveAgentCount: 4
  });
  assert.equal(plan.plannedAgentCount, 15);
  assert.equal(plan.insufficientForMinimumWave, false);
  assert.ok(plan.tokenReservationEstimate >= 80000);
  assert.ok(plan.requiredForSelected >= 1200000);

  const blocked = planAdaptiveWaveBudget({
    state,
    selectedCount: 15,
    promptMode: 'compact',
    controllerGlobalTokenLimit: 2500000,
    tokenReservationEstimate: 65000,
    safetyMultiplier: 1.15,
    minWaveAgentCount: 4
  });
  assert.equal(blocked.plannedAgentCount, 0);
  assert.equal(blocked.insufficientForMinimumWave, true);
});
