import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceHubSnapshot, createCommerceHubDashboardRoutes, createCommerceHubApiRoutes, createCommerceHubOpsRoutes, createCommerceHubPublicRoutes, createCommerceHubRegistryRoutes, summarizeCommerceHubFixtures } from '../packages/commerce-hub/index.mjs';

test('commerce-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceHubDashboardRoutes().length, 3);
  assert.equal(createCommerceHubApiRoutes().length, 4);
  assert.equal(createCommerceHubOpsRoutes().length, 3);
  assert.equal(createCommerceHubPublicRoutes().length, 3);
  assert.equal(createCommerceHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceHubFixtures().contacts, 2);
});

