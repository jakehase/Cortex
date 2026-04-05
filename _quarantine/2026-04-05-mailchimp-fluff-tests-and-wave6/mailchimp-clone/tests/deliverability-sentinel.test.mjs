import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilitySentinelSnapshot, createDeliverabilitySentinelDashboardRoutes, createDeliverabilitySentinelApiRoutes, createDeliverabilitySentinelOpsRoutes, createDeliverabilitySentinelPublicRoutes, createDeliverabilitySentinelRegistryRoutes, summarizeDeliverabilitySentinelFixtures } from '../packages/deliverability-sentinel/index.mjs';

test('deliverability-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilitySentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilitySentinelDashboardRoutes().length, 3);
  assert.equal(createDeliverabilitySentinelApiRoutes().length, 4);
  assert.equal(createDeliverabilitySentinelOpsRoutes().length, 3);
  assert.equal(createDeliverabilitySentinelPublicRoutes().length, 3);
  assert.equal(createDeliverabilitySentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilitySentinelFixtures().contacts, 2);
});

