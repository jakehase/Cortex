import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingWatchtowerSnapshot, createBillingWatchtowerDashboardRoutes, createBillingWatchtowerApiRoutes, createBillingWatchtowerOpsRoutes, createBillingWatchtowerPublicRoutes, createBillingWatchtowerRegistryRoutes, summarizeBillingWatchtowerFixtures } from '../packages/billing-watchtower/index.mjs';

test('billing-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingWatchtowerDashboardRoutes().length, 3);
  assert.equal(createBillingWatchtowerApiRoutes().length, 4);
  assert.equal(createBillingWatchtowerOpsRoutes().length, 3);
  assert.equal(createBillingWatchtowerPublicRoutes().length, 3);
  assert.equal(createBillingWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingWatchtowerFixtures().contacts, 2);
});

