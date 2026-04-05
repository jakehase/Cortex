import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerConsoleSnapshot, createCustomerConsoleDashboardRoutes, createCustomerConsoleApiRoutes, createCustomerConsoleOpsRoutes, createCustomerConsolePublicRoutes, createCustomerConsoleRegistryRoutes, summarizeCustomerConsoleFixtures } from '../packages/customer-console/index.mjs';

test('customer-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerConsoleDashboardRoutes().length, 3);
  assert.equal(createCustomerConsoleApiRoutes().length, 4);
  assert.equal(createCustomerConsoleOpsRoutes().length, 3);
  assert.equal(createCustomerConsolePublicRoutes().length, 3);
  assert.equal(createCustomerConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerConsoleFixtures().contacts, 2);
});

