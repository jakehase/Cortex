import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerStudioSnapshot, createCustomerStudioDashboardRoutes, createCustomerStudioApiRoutes, createCustomerStudioOpsRoutes, createCustomerStudioPublicRoutes, createCustomerStudioRegistryRoutes, summarizeCustomerStudioFixtures } from '../packages/customer-studio/index.mjs';

test('customer-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerStudioDashboardRoutes().length, 3);
  assert.equal(createCustomerStudioApiRoutes().length, 4);
  assert.equal(createCustomerStudioOpsRoutes().length, 3);
  assert.equal(createCustomerStudioPublicRoutes().length, 3);
  assert.equal(createCustomerStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerStudioFixtures().contacts, 2);
});

