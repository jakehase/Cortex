import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleSentinelSnapshot, createLifecycleSentinelDashboardRoutes, createLifecycleSentinelApiRoutes, createLifecycleSentinelOpsRoutes, createLifecycleSentinelPublicRoutes, createLifecycleSentinelRegistryRoutes, summarizeLifecycleSentinelFixtures } from '../packages/lifecycle-sentinel/index.mjs';

test('lifecycle-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleSentinelDashboardRoutes().length, 3);
  assert.equal(createLifecycleSentinelApiRoutes().length, 4);
  assert.equal(createLifecycleSentinelOpsRoutes().length, 3);
  assert.equal(createLifecycleSentinelPublicRoutes().length, 3);
  assert.equal(createLifecycleSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleSentinelFixtures().contacts, 2);
});

