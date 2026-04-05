import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeSentinelSnapshot, createCreativeSentinelDashboardRoutes, createCreativeSentinelApiRoutes, createCreativeSentinelOpsRoutes, createCreativeSentinelPublicRoutes, createCreativeSentinelRegistryRoutes, summarizeCreativeSentinelFixtures } from '../packages/creative-sentinel/index.mjs';

test('creative-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeSentinelDashboardRoutes().length, 3);
  assert.equal(createCreativeSentinelApiRoutes().length, 4);
  assert.equal(createCreativeSentinelOpsRoutes().length, 3);
  assert.equal(createCreativeSentinelPublicRoutes().length, 3);
  assert.equal(createCreativeSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeSentinelFixtures().contacts, 2);
});

