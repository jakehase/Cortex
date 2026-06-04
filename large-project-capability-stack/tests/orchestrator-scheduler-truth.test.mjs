import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSchedulerModel,
  buildSchedulerTruthReport,
  deriveObservedConcurrencyTruth,
  evaluateScaleCredit
} from '../packages/orchestrator-scheduler-truth/index.mjs';

function at(ms) {
  return new Date(1_700_000_000_000 + ms).toISOString();
}

const shardPlan = {
  shards: [
    { id: 'ui-shell', lane: 'ui', domain: 'frontend', fileAreas: ['apps/web/public/app-shell.jsx'], allowedFiles: ['apps/web/public/app-shell.jsx'], requiredVerifiers: ['tests'], acceptanceChecks: ['ui proof'] },
    { id: 'campaign-route', lane: 'api', domain: 'campaigns', fileAreas: ['packages/app/routes/campaigns.mjs'], allowedFiles: ['packages/app/routes/campaigns.mjs'], requiredVerifiers: ['tests'], acceptanceChecks: ['route proof'] },
    { id: 'campaign-domain', lane: 'domain', domain: 'campaigns', fileAreas: ['packages/app/domain-campaigns.mjs'], allowedFiles: ['packages/app/domain-campaigns.mjs'], requiredVerifiers: ['tests'], acceptanceChecks: ['domain proof'] }
  ]
};

test('scheduler model tracks lanes, ownership, dependency readiness, cost, and collision risk', () => {
  const model = buildSchedulerModel({ shardPlan, surfaceMatrix: { surfaces: [{ id: 'ui-shell' }, { id: 'campaign-route' }, { id: 'campaign-domain' }] } });
  assert.equal(model.shardCount, 3);
  assert.equal(model.laneCounts.ui, 1);
  assert.equal(model.laneCounts.api, 1);
  assert.equal(model.fileOwnership['apps/web/public/app-shell.jsx'][0], 'ui-shell');
  assert.equal(model.dependencyReadiness['ui-shell'].initiallyReady, true);
  assert.equal(model.verifierCost['campaign-route'] > 0, true);
  assert.equal(model.collisionRiskCounts.low >= 3, true);
});

test('observed concurrency truth reports peak concurrency, worker minutes, idle gaps, and assignment latency', () => {
  const events = [
    { at: at(0), type: 'live_worker_spawned', shardId: 'ui-shell', agentId: 'agent-1', leaseId: 'l1' },
    { at: at(100), type: 'live_worker_spawned', shardId: 'campaign-route', agentId: 'agent-2', leaseId: 'l2' },
    { at: at(600), type: 'live_worker_exit', shardId: 'ui-shell', agentId: 'agent-1', leaseId: 'l1', ok: true },
    { at: at(700), type: 'live_worker_exit', shardId: 'campaign-route', agentId: 'agent-2', leaseId: 'l2', ok: true },
    { at: at(1200), type: 'live_worker_spawned', shardId: 'campaign-domain', agentId: 'agent-3', leaseId: 'l3' },
    { at: at(1600), type: 'live_worker_exit', shardId: 'campaign-domain', agentId: 'agent-3', leaseId: 'l3', ok: true }
  ];
  const truth = deriveObservedConcurrencyTruth({ workerEvents: events, shardPlan, requestedAgentCount: 3, productiveMergedPatchCount: 3 });
  assert.equal(truth.uniqueAgentCount, 3);
  assert.equal(truth.peakConcurrentWorkers, 2);
  assert.equal(truth.activeWorkerMs, 1600);
  assert.equal(truth.idleGapCount, 1);
  assert.equal(truth.longestIdleGapMs, 500);
  assert.equal(truth.assignmentGapCount, 2);
  assert.equal(truth.lanePeakConcurrency.ui, 1);
});

test('scale credit blocks requested tiers that lack observed peak concurrency', () => {
  const truth = deriveObservedConcurrencyTruth({
    workerEvents: [
      { at: at(0), type: 'live_worker_spawned', shardId: 'ui-shell', agentId: 'agent-1', leaseId: 'l1' },
      { at: at(1000), type: 'live_worker_exit', shardId: 'ui-shell', agentId: 'agent-1', leaseId: 'l1', ok: true }
    ],
    shardPlan,
    requestedAgentCount: 3,
    productiveMergedPatchCount: 3
  });
  const credit = evaluateScaleCredit({ concurrencyTruth: truth, requestedAgentCount: 3, productiveMergedPatchCount: 3, shardCount: 3 });
  assert.equal(credit.eligible, false);
  assert.equal(credit.failures.some((failure) => failure.reason === 'insufficient_peak_concurrency'), true);
});

test('scale credit blocks fake scale when merges are not productive landed product work', () => {
  const truth = deriveObservedConcurrencyTruth({
    workerEvents: [
      { at: at(0), type: 'live_worker_spawned', shardId: 'ui-shell', agentId: 'agent-1', leaseId: 'l1' },
      { at: at(0), type: 'live_worker_spawned', shardId: 'campaign-route', agentId: 'agent-2', leaseId: 'l2' },
      { at: at(500), type: 'live_worker_exit', shardId: 'ui-shell', agentId: 'agent-1', leaseId: 'l1', ok: true },
      { at: at(500), type: 'live_worker_exit', shardId: 'campaign-route', agentId: 'agent-2', leaseId: 'l2', ok: true }
    ],
    shardPlan: { shards: shardPlan.shards.slice(0, 2) },
    requestedAgentCount: 2,
    productiveMergedPatchCount: 0
  });
  const credit = evaluateScaleCredit({ concurrencyTruth: truth, requestedAgentCount: 2, productiveMergedPatchCount: 0, shardCount: 2, requireProductiveMerges: true });
  assert.equal(credit.eligible, false);
  assert.equal(credit.failures.some((failure) => failure.reason === 'insufficient_productive_merges'), true);
});

test('scheduler truth report summarizes model, concurrency, and scale credit', () => {
  const patchQueue = {
    merged: [
      { id: 'p1', shardId: 'ui-shell', filePaths: ['apps/web/public/app-shell.jsx'], canonicalLandingRecord: { eligible: true } },
      { id: 'p2', shardId: 'campaign-route', filePaths: ['packages/app/routes/campaigns.mjs'], canonicalLandingRecord: { eligible: true } }
    ],
    rejected: []
  };
  const report = buildSchedulerTruthReport({
    shardPlan: { shards: shardPlan.shards.slice(0, 2) },
    surfaceMatrix: { surfaces: [{ id: 'ui-shell' }, { id: 'campaign-route' }] },
    patchQueue,
    workerEvents: [
      { at: at(0), type: 'live_worker_spawned', shardId: 'ui-shell', agentId: 'agent-1', leaseId: 'l1' },
      { at: at(0), type: 'live_worker_spawned', shardId: 'campaign-route', agentId: 'agent-2', leaseId: 'l2' },
      { at: at(500), type: 'live_worker_exit', shardId: 'ui-shell', agentId: 'agent-1', leaseId: 'l1', ok: true },
      { at: at(500), type: 'live_worker_exit', shardId: 'campaign-route', agentId: 'agent-2', leaseId: 'l2', ok: true }
    ],
    requestedAgentCount: 2
  });
  assert.equal(report.summary.scaleCreditEligible, true);
  assert.equal(report.summary.productiveMergedPatchCount, 2);
  assert.equal(report.summary.peakConcurrentWorkers, 2);
});
