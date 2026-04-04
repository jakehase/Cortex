import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceWatchtowerSnapshot, createEcommerceWatchtowerDashboardRoutes, createEcommerceWatchtowerApiRoutes, createEcommerceWatchtowerOpsRoutes, createEcommerceWatchtowerPublicRoutes, createEcommerceWatchtowerRegistryRoutes, summarizeEcommerceWatchtowerFixtures } from '../packages/ecommerce-watchtower/index.mjs';

test('ecommerce-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceWatchtowerDashboardRoutes().length, 3);
  assert.equal(createEcommerceWatchtowerApiRoutes().length, 4);
  assert.equal(createEcommerceWatchtowerOpsRoutes().length, 3);
  assert.equal(createEcommerceWatchtowerPublicRoutes().length, 3);
  assert.equal(createEcommerceWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceWatchtowerFixtures().contacts, 2);
});

