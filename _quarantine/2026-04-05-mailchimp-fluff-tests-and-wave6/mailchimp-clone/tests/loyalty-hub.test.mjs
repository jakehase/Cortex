import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyHubSnapshot, createLoyaltyHubDashboardRoutes, createLoyaltyHubApiRoutes, createLoyaltyHubOpsRoutes, createLoyaltyHubPublicRoutes, createLoyaltyHubRegistryRoutes, summarizeLoyaltyHubFixtures } from '../packages/loyalty-hub/index.mjs';

test('loyalty-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyHubDashboardRoutes().length, 3);
  assert.equal(createLoyaltyHubApiRoutes().length, 4);
  assert.equal(createLoyaltyHubOpsRoutes().length, 3);
  assert.equal(createLoyaltyHubPublicRoutes().length, 3);
  assert.equal(createLoyaltyHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyHubFixtures().contacts, 2);
});

