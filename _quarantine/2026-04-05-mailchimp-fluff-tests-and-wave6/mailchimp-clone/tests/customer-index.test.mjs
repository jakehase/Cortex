import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerIndexSnapshot, createCustomerIndexDashboardRoutes, createCustomerIndexApiRoutes, createCustomerIndexOpsRoutes, createCustomerIndexPublicRoutes, createCustomerIndexRegistryRoutes, summarizeCustomerIndexFixtures } from '../packages/customer-index/index.mjs';

test('customer-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerIndexDashboardRoutes().length, 3);
  assert.equal(createCustomerIndexApiRoutes().length, 4);
  assert.equal(createCustomerIndexOpsRoutes().length, 3);
  assert.equal(createCustomerIndexPublicRoutes().length, 3);
  assert.equal(createCustomerIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerIndexFixtures().contacts, 2);
});

