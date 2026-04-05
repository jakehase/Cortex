import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingCockpitSnapshot, createBillingCockpitDashboardRoutes, createBillingCockpitApiRoutes, createBillingCockpitOpsRoutes, createBillingCockpitPublicRoutes, createBillingCockpitRegistryRoutes, summarizeBillingCockpitFixtures } from '../packages/billing-cockpit/index.mjs';

test('billing-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingCockpitDashboardRoutes().length, 3);
  assert.equal(createBillingCockpitApiRoutes().length, 4);
  assert.equal(createBillingCockpitOpsRoutes().length, 3);
  assert.equal(createBillingCockpitPublicRoutes().length, 3);
  assert.equal(createBillingCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingCockpitFixtures().contacts, 2);
});

