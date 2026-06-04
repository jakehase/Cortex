import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePositiveIntegerList,
  resolveAdaptiveConcurrencyTiers,
  resolveRequestedAgentCount,
  resolveScaleProofPreflight,
  scaleProofMinimumsForAgentCount
} from '../scripts/lib/orchestrator-adaptive-concurrency.mjs';

test('adaptive concurrency starts at 100 when a full-clone run requests 100 and the backlog is huge', () => {
  const requestedTiers = parsePositiveIntegerList('8,16,32,64,100');
  const requestedAgentCount = resolveRequestedAgentCount({
    env: { MAILCHIMP_REQUESTED_AGENT_COUNT: '100' },
    requestedTiers
  });
  const plan = resolveAdaptiveConcurrencyTiers({
    requestedTiers,
    requestedAgentCount,
    shardCount: 1628,
    requestedFidelity: 'full_clone',
    env: {}
  });

  assert.equal(plan.mode, 'adaptive_concurrency');
  assert.equal(plan.adaptiveTarget, 100);
  assert.deepEqual(plan.resolvedTiers, [100]);
  assert.equal(plan.downscaled, false);
  assert.equal(plan.blocker, null);
});

test('adaptive concurrency downshifts to the largest supported tier as backlog shrinks', () => {
  const plan = resolveAdaptiveConcurrencyTiers({
    requestedTiers: [8, 16, 32, 64, 100],
    requestedAgentCount: 100,
    shardCount: 58,
    requestedFidelity: 'full_clone',
    env: {}
  });

  assert.equal(plan.mode, 'adaptive_concurrency');
  assert.equal(plan.adaptiveTarget, 32);
  assert.deepEqual(plan.resolvedTiers, [32]);
  assert.equal(plan.downscaled, true);
  assert.match(plan.reason, /only 58 runnable shards/);
});

test('adaptive concurrency permits an 8-agent tail only when the remaining backlog is small', () => {
  const plan = resolveAdaptiveConcurrencyTiers({
    requestedTiers: [8, 16, 32, 64, 100],
    requestedAgentCount: 100,
    shardCount: 13,
    requestedFidelity: 'full_clone',
    env: {}
  });

  assert.equal(plan.mode, 'adaptive_concurrency');
  assert.equal(plan.adaptiveTarget, 8);
  assert.deepEqual(plan.resolvedTiers, [8]);
  assert.equal(plan.blocker, null);
});

test('adaptive concurrency blocks silent low-tier fallback when scalable tiers are missing', () => {
  const plan = resolveAdaptiveConcurrencyTiers({
    requestedTiers: [8],
    requestedAgentCount: 100,
    shardCount: 500,
    requestedFidelity: 'full_clone',
    env: {}
  });

  assert.equal(plan.mode, 'blocked');
  assert.deepEqual(plan.resolvedTiers, [8]);
  assert.match(plan.blocker.blocker, /resolved only to 8/);
  assert.match(plan.blocker.nextAction, /32,64,100/);
});

test('non full-clone runs keep the staged ladder unchanged', () => {
  const plan = resolveAdaptiveConcurrencyTiers({
    requestedTiers: [8, 16, 32],
    requestedAgentCount: 32,
    shardCount: 1000,
    requestedFidelity: 'parity_for_scope',
    env: {}
  });

  assert.equal(plan.mode, 'staged_ladder');
  assert.deepEqual(plan.resolvedTiers, [8, 16, 32]);
});

test('scale proof preflight blocks targeted repair config before high-scale final-boss launch', () => {
  const preflight = resolveScaleProofPreflight({
    requestedTiers: [100],
    requestedAgentCount: 100,
    requestedFidelity: 'full_clone',
    shardPlan: { summary: { shardCount: 188, initialReadyCount: 144, laneCount: 11, domainCount: 11 } },
    env: { MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS: 'focus.api_keys_webhooks' }
  });

  assert.equal(preflight.ok, false);
  assert.equal(preflight.scaleProofRequired, true);
  assert.deepEqual(preflight.targetFocusIds, ['focus.api_keys_webhooks']);
  assert.equal(preflight.failures[0].reason, 'targeted_focus_set_active_for_high_scale_full_clone');
});

test('scale proof preflight accepts broad final-boss launch with enough ready shards and lane diversity', () => {
  const preflight = resolveScaleProofPreflight({
    requestedTiers: [100],
    requestedAgentCount: 100,
    requestedFidelity: 'full_clone',
    shardPlan: { summary: { shardCount: 188, initialReadyCount: 144, laneCount: 11, domainCount: 11 } },
    env: {}
  });

  assert.equal(preflight.ok, true);
  assert.equal(preflight.minimums.minimumObservedAgents, 20);
  assert.equal(preflight.minimums.minimumPeakConcurrentWorkers, 10);
});

test('scale proof preflight blocks high-scale launch when execution-plane resources are below gate', () => {
  const preflight = resolveScaleProofPreflight({
    requestedTiers: [100],
    requestedAgentCount: 100,
    requestedFidelity: 'full_clone',
    shardPlan: { summary: { shardCount: 188, initialReadyCount: 144, laneCount: 11, domainCount: 11 } },
    resourcePreflight: {
      ok: false,
      status: 'resource_preflight_blocked',
      failures: [{ reason: 'file_descriptor_limit_too_low', fileDescriptorLimit: 1024, minimumFileDescriptorLimit: 3200 }],
      blocker: { nextAction: 'Raise ulimit before relaunch.' }
    },
    env: {}
  });

  assert.equal(preflight.ok, false);
  assert.equal(preflight.resourcePreflight.status, 'resource_preflight_blocked');
  assert.equal(preflight.failures.at(-1).reason, 'resource_preflight_failed');
  assert.match(preflight.blocker.nextAction, /Raise ulimit/);
});

test('scale proof minimums mirror supervisor truth thresholds', () => {
  assert.deepEqual(scaleProofMinimumsForAgentCount(100), {
    requestedAgentCount: 100,
    minimumObservedAgents: 20,
    minimumPeakConcurrentWorkers: 10
  });
});
