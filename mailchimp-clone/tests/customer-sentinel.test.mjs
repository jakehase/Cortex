import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerSentinelSnapshot, createCustomerSentinelDashboardRoutes, createCustomerSentinelApiRoutes, createCustomerSentinelOpsRoutes, createCustomerSentinelPublicRoutes, createCustomerSentinelRegistryRoutes, summarizeCustomerSentinelFixtures } from '../packages/customer-sentinel/index.mjs';

test('customer-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerSentinelDashboardRoutes().length, 3);
  assert.equal(createCustomerSentinelApiRoutes().length, 4);
  assert.equal(createCustomerSentinelOpsRoutes().length, 3);
  assert.equal(createCustomerSentinelPublicRoutes().length, 3);
  assert.equal(createCustomerSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerSentinelFixtures().contacts, 2);
});

