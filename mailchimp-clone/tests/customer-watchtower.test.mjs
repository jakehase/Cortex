import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerWatchtowerSnapshot, createCustomerWatchtowerDashboardRoutes, createCustomerWatchtowerApiRoutes, createCustomerWatchtowerOpsRoutes, createCustomerWatchtowerPublicRoutes, createCustomerWatchtowerRegistryRoutes, summarizeCustomerWatchtowerFixtures } from '../packages/customer-watchtower/index.mjs';

test('customer-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerWatchtowerDashboardRoutes().length, 3);
  assert.equal(createCustomerWatchtowerApiRoutes().length, 4);
  assert.equal(createCustomerWatchtowerOpsRoutes().length, 3);
  assert.equal(createCustomerWatchtowerPublicRoutes().length, 3);
  assert.equal(createCustomerWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerWatchtowerFixtures().contacts, 2);
});

