import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerCockpitSnapshot, createCustomerCockpitDashboardRoutes, createCustomerCockpitApiRoutes, createCustomerCockpitOpsRoutes, createCustomerCockpitPublicRoutes, createCustomerCockpitRegistryRoutes, summarizeCustomerCockpitFixtures } from '../packages/customer-cockpit/index.mjs';

test('customer-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerCockpitDashboardRoutes().length, 3);
  assert.equal(createCustomerCockpitApiRoutes().length, 4);
  assert.equal(createCustomerCockpitOpsRoutes().length, 3);
  assert.equal(createCustomerCockpitPublicRoutes().length, 3);
  assert.equal(createCustomerCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerCockpitFixtures().contacts, 2);
});

