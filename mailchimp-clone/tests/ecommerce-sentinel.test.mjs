import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceSentinelSnapshot, createEcommerceSentinelDashboardRoutes, createEcommerceSentinelApiRoutes, createEcommerceSentinelOpsRoutes, createEcommerceSentinelPublicRoutes, createEcommerceSentinelRegistryRoutes, summarizeEcommerceSentinelFixtures } from '../packages/ecommerce-sentinel/index.mjs';

test('ecommerce-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceSentinelDashboardRoutes().length, 3);
  assert.equal(createEcommerceSentinelApiRoutes().length, 4);
  assert.equal(createEcommerceSentinelOpsRoutes().length, 3);
  assert.equal(createEcommerceSentinelPublicRoutes().length, 3);
  assert.equal(createEcommerceSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceSentinelFixtures().contacts, 2);
});

