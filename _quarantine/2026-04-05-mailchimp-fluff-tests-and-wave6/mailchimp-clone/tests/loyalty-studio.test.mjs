import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyStudioSnapshot, createLoyaltyStudioDashboardRoutes, createLoyaltyStudioApiRoutes, createLoyaltyStudioOpsRoutes, createLoyaltyStudioPublicRoutes, createLoyaltyStudioRegistryRoutes, summarizeLoyaltyStudioFixtures } from '../packages/loyalty-studio/index.mjs';

test('loyalty-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyStudioDashboardRoutes().length, 3);
  assert.equal(createLoyaltyStudioApiRoutes().length, 4);
  assert.equal(createLoyaltyStudioOpsRoutes().length, 3);
  assert.equal(createLoyaltyStudioPublicRoutes().length, 3);
  assert.equal(createLoyaltyStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyStudioFixtures().contacts, 2);
});

