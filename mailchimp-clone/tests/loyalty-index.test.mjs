import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyIndexSnapshot, createLoyaltyIndexDashboardRoutes, createLoyaltyIndexApiRoutes, createLoyaltyIndexOpsRoutes, createLoyaltyIndexPublicRoutes, createLoyaltyIndexRegistryRoutes, summarizeLoyaltyIndexFixtures } from '../packages/loyalty-index/index.mjs';

test('loyalty-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyIndexDashboardRoutes().length, 3);
  assert.equal(createLoyaltyIndexApiRoutes().length, 4);
  assert.equal(createLoyaltyIndexOpsRoutes().length, 3);
  assert.equal(createLoyaltyIndexPublicRoutes().length, 3);
  assert.equal(createLoyaltyIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyIndexFixtures().contacts, 2);
});

