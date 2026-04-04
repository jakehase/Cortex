import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyGridSnapshot, createLoyaltyGridDashboardRoutes, createLoyaltyGridApiRoutes, createLoyaltyGridOpsRoutes, createLoyaltyGridPublicRoutes, createLoyaltyGridRegistryRoutes, summarizeLoyaltyGridFixtures } from '../packages/loyalty-grid/index.mjs';

test('loyalty-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyGridDashboardRoutes().length, 3);
  assert.equal(createLoyaltyGridApiRoutes().length, 4);
  assert.equal(createLoyaltyGridOpsRoutes().length, 3);
  assert.equal(createLoyaltyGridPublicRoutes().length, 3);
  assert.equal(createLoyaltyGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyGridFixtures().contacts, 2);
});

