import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerNotebookSnapshot, createCustomerNotebookDashboardRoutes, createCustomerNotebookApiRoutes, createCustomerNotebookOpsRoutes, createCustomerNotebookPublicRoutes, createCustomerNotebookRegistryRoutes, summarizeCustomerNotebookFixtures } from '../packages/customer-notebook/index.mjs';

test('customer-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerNotebookDashboardRoutes().length, 3);
  assert.equal(createCustomerNotebookApiRoutes().length, 4);
  assert.equal(createCustomerNotebookOpsRoutes().length, 3);
  assert.equal(createCustomerNotebookPublicRoutes().length, 3);
  assert.equal(createCustomerNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerNotebookFixtures().contacts, 2);
});

