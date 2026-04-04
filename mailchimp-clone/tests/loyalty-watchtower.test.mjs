import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyWatchtowerSnapshot, createLoyaltyWatchtowerDashboardRoutes, createLoyaltyWatchtowerApiRoutes, createLoyaltyWatchtowerOpsRoutes, createLoyaltyWatchtowerPublicRoutes, createLoyaltyWatchtowerRegistryRoutes, summarizeLoyaltyWatchtowerFixtures } from '../packages/loyalty-watchtower/index.mjs';

test('loyalty-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyWatchtowerDashboardRoutes().length, 3);
  assert.equal(createLoyaltyWatchtowerApiRoutes().length, 4);
  assert.equal(createLoyaltyWatchtowerOpsRoutes().length, 3);
  assert.equal(createLoyaltyWatchtowerPublicRoutes().length, 3);
  assert.equal(createLoyaltyWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyWatchtowerFixtures().contacts, 2);
});

