import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerAdvisorSnapshot, createCustomerAdvisorDashboardRoutes, createCustomerAdvisorApiRoutes, createCustomerAdvisorOpsRoutes, createCustomerAdvisorPublicRoutes, createCustomerAdvisorRegistryRoutes, summarizeCustomerAdvisorFixtures } from '../packages/customer-advisor/index.mjs';

test('customer-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerAdvisorDashboardRoutes().length, 3);
  assert.equal(createCustomerAdvisorApiRoutes().length, 4);
  assert.equal(createCustomerAdvisorOpsRoutes().length, 3);
  assert.equal(createCustomerAdvisorPublicRoutes().length, 3);
  assert.equal(createCustomerAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerAdvisorFixtures().contacts, 2);
});

