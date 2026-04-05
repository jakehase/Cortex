import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerWorkbenchSnapshot, createCustomerWorkbenchDashboardRoutes, createCustomerWorkbenchApiRoutes, createCustomerWorkbenchOpsRoutes, createCustomerWorkbenchPublicRoutes, createCustomerWorkbenchRegistryRoutes, summarizeCustomerWorkbenchFixtures } from '../packages/customer-workbench/index.mjs';

test('customer-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerWorkbenchDashboardRoutes().length, 3);
  assert.equal(createCustomerWorkbenchApiRoutes().length, 4);
  assert.equal(createCustomerWorkbenchOpsRoutes().length, 3);
  assert.equal(createCustomerWorkbenchPublicRoutes().length, 3);
  assert.equal(createCustomerWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerWorkbenchFixtures().contacts, 2);
});

