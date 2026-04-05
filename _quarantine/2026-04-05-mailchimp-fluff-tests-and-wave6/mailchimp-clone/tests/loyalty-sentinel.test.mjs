import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltySentinelSnapshot, createLoyaltySentinelDashboardRoutes, createLoyaltySentinelApiRoutes, createLoyaltySentinelOpsRoutes, createLoyaltySentinelPublicRoutes, createLoyaltySentinelRegistryRoutes, summarizeLoyaltySentinelFixtures } from '../packages/loyalty-sentinel/index.mjs';

test('loyalty-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltySentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltySentinelDashboardRoutes().length, 3);
  assert.equal(createLoyaltySentinelApiRoutes().length, 4);
  assert.equal(createLoyaltySentinelOpsRoutes().length, 3);
  assert.equal(createLoyaltySentinelPublicRoutes().length, 3);
  assert.equal(createLoyaltySentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltySentinelFixtures().contacts, 2);
});

