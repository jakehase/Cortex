import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyNavigatorSnapshot, createLoyaltyNavigatorDashboardRoutes, createLoyaltyNavigatorApiRoutes, createLoyaltyNavigatorOpsRoutes, createLoyaltyNavigatorPublicRoutes, createLoyaltyNavigatorRegistryRoutes, summarizeLoyaltyNavigatorFixtures } from '../packages/loyalty-navigator/index.mjs';

test('loyalty-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyNavigatorDashboardRoutes().length, 3);
  assert.equal(createLoyaltyNavigatorApiRoutes().length, 4);
  assert.equal(createLoyaltyNavigatorOpsRoutes().length, 3);
  assert.equal(createLoyaltyNavigatorPublicRoutes().length, 3);
  assert.equal(createLoyaltyNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyNavigatorFixtures().contacts, 2);
});

