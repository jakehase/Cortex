import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyFoundrySnapshot, createLoyaltyFoundryDashboardRoutes, createLoyaltyFoundryApiRoutes, createLoyaltyFoundryOpsRoutes, createLoyaltyFoundryPublicRoutes, createLoyaltyFoundryRegistryRoutes, summarizeLoyaltyFoundryFixtures } from '../packages/loyalty-foundry/index.mjs';

test('loyalty-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyFoundryDashboardRoutes().length, 3);
  assert.equal(createLoyaltyFoundryApiRoutes().length, 4);
  assert.equal(createLoyaltyFoundryOpsRoutes().length, 3);
  assert.equal(createLoyaltyFoundryPublicRoutes().length, 3);
  assert.equal(createLoyaltyFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyFoundryFixtures().contacts, 2);
});

