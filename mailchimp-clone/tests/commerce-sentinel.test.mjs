import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceSentinelSnapshot, createCommerceSentinelDashboardRoutes, createCommerceSentinelApiRoutes, createCommerceSentinelOpsRoutes, createCommerceSentinelPublicRoutes, createCommerceSentinelRegistryRoutes, summarizeCommerceSentinelFixtures } from '../packages/commerce-sentinel/index.mjs';

test('commerce-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceSentinelDashboardRoutes().length, 3);
  assert.equal(createCommerceSentinelApiRoutes().length, 4);
  assert.equal(createCommerceSentinelOpsRoutes().length, 3);
  assert.equal(createCommerceSentinelPublicRoutes().length, 3);
  assert.equal(createCommerceSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceSentinelFixtures().contacts, 2);
});

